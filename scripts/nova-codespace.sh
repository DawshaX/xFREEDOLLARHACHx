#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NOVA on a GitHub Codespace — one command, ends with the URL you paste.
# ─────────────────────────────────────────────────────────────────────────────
#   bash scripts/nova-codespace.sh              # build if needed, start, print URL
#   bash scripts/nova-codespace.sh --rebuild    # force a rebuild first
#
# Why this exists on top of nova-machine-setup.sh: a Codespace forwards ports
# with a *private* default, so an engine that answers on localhost:8080 is still
# unreachable from the Pages page until that port is made public. This script
# does the three things a human would otherwise discover one failure at a time:
#   1. setup if the build is missing (and say how long it will take)
#   2. start the engine in the background and WAIT for /api/health
#   3. make port 8080 public and print the exact https URL + the token
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8080}"
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

# ── 1 · build ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--rebuild" ] || [ ! -f artifacts/api-server/dist/index.mjs ] || [ ! -f artifacts/kali-panel/dist/public/index.html ]; then
  say "building (first run only — 3-6 minutes on 4 cores)"
  bash scripts/nova-machine-setup.sh
else
  ok "build already present — not rebuilding (use --rebuild to force)"
fi

if [ ! -f .env.local ]; then
  bad "no .env.local — run scripts/nova-machine-setup.sh once"
  exit 1
fi

# ── 2 · start + wait for a real health answer ───────────────────────────────
say "starting the engine"
if curl -fsS -m 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  ok "engine already answering on ${PORT}"
else
  ./scripts/nova-serve.sh --bg || { bad "engine failed to start — see /tmp/nova.log"; exit 1; }
fi
for i in $(seq 1 20); do
  if curl -fsS -m 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ok "health ok after $((i))s"
    break
  fi
  sleep 1
  [ "$i" -eq 20 ] && { bad "no health answer after 20s — tail /tmp/nova.log"; exit 1; }
done

# ── 3 · public URL ──────────────────────────────────────────────────────────
say "the URL"
PUBLIC=""
if [ -n "${CODESPACE_NAME:-}" ]; then
  DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  PUBLIC="https://${CODESPACE_NAME}-${PORT}.${DOMAIN}"
  # Private by default. gh is pre-authenticated in a Codespace, so this works.
  if command -v gh >/dev/null 2>&1; then
    if gh codespace ports visibility "${PORT}:public" -c "${CODESPACE_NAME}" >/dev/null 2>&1; then
      ok "port ${PORT} is now PUBLIC (anyone with the URL can reach it)"
    else
      bad "could not flip the port with gh — do it by hand: Ports tab → ${PORT} → right-click → Port Visibility → Public"
    fi
  fi
else
  echo "  not inside a Codespace (no CODESPACE_NAME) — this is a plain machine."
  echo "  Use its own address, or tunnel it:  npx --yes localtunnel --port ${PORT}"
fi

TOKEN="$(grep -m1 '^NOVA_EXEC_TOKEN=' .env.local | cut -d= -f2-)"
cat <<EOF

════════════════════════════════════════════════════════════════════════════
  الصق الاتنين دول في «محطة نوفا» على صفحة الأسطول
  (https://dawshax.github.io/xFREEDOLLARHACHx/nova-fleet)

  الرابط : ${PUBLIC:-http://127.0.0.1:${PORT}}
  التوكن : ${TOKEN}

  للتأكد من أي مكان:  ${PUBLIC:-http://127.0.0.1:${PORT}}/api/health
════════════════════════════════════════════════════════════════════════════

ملاحظات لازم تعرفها:
  • Codespace بيقفل بعد 30 دقيقة خمول → المحرك بيقف → الصفحة تقول «مش متصل».
    أول ما تفتحه تاني، شغّل:  ./scripts/nova-serve.sh --bg
  • اللوج في /tmp/nova.log · الإيقاف:  fuser -k ${PORT}/tcp
EOF
