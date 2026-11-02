# 🗺️ خريطة البرنامج الكاملة — CyberNova / NOVA

> توثيق «إيه اللي جوه البرنامج فعلاً وقد إيه يشتغل» — مكتوب من **قراءة الكود + تشغيل فعلي** في 2026-11-02،
> مش منسوخ من `HANDOFF.md`. كل رقم تحت فيه مصدر (ملف أو نداء API حقيقي).
> للرجوع السريع: [NOVA.md](../NOVA.md) (دليل الاستخدام) · [docs/OPS.md](OPS.md) (التشغيل الآلي) · [HANDOFF.md](../HANDOFF.md) (سجل المراحل).

---

## 0) في سطر واحد

منصة **أمن سيبراني دفاعي + صيد ثغرات قانوني** بواجهة شبيهة بسطح مكتب Kali، وعقل اسمه **نوفا (NOVA)**
بيقدر يفهم عربي، يخطّط، ويستدعي 33 أداة حقيقية، ويكتب تقرير. شغال في وضعين: **Static** (GitHub Pages /
المتصفح لوحده) و**Server** (Node + Express + WebSocket + ذاكرة على القرص).

**الفلسفة اللي في الكود فعلاً:** مفيش اختراع بيانات · مفيش هجوم · شغل على مصرّح به فقط · الفشل يُقال بصراحة.
(مكتوبة في `artifacts/api-server/src/lib/agent/persona.ts:69-75`)

---

## 1) الطبقات والمعمارية

```
┌─ artifacts/kali-panel (React 19 + Vite + wouter + Tailwind 4) ── 157 route / 84 ملف صفحة
│      src/setup.ts  ← شيمز fetch/WebSocket/EventSource: بيوصلوا بـ server أو بالمحرك المحلي
│      src/lib/standalone-api.ts  ← «المحرك المحلي» (5,494 سطر) — بشتغل كباك-إند جوه المتصفح
├─ artifacts/api-server (Express 5 + esbuild bundle)
│      src/app.ts            ← 600 سطر: CORS, SSE, standalone interception, error shim
│      src/routes/*.ts       ← 79 ملف / 553 endpoint
│      src/lib/agent/*       ← العقل: core · tools · llm · persona · memory-store · council · self-check
│      src/lib/standalone-api.ts  ← نفس ملف الواجهة (نسخة متطابقة byte-for-byte)
├─ lib/db (Drizzle + Postgres — اختياري تماماً) · lib/api-zod · lib/api-spec (OpenAPI/orval)
├─ scripts/*.mjs  ← 9 فحوصات + build-standalone + autonomous-brain-pulse
├─ state/*.json   ← «الذاكرة السحابية» اللي بيتعملها commit كل نبضة (بتتقرا من الصفحة الثابتة)
└─ nova-agent.js (33KB) ← وكيل على جهاز حقيقي: بيسجّل نفسه على WebSocket وبينفّذ اللي تطلبه
```

**تصميم مهم لازم تعرفه:** `standalone-api.ts` **ملف واحد بيلعب دورين** — الباك-إند الحقيقي للـPages،
والـfallback جوه السيرفر. متطابقين بالـmd5، وفيه فحص `audit:connections` بيأكد إن مفيش drift.
أي تعديل لازم يتعمل في الاتنين (أو يتنقل بنسخة واحدة لـ`lib/`).

---

## 2) عقدة نوفا — الـ33 أداة (حقيقية كلها، من `GET /api/nova-core/tools`)

