import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { searchTerm } from '@/lib/admin';
import { globalSearch, type SearchHit } from '@/lib/admin/search';

export const dynamic = 'force-dynamic';

/** /admin/search?q= — one box for routes, files, accounts and the event log. */
export default async function AdminSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = searchTerm(params.q);
  const results = await globalSearch(q);

  const groups: { title: string; hits: SearchHit[]; empty: string }[] = [
    { title: 'Shares', hits: results.shares, empty: 'No share matches.' },
    { title: 'Files', hits: results.files, empty: 'No file matches.' },
    { title: 'Users', hits: results.users, empty: 'No account matches.' },
    {
      title: 'Security events',
      hits: results.events,
      empty: 'Nothing in the log.',
    },
  ];

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="mt-1 text-sm text-sub">
          Routes, file names, email addresses and the security log in one query.
        </p>
      </div>

      <form
        action="/admin/search"
        className="flex flex-wrap items-center gap-2"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Search everything…"
          className="h-10 min-w-[18rem] flex-1 rounded-md border border-line bg-card-soft px-3 text-sm text-fg outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
        >
          Search
        </button>
      </form>

      {q.length < 2 ? (
        <p className="text-sm text-sub">Type at least two characters.</p>
      ) : results.total === 0 ? (
        <p className="text-sm text-sub">
          Nothing matches <span className="font-mono text-fg">{q}</span>.
        </p>
      ) : (
        <>
          <p className="text-sm text-sub">
            {results.total} match{results.total === 1 ? '' : 'es'} for{' '}
            <span className="font-mono text-fg">{q}</span>
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map((group) => (
              <section
                key={group.title}
                className="rounded-xl border border-line bg-card p-4"
              >
                <h2 className="text-sm font-medium">
                  {group.title}{' '}
                  <span className="text-xs font-normal text-sub">
                    {group.hits.length}
                  </span>
                </h2>
                <ul className="mt-3 space-y-2">
                  {group.hits.length === 0 ? (
                    <li className="text-xs text-sub">{group.empty}</li>
                  ) : (
                    group.hits.map((hit) => (
                      <li key={hit.id}>
                        <Link
                          href={hit.href}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/70 px-3 py-2 transition-colors hover:border-accent/60"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-fg">
                              {hit.title}
                            </span>
                            <span className="block truncate text-xs text-sub">
                              {hit.subtitle}
                            </span>
                          </span>
                          {hit.badge ? (
                            <Badge variant="neutral">{hit.badge}</Badge>
                          ) : null}
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
