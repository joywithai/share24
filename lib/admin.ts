import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Who is an administrator, and what did they just do.
 *
 * The middleware only answers "is somebody signed in?" — a redirect is enough
 * for an anonymous visitor, and it must not cost a database round trip. The
 * *role* is checked here, in the page and in every action, which is the only
 * check that cannot be bypassed by calling a server action directly.
 */

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

/** The signed-in account if it is an active administrator, else `null`. */
export async function currentAdmin(): Promise<AdminUser | null> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  if (!user || user.role !== 'admin' || user.status !== 'active') return null;
  return user;
}

export function isAdmin(user: { role?: string } | null | undefined): boolean {
  return user?.role === 'admin';
}

/** Best-effort audit entry. Never throws — logging must not break an action. */
export async function recordAdminAction(input: {
  actor: AdminUser;
  action: string;
  target?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await prisma.adminLog.create({
      data: {
        actorId: input.actor.id,
        action: input.action,
        target: input.target ?? null,
        detail: input.detail?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    console.warn('[admin] could not record an action', error);
  }
}

// ---------------------------------------------------------------------------
// Small helpers the pages and actions share
// ---------------------------------------------------------------------------

export interface PageInfo {
  page: number;
  perPage: number;
  total: number;
  pages: number;
  skip: number;
}

/** Clamp `?page=` and work out the offset for a query. */
export function pageInfo(
  rawPage: string | string[] | undefined,
  total: number,
  perPage = 25,
): PageInfo {
  const requested = Number(Array.isArray(rawPage) ? rawPage[0] : rawPage);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Number.isFinite(requested)
    ? Math.min(pages, Math.max(1, Math.trunc(requested)))
    : 1;
  return { page, perPage, total, pages, skip: (page - 1) * perPage };
}

/** Trim a search box value and keep it short enough for a LIKE query. */
export function searchTerm(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').trim().slice(0, 80);
}

/** Format a date for the admin tables: stable, sortable, no locale drift. */
export function shortDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

/** "4.2 MB", "980 B" — the same scale the visitor-facing UI uses. */
export { formatBytes } from '@/lib/file';
