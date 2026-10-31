# تشغيل NOVA 24/7 مجاناً — بدون جهازك

> الهدف: البرنامج يشتغل لوحده على طول، **بمجاناً 100%**، ويفضل فاكر كل حاجة.
> اختار **طريقة واحدة** من اللي تحت — كلها مجانية.

---

## 1) Oracle Cloud — Always Free (الأفضل) 🥇

سيرفر حقيقي مجاني للأبد، **مش بينام**، ويشيل Ollama (العقل المحلي) كمان.

1. اعمل حساب على <https://cloud.oracle.com/free> (بطاقة للتحقق فقط، مش هتتخصم).
2. **Create Instance** → Shape: **VM.Standard.A1.Flex** (Ampere ARM) أو **VM.Standard.E2.1.Micro** (AMD) — الاتنين داخل الـ Always Free.
3. نظام التشغيل: **Ubuntu 24.04**.
4. نزّل مفتاح SSH (اللي هيطلبه) واحفظه.
5. من على جهازك/أي terminal:

```bash
ssh -i your-key.pem ubuntu@<SERVER_IP>

# على السيرفر:
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/DawshaX/xFREEDOLLARHACHx.git /opt/cybernova
sudo bash /opt/cybernova/deploy/oracle-setup.sh
```

أو بأمر واحد بدون نسخ الكود يدوياً:

```bash
curl -fsSL https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/deploy/oracle-setup.sh | sudo bash
```

6. افتح البورت 80 من **Oracle Console → Networking → VCN → Security List → Add Ingress Rule** (0.0.0.0/0 → TCP 80 و 443).
7. خلاص:

```
http://<SERVER_IP>/nova-core      ← الشات
http://<SERVER_IP>/nova-memory    ← الذاكرة
```

**اللي السكربت بيعمله:** Node + pnpm + Ollama + موديل مجاني + Nginx + خدمة systemd
بترجع لوحدها لو وقعت وبتبدأ مع البوت + **نسخة احتياطية يومية** للذاكرة + جدار ناري.

### شهادة HTTPS مجانية (اختياري بس منصوح بيه)
لو عندك دومين، شغّل السكربت ومعاه بياناته:

```bash
sudo DOMAIN=nova.yourdomain.com EMAIL=you@mail.com bash /opt/cybernova/deploy/oracle-setup.sh
```
certbot هيعمل TLS تلقائي + تجديد تلقائي.

---

## 0) إزاي أتأكد إنه شغّال؟ (الفحص الذاتي)

- في السيرفر: `/self-check` — 7 فحوصات حقيقية (ذاكرة · قرص · عقل · أدوات · إنترنت · WebSocket · الدورة الذاتية).
- من برّه: `AUDIT_URL=http://<host>:8080 node scripts/audit-live-server.mjs` — 15 فحص.
- تلقائي كل 6 ساعات: `.github/workflows/live-audit.yml` (يحتاج سرّ `NOVA_URL`).

---

## 2) Render — أسرع بداية (بدون terminal)

1. اعمل حساب على <https://render.com> واربط GitHub.
2. **New → Blueprint** واختار المستودع → **Apply** (الملف `render.yaml` جاهز).
3. من **Settings → Environment** ضيف مفاتيحك المجانية لو حابب (Gemini / Groq …) — أو سيبها فاضية.
4. الرابط هيبقى زي `https://cybernova-nova.onrender.com`.

> الـ Free plan بينام بعد 15 دقيقة خمول. الحل: **GitHub Action** جاهز بينبّه كل 10 دقايق:
> Repo → Settings → Secrets and variables → Actions → **NOVA_URL** = رابطك.

**مفيش فيزا / مفيش كارت؟** ده المسار الوحيد الكامل من غير أي بيانات بنكية —
الدليل خطوة بخطوة (بالحدود الحقيقية والذاكرة والـkeep-alive المزدوج): **[`deploy/render-free-guide.md`](./render-free-guide.md)**

---

## 3) Fly.io — تشغيل مستمر مع قرص دائم

> ⚠️ **Fly.io بقى بيطلب كارت بنكي، والفري تير القديم اتلغى** (تجربة محدودة بس).
> القسم ده للعلم أو لو عندك كارت — لو مفيش، استخدم Render فوق.

```bash
curl -L https://fly.io/install.sh | sh
fly auth signup
fly launch --copy-config --name cybernova-nova
fly volumes create nova_data --size 1 --region fra
fly deploy
fly open
```
`fly.toml` مضبوط على `auto_stop_machines = false` → **بيشتغل 24/7** والذاكرة على volume دائم.

---

## 4) Docker (أي مكان: VPS، NAS، Raspberry Pi، جهاز صديق…)

```bash
git clone https://github.com/DawshaX/xFREEDOLLARHACHx.git && cd xFREEDOLLARHACHx
cp artifacts/api-server/.env.nova.example .env    # اختياري: مفاتيح مجانية
docker compose up -d                               # المنصة + الـ API
docker compose --profile local-ai up -d            # + Ollama وموديل مجاني
```

- `restart: unless-stopped` → يرجّع نفسه بعد أي عطل أو reboot.
- الذاكرة في volume اسمه `nova-state` (مش بتضيع).

---

## 5) PM2 — أي جهاز/سيرفر عندك (بدون root)

```bash
npm i -g pm2
pnpm install && pnpm --filter @workspace/api-server run build
BASE_PATH=/ pnpm --filter @workspace/kali-panel run build
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup     # تشغيل تلقائي مع البوت
```

---

## المفاتيح المجانية (اختياري تماماً)

البرنامج بيشتغل **من غير أي مفتاح**. لو عايز ردود أغنى، ضيف واحد أو أكثر:

| المزوّد | من فين | مجاني |
|---|---|---|
| **Ollama** | محلي / على السيرفر | ✅ بلا حدود |
| **Google Gemini** | <https://aistudio.google.com/apikey> | ✅ فري تير سخي |
| **Groq** | <https://console.groq.com/keys> | ✅ سريع جداً |
| **OpenRouter** | موديلات `:free` | ✅ |
| **Mistral** | <https://console.mistral.ai> | ✅ |

**مهم:** المفاتيح تتحط في:
- Oracle/systemd: `/etc/cybernova.env`
- Docker: ملف `.env` جانب `docker-compose.yml`
- Render/Fly: من لوحة Environment variables

**عمرها ما تتحط في الكود ولا في Git.** لو مفتاح اتكشف → اعمله revoke فوراً.

---

## الصيانة اليومية (مفيش حاجة تعملها)

| حاجة | بتتم إزاي |
|---|---|
| يرجع بعد أي عطل | `Restart=always` (systemd) / `restart: unless-stopped` (Docker) / PM2 |
| يبدأ مع البوت | `systemctl enable nova` / `pm2 startup` |
| الذاكرة تفضل | ملف على القرص + volume |
| نسخة احتياطية | `nova-backup.timer` يومياً 03:20 (14 يوم) + GitHub Action |
| ما ينامش | keep-alive كل 10 دقايق |

### أوامر مفيدة

```bash
systemctl status nova           # الحالة
journalctl -u nova -f           # اللوج مباشر
systemctl restart nova          # إعادة تشغيل
curl localhost/api/health       # فحص سريع
curl localhost/api/nova-core/memory/stats | jq .total
```

### نقل الذاكرة لسيرفر جديد
```bash
# من القديم
curl -O http://OLD_SERVER/api/nova-core/memory/export
# على الجديد
curl -X POST -H 'content-type: application/json' \
     --data @nova-memory-*.json http://NEW_SERVER/api/nova-core/memory/import
```
