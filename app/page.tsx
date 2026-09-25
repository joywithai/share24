import Link from 'next/link';

import { Brand } from '@/components/layout/Brand';

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
    description: 'PNG, JPG, WEBP, PDF, TXT, DOC, DOCX · 10 MB.',
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
 * Homepage — a static Server Component. Wordmark, three steps, the link box
 * and the two entry points. Nothing more.
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

      {/* The whole product in one box: your name becomes the link. */}
      <div className="mt-8 flex w-full max-w-md items-stretch overflow-hidden rounded-lg border border-line bg-card font-mono text-xs sm:text-sm">
        <span className="flex shrink-0 items-center border-r border-line bg-card-soft px-3 py-2.5 text-sub">
          https://sharetofnd/
        </span>
        <span className="flex min-w-0 flex-1 items-center truncate px-3 py-2.5 text-fg">
          any-name
        </span>
      </div>
      <p className="mt-2 text-xs text-sub/70">
        You pick the name — that&rsquo;s the whole link.
      </p>

      <ol className="mt-10 grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="min-w-0 rounded-lg border border-line bg-card p-4"
          >
            <span className="font-mono text-xs text-brand-2">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="mt-1 text-sm font-semibold">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-sub break-words">
              {step.text}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-card-soft px-5 py-4 text-left transition-colors hover:border-accent/50 hover:bg-card"
          >
            <span className="text-accent">{action.icon}</span>
            <span className="min-w-0">
              <span className="block text-base font-semibold">
                {action.title}
              </span>
              <span className="block text-xs leading-relaxed text-sub break-words">
                {action.description}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
