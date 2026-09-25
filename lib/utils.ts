import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes with conditional logic (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Shortens a host for display next to an editable name: a preview/staging
 * hostname like `sbx-cdza2eyzvobinpf7.arena.site` eats the room the name needs,
 * so only the last labels survive (`…arena.site`). Short hosts, ports and IP
 * addresses are left exactly as they are.
 */
export function compactHost(host: string, keepLabels = 2): string {
  const [name, port] = host.split(/:(?=\d+$)/);
  const labels = name.split('.');
  const isIp =
    labels.length === 4 && labels.every((part) => /^\d+$/.test(part));
  if (isIp || labels.length <= keepLabels) return host;
  const tail = labels.slice(-keepLabels).join('.');
  return `…${tail}${port ? `:${port}` : ''}`;
}
