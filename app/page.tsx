import Link from 'next/link';

import { Brand } from '@/components/layout/Brand';
import { RouteGoBox } from '@/components/share/RouteGoBox';

const steps = [
  {
    title: 'Add',
    text: 'Paste or write code — or drop a file.',
  },
  {
    title: 'Name it',
    text: 'Take any slug you like, e.g. “any-name”.',
  },
  {
    title: 'Share',
    text: 'Send the link. It burns after 24 hours.',
  },
];

const actions = [
  {
    href: '/create/code',
    title: 'Share code',
    description: 'Paste or write code or text.',
    icon: (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5 shrink-0"
      >
        <path
          d="m8 7-5 5 5 5M16 7l5 5-5 5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: '/create/file',
    title: 'Share a file',
    description: 'Any file except archives, executables & media · 10 MB.',
    icon: (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5 shrink-0"
      >
        <path
          d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

/**
 * Homepage — a static Server Component. Wordmark, the name box, the two entry
 * points, then the three steps. Nothing more.
 */
export default function HomePage() {
  return (
    <div className="flex flex-col items-center pt-6 text-center sm:pt-12">
      <h1>
        <Brand size="text-4xl sm:text-5xl" tag={false} />
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-sub sm:text-base">
        Paste or drop it, name it, share the link — it burns in 24 hours.
      </p>

      {/* The whole product in one box: name → link. Type (or paste) a name
          somebody shared with you and Go straight to it. */}
      <RouteGoBox />

      <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-2 sm:gap-4">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex min-w-0 items-center gap-4 rounded-xl border border-line bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-card-soft hover:shadow-lg hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition-colors group-hover:bg-accent/15">
              {action.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {action.title}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed break-words text-sub">
                {action.description}
              </span>
            </span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4 shrink-0 text-sub transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
            >
              <path
                d="m9 6 6 6-6 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        ))}
      </div>

      {/* Primary actions first: the two ways to create a share sit right
          under the name box, where the eye already is.

          The three steps, as a flow rather than three boxes: a numbered node
          with a hairline running out of it, then plain type underneath., not as three boxes: a numbered node with
          a hairline running out of it, then plain type underneath. */}
      <ol className="mt-12 grid w-full max-w-2xl gap-x-6 gap-y-7 text-left sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="group min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10 font-mono text-[10px] text-accent tabular-nums transition-colors group-hover:border-accent/50 group-hover:bg-accent/15">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                aria-hidden
                className="h-px flex-1 bg-gradient-to-r from-line via-line/70 to-transparent"
              />
            </div>
            <p className="mt-3 text-sm font-semibold">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed break-words text-sub">
              {step.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