| الأداة | الوضع | بتعمل إيه فعلاً |
|---|---|---|
| `recon_target` | active | DNS + ترويسات HTTP + شهادة TLS في نداء واحد |
| `dns_lookup` | safe | A / AAAA / MX / TXT / NS / CNAME / DMARC |
| `tls_audit` | active | إصدار/مُصدر/انتهاء/بروتوكول |
| `http_headers_audit` | active | HSTS, CSP, X-Frame-Options, Referrer-Policy + درجة أمان |
| `port_scan` | active | TCP غير تدميري، **حد أقصى 40 منفذ** |
| `subdomain_enum` | active | CRT.SH + DNS (مصادر عامة بس) |
| `web_fetch` | active | جلب نص من URL عام + حارس SSRF |
| `cve_lookup` / `vuln_search` | safe | NVD حقيقي |
| `exploit_search` | safe | Exploit-DB |
| `github_search` | safe | GitHub code/repo search |
| `knowledge_search` | safe | فهرس المنصة (3,354 عنصر) |
| `kali_toolbox` | safe | بيقترح الأداة + الأمر المعدّل للهدف (78 أداة) |
| `memory_save/search/list/forget/stats` | safe | ذاكرة طويلة الأمد على القرص |
| `set_active_target` / `record_finding` | safe | الهدف النشط + تسجيل نتيجة |
| `mission_create/status` / `report_generate` | safe | مهمة · حالة · تقرير Markdown |
| `platform_status` / `corpus_stats` / `task_list` | safe | حالة المنصة والأرقام |
| `hash_text` / `evidence_list` / `report_list` | safe | بصمة SHA · أدلة · تقارير |
| `fleet_list` / `fleet_profile` | safe | الأجهزة المتصلة + ملفها العميق |
| **`fleet_exec`** | **sensitive** | **تنفيذ أمر حقيقي على جهاز متصل** |
| `device_control_map` | safe | أمر تثبيت الوكيل لكل نظام |

> ⚠️ `fleet_exec` معلّمة `risk:"sensitive"` بس — **مفيش بوابة تأكيد في الكود**. الشرط موجود في
> البرومبت فقط (`persona.ts:67`). يعني أي **indirect prompt injection** (محتوى صفحة/ريد API رجّعته
> `web_fetch` واتحوّال للـprompt) يقدر يدفع نوفا تنفّذ أوامر على أسطولك. **ده أهم باب لازم يتقفل قبل النت.**

### الفهرس المعرفي — أرقام حقيقية (من `corpus_stats`)
```
kaliToolsCount 78 · kaliCategories 13 · githubProjects 56
vulnPrimitives 28 · targetSurfaces 19 · synthesizedPatterns 3,192
totalIndexedKnowledgeItems 3,354
```
✅ رقم «3,300+» اللي في الوثائق **صح**. بس خليك عارف إيه: الـ3,192 دول **ماتريكس مولّدة آلياً**
(فئات ثغرات × أسطح hedef × خطوات منهجية)، يعني **مولّد شيك‑لاستات** مش قاعدة بيانات CVE.
مصدر الـCVE الحقيقي الوحيد هو NVD/Exploit‑DB/GitHub advisories وقت التشغيل.

---

## 3) محركات البحث العميق (26 endpoint في `routes/deep-research.ts`)

| المحرك | شغال بجد؟ |
|---|---|
| `pipeline` (4 مراحل) | ✅ بيطلّع DNS/TLS/JS/ترويسات حقيقيين |
| `js-analyzer` | ✅ بيعمل fetch للملفات ويستخرج مسارات |
| `auth-matrix` (BOLA/IDOR) | ✅ بيعمل 3 طلبات بمختلف الجلسات |
| `config-auditor` | ✅ CORS reflection + dangling NS + `security.txt` |
| `github-auditor` / `arsenal` | ✅ بحث GitHub حقيقي (56 مشروع مرجعي) |
| `zero-fp-verify` | ✅ مقارنة بصمة SHA‑256 مقابل بصمة 404 الأساسية |
| `live-osint` | ✅ Shodan InternetDB + CRT.sh + Wayback CDX |
| `jwt-cookie-auditor` / `schema-auditor` | ✅ فك JWT + فحوصات introspection |
| `platforms` / `primitives` / `self-awareness` / `tactical-doctrine` | 📚 بيانات ثابتة (دليل/عقيدة) |
| `kali-arsenal` / `kali-simulate` | 🦅 كتالوج 78 أداة + **محاكي** (الأمر بيتكتب، مش بيتنفّذ — إلا لو الأداة على الجهاز) |
| `workstation-*` (5) | 🖥️ شells/بيئات وهمية للعرض على الوضع الـstatic؛ على السيرفر بتروح للراوتر الحقيقي |
| `cryptocom-scope` / `discovered-vault` | 📄 قراءة JSON مخزّن في `state/` |

