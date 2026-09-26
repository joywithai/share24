/**
 * The page a browser lands on when a download cannot be served.
 *
 * The download routes normally answer with a file, so anything else means
 * something is gone: the share expired, it was never here, or — this V1 keeps
 * uploads on the local disk — the bytes were swept away while the database row
 * survived. A bare `text/plain` sentence leaves the visitor stuck on a blank
 * page with no way forward, so every failure renders a small self-contained
 * page (inline styles: it must not depend on the app's CSS pipeline) with the
 * two useful actions: retry the share page, or make a new share.
 */

export type DownloadFailureKind =
  | 'share-gone'
  | 'files-gone'
  | 'file-gone'
  | 'not-part-of-share'
  | 'corrupt'
  | 'rate-limited'
  | 'blocked'
  | 'maintenance';

const STATUS: Record<DownloadFailureKind, number> = {
  'share-gone': 410,
  'files-gone': 410,
  'file-gone': 410,
  'not-part-of-share': 404,
  'rate-limited': 429,
  blocked: 403,
  maintenance: 503,
  corrupt: 500,
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

interface FailureCopy {
  title: string;
  body: string;
}

function copyFor(
  kind: DownloadFailureKind,
  route: string,
  missing: number,
): FailureCopy {
  const slug = escapeHtml(`/${route}`);
  switch (kind) {
    case 'maintenance':
      return {
        title: 'Downloads are paused for maintenance',
        body: `The share <span style="font-family:var(--mono);color:#e5e7eb">${slug}</span> is still there — file downloads are switched off for a few minutes while the server is upgraded. Try again shortly.`,
      };
    case 'blocked':
      return {
        title: 'This address is not allowed',
        body: `Requests from this address are blocked, so <span style="font-family:var(--mono);color:#e5e7eb">${slug}</span> cannot be downloaded here. If that is a mistake, contact the operator.`,
      };
    case 'rate-limited':
      return {
        title: 'Too many downloads from this address',
        body: `The share <span style="font-family:var(--mono);color:#e5e7eb">${slug}</span> is fine — this address asked for files too many times in a row. Wait a moment and try again.`,
      };
    case 'share-gone':
      return {
        title: 'This link is gone',
        body: `<span style="font-family:var(--mono);color:#e5e7eb">${slug}</span> has expired or was never here. Every share self-destructs after 24 hours, and nothing is kept afterwards.`,
      };
    case 'files-gone':
      return {
        title: 'These files are no longer on the server',
        body: `The share <span style="font-family:var(--mono);color:#e5e7eb">${slug}</span> still exists, but ${
          missing === 1 ? 'its file was' : `all ${missing} files were`
        } removed from disk before the 24 hours were up. Uploads live on local storage here, which a server restart can empty.`,
      };
    case 'file-gone':
      return {
        title: 'This file is no longer on the server',
        body: `The other files of <span style="font-family:var(--mono);color:#e5e7eb">${slug}</span> may still be there — this one was removed from disk before the share expired.`,
      };
    case 'not-part-of-share':
      return {
        title: 'That file is not part of this share',
        body: `The link asks for a file that does not belong to <span style="font-family:var(--mono);color:#e5e7eb">${slug}</span>. Open the share page and pick a file from the list.`,
      };
    default:
      return {
        title: 'This download could not be prepared',
        body: `Something about <span style="font-family:var(--mono);color:#e5e7eb">${slug}</span> is inconsistent on the server. Try the share page again, or upload the files once more.`,
      };
  }
}

export function downloadFailure(
  kind: DownloadFailureKind,
  options: { route: string; missing?: number; retryAfterSeconds?: number },
): Response {
  const { route, missing = 0, retryAfterSeconds } = options;
  const { title, body } = copyFor(kind, route, missing);
  const status = STATUS[kind];

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: #0b0d0f;
        color: #e5e7eb;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .card {
        width: 100%;
        max-width: 30rem;
        border: 1px solid #1e242d;
        border-radius: 16px;
        background: #12161b;
        padding: 28px;
        text-align: center;
      }
      .icon {
        display: inline-flex;
        width: 52px;
        height: 52px;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(248, 113, 113, 0.12);
        color: #f87171;
      }
      h1 { margin: 18px 0 0; font-size: 1.15rem; font-weight: 600; letter-spacing: -0.01em; }
      p { margin: 10px 0 0; font-size: 0.875rem; line-height: 1.65; color: #94a3b8; }
      .actions { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
      a {
        display: inline-flex;
        align-items: center;
        height: 40px;
        padding: 0 16px;
        border-radius: 10px;
        font-size: 0.875rem;
        font-weight: 500;
        text-decoration: none;
      }
      .primary { background: #3b82f6; color: #ffffff; }
      .ghost { border: 1px solid #1e242d; color: #e5e7eb; }
      .code { font-family: var(--mono); font-size: 0.75rem; color: #64748b; margin-top: 18px; }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 8v5" />
          <path d="M12 16.5h.01" />
          <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </span>
      <h1>${escapeHtml(title)}</h1>
      <p>${body}</p>
      <div class="actions">
        <a class="primary" href="/create/file">Share files again</a>
        <a class="ghost" href="/">Back to the start</a>
      </div>
      <p class="code">${status} · /${escapeHtml(route)}</p>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(status === 429 && retryAfterSeconds
        ? { 'Retry-After': String(retryAfterSeconds) }
        : {}),
    },
  });
}
