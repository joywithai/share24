import { maintenanceState } from '@/lib/settings';

/**
 * A thin strip above the header while maintenance mode is on.
 *
 * Nothing renders — and no query runs — when the app is serving normally, so
 * the normal design is untouched. While it is on, visitors are told why a
 * create button is refusing them, instead of meeting an unexplained error.
 */
export async function MaintenanceBanner() {
  const state = await maintenanceState();
  if (!state.active) return null;

  return (
    <output className="mt-4 block rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
      <strong className="font-medium">Maintenance mode.</strong>{' '}
      <span className="text-fg/80">{state.message}</span>
    </output>
  );
}
