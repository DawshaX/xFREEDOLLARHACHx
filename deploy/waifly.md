# تشغيل NOVA على Waifly (الخطة المجانية الدائمة)

>Waifly = سيرفر Node.js دائم بـ**300 MB رام / 1 GB ديسك**، من غير فيزا. ده كفاية **عقل + محرك ops
>سلبي** بالظبط، ومش كفاية Ollama أو `nuclei` بالتيمبلتس. التفاصيل تحت مبنية على القيود دي، مش على
>اتمنيّات.

## ⚠️ 00) إقرأ ده الأول — الهوست ده كان مكشوف (قياس من CI 2026-11-02)

الـprobe اللي بيستخدم runner بتاع GitHub (لأن الصندوق بتاعي مابيوصلش `waifly.com`) طلع كده:

```
POST /api/local-agent/exec  (anonymous, من غير أي توكن) → 200
{"stdout":"uid=1001(runner) gid=1001(runner) … 113(docker) …"}
GET /api/fleet/capabilities → fleet.connected: 4 · caps: shell, files, screenshot, pty, input, clipboard
GET /api/ops/version → HTML (مش JSON) → VERDICT: PRE-OPS bundle
```

معناه العملي: **أي حد على الإنترنت يقدر ينفّذ أوامر على السيرفر بتاعك وعلى النودات الأربعة المتصلة بيه**،
و`download-project-zip` في الـbundle القديم كان بيرجع المصدر كاملاً — يعني **ملفات `.env` والمفاتيح اللي جواه
اتقريت من ناس تانية**. الترتيب ده مش نصيحة، ده إطفاء حريق:

1. **ادور كل المفاتيح** اللي في `.env` على الهوست (Groq/Gemini/OpenRouter/OpenAI/أي حد) — Groq شغال عندك
   من القياس (`groq ok:true 437ms`) فاعمله rotate من console.groq.com. المفتاح اللي ممكن يكون اتقرا = مفتاح ميت.
2. **قفّل الأسطول دلوقتي**: `Actions → All workflows → fleet-nodes → ••• → Cancel running workflow`
   (أنا ماقدرش ألغيه — للتوكن المربوط بالريبو ماعندوش `actions:write`؛ جربت ورجّع 403).
   كمان اقطع الـcron مؤقتاً: `Actions → fleet-nodes → Disable workflow` لحد ما التوكن يتظبط.
3. **اعمل redeploy بالـbuild الجديد** (اللي فيه `src/lib/ops/gate.ts`) — PR #64 اتعمله merge على `main`
   والـworkflow `NOVA portable bundle (24/7)` بينشر `nova-24-7` كـrelease asset. حمله من الخطوة 1 تحت.
4. **سيّر `NOVA_EXEC_TOKEN` قبل الـrestart** (الخطوة 2 تحت). في الـbuild الجديد: كتابة مجهولة = 403،
   تسجيل نود من غير توكن = 401، و`download-project-zip` = 403 غير بـ`NOVA_ALLOW_SOURCE_DOWNLOAD=1`.
5. **الأسطول بقى محتاج opt-in**: `fleet-nodes` مابيطلقش موجة من `schedule/push` غير لما
   `vars.FLEET_ENABLED=1` **و** `secrets.NOVA_EXEC_TOKEN` موجودين. التشغيل اليدوي لسه حر.

» القياس ده هو السبب في كل القيود اللي في الوثايق دي. مش إحتراس مبالغ فيه — ده ثغرة اتقفلت ولسه عايزة
نشر عندك.

---

## 0 ليه الصفحة دي أصلاً

المحرك اللي شغال دلوقتي على `node.waifly.com:<PORT_REDACTED>` **قبل** طبقة `src/lib/ops/` — يعني مفيش
`/api/ops/*`، مفيش scope gate، مفيش jobs ولا أدلة. أي كلام عن «الفحص الحقيقي» على الهوست ده
بيحتاج redeploy الأول. الطريقة السريعة للتأكد (من أي جهاز، مش من الصندوق بتاعي):

```bash
curl -s http://node.waifly.com:<PORT_REDACTED>/api/ops/version
# {"opsRouter":true, "sha":"…", "stale":{…}}  ← الجديد موجود
# 404 أو HTML                                      ← الهوست لسه على build قديم
```

أو من غير ما تفتح طرف: `Actions → probe-live-llm → Run workflow` (الـworkflow بيكتب
`probe-report.txt` في الفرع بنفسه، وأنا أقدر أقراه من هنا).

## 1) جيب الـbundle الجاهز (ماتبنيش على السيرفر)

300 MB مش محل مناسيب لـ`pnpm install && build`. البناء بيتعمل في CI وبيننزل كـasset:

```bash
# على Waifly (Console / WebSSH):
cd ~/app || mkdir -p ~/app && cd ~/app
curl -fsSL -L -o nova.zip "$(curl -s https://api.github.com/repos/DawshaX/xFREEDOLLARHACHx/releases/tags/nova-portable \
  | grep browser_download_url | grep 'nova-24-7' | head -1 | cut -d'"' -f4)"
unzip -o -q nova.zip && rm nova.zip
ls        # index.mjs + public/ + …
```

الـworkflow اللي بينشر ده: **`standalone-bundle`** (build + smoke-test في مجلد فاضي + release
`nova-portable`). اشتغّل هو بعد ما الـPR يتعمله merge.

## 2) متغيرات البيئة الصح لخطة 300 MB

