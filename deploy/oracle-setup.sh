#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CyberNova / NOVA — one-shot installer for a free 24/7 cloud server
#
# Tested target: Oracle Cloud "Always Free" (Ubuntu 22.04/24.04, ARM Ampere or
# AMD micro). Also works on any Ubuntu/Debian VPS, Raspberry Pi, or a home box.
#
#   curl -fsSL https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/deploy/oracle-setup.sh | sudo bash
#
# or, already on the machine:
#   sudo bash deploy/oracle-setup.sh
#
# What it installs (all free / open source):
#   • Node 22 + pnpm
#   • Nginx  (reverse proxy, port 80 → 8080)
#   • Ollama (local LLM, CPU) + one small model
#   • systemd service `nova` (auto-restart, starts on boot)
#   • optional TLS via certbot when DOMAIN is provided
#
# Options (env vars):
#   REPO_URL   git url (default: the public repo)
#   APP_DIR    install dir (default: /opt/cybernova)
#   DOMAIN     e.g. nova.example.com — enables Let's Encrypt
#   EMAIL      email for Let's Encrypt
#   MODEL      ollama model (default: qwen2.5:3b)
#   PORT       app port (default: 8080)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/DawshaX/xFREEDOLLARHACHx.git}"
APP_DIR="${APP_DIR:-/opt/cybernova}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
MODEL="${MODEL:-qwen2.5:3b}"
PORT="${PORT:-8080}"
SERVICE_USER="${SERVICE_USER:-nova}"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "شغّله بـ sudo:  sudo bash deploy/oracle-setup.sh"

say "1/8 · تحديث النظام وتثبيت الأساسيات"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg ufw nginx jq >/dev/null

say "2/8 · تثبيت Node 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v)"

say "3/8 · تثبيت pnpm"
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@10.34.9 --activate >/dev/null 2>&1 || npm i -g pnpm@10 >/dev/null
ok "pnpm $(pnpm -v)"

say "4/8 · جلب الكود إلى $APP_DIR"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard origin/main
else
  mkdir -p "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
git config --global --add safe.directory "$APP_DIR" || true
ok "الكود جاهز: $(git -C "$APP_DIR" rev-parse --short HEAD)"

say "5/8 · بناء المنصة (API + الواجهة)"
cd "$APP_DIR"
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/api-server run build
BASE_PATH=/ pnpm --filter @workspace/kali-panel run build
ok "البناء تم"

say "6/8 · تثبيت Ollama + موديل مجاني ($MODEL)"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh >/dev/null
fi
systemctl enable --now ollama >/dev/null 2>&1 || true
# OLLAMA_ORIGINS so the browser can talk to it directly when needed
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_KEEP_ALIVE=24h"
EOF
systemctl daemon-reload
systemctl restart ollama || true
sleep 3
if ollama list 2>/dev/null | grep -q "${MODEL%%:*}"; then
  ok "الموديل موجود بالفعل"
else
  say "   تنزيل $MODEL (مرة واحدة، ممكن يأخذ دقائق)…"
  ollama pull "$MODEL" || warn "فشل تنزيل الموديل — المنصة هتشتغل بالعقل المدمج/المفاتيح المجانية"
fi

say "7/8 · خدمة systemd دائمة (ترجع لوحدها + تبدأ مع البوت)"
mkdir -p /var/lib/cybernova
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR" /var/lib/cybernova

cat > /etc/systemd/system/nova.service <<EOF
[Unit]
Description=CyberNova / NOVA agent
After=network-online.target ollama.service
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=$PORT
Environment=OLLAMA_BASE_URL=http://127.0.0.1:11434
Environment=OLLAMA_MODEL=$MODEL
Environment=NOVA_MEMORY_FILE=/var/lib/cybernova/nova-memory.json
EnvironmentFile=-/etc/cybernova.env
ExecStart=$(command -v node) --enable-source-maps $APP_DIR/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/cybernova $APP_DIR/artifacts

[Install]
WantedBy=multi-user.target
EOF

# Secrets file — never committed, only on this machine.
if [ ! -f /etc/cybernova.env ]; then
  cat > /etc/cybernova.env <<'EOF'
# مفاتيح اختيارية (مجانية). املأ اللي عندك فقط، وامسح الباقي.
# GEMINI_API_KEY=
# GROQ_API_KEY=
# OPENROUTER_API_KEY=
# MISTRAL_API_KEY=
# TOGETHER_API_KEY=
# OPENAI_API_KEY=
# ENABLE_AGENT_SHELL=1
EOF
  chmod 600 /etc/cybernova.env
fi

systemctl daemon-reload
systemctl enable nova >/dev/null
systemctl restart nova
sleep 4
systemctl is-active --quiet nova && ok "nova.service شغالة" || warn "nova.service لم تبدأ — راجع: journalctl -u nova -n 50"

say "8/8 · Nginx + الجدار الناري + TLS اختياري"
cat > /etc/nginx/sites-available/cybernova <<EOF
server {
    listen 80;
    server_name ${DOMAIN:-_};

    client_max_body_size 25m;

    location /api/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;

        # SSE / agent streaming — must not be buffered
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        # WebSocket upgrade
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF
ln -sf /etc/nginx/sites-available/cybernova /etc/nginx/sites-enabled/cybernova
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null && systemctl reload nginx && ok "nginx شغال"

ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true
ok "الجدار الناري مفتوح على 80/443 + SSH فقط"

if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  say "TLS · Let's Encrypt لـ $DOMAIN"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || warn "فشل شهادة TLS"
fi

PUBLIC_IP="$(curl -s --max-time 5 https://api.ipify.org || echo "SERVER_IP")"
cat <<EOF

────────────────────────────────────────────────────────────
  ✅ NOVA اشتغلت وخلاص — مفيش تدخل منك تاني
     المنصة          http://${DOMAIN:-$PUBLIC_IP}/
     الشات           http://${DOMAIN:-$PUBLIC_IP}/nova-core
     الذاكرة         http://${DOMAIN:-$PUBLIC_IP}/nova-memory
     فحص الصحة       http://${DOMAIN:-$PUBLIC_IP}/api/health

  الأوامر المهمة:
     systemctl status nova        حالة الخدمة
     journalctl -u nova -f        متابعة اللوج
     systemctl restart nova       إعادة تشغيل
     nano /etc/cybernova.env      إضافة مفاتيح مجانية (اختياري)

  الذاكرة محفوظة في: /var/lib/cybernova/nova-memory.json
  نسخة احتياطية يومية تلقائية: systemctl list-timers | grep nova
────────────────────────────────────────────────────────────
EOF

# ── daily memory backup (free, local, keeps 14 days) ─────────────────────────
cat > /usr/local/bin/nova-backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SRC=/var/lib/cybernova/nova-memory.json
DST=/var/lib/cybernova/backups
mkdir -p "$DST"
[ -f "$SRC" ] && cp "$SRC" "$DST/nova-memory-$(date +%Y%m%d-%H%M).json"
find "$DST" -name 'nova-memory-*.json' -mtime +14 -delete
EOF
chmod +x /usr/local/bin/nova-backup.sh

cat > /etc/systemd/system/nova-backup.service <<'EOF'
[Unit]
Description=CyberNova memory backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/nova-backup.sh
EOF

cat > /etc/systemd/system/nova-backup.timer <<'EOF'
[Unit]
Description=Daily CyberNova memory backup
[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now nova-backup.timer >/dev/null 2>&1 || true
ok "نسخة احتياطية يومية للذاكرة الساعة 03:20"
