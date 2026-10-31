#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CyberNova · NOVA — one-command local launcher
#
#   ./scripts/nova-local.sh              build if needed, start API + panel
#   ./scripts/nova-local.sh --rebuild    force a fresh build first
#   ./scripts/nova-local.sh --ollama     also print Ollama setup + status
#
# What it does
#   1. sanity-checks node / pnpm / deps
#   2. builds the API server (dist) and the panel (static) when missing
#   3. starts the API on :8080  (the agent brain + 21 real tools)
#   4. starts the panel on  :3000 (chat UI at /nova-core, proxying /api → :8080)
#   5. prints whether Ollama is reachable, so you know which brain you get
#
# Ctrl+C stops both processes.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-8080}"
PANEL_PORT="${PANEL_PORT:-3000}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
REBUILD=0
SHOW_OLLAMA=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    --ollama)  SHOW_OLLAMA=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg"; exit 1 ;;
  esac
done

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

say "checking toolchain"
command -v node >/dev/null || { echo "node is required (>= 20)"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "node >= 20 required, found $(node -v)"; exit 1; }
command -v pnpm >/dev/null || { warn "pnpm missing — installing"; npm i -g pnpm@10; }
ok "node $(node -v) · pnpm $(pnpm -v)"

if [ ! -d node_modules ]; then
  say "installing dependencies (first run)"
  pnpm install --no-frozen-lockfile
fi

if [ "$REBUILD" = "1" ] || [ ! -f artifacts/api-server/dist/index.mjs ]; then
  say "building API server"
  pnpm --filter @workspace/api-server run build
fi

if [ "$REBUILD" = "1" ] || [ ! -f artifacts/kali-panel/dist/public/index.html ]; then
  say "building panel"
  BASE_PATH=/ pnpm --filter @workspace/kali-panel run build
fi

# ── Ollama (free, local brain) ────────────────────────────────────────────────
OLLAMA_ONLINE=0
if curl -s --max-time 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
  OLLAMA_ONLINE=1
  MODEL_COUNT="$(curl -s --max-time 3 "$OLLAMA_URL/api/tags" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).models||[]).length)}catch{console.log(0)}})' 2>/dev/null || echo 0)"
  ok "Ollama online at $OLLAMA_URL ($MODEL_COUNT models) → NOVA uses the LLM brain"
else
  warn "Ollama not reachable at $OLLAMA_URL → NOVA still works, using the built-in planner"
  if [ "$SHOW_OLLAMA" = "1" ]; then
    cat <<'EOS'

  To switch on the free local brain:
    1) install Ollama          https://ollama.com/download
    2) pull a model            ollama pull llama3.1        (or qwen2.5:7b / mistral)
    3) allow the browser       OLLAMA_ORIGINS=* ollama serve   (macOS/Linux)
                               setx OLLAMA_ORIGINS *           (Windows)
    4) start NOVA              ./scripts/nova-local.sh
  Optional cloud-free-tier keys (still free): GROQ_API_KEY / OPENROUTER_API_KEY /
  GEMINI_API_KEY / MISTRAL_API_KEY / TOGETHER_API_KEY in the shell env.

EOS
  fi
fi

cleanup() { trap - INT TERM EXIT; kill 0 2>/dev/null || true; }
trap cleanup INT TERM EXIT

say "starting API server on :$API_PORT"
(
  cd artifacts/api-server
  PORT="$API_PORT" OLLAMA_BASE_URL="$OLLAMA_URL" node --enable-source-maps ./dist/index.mjs
) &

for _ in $(seq 1 40); do
  curl -s --max-time 1 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -s --max-time 2 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 \
  && ok "API healthy" || warn "API did not answer /api/health yet"

say "starting panel on :$PANEL_PORT"
(
  cd artifacts/kali-panel
  npx vite --config vite.config.ts --host 0.0.0.0 --port "$PANEL_PORT"
) &

sleep 2
cat <<EOF

────────────────────────────────────────────────────────────
  NOVA is up
    chat          http://localhost:$PANEL_PORT/nova-core
    desktop chat  http://localhost:$PANEL_PORT/live-agent
    API health    http://localhost:$API_PORT/api/health
    brain         http://localhost:$API_PORT/api/nova-core/status
    ollama        $([ "$OLLAMA_ONLINE" = 1 ] && echo "online" || echo "offline (built-in planner)")
  Ctrl+C to stop everything.
────────────────────────────────────────────────────────────
EOF

wait
