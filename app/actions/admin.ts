'use server';

import { revalidatePath } from 'next/cache';

import { type AdminUser, currentAdmin, recordAdminAction } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { blockIp, clearBlockCache, unblockIp } from '@/lib/security/events';
import { clearViolations } from '@/lib/security/guard';
import { normalizeIp } from '@/lib/security/ip';
import { setSetting } from '@/lib/settings';
import { providerFor } from '@/lib/storage';

/**
 * Admin actions.
 *
 * Every one of them starts with the same two lines — resolve the *real*
 * administrator from the session, and refuse if there is none. The middleware
 * is a convenience for the browser; this is the check that cannot be skipped by
 * posting straight to a server action.
 *
 * Destructive actions are explicit about what they remove, and every change
 * leaves an `AdminLog` row.
 */

export interface AdminActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const NOT_ALLOWED: AdminActionResult = {
  ok: false,
  error: 'Not allowed.',
};

async function asAdmin(): Promise<AdminUser | null> {
  return currentAdmin();
}

function revalidateAdmin(): void {
  revalidatePath('/admin');
  revalidatePath('/admin/shares');
  revalidatePath('/admin/users');
  revalidatePath('/admin/files');
  revalidatePath('/admin/security');
  revalidatePath('/admin/storage');
  revalidatePath('/admin/logs');
  revalidatePath('/admin/settings');
}

/** The id inside a hidden form field, or `null` when it is missing. */
function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

export async function expireShareAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await asAdmin();
  if (!admin) return NOT_ALLOWED;

  const id = field(formData, 'id');
  if (!id) return { ok: false, error: 'Missing share id.' };

  const share = await prisma.share.update({
    where: { id },
    data: { isExpired: true },
    select: { route: true },
  });

  await recordAdminAction({
    actor: admin,
    action: 'share.expire',
    target: id,
    detail: `/${share.route}`,
  });
  revalidateAdmin();
  return { ok: true, message: `/${share.route} expired.` };
}

export async function deleteShareAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await asAdmin();
  if (!admin) return NOT_ALLOWED;

  const id = field(formData, 'id');
  if (!id) return { ok: false, error: 'Missing share id.' };

  const share = await prisma.share.findUnique({
    where: { id },
    select: {
      route: true,
      files: {
        select: {
          storedPath: true,
          storageType: true,
          r2Key: true,
          r2Bucket: true,
        },
      },
    },
  });
  if (!share) return { ok: false, error: 'That share is already gone.' };

  // Bytes first: a row deleted while its files stay would be an orphan that
  // nothing points at any more. A storage failure must not stop the delete —
  // the row is what makes the link work — so it is logged and moved past.
  for (const file of share.files) {
    try {
      await providerFor(file).delete(file);
    } catch (error) {
      console.warn(
        `[admin] could not delete bytes for ${file.storedPath}`,
        error,
      );
    }
  }

  await prisma.share.delete({ where: { id } });

  await recordAdminAction({
    actor: admin,
    action: 'share.delete',
    target: id,
    detail: `/${share.route} (${share.files.length} file${share.files.length === 1 ? '' : 's'})`,
  });
  revalidateAdmin();
  return { ok: true, message: `/${share.route} deleted.` };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function updateUserRoleAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await asAdmin();
  if (!admin) return NOT_ALLOWED;

  const id = field(formData, 'id');
  const role = field(formData, 'role');
  if (role !== 'admin' && role !== 'user') {
    return { ok: false, error: 'Unknown role.' };
  }
  if (id === admin.id && role !== 'admin') {
    return {
      ok: false,
      error: 'You cannot remove your own administrator access.',
    };
  }

  const user = await prisma.user.update({
    where: { id },
    data: { role },
    select: { email: true },
  });

  await recordAdminAction({
    actor: admin,
    action: 'user.role',
    target: id,
    detail: `${user.email} → ${role}`,
  });
  revalidateAdmin();
  return { ok: true, message: `${user.email} is now ${role}.` };
}

