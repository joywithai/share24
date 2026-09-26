import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

// Better Auth REST endpoints — /api/auth/sign-in/email, /api/auth/sign-up/email,
// /api/auth/get-session, /api/auth/sign-out, …
const { GET, POST } = toNextJsHandler(auth);

export { GET, POST };
