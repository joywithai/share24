import { cn } from '@/lib/utils';

interface BrandProps {
  /** Tailwind text-size class, e.g. `text-lg` (header) or `text-5xl` (hero). */
  size?: string;
  /** Show the small "24h" tag next to the wordmark. */
  tag?: boolean;
  className?: string;
}

/**
 * The three-colour wordmark: **Share**·**to**·**fnd**.
 * Pure markup — safe in Server Components and Client Components alike.
 */
export function Brand({ size = 'text-lg', tag = true, className }: BrandProps) {
  return (
    <span
      className={cn(
        'font-mono font-semibold tracking-tight whitespace-nowrap',
        size,
        className,
      )}
    >
      <span className="text-brand-1">Share</span>
      <span className="text-brand-2">to</span>
      <span className="text-brand-3">fnd</span>
      {tag && (
        <span className="ml-1.5 align-middle text-xs font-normal text-sub">
          24h
        </span>
      )}
    </span>
  );
}
