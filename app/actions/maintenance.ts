'use server';

import { revalidatePath } from 'next/cache';

import { currentAdmin, recordAdminAction } from '@/lib/admin';
import { runCleanup } from '@/lib/cleanup/auto';

/**
 * The maintenance buttons in the admin panel: run the cleanup job on demand,
 * and re-run the consistency scan the storage page shows.
 */

export interface MaintenanceResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function runCleanupAction(): Promise<MaintenanceResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, error: 'Not allowed.' };

  const report = await runCleanup('admin');

  await recordAdminAction({
    actor: admin,
    action: 'cleanup.run',
    detail:
      `${report.sharesDeleted} shares, ${report.filesDeleted} files, ` +
      `${report.strayFilesDeleted} stray files, ${report.blocksDeleted} blocks`,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/storage');
  revalidatePath('/admin/logs');
  revalidatePath('/admin/security');

  if (report.errors.length > 0) {
    return {
      ok: true,
      message: `Cleanup finished with ${report.errors.length} error(s) — see the logs.`,
    };
  }
  return {
    ok: true,
    message:
      `Removed ${report.sharesDeleted} share(s), ${report.filesDeleted} file(s), ` +
      `${report.strayFilesDeleted} stray file(s) and ${report.blocksDeleted} expired block(s) in ${report.durationMs} ms.`,
  };
}

/** Re-run the storage consistency scan by refreshing the page data. */
export async function scanStorageAction(): Promise<MaintenanceResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, error: 'Not allowed.' };

  // The scan itself runs inside the page render (`orphanScan`), so the action
  // only has to make that render happen again.
  revalidatePath('/admin/storage');
  return { ok: true, message: 'Scan refreshed.' };
}
