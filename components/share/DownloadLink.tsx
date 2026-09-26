'use client';

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

interface DownloadLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target'> {
  href: string;
  /** `all` or a file id — also used by the resume-after-PIN helper. */
  downloadKey: string;
  children: ReactNode;
}

/**
 * A download link that adapts to where it is being shown.
 *
 * Normally it downloads in place, like any other link. When the page is
 * embedded (the sandboxed preview iframe), a same-frame download is silently
 * blocked by the browser — no error, nothing happens — so there it opens a new
 * tab instead, which is always allowed to save the file.
 *
 * The attribute is added after mount, so the server and client markup agree.
 */
export function DownloadLink({
  href,
  downloadKey,
  children,
  ...rest
}: DownloadLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.self !== window.top) {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener');
    }
  }, []);

  return (
    <a ref={ref} href={href} data-download-key={downloadKey} {...rest}>
      {children}
    </a>
  );
}
