import Link from 'next/link';

import type { PageInfo } from '@/lib/admin';

/**
 * Server-rendered paging: links, not buttons, so the browser's back button and
 * "open in new tab" both behave. The query string is preserved (`?q=`, `?type=`)
 * so a filtered list stays filtered while paging.
 */
export function Pagination({
  info,
  basePath,
  params,
}: {
  info: PageInfo;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (info.pages <= 1) return null;

  const href = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) search.set(key, value);
    }
    search.set('page', String(page));
    return `${basePath}?${search.toString()}`;
  };

  const linkClass =
    'rounded-md border border-line px-3 py-1.5 text-sm text-sub transition-colors hover:text-fg';

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-sub">
        Page {info.page} of {info.pages} · {info.total} rows
      </span>
      <div className="flex gap-2">
        {info.page > 1 ? (
          <Link className={linkClass} href={href(info.page - 1)}>
            Previous
          </Link>
        ) : (
          <span className={`${linkClass} opacity-40`}>Previous</span>
        )}
        {info.page < info.pages ? (
          <Link className={linkClass} href={href(info.page + 1)}>
            Next
          </Link>
        ) : (
          <span className={`${linkClass} opacity-40`}>Next</span>
        )}
      </div>
    </div>
  );
}