**ترسانة Kali (78 أداة / 13 فئة) وGitHub (56 مشروع)** = دليل أوامر آمن + اقتباس مشروع، **مش** أدوات منصّبة.
الأدوات الحقيقية بتيجي من `nova-agent.js` على جهاز عليه الأدوات، أو `kali_toolbox` بيولّد الأمر وانت تنفّذه.

---

## 4) الوكلاء (6 عقول + مجلس)

| الوكيل | مكانه | حقيقي؟ |
|---|---|---|
| **NOVA Core** (`/nova-core`) | الراوتر `routes/nova-core.ts` + `lib/agent/core.ts` | ✅ العقل الأساسي: خطة → أدوات → رد، SSE حي، ذاكرة |
| `agent.ts` / `agentV2` | راوتر + جداول Drizzle | 🟡 نصفي — معظمه على الوضع الـstandalone بيوصل لـ`stubs.ts` |
| `novaAgent/V2/V3`, `novaIntelligence(V3)` | `lib/novaAgent*.ts` | 🟠 نسخ متراكمة (v1/v2/v3) — **لازم يتوحّدوا على واحدة** |
| `live-agent.ts` (31 endpoint) | `/api/live-agent/*` | ✅ sessions + brain-status + SSE |
| `kaligpt.ts`, `multi-ai.ts`, `anthropic.ts` | راوترات | 🟡 بتعدي على نفس المزودين بدون طبقة أمان مشتركة |
| **المجلس (council)** | `lib/agent/council.ts` | ⚠️ محتاج **صوتين على الأقل**؛ بلا مفاتيح = صوت واحد (الـself‑check بيقولك ده بصراحة) |
| `autonomous-daemon.ts` | نبضة 24/7 في الخلفية | ✅ بيشتغل فعلاً (عدّاد الدورات بيزيد) |

---

## 5) الذاكرة والتخزين — 3 أنظمة مختلفة تماماً

| النظام | فين | الدوام | الحد |
|---|---|---|---|
| ذاكرة نوفا طويلة الأمد | `state/nova-memory.json` (`NOVA_MEMORY_FILE`) | ✅ بعد الريستارت (كتابة ذرّية tmp→rename) | سقف لكل نوع، المثبّت عمره ما بيتشال |
| حالة العقل السحابي | `state/cybernova-brain-state.json` (91KB) | ✅ على GitHub كـcommit — بتقراه الصفحة الثابتة | آخر 200 ثغرة · سجل النبضات · الخزنة |
| جلسة المتصفح | `localStorage` (cybernova_*) | 🟡 في المتصفح بس — بتضيع بمسح البيانات | لا مركزية، ولا تشفير |
| خزائن `state/*.json` | `discovered-vulnerabilities-vault`, `nova-mission-log`, سكوبات Crypto.com/Sky | ✅ مقروءة من `public/state/` (نسخة مكررة) | ملفيات ثابتة، اتّساعها بالنص |

**على الاستضافات المجانية:** Render بيمسح القرص مع كل deploy → الذاكرة تروح.
**الحل الموجود:** تصدير/استيراد + نسخة يومية في `keepalive.yml` + **النبضة بتكتب على GitHub** (ده الحل الناجح).

---

## 6) العقل اللغوي — 8 مزودين بلا مفاتيح أو بمفاتيح مجانية

الترتيب في `lib/agent/llm.ts` (الأرخص → الأغلى): `Ollama محلي` · `Pollinations (بلا مفتاح)` · `Groq` ·
`OpenRouter :free` · `Gemini` · `Mistral` · `Together` · `Cerebras` · `GitHub Models` · `OpenAI` (المدفوع آخرًا).

