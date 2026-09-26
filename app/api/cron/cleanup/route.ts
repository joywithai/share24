import { currentAdmin } from '@/lib/admin';
import { runCleanup } from '@/lib/cleanup/auto';

export const dynamic = 'force-dynamic';

/**
 * The scheduled cleanup endpoint.
 *
 * Two ways in, and nothing else:
 *
 *   - `Authorization: Bearer $CRON_SECRET` — what Vercel Cron (and any other
 *     scheduler) sends when `CRON_SECRET` is set in the environment.
 *   - a signed-in administrator, so an operator can poke it from a script or a
 *     bookmark without knowing the secret.
 *
 * When `CRON_SECRET` is unset the bearer path is refused outright rather than
 * left empty: an unauthenticated endpoint that deletes data is exactly the
 * kind of thing that gets found by somebody else first.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get('authorization') ?? '';
  const fromScheduler = Boolean(secret && authorization === `Bearer ${secret}`);

  if (!fromScheduler) {
    const admin = await currentAdmin();
    if (!admin) {
      return Response.json(
        {
          error: secret
            ? 'Provide the cron secret, or sign in as an administrator.'
            : 'CRON_SECRET is not set — sign in as an administrator to run cleanup.',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  const report = await runCleanup(fromScheduler ? 'cron' : 'admin');
  return Response.json(report, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
