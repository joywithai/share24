import type { DailyCount } from '@/lib/admin/stats';

/**
 * A bar chart in plain markup — no chart library, no client JavaScript.
 *
 * Fourteen bars do not need a canvas: server-rendered divs keep the page fast,
 * work with keyboard/screen readers (each bar carries its numbers in `title`
 * and `aria-label`) and cannot break the CSP.
 */
export function BarChart({
  data,
  label,
  tone = 'accent',
}: {
  data: DailyCount[];
  label: string;
  tone?: 'accent' | 'danger';
}) {
  const max = Math.max(1, ...data.map((point) => point.count));
  const total = data.reduce((sum, point) => sum + point.count, 0);
  const color = tone === 'danger' ? 'bg-danger/70' : 'bg-accent/70';

  return (
    <figure className="rounded-xl border border-line bg-card p-4">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-sub">
          {total} in the last {data.length} days
        </span>
      </figcaption>
      <div className="mt-4 flex h-24 items-end gap-1">
        {data.map((point) => (
          <div
            key={point.day}
            className="group flex h-full flex-1 items-end"
            title={`${point.day}: ${point.count}`}
            aria-label={`${point.day}: ${point.count}`}
          >
            <div
              className={`w-full rounded-t ${color} transition-opacity group-hover:opacity-100`}
              style={{
                height: `${Math.max(point.count === 0 ? 2 : 8, (point.count / max) * 100)}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-sub">
        <span>{data[0]?.day}</span>
        <span>{data.at(-1)?.day}</span>
      </div>
    </figure>
  );
}