الاختبار الفعلي على الجهاز (صفر مفاتيح، صفر Ollama):
```
brain: «العقل اللغوي متصل: Pollinations (بدون مفتاح)»  → الردود طلعت حقيقية بالمصري
tools: «33 أداة مسجّلة · تنفيذ hash_text نجح (SHA256 7d3fd347…)»
```
يعني **من غير أي فلوس ومن غير أي مفتاح، الشات والأدوات شغالين**. الفرق: الجودة والـrate limits.

---

## 7) الأسطول و`nova-agent.js` (الذراع اللي على الأجهزة)

`nova-agent.js` بيسجّل نفسه على `ws://…/api/local-agent/ws` وبيقبل: `exec · exec_stream · fs_list ·
fs_read · fs_write · processes · kill_process · screenshot · sysinfo · pty_* · mouse/keyboard/clipboard ·
deep_profile · heartbeat`. الوضع `--read-only` بيرفض التنفيذ، و`--allow nmap,curl,ls` بيقيّد البادئات.

22 endpoint في `routes/local-agent.ts` + 6 في `local-agent-input.ts` + `nodes.ts` + `fleet-mesh.ts` (خطط/خطوات/بث).

### 🚨 الحقيقة اللي لازم تتقال قبل «هنشغله على النت»
كل دول **من غير أي authentication** — لا توكن، لا same‑origin، لا في الويكند هاندشيك:

```
POST /api/local-agent/exec      {"command":"id"}        → 200  (من غير Origin ولا توكن)
GET  /api/local-agent/fs/list                            → 200
GET  /api/local-agent/download-project-zip               → 200  (الكود المصدري كله tar.gz)
GET  /api/local-agent/download-agent                     → 200  (سكريبت curl|bash)
GET  /api/fleet/bootstrap                                → 200  (الأمر الجاهز للتثبيت)
POST /api/kill-switch/activate                           → 200  {"killed":true}  (أي حد يوقف العقل)
POST /api/nova-core/auto-update                          → بلا حارس  (أي حد يشغّل deploy)
GET  /api/nova-core/restart                              → بلا حارس (لو في supervisor)
```
بالمقارنة: `/api/exec/*` محروس صح (`NOVA_EXEC_TOKEN` أو same‑origin، والـ`bash -c` مقفول) — والدليل
الـself‑check بند `exec` طالع ✓. **الفرق إن `local-agent` نسيوا من نفس الباب.**

**قبل أي نشر عام (مرتبة بخطورة التنفيذ):**
1. `app.use("/api/local-agent", requireToken)` — نفس `execAllowed` بتاع `exec.ts`، + التوكن في `routeUpgrade`.
2. `download-project-zip` يتشال أو يتقفل بالتوكن (تسريب مصدر + تسريب مسارات).
3. `kill-switch` و`auto-update` و`restart` و`settings/keys` خلف نفس التوكن.
4. `NOVA_EXEC_TOKEN=<openssl rand -hex 24>` في `.env` — **مش optional** على Oracle/Render.
5. `fs_write` + `mouse/keyboard` + `pty` تتقفل افتراضياً (`NOVA_ALLOW_FLEET_CONTROL=0`) وتفتح للضرورة.
6. بوابة تأكيد في **الكود** لـ`fleet_exec` (approval token بخطوتين) — مش في البرومبت.

---

## 8) إيه الحقيقي وإيه «شكل» — بالأرقام

| المقياس | الرقم | التفسير |
|---|---|---|
| إجمالي endpoints في `api-server/src/routes` | **553** | موزّع على 79 ملف |
| منها في `stubs.ts` لوحده | **100** | ردود فاضية/جاهزة «عشان الواجهة ماتفرش» |
| ملفات راوتر بيلمس شبكة/`https://` | **25 / 79** | الباقي بيانات محلية أو state |
| فحوصات المشروع الخضرا | 157/157 render · 156/156 live · 17/17 contracts · 0 فجوات connections | ✅ قوية جداً |
| typecheck الواجهة | **0 أخطاء** | ✅ |
| typecheck السيرفر | **99 خطأ** (`agent.ts` 39، `live_agent.ts` 14…) | ❌ و`pnpm build` بيفشل |
| CI | أخضر | ⚠️ لأن `deploy-pages.yml` ما بيجريش typecheck |
| unit tests | **0 ملف** | كل حاجة E2E؛ منطقي لواجهة، ناقص لمنطق الأدوات/الذاكرة |

