/**
 * A full-page navigation, for the few cases where the App Router's client-side
 * navigation cannot work.
 *
 * The case that matters: signing in. `router.push('/profile')` is a *soft*
 * navigation — React re-uses whatever it already knows about that route, and
 * the visitor has almost always just been redirected *away* from it ("not
 * signed in" → /login), so the cached render is exactly the wrong one and the
 * page appears not to change at all. A real navigation makes the browser send
 * the session cookie that was just set and lets the server render the target
 * fresh.
 *
 * Kept in its own module so the sign-in flow stays testable (jsdom refuses to
 * let tests overwrite `window.location`).
 */
export function hardNavigate(to: string): void {
  window.location.assign(to);
}
