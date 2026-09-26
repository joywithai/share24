#!/usr/bin/env bash
# One-command local setup after a sandbox reset:
#   .env (fresh secrets) → Prisma client → demo seed.
# Start the database first (`npm run db:dev`) and the app afterwards
# (`npm run dev`).
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  python3 - <<'PY'
import secrets
open('.env','w').write(f'''DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/corium?schema=public"
BETTER_AUTH_SECRET="{secrets.token_hex(32)}"
UNLOCK_SECRET="{secrets.token_hex(32)}"
NEXT_PUBLIC_APP_URL=""
CORIUM_UPLOADS_DIR="./.uploads"
CORIUM_ALLOWED_ORIGINS="https://*.arena.site,https://*.e2b.app"
CORIUM_TRUSTED_ORIGINS="https://*.arena.site,https://*.e2b.app"
''')
print('[bootstrap] .env written')
PY
else
  echo '[bootstrap] .env already present'
fi

[ -d node_modules ] || { echo '[bootstrap] npm install…'; npm install --no-audit --no-fund; }
# Uploads live in the project (not /tmp) so a restart cannot empty them.
mkdir -p .uploads && echo '[bootstrap] uploads dir ok'
npm run db:generate >/dev/null && echo '[bootstrap] prisma client ok'
npm run db:seed 2>&1 | tail -3