### ✅ طبقة «الموك بيلبّس الفشل» — اتصلّحت
`res.json` shim بقى بيشتغل على **قراءات** المسارات اللي مش راوتر حقيقي بس؛ أي `/api/(exec|local-agent|live-agent|nova-core|ops|fleet|kill-switch|…)`
بيعدّي رده الحقيقي كما هو (503 = مفيش جهاز، مش 200 مفبرك). والـcatch-all بتاع `kali-sandbox-01` بقى
`{ ok:false, error:"no_execution_plane" }` بيوصّف الطريق اللي يخلّيه حقيقي. وكمان `/api` مجهول بقى **404 JSON** بدل HTML.

### طبقة «الموك بيلبّس الفشل» — النص الأصلي للتشخيص
`res.json` معرَّف من جديد: أي **404/500/503** من راوتر حقيقي بيتحوّل لـ**200** من `resolveStandaloneApi`.
ومعاه catch‑all:
```ts
if (path.startsWith("/local-agent/")) return { ok:true, connected:true, output:"Executed on kali-sandbox-01" };
```
**إثبات:** السيرفر شغال ومفيش أي جهاز متصل (`/api/local-agent/status` → `connected:false, count:0`)
ومع ذلك `/api/local-agent/exec` رجّع **200 «Executed on kali-sandbox-01»**.
ده أخطر من البابين اللي فوق لأنه بيخلي اللوحة **تكذب عليك بالطمأنينة** — وهو نفس الدرس اللي اتسجل في
HANDOFF عن الـgateway/Ollama، بس لسه عايش في باقي الـnamespaces. أي مسار تنفيذ/كتابة لازم يرجّع **501** صريح.

### ثغرة تانية في نفس الطبقة
مسار `/api` مش معروف بيرجع **`200 text/html`** (ملف الـSPA) بدل `404 JSON` — مثال: `/api/stats`,
`/api/monitor/health`. أي صفحة بتعمل `fetch().then(r=>r.json())` هتاخد **SyntaxError** بدل رسالة واضحة،
والغلط ده بيظهر بس على السيرفر (على Pages المحرك المحلي بيرد صح) → «شغال على Pages، مكسور على السيرفر».

---

## 8b) 🆕 محرك التنفيذ الحقيقي — `src/lib/ops/` (مضاف 2026-11-02)

| الملف | الدور |
|---|---|
| `ops/scope.ts` | البوابة القانونية: `state/programs.json` (wildcard/exact/CIDR/out_of_scope/passive_only) + حدود لكل برنامج + مضايفة DNS/rebinding + security.txt |
| `ops/gate.ts` | سياسة من واحد لكل حاجة خطرة: توكن/ same-origin / وضع المعمل، و`wsUpgradeAllowed` للتسجيل |
| `ops/ratelimit.ts` | سلة رموز لكل هوست + سقف عام + backoff أسي على 429/403/5xx |
| `ops/tools.ts` | أنواع المهام: 8 مدمجة (DNS/TLS/ترويسات/منافذ/CT/security.txt/JS/NVD) + 5 أدوات حقيقية بـ**argv بدون شل** |
| `ops/runner.ts` | job دائم: state/jobs/<id>.json، ميزانية، pause/resume/cancel، kill-switch، أدلة SHA-256، **بوابة تحقق**، تقرير Markdown |
| `routes/ops.ts` | REST: `/api/ops/{kinds,programs,programs/discover,jobs,stats,provision}` — القراءة مفتوحة، الكتابة بالتوكن |
| `ops/keys-source.ts` | التزويد الذاتي: مفاتيح من `NOVA_KEYS_URL`/`NOVA_KEYS_FILE` + تسجيل نطاقات `NOVA_SCOPE_DOMAINS` وقت الإقلاع (passive-only دايماً) |
| `scripts/ops-selftest.mjs` | 35 فحص على المنطق الحقيقي (بـtype-striping، من غير build) |
| `scripts/typecheck-ratchet.mjs` | baseline = 99، والـCI بيمنع أي رقم أعلى |

