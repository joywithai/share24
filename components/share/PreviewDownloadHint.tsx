'use client';

import { useEffect, useState } from 'react';

/**
 * Download help for the sandboxed preview iframe.
 *
 * Inside the preview the app lives in a sandboxed frame, and some sandboxes
 * swallow downloads: the click lands, the request succeeds, and the browser
 * still saves nothing — no error anywhere. `DownloadLink` opens a new tab for
 * exactly that case, but a sandbox can also refuse popups, so the visitor gets
 * told what to do instead (a right-click always escapes the sandbox, because
 * the menu belongs to the browser, not to the page).
 *
 * Rendered only when the page really is embedded (and only after mount, so the
 * server markup stays identical), which keeps a normal deployment clean.
 */
export function PreviewDownloadHint() {
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    setEmbedded(window.self !== window.top);
  }, []);

  if (!embedded) return null;

  return (
    <p className="mt-2 text-xs leading-relaxed text-sub/70">
      In this preview frame a download can be blocked silently. If a click does
      nothing, right-click the button and choose{' '}
      <span className="text-sub">&ldquo;Open link in new tab&rdquo;</span>, or
      open the app in its own tab.
    </p>
  );
}
