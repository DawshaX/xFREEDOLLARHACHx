#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# NOVA on a 300 MB slot (Waifly and every other tiny free NodeJS host)
# ─────────────────────────────────────────────────────────────────────────────
# Run this INSIDE the server's console (Waifly → your server → Console):
#
#   sh waifly-bootstrap.sh
#
# What it does, and why each step exists:
#   • downloads the portable bundle from the public release — **no build here**.
#     `pnpm install && vite build` needs ~1.5 GB of RAM and this box has 300 MB;
#     building on the server is how a free slot dies with "Killed".
#   • writes `.env` with a real NOVA_EXEC_TOKEN. Without it every write is 403
#     and no node can register (that gate exists because this host was found
#     wide open on 2026-11-02 — see deploy/waifly.md).
#   • turns OFF the corpus auto-download: the corpus is 14 MB gzipped and the
#     box has 300 MB. Query still works against `/corpus` on the Supabase side.
#   • makes `state/` inside the app folder so memory survives restarts.
#   • prints exactly what to put in the panel's Start Command.
#
# Idempotent: run it again to re-download a newer bundle; `.env` is kept unless
# you pass --new-token.
set -eu

APP_DIR="${APP_DIR:-$HOME/app}"
REPO="${REPO:-DawshaX/xFREEDOLLARHACHx}"
TAG="${TAG:-nova-portable}"
ASSET="${ASSET:-nova-24-7.zip}"
FROM=""
NEW_TOKEN=0

for arg in "$@"; do
  case "$arg" in
    --from=*) FROM="${arg#--from=}" ;;
    --new-token) NEW_TOKEN=1 ;;
    --dir=*) APP_DIR="${arg#--dir=}" ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[1;31m✗\033[0m %s\n' "$*"; }

# Resolve a relative --from= BEFORE we cd away from the caller's directory.
if [ -n "$FROM" ]; then
  case "$FROM" in
    /*) ;;
    *) FROM="$(pwd)/$FROM" ;;
  esac
fi

say "1/4 download the portable bundle"
mkdir -p "$APP_DIR"
cd "$APP_DIR"
rm -f nova.zip
if [ -n "$FROM" ]; then
  cp "$FROM" nova.zip
  ok "using $FROM"
else
  # api.github.com first (a plain JSON call), then the asset URL it returns.
  URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/$TAG" \
        | grep browser_download_url | grep "$ASSET" | head -1 | cut -d'"' -f4)
  if [ -z "$URL" ]; then bad "could not find $ASSET in release $TAG"; exit 1; fi
  echo "  $URL"
  curl -fsSL -o nova.zip "$URL" || { bad "download failed"; exit 1; }
fi
unzip -oq nova.zip || { bad "unzip failed (is the zip complete?)"; exit 1; }
rm -f nova.zip
# The zip contains one top folder; flatten it into APP_DIR.
if [ -d "$APP_DIR/nova-24-7" ]; then
  cp -a "$APP_DIR/nova-24-7/." "$APP_DIR/"
  rm -rf "$APP_DIR/nova-24-7"
fi
[ -f boot.mjs ] || { bad "boot.mjs missing — the bundle layout changed"; exit 1; }
ok "unpacked into $APP_DIR"

say "2/4 state + env"
mkdir -p state
if [ -f .env ] && [ "$NEW_TOKEN" = "0" ]; then
  ok ".env kept (existing token)"
else
  TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > .env <<EOF
# written by waifly-bootstrap.sh — this file holds the exec token, never commit it
NODE_ENV=production
HOST=0.0.0.0
PORT=8080   # the panel assigns the real one; start.sh prefers $PORT/$SERVER_PORT
NOVA_EXEC_TOKEN=$TOKEN
NOVA_MEMORY_FILE=$APP_DIR/state/nova-memory.json
NOVA_STATIC_DIR=$APP_DIR/public
NOVA_JOBS_REL=$APP_DIR/state/jobs
NOVA_PROGRAMS_FILE=$APP_DIR/state/programs.json
# 300 MB box: the 14 MB corpus is NOT downloaded here; ask the ops API instead
NOVA_CORPUS_AUTODOWNLOAD=0
NOVA_OPS_AUTONOMY=passive
NOVA_MAX_INFLIGHT=2
# durable memory (optional but recommended on a host with no backup):
# NOVA_SUPABASE_URL=https://<project>.supabase.co
# NOVA_SUPABASE_SERVICE_KEY=<service-role key>
EOF
  ok "token generated"
fi

say "3/4 prune old evidence (1 GB disk)"
find state/jobs -maxdepth 1 -mindepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true
df -h . 2>/dev/null | tail -1 || true

say "4/4 what to paste in the panel"
. ./.env 2>/dev/null || true
cat <<EOF

  Start Command :  sh $APP_DIR/start.sh
  (or, if the panel wants a single node command:   node $APP_DIR/boot.mjs )
  Port          :  ${PORT:-8080}   ← use whatever Waifly assigns; start.sh reads PORT/SERVER_PORT

  After it is up, from anywhere:
    curl -s http://<your-host>:${PORT:-8080}/api/health
    curl -s http://<your-host>:${PORT:-8080}/api/ops/version

  Token (paste into «محطة نوفا» on the fleet page):
    $NOVA_EXEC_TOKEN

  Update later (no rebuild):
    sh $APP_DIR/waifly-bootstrap.sh        # same script, re-run

EOF
