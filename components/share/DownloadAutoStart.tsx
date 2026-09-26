'use client';

import { useEffect } from 'react';

/**
 * A download was requested on a locked share: the route sent the visitor to
 * the PIN form with `?download=<scope>` instead of a file. Once the visitor
 * unlocks, this component finds the matching link on the freshly rendered
 * page — links carry a signed token, so they work even when the unlock cookie
 * never reaches the download request — and clicks it. The query parameter is
 * then dropped so a reload does not download twice.
 *
 * Renders nothing.
 */
export function DownloadAutoStart({ scope }: { scope: string }) {
  useEffect(() => {
    if (!scope) return;

    const link = document.querySelector<HTMLAnchorElement>(
      `a[data-download-key="${CSS.escape(scope)}"]`,
    );
    if (!link) return;

    // Clean the intent out of the URL before navigating, so the download does
    // not re-trigger if the visitor comes back to this page.
    const url = new URL(window.location.href);
    url.searchParams.delete('download');
    window.history.replaceState(null, '', url.toString());

    link.click();
  }, [scope]);

  return null;
}
