#!/usr/bin/env sh
# TEST10 — نقطة دخول صورة جهاز الشغل (كالي).
# NOVA_HUB_URL موجود  ⇒ عميل nova-agent بيتنزل من الهَب ويتصل دائمًا (الجهاز الحقيقي).
# مش موجود            ⇒ الفحص الذاتي المطبوع (إثبات الصورة) — نفس سلوك CMD القديم.
set -eu
if [ "${NOVA_HUB_URL:-}" != "" ]; then
  echo "[nova-kali] وضع جهاز الشغل — تحميل العميل من ${NOVA_HUB_URL}"
  AGENT="/opt/nova/nova-agent.js"
  i=0
  until curl -fsSL "${NOVA_HUB_URL}/api/local-agent/download-nova-agent" -o "$AGENT" || wget -q "${NOVA_HUB_URL}/api/local-agent/download-nova-agent" -O "$AGENT"; do
    i=$((i+1)); [ "$i" -ge 5 ] && { echo "[nova-kali] فشل تحميل العميل 5 مرات — خروج صادق"; exit 1; }
    sleep 5
  done
  echo "[nova-kali] العميل جاهز ($(wc -c < "$AGENT") بايت) — اتصال دائم إلى ${NOVA_HUB_URL}"
  exec node "$AGENT" --server "${NOVA_HUB_URL/https:/wss:}/api/local-agent/ws" ${NOVA_EXEC_TOKEN:+--token "$NOVA_EXEC_TOKEN"} --reconnect
fi
echo '--- NOVA kali plane ---'
for b in nmap sqlmap nikto whatweb gobuster semgrep nuclei httpx subfinder katana dnsx naabu ffuf; do
  if command -v "$b" >/dev/null 2>&1; then echo "  OK   $b"; else echo "  MISS $b"; fi
done