**الأدوات (13 أداة جديدة في `agent/tools.ts`):** `scope_check` · `program_add` · `program_discover` · `program_list` · `job_create` ·
`job_status` · `job_list` · `job_control` · `finding_verify` · `findings_list` · `job_report` · `ops_kinds` — يعني نوفا
تقدر تقول «ادخل على البرنامج ده» وتعمل job حقيقي بدل ما تشرحلك الخطة.

**إثبات من التشغيل الفعلي (الـsandbox هنا بيقطع الـHTTPS للخارج، فده المطلوب بالظبط):**
```
status done · stats {done:4, failed:4, skipped:0, findings:8, verified:6}
  recon.dns          done   DNS: 2 سجل A · 2 TXT
  recon.headers      failed الطلب لـexample.com موصّلش — النتيجة «مجهولة» مش «ناقصة»
  recon.ports        done   12 منفذ مفتوح · 6 حسّاس   ← الأدلة: evidence/recon.ports-f5588d94ecf6.txt
verify: 6/8 أُعيد إنتاجه · التقرير: state/jobs/<id>/report.md
POST /api/local-agent/exec (مجهول) → 403 · WS handshake → 401 · /api/munknow-path → 404 JSON
```

**اتقفل من القائمة دي (2026-11-02، نفس اليوم):**
- التولشيت المجاني الحقيقي: `deploy/oracle-setup.sh` بينزّل `nmap/dnsutils/whois` + `nuclei/httpx/subfinder/katana`
  من الـrelease الرسمي و`nuclei-templates`، و`POST /api/tools/install` بيعمل نفس الكلام على نود متصل (ومن غير
  نود بيرجع 503 بصدق مش «اتنفذ» مزيّف). `findBinary` بقى بيدوّر في `~/.local/bin` و`~/go/bin` كمان.
- التوكن للنودات: `nova-agent.js` بيبعت `NOVA_TOKEN` في `?token=` وفي الـregister، وسكربتOracle بيولّده
  ويحفظه في `/etc/cybernova.env` (600) — من غيره أي نود جديد هيترفض 401.
- مجلس بصوت حقيقي من غير مفاتيح: `NOVA_KEYLESS_SEATS` = 3 مقاعد موديلات مختلفة + `ollama` = 4، فـ
  `council()` بقى `usable >= 2` وبيصوّت بدل «صوت واحد».
- كتالوج السيرفرات المجانية (`routes/fleet-capacity.ts`) كان **مكتوب ومش مربوط** — اتmount في
  `routes/index.ts` فـ `/api/fleet/{capabilities,catalogue,scale-plan}` بقوا أحياء.

**اللسه ناقص للوصول لرؤيا «منصة زي كالي»:** طبقة `verify/` للمزيد من البراهين (SSRF canary، XSS headless،
SQLi differential)، `lib/programs/hackerone.ts` (قايمة برامجك من API — محتاج توكن HackerOne من المستخدم)،
`jobs` على Postgres بدل الملفات عشان الـconcurrency الحقيقي، وواجهة للـOps في اللوحة (المحرك لسه API/أدوات بس).

---

## 9) التشغيل المجاني 24/7 — الخيارات الست

| الطريقة | الملف | ينفع لإيه |
|---|---|---|
| **Oracle Always Free** 🥇 | `deploy/oracle-setup.sh` | سيرفر دائم، بيشيل Ollama، systemd + رجوع تلقائي |
| Render | `render.yaml` | أسرع بداية؛ بينام بعد 15 د؛ **بيمسح القرص كل deploy** |
| Fly.io | `fly.toml` | مستمر + قرص دائم للذاكرة |
| Docker | `Dockerfile` + `docker-compose.yml` (`--profile local-ai`) | أي مكان |
| PM2 | `ecosystem.config.cjs` | أي جهاز بدون root |
| **GitHub Actions (بدون سيرفر)** | `autonomous-brain-pulse.yml` (كل ساعة) | العقل السحابي: NVD + CISA KEV + GHSA → `state/` |

