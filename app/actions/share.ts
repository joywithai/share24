'use server';

import { cookies, headers } from 'next/headers';

import { getSession } from '@/lib/auth';
import { expiryFrom, isShareExpired } from '@/lib/expire';
import { filesProblem, mimeTypeFor, sanitizeDisplayName } from '@/lib/file';
import { bytesProblem, SNIFF_BYTES } from '@/lib/file-magic';
import {
  verifyPin as comparePinWithHash,
  createUnlockToken,
  hashPin,
  UNLOCK_TTL_MS,
  unlockCookieName,
} from '@/lib/pin';
import { prisma } from '@/lib/prisma';
import { normalizeRoute, routeProblem } from '@/lib/route';
import { codeShareSchema } from '@/lib/schemas';
import { logSecurityEvent } from '@/lib/security/events';
import { guardAction } from '@/lib/security/guard';
import { clientIp } from '@/lib/security/ip';
import { maintenanceState } from '@/lib/settings';
import { getStorageProvider, type StorageLocation } from '@/lib/storage';

export interface ShareResult {
  ok: boolean;
  error?: string;
  route?: string;
}

export interface PinFormState {
  ok: boolean;
  error?: string;
  expired?: boolean;
}

/** Live "is this slug still free?" answer for the route input. */
export interface RouteStatus {
  state: 'invalid' | 'free' | 'taken';
  message: string | null;
}

const ROUTE_TAKEN_ERROR =
  'That route is already in use by an active share. Pick another one, or wait for the current share to expire (24h max).';

/** The share author's user id (null when anonymous). */
async function currentUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.user?.id ?? null;
}

/** Who is calling, as far as the forwarding headers reveal. */
async function caller(): Promise<{
  ip: string;
  userAgent: string | null;
  userId: string | null;
  isAdmin: boolean;
}> {
  const headerList = await headers();
  const userId = await currentUserId();

  // The role is only looked up for signed-in callers, which is rare — and it
  // is what lets an administrator keep working while maintenance mode is on.
  let isAdmin = false;
  if (userId) {
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });
    isAdmin = account?.role === 'admin' && account.status === 'active';
  }

  return {
    ip: clientIp(headerList),
    userAgent: headerList.get('user-agent'),
    userId,
    isAdmin,
  };
}

/**
 * After creating (or unlocking) a PIN-protected share, the browser that just
 * proved it knows the PIN gets a short-lived unlock cookie for that route.
 */
async function setUnlockCookieForRoute(route: string, expiresAt: Date) {
  const validUntil = Math.min(expiresAt.getTime(), Date.now() + UNLOCK_TTL_MS);
  const token = createUnlockToken(route, validUntil);
  const store = await cookies();
  store.set(unlockCookieName(route), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(validUntil),
  });
}

/**
 * Cheap availability probe for the create forms: called (debounced) on every
 * keystroke so the route input can show ✓ / ✕ before the user submits. The
 * authoritative check still happens inside the create transactions below.
 */
export async function routeStatus(input: unknown): Promise<RouteStatus> {
  const route = normalizeRoute(String(input ?? ''));
  const problem = routeProblem(route);
  if (problem) return { state: 'invalid', message: problem };

  // Typed on every keystroke — the cheapest possible probe, but still a
  // database read per call, so it gets its own (generous) limit.
  const who = await caller();
  const guard = await guardAction('lookup', {
    ip: who.ip,
    userId: who.userId,
    userAgent: who.userAgent,
  });
  if (!guard.ok) return { state: 'invalid', message: guard.message };

  const now = new Date();
  const taken = await prisma.share.findFirst({
    where: { route, isExpired: false, expiresAt: { gt: now } },
    select: { id: true },
  });
  return taken
    ? { state: 'taken', message: ROUTE_TAKEN_ERROR }
    : { state: 'free', message: null };
}

/** Visitors cannot create shares while maintenance mode is on. */
async function maintenanceRefusal(isAdmin: boolean): Promise<string | null> {
  const state = await maintenanceState();
  if (!state.active || isAdmin) return null;
  return `${state.message} (Maintenance mode — nothing was created.)`;
}