| المتغير | القيمة على Waifly | ليه |
|---|---|---|
| `PORT` | `8080` | Waifly بيعيّن البورت نفسه — المحرك بيقرا `PORT/SERVER_PORT/APP_PORT/WEB_PORT` ورا بعض |
| `NOVA_EXEC_TOKEN` | من `/etc/cybernova.env` أو `openssl rand -hex 24` | **من غيره:** أي نود جديد 401 وأي كتابة مجهولة 403 (وده مقصود) |
| `NOVA_MEMORY_FILE` | `./state/nova-memory.json` | القرص صغير؛ حطه في `state/` الجوه المجلد نفسه عشان يتنقل معاك |
| `NOVA_PROGRAMS_FILE` | `./state/programs.json` | سجل البرامج = وثيقة الإذن. مترفعش على git عام — `state/programs.json` في `.gitignore` |
| `NOVA_JOBS_REL` | `./state/jobs` | الأدلة والنتائج؛ **1 GB ديسك**، فخلي الـprune عادة (تحت) |
| `NOVA_MAX_INFLIGHT` | `2` | 300 MB + CPU مشترك = قلّل التزامن عشان الثروتل ميوطّش الـevent loop |
| `NOVA_OPS_AUTONOMY` | `passive` | الدورة الخلفية: DNS + CT-logs + intel عام. `standard` بعد ما تتأكد إن معاك إذن مكتوب |
| `NOVA_KEYS_URL` | `https://…` (اختياري) | لو المفاتيح في endpoint عندك؛ **https إجباري** غير بـ`NOVA_KEYS_ALLOW_HTTP=1` |
| `NOVA_KEYLESS_LLM` | `1` (افتراضي) | حتى من غير ولا مفتاح: 3 مقاعد pollinations + ollama (لو موجود) = مجلس بيصوّت |

**ملف البيئة** (لو الـpanel بتاعك بيقرا env من ملف): `state/nova.env` أو من واجهة Waifly → Environment.

## 3) التشغيل + الدوام

```bash
# Console بتاع Waifly: Start Command
node index.mjs
```
- مفيش `systemd` في الحاوية، فالدوام من **الـwatchdog بتاع المنصة** (restart on exit) +
  المحرك نفسه بيرجع الـnودات تلقائياً (الوكيل عنده reconnect loop).
- لو المنصة بتنام لما مفيش زيارات: حط **monitor خارجي مجاني** يضرب `/api/health` كل 5 دقايق
  (`GET /api/fleet/catalogue?kind=monitor` فيه قايمة بالمتاح).

## 4) الديسك (1 GB) — أهم نقطة عملية

```bash
du -sh state/jobs 2>/dev/null           # حجم الأدلة
find state/jobs -maxdepth 1 -mindepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null   # prune أسبوعي
df -h | tail -1                          #space الفاضل
```
`report.md` + `evidence/*.txt` بيتكتبوا لكل job، وكل ملف دليل متجّهل بـSHA-256 جوه الـjob نفسه —
فالحذف بعد أسبوع مابيكسرش أي إثبات اتبعت في تقرير (التقرير Markdown بيتنزل لوحده).

## 5) ربط الأسطول بالهوست ده

نود GitHub Actions (لحد 19 × 4 vCPU/16 GB، موجة كل 5 ساعات) بيوصل بالـhub الافتراضي:

```
GitHub → Settings → Secrets and variables → Actions
  Secret   : NOVA_EXEC_TOKEN   = نفس التوكن اللي في السيرفر
  Variable : NOVA_HUB          = ws://node.waifly.com:<PORT_REDACTED>/api/local-agent/ws
  Variable : FLEET_NODES       = 4
```
ثم `Actions → fleet-nodes → Run workflow`. **مهم:** نودات Actions متسطّبلهاش ماسحات نشطة
(nmap/nuclei) — السورس IP بتاع GitHub، والمسح النشط منه بلاغ بيودّي الحساب. هي بتدي استطلاع
وقراية فقط؛ التقيل على نود دائم.

أي جهاز تاني (لابتوب/راوتر/Termux):

```bash
curl -fsSL http://node.waifly.com:<PORT_REDACTED>/api/local-agent/download-nova-agent -o nova-agent.js
NOVA_TOKEN=<TOKEN> NOVA_SERVER=ws://node.waifly.com:<PORT_REDACTED>/api/local-agent/ws node nova-agent.js --id my-box
```

## 6) checklist بعد الـdeploy (اطلب من أي حد ينفذه، أو من CI)

```bash
B=http://node.waifly.com:<PORT_REDACTED>
curl -s $B/api/health                         # {"status":"ok","mode":"standalone"}
curl -s $B/api/ops/version | head -c 200      # opsRouter:true + sha
curl -s $B/api/ops/kinds  | head -c 120       # 13 نوع مهمة
curl -s $B/api/nova-core/awareness | head -c 220  # verdict + organs — «المخ عارف نفسه»
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.test' $B/api/ops/programs  # 403 (قراية حساسة)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/local-agent/exec -d '{"command":"id"}'   # 403
curl -s $B/api/fleet/capabilities | head -c 160  # كام نود متصل فعلاً
curl -s -X POST $B/api/ops/programs/discover -H "x-nova-token: $TOKEN" \
     -H 'content-type: application/json' -d '{"target":"example.com"}' | head -c 300
curl -s -X POST $B/api/ops/sweep -H "x-nova-token: $TOKEN" | head -c 200   # دورة خلفية حقيقية
```

المتوقع: `version` بيطلع، `exec` مجهول = **403**، `discover` بيسجّل passive، و`sweep` بيبدأ
job حقيقي. لو `version` = 404 → الهوست لسه قديم، ارجع للخطوة 1.
