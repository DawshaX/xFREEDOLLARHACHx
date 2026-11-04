#!/usr/bin/env bash
# Start the NOVA engine (and the panel it serves) with the token from .env.local.
#
#   ./scripts/nova-serve.sh            # foreground, Ctrl-C to stop
#   ./scripts/nova-serve.sh --bg      # background, logs to /tmp/nova.log
#
# The engine is ONE process: it answers /api/* and serves the built panel on /.
# That is what makes a single free machine enough to be the whole program.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env.local; set +a
else
  echo "no .env.local — run ./scripts/nova-machine-setup.sh first" >&2
  exit 1
fi

# The engine only serves the built panel when NODE_ENV=production (see app.ts),
# and an .env.local written before that line existed would silently 404 on `/`.
export NODE_ENV="${NODE_ENV:-production}"

if [ ! -f artifacts/api-server/dist/index.mjs ]; then
  echo "no build yet — running pnpm --filter @workspace/api-server run build" >&2
  pnpm --filter @workspace/api-server run build
fi

echo "  engine   http://${HOST:-0.0.0.0}:${PORT:-8080}"
echo "  token    ${NOVA_EXEC_TOKEN:0:8}… (full value in .env.local)"
echo "  tools    ${NOVA_TOOL_DIR:-$ROOT/vendor/bin}"

if [ "${1:-}" = "--bg" ]; then
  nohup node --enable-source-maps artifacts/api-server/dist/index.mjs > /tmp/nova.log 2>&1 &
  echo "  pid      $!  (logs: /tmp/nova.log)"
  sleep 4
  curl -fsS -m 5 "http://127.0.0.1:${PORT:-8080}/api/health" && echo || { echo "health failed — see /tmp/nova.log"; exit 1; }
else
  exec node --enable-source-maps artifacts/api-server/dist/index.mjs
fi
