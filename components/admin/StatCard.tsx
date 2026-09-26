import type { ReactNode } from 'react';

/**
 * A one-line summary number for the dashboard and the section headers.
 * `tone` colours the value: neutral by default, `danger` when a number is a
 * warning, `ok` when it is healthy.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'ok' | 'danger';
}) {
  const valueTone =
    tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-fg';
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-sub">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueTone}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-sub">{hint}</p> : null}
    </div>
  );
}