/**
 * Create a code/text share.
 *
 * Server-side validation is mandatory — the client-side Zod pass can be
 * bypassed, so everything is re-checked here: schema, route rules and
 * availability.
 */
export async function createCodeShare(input: unknown): Promise<ShareResult> {
  // Rate limit before anything touches the database.
  const author = await caller();
  const guard = await guardAction('create', {
    ip: author.ip,
    userId: author.userId,
    userAgent: author.userAgent,
  });
  if (!guard.ok) return { ok: false, error: guard.message };

  const maintenance = await maintenanceRefusal(author.isAdmin);
  if (maintenance) return { ok: false, error: maintenance };

  const parsed = codeShareSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const { code, pin } = parsed.data;
  const route = normalizeRoute(parsed.data.route);
  const problem = routeProblem(route);
  if (problem) {
    return { ok: false, error: problem };
  }

  const now = new Date();
  const expiresAt = expiryFrom(now);

  const outcome = await prisma.$transaction(async (tx) => {
    // Availability = no *active* share owns this route right now. Expired
    // shares release their routes automatically.
    const taken = await tx.share.findFirst({
      where: { route, isExpired: false, expiresAt: { gt: now } },
      select: { id: true },
    });
    if (taken) return 'taken' as const;

    await tx.share.create({
      data: {
        type: 'code',
        route,
        content: code,
        pinHash: pin ? await hashPin(pin) : null,
        expiresAt,
        userId: await currentUserId(),
      },
    });
    return 'created' as const;
  });

  if (outcome === 'taken') {
    return { ok: false, error: ROUTE_TAKEN_ERROR };
  }

  if (pin) {
    await setUnlockCookieForRoute(route, expiresAt);
  }

  return { ok: true, route };
}

/**
 * Create a file share — one route carrying 1–10 files.
 *
 * Order matters: validate → store the files through the configured storage
 * provider → (transaction) check route availability + create the share and one
 * ShareFile row per file. If the database step fails, the bytes that were just
 * written are removed again, so storage and metadata cannot drift apart.
 *
 * Which provider is used comes from `STORAGE_TYPE` (`LOCAL` by default); the
 * row records the choice, so a later switch to R2 never orphans this share.
 */