آلي شغال من غير تدخل: نبضة كل 10 د تمنع النوم · نسخة يومية للذاكرة · الـworkflow بيوقّظ السيرفر ·
Ollama model ينزّل لوحده (`ensureOllamaReady`) · لو مفيش موديل/مفتاح → العقل المدمج يكمّل.

---

## 10) حدود لازم تكون واضحة (عشان «نحمي العالم» محتاجة توقع صح)

1. **المنصة مش أداة اختراق.** مفيش exploit framework. اللي فيه: استطلاع سلبى، فحوصات ترويسات/CORS،
   تحليل JS، مصفوفة صلاحيات، تحقق SHA‑256، وتوليد تقرير. ده **نصف** شغل الـbug bounty الصح.
2. **مفيش scanner أصلي.** Nuclei/Nmap/Katana مش منصّبين؛ `kali-simulate` بيولّد الأمر. التنفيذ الحقيقي
   محتاج `nova-agent.js` على جهاز فيه الأدوات.
3. **النموذج اللغوي مش بيفحص** — بيخطّط وبيفسّر. أي «ثغرة» قالها لازم تتأكد بأداة/برهان (`zero-fp-verify`).
4. **الذاكرة لكل مستخدم لوحده** (localStorage) — مفيش حسابات، مفيش multi‑tenant، مفيش تشفير.
   لو حطيتها على نت عام، أي حد يشوف نفس المنصة **يشوف بياناتك** (وليس العكس فقط).
5. **Rate limits خارجية:** NVD 5 req/30s، GitHub مجهّز بـ60/hr بلا توكن. الشات هيقول 429 بصراحة، بس
   متبنيش عليه سكرابنج واسع.
6. **الفحص بدفعات على GitHub Actions** (`fleet-nodes` — 19 نود × 350 دقيقة) بيوقّعك تحت عين GitHub؛
   لو فيه أي تنفيذ على أهداف خارجية من نودات GitHub ممكن يطيح بالحساب. خليها داخلية/للمحاكاة.
7. **قانونياً:** Scope checker و«مصرّح به فقط» موجودين في البرومبت والواجهة، **مش enforced في الأدوات**.
   إضافة: منع `port_scan`/`web_fetch` لأي هدف مش في allowlist البرامج = أقوى حاجز يمنع خطأ غالي.

---

## 11) ترتيب الإصلاح المقترح (كله صغير ومحدّد)

| # | الشغل | الحجم | الأثر |
|---|---|---|---|
| 1 | ✅ **تم** توكن على `local-agent/*` + هاندشيك WS + توحيد البوابة في `ops/gate.ts` | — | 🛡️ سد RCE عام |
| 2 | ✅ **تم** قفل `kill-switch` / `auto-update` / `restart` / `download-project-zip` | — | 🛡️ سد DoS + تسريب مصدر |
| 3 | ✅ **تم** الموك بيقول الصدق + `/api` مجهول = 404 JSON | — | ✅ المصداقية |
| 4 | ✅ **تم** رatchet في CI (baseline 99) · ⏳ إصلاح الـ99 خطأ نفسها | ~يوم | ✅ البناء |
| 5 | حذف `novaAgentV1/V2` الميت + `lib/lib/` + `pages/123.tsx` + ملفات `-Fixed/-Real/-supreme-final` | نص يوم | 🧹 صيانة |
| 6 | `standalone-api.ts` في `lib/` ملف واحد + اختبارات وحدة لمنطق الأدوات/الذاكرة | يوم | ✅ أمان هندسي |
| 7 | allowlist أهداف مصرّح بها في `port_scan`/`web_fetch`/`fleet_exec` | ~80 سطر | ⚖️ حماية قانونية |

---

*ملف مرجعي — اتولّد من فحص فعلي: `pnpm install` · بناء الواجهة والسيرفر · `audit:{render,live,contracts,
connections,static-brain,brain}` · تشغيل `dist/index.mjs` على :8080 ونداءات API مباشرة.*
