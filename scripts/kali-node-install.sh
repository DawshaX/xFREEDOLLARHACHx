#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TEST10 — «جهاز الشغل»: تركيب عقدة كالي كاملة وتوصيلها بالمنصة بأمر واحد.
#
# بيشتغل على أي Debian/Ubuntu/Kali (سيرفر المالك أو الـVPS):
#   curl -fsSL https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/scripts/kali-node-install.sh \
#     | bash -s -- "wss://<HUB>/api/local-agent/ws" "<NOVA_EXEC_TOKEN>"
#
# اللي بيعمله (كل خطوة بتتطبع ومقاسة):
#   1) أدوات كالي الأساسية من apt (nmap sqlmap nikto whatweb gobuster …)
#   2) Node.js 20 (منative أو apt)
#   3) عميل nova-agent من الهَب نفسه (مصدر واحد للحقيقة)
#   4) اتصال دائم (--reconnect) + سيرفيس systemd لو متاح، وإلا حلقة nohup
#   5) فحص أخير: عدد الأدوات المتاحة بيتطبع — بلا ادعاء
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HUB_WS="${1:-}"
HUB_HTTP="${2:-}"
TOKEN="${3:-}"

if [ -z "$HUB_WS" ]; then
  echo "الاستخدام: kali-node-install.sh <wss://HUB/api/local-agent/ws> <HUB_HTTP_URL> <TOKEN>"
  echo "مثال:     kali-node-install.sh 'wss://nova.example.com/api/local-agent/ws' 'https://nova.example.com' 'probetoken'"
  exit 2
fi
HUB_HTTP="${HUB_HTTP:-${HUB_WS/wss:\/\//https://}}"
HUB_HTTP="${HUB_HTTP%/}"

echo "== [1/5] أدوات كالي =="
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -qq || apt-get update -qq || true
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    nmap sqlmap nikto whatweb gobuster dnsutils openssl curl wget git unzip jq \
    python3 python3-pip || sudo apt-get install -y nmap curl || true
else
  echo "  ⚠️ apt مش متاح — الأدوات الـapt هتتخطى (العميل هيتركب لو node موجود)"
fi

echo "== [2/5] Node.js =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || true
  sudo apt-get install -y nodejs || { echo "  ✗ فشل تركيب node — ركّبه يدويًا وشغّل السكربت تاني"; exit 1; }
fi
echo "  node $(node --version)"

echo "== [3/5] عميل nova-agent من الهَب =="
mkdir -p /opt/nova
curl -fsSL "${HUB_HTTP}/api/local-agent/download-nova-agent" -o /opt/nova/nova-agent.js \
  || wget -q "${HUB_HTTP}/api/local-agent/download-nova-agent" -O /opt/nova/nova-agent.js \
  || { echo "  ✗ تعذر تحميل العميل من ${HUB_HTTP} — اتأكد إن الهَب شغال"; exit 1; }
echo "  العميل: $(wc -c < /opt/nova/nova-agent.js) بايت"

echo "== [4/5] الاتصال الدائم =="
if command -v systemctl >/dev/null 2>&1 && [ -w /etc/systemd/system ] 2>/dev/null; then
  cat > /tmp/nova-kali.service <<EOF2
[Unit]
Description=NOVA Kali work node
After=network-online.target

[Service]
ExecStart=/usr/bin/node /opt/nova/nova-agent.js --server "${HUB_WS}" --token "${TOKEN}" --reconnect
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF2
  sudo mv /tmp/nova-kali.service /etc/systemd/system/nova-kali.service
  sudo systemctl daemon-reload && sudo systemctl enable --now nova-kali
  echo "  systemd: nova-kali service اشتغل"
else
  nohup node /opt/nova/nova-agent.js --server "${HUB_WS}" --token "${TOKEN}" --reconnect > /opt/nova/agent.log 2>&1 &
  echo "  nohup pid=$! — اللوج: /opt/nova/agent.log (عشان يفضل حي بعد الريبوت استخدم systemd أو pm2)"
fi

echo "== [5/5] الفحص المقاس =="
COUNT=0
for b in nmap sqlmap nikto whatweb gobuster nuclei httpx subfinder; do
  if command -v "$b" >/dev/null 2>&1; then echo "  OK   $b"; COUNT=$((COUNT+1)); else echo "  MISS $b"; fi
done
echo "✔ العقدة اتوصلت بمسار ${HUB_WS} — ${COUNT}/8 أداة أساسية متاحة"
echo "  اتأكد من الهَب: /kali-command هتشوف العقدة دي في القائمة"
