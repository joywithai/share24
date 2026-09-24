'use client';

import dynamic from 'next/dynamic';

/**
 * Read-only code display for shared content. The Monaco editor is only
 * importable client-side, so it is pulled in with `dynamic` + `ssr: false`
 * — this wrapper is the client boundary that a server component can render.
 */
const CodeEditor = dynamic(
  () => import('@/components/editor/CodeEditor').then((mod) => mod.CodeEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] items-center justify-center rounded-lg border border-line bg-bg font-mono text-sm text-sub">
        Loading…
      </div>
    ),
  },
);

export function CodeBlock({ value }: { value: string }) {
  return (
    <CodeEditor
      value={value}
      readOnly
      height="min(60vh, 560px)"
      ariaLabel="Shared code"
    />
  );
}
