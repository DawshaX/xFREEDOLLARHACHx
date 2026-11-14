#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ديسكتوب كالي الحقيقي في متصفح المالك:
#   Xvfb (شاشة 1280x800) + fluxbox (WM) + xterm + thunar
#   + x11vnc (يغمر الشاشة على 5901 محليًا) + websockify/noVNC على 6080
# ⇒ المتصفح يفتح الديسكتوب، والأجينت يتحكم فيه بأوامر xdotool حقيقية.
# السكربت بيفضل في المقدمة (exec websockify) — مناسب لstart_process.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KALI="$REPO_DIR/scripts/kali-exec.sh"
GEOM="${NOVA_KALI_GEOM:-1280x800x24}"

echo "── تشغيل ديسكتوب كالي الحقيقي (Xvfb :99 ${GEOM} + fluxbox + x11vnc → noVNC :6080) ──"
pkill -f "Xvfb :99" 2>/dev/null && echo "  (قتلت Xvfb قديم)"
pkill -f "x11vnc" 2>/dev/null && echo "  (قتلت x11vnc قديم)"
pkill -f "websockify.*6080" 2>/dev/null && echo "  (قتلت websockify قديم)"
sleep 1

"$KALI" "Xvfb :99 -screen 0 ${GEOM%%x*}x${GEOM#*x} -nolisten tcp" >/tmp/kali-xvfb.log 2>&1 &
sleep 2
"$KALI" "DISPLAY=:99 fluxbox" >/tmp/kali-fluxbox.log 2>&1 &
sleep 1
"$KALI" "DISPLAY=:99 xterm -geometry 100x30+40+40 -title 'Kali — NOVA Work Node'" >/tmp/kali-xterm.log 2>&1 &
"$KALI" "DISPLAY=:99 (thunar >/dev/null 2>&1 || true)" >/tmp/kali-thunar.log 2>&1 &
sleep 1
"$KALI" "x11vnc -display :99 -forever -shared -rfbport 5901 -listen localhost -nopw -noxrecord -noxdamage -quiet" >/tmp/kali-x11vnc.log 2>&1 &
sleep 2

echo "── noVNC على 0.0.0.0:6080 (المتصفح: /vnc.html?autoconnect=1) ──"
exec "$KALI" "websockify --web /usr/share/novnc 0.0.0.0:6080 localhost:5901"