export async function createFileShare(
  formData: FormData,
): Promise<ShareResult> {
  const author = await caller();
  // Uploads use their own window: a set of files is heavier than a snippet,
  // but an author moving a few sets deserves more than ten of them an hour.
  const guard = await guardAction('upload', {
    ip: author.ip,
    userId: author.userId,
    userAgent: author.userAgent,
  });
  if (!guard.ok) return { ok: false, error: guard.message };

  const maintenance = await maintenanceRefusal(author.isAdmin);
  if (maintenance) return { ok: false, error: maintenance };

  const route = normalizeRoute(String(formData.get('route') ?? ''));
  const pin = String(formData.get('pin') ?? '');

  const problem = routeProblem(route);
  if (problem) return { ok: false, error: problem };
  if (pin && !/^\d{4}$/.test(pin)) {
    return { ok: false, error: 'PIN must be exactly 4 digits.' };
  }

  // The picker sends every file under `files` (repeated); `file` is still
  // accepted so an old form — or a hand-made request — keeps working.
  const files = [
    ...formData.getAll('files'),
    ...formData.getAll('file'),
  ].filter((entry): entry is File => entry instanceof File);

  const fileIssue = filesProblem(files);
  if (fileIssue) return { ok: false, error: fileIssue };

  // The name and the browser's MIME type are both claims the uploader
  // controls; the first bytes are not. A renamed archive or a fake image is
  // refused here, before anything is written.
  for (const file of files) {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const issue = bytesProblem({ name: file.name, type: file.type }, head);
    if (issue) {
      await logSecurityEvent({
        type: 'suspicious_upload',
        severity: 'warning',
        ip: author.ip,
        route,
        userId: author.userId,
        userAgent: author.userAgent,
        detail: `${file.name}: ${issue}`,
      });
      return { ok: false, error: issue };
    }
  }

  const now = new Date();
  const expiresAt = expiryFrom(now);

  const provider = getStorageProvider();
  const shareId = crypto.randomUUID();

  // The metadata the database needs, plus a lazy byte reader per file: the
  // provider pulls one file's bytes while it writes it, so a 10-file / 50 MB
  // share never has to sit in memory as a whole. The stored name (and with it
  // the extension a browser sees) is the provider's job — see
  // lib/storage/naming.ts.
  const uploads = files.map((file, position) => {
    // The name we keep and send back is the sanitized one: no control or
    // bidi characters, no path separators, sane length (see lib/file.ts).
    const displayName = sanitizeDisplayName(file.name);
    return {
      fileName: displayName,
      position,
      fileSize: file.size,
      mimeType: mimeTypeFor(displayName, file.type),
      bytes: async () => new Uint8Array(await file.arrayBuffer()),
    };
  });

  // A provider that fails halfway removes its own partial writes.
  const locations: StorageLocation[] = await provider.save(shareId, uploads);

  let outcome: 'taken' | 'created';
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const taken = await tx.share.findFirst({
        where: { route, isExpired: false, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (taken) return 'taken' as const;

      await tx.share.create({
        data: {
          id: shareId,
          type: 'file',
          route,
          pinHash: pin ? await hashPin(pin) : null,
          expiresAt,
          userId: await currentUserId(),
        },
      });
      await tx.shareFile.createMany({
        data: uploads.map((entry, index) => ({
          shareId,
          storedPath: locations[index].storedPath,
          storageType: locations[index].storageType,
          r2Key: locations[index].r2Key,
          r2Bucket: locations[index].r2Bucket,
          fileName: entry.fileName,
          fileSize: entry.fileSize,
          mimeType: entry.mimeType,
          position: entry.position,
        })),
      });
      return 'created' as const;
    });
  } catch (error) {
    await provider.deleteShare(shareId).catch(() => {});
    throw error;
  }

  if (outcome === 'taken') {
    await provider.deleteShare(shareId).catch(() => {});
    return { ok: false, error: ROUTE_TAKEN_ERROR };
  }

  if (pin) {
    await setUnlockCookieForRoute(route, expiresAt);
  }

  return { ok: true, route };
}

/**
 * Verify a PIN for a protected share (useActionState).
 * On success an unlock cookie is set so the content page and the download
 * route accept the request until the cookie (or the share) expires.
 */
export async function verifyPinAction(
  _prevState: PinFormState,
  formData: FormData,
): Promise<PinFormState> {
  const shareId = String(formData.get('shareId') ?? '');
  const route = String(formData.get('route') ?? '');
  const pin = String(formData.get('pin') ?? '');

  // PINs are four digits — 10 000 guesses is nothing without a limit, so the
  // attempt counter is per address *and* per route.
  const who = await caller();
  const guard = await guardAction('pin', {
    ip: who.ip,
    route,
    userId: who.userId,
    userAgent: who.userAgent,
  });
  if (!guard.ok) return { ok: false, error: guard.message };

  if (!shareId || !route) {
    return {
      ok: false,
      error: 'This share is no longer available.',
      expired: true,
    };
  }

  const share = await prisma.share.findUnique({
    where: { id: shareId },
    select: { route: true, pinHash: true, isExpired: true, expiresAt: true },
  });

  if (!share || share.route !== route) {
    return {
      ok: false,
      error: 'This share is no longer available.',
      expired: true,
    };
  }
  if (isShareExpired(share)) {
    return { ok: false, error: 'This share has expired.', expired: true };
  }
  if (!share.pinHash) {
    return { ok: true };
  }

  const valid = await comparePinWithHash(pin, share.pinHash);
  if (!valid) {
    await logSecurityEvent({
      type: 'pin_failure',
      severity: 'warning',
      ip: who.ip,
      route: share.route,
      userId: who.userId,
      userAgent: who.userAgent,
      detail: 'wrong PIN for a protected share',
    });
    return { ok: false, error: 'Incorrect PIN — please try again.' };
  }

  await setUnlockCookieForRoute(share.route, share.expiresAt);
  return { ok: true };
}
