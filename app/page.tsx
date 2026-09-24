import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

const actions = [
  {
    href: '/create/code',
    title: 'Share code',
    description: 'Paste code or text into an editor, pick a route, get a link.',
    icon: (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-6 w-6"
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
    description: 'Drop a PNG, JPG, WEBP, PDF, TXT, DOC or DOCX — up to 10 MB.',
    icon: (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-6 w-6"
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
 * Homepage — a static Server Component. Two buttons, nothing else.
 */
export default function HomePage() {
  return (
    <div className="flex flex-col items-center pt-16 text-center sm:pt-24">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Share it. <span className="text-accent">Let it burn.</span>
      </h1>
      <p className="mt-4 max-w-md text-base text-sub">
        Temporary sharing for developers. No account, no forms — give Corium a
        route, get a link, and everything vanishes after 24 hours.
      </p>

      <div className="mt-12 grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={`${buttonVariants({ variant: 'secondary', size: 'lg' })} h-auto flex-col items-start justify-start gap-3 rounded-xl px-6 py-6 text-left transition-colors hover:border-accent/50 hover:bg-card-soft`}
          >
            <span className="text-accent">{action.icon}</span>
            <span className="text-lg font-semibold text-fg">
              {action.title}
            </span>
            <span className="text-sm leading-relaxed text-sub">
              {action.description}
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-12 text-xs text-sub/70">
        Optional 4-digit PIN · custom routes · 24-hour self-destruction
      </p>
    </div>
  );
}