export async function updateUserStatusAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await asAdmin();
  if (!admin) return NOT_ALLOWED;

  const id = field(formData, 'id');
  const status = field(formData, 'status');
  if (status !== 'active' && status !== 'suspended') {
    return { ok: false, error: 'Unknown status.' };
  }
  if (id === admin.id && status === 'suspended') {
    return { ok: false, error: 'You cannot suspend your own account.' };
  }

  const user = await prisma.user.update({
    where: { id },
    data: { status },
    select: { email: true },
  });

  // A suspended account must not keep signed-in sessions alive.
  if (status === 'suspended') {
    await prisma.session.deleteMany({ where: { userId: id } });
  }

  await recordAdminAction({
    actor: admin,
    action: 'user.status',
    target: id,
    detail: `${user.email} → ${status}`,
  });
  revalidateAdmin();
  return { ok: true, message: `${user.email} is now ${status}.` };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function deleteFileAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await asAdmin();
  if (!admin) return NOT_ALLOWED;

  const id = field(formData, 'id');
  const file = await prisma.shareFile.findUnique({
    where: { id },
    select: {
      id: true,
      fileName: true,
      storedPath: true,
      storageType: true,
      r2Key: true,
      r2Bucket: true,
      share: { select: { route: true } },
    },
  });
  if (!file) return { ok: false, error: 'That file is already gone.' };

  try {
    await providerFor(file).delete(file);
  } catch (error) {
    console.warn(
      `[admin] could not delete bytes for ${file.storedPath}`,
      error,
    );
  }
  await prisma.shareFile.delete({ where: { id } });

  await recordAdminAction({
    actor: admin,
    action: 'file.delete',
    target: id,
    detail: `${file.fileName} (/${file.share.route})`,
  });
  revalidateAdmin();
  return { ok: true, message: `${file.fileName} deleted.` };
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export async function blockIpAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await asAdmin();
  if (!admin) return NOT_ALLOWED;

  const ip = field(formData, 'ip');
  const reason = field(formData, 'reason') || 'blocked from the admin panel';
  const minutes = Number(field(formData, 'minutes') || '0');

  if (!ip) return { ok: false, error: 'Enter an address.' };
  const normalized = normalizeIp(ip);
  if (!normalized) return { ok: false, error: `"${ip}" is not an IP address.` };

  const blocked = await blockIp({
    ip: normalized,
    reason,
    durationMs:
      Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null,
    blockedBy: admin.email,
  });
  if (!blocked) return { ok: false, error: 'Could not write the block.' };

  await recordAdminAction({
    actor: admin,
    action: 'security.block',
    target: normalized,
    detail:
      Number.isFinite(minutes) && minutes > 0
        ? `${minutes} minutes — ${reason}`
        : `permanent — ${reason}`,
  });
  revalidateAdmin();
  return { ok: true, message: `${normalized} blocked.` };
}

export async function unblockIpAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await asAdmin();
  if (!admin) return NOT_ALLOWED;

  const ip = field(formData, 'ip');
  if (!ip) return { ok: false, error: 'Missing address.' };

  await unblockIp(ip);
  clearViolations(ip);
  clearBlockCache();

  await recordAdminAction({
    actor: admin,
    action: 'security.unblock',
    target: ip,
  });
  revalidateAdmin();
  return { ok: true, message: `${ip} unblocked.` };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveSettingAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await asAdmin();
  if (!admin) return NOT_ALLOWED;

  const key = field(formData, 'key');
  const value = field(formData, 'value');
  const outcome = await setSetting(key, value, admin.email);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await recordAdminAction({
    actor: admin,
    action: 'setting.update',
    target: key,
    detail: `${key} = ${outcome.value}`,
  });
  revalidateAdmin();
  return { ok: true, message: `${key} saved.` };
}
