# كيف بيشتغل النظام دلوقتي — من غير أي تدخّل يدوي

> آخر تحديث: 2026-11-01 (23:30 UTC) · مبني على تجارب حقيقية على السيرفر الشغّال، مش على كلام.

---

## 1) دورة التحديث (مقفولة بالكامل)

```
تعديل الكود → push → PR → merge
        ↓
GitHub Actions يبني الحزمة (اختبار + build)
        ↓
ينشر nova-24-7.zip في release "nova-portable"
        ↓
السيرفر (كل 15 دقيقة) بيسأل: فيه أحدث؟ → ينزّل ويطبّق
        ↓
المُشرف (boot.mjs) بيعيد تشغيل العملية بالكود الجديد
        ↓
لو مفيش /api/health في دقيقتين → يرجع النسخة القديمة تلقائياً
```

**مفيش زر، ومفيش رفع ملفات، ومفيش قناة تنفيذ مفتوحة.**

| نقطة تحقق | المسار |
|---|---|
| النسخة الشغّالة | `GET /api/nova-core/version` |
| حالة التحديث الذاتي | `GET /api/nova-core/auto-update` |
| فحص بدون تركيب | `GET /api/nova-core/auto-update?check=1` |
| تركيب فوري | `POST /api/nova-core/auto-update` |
| إعادة تشغيل | `POST /api/nova-core/restart` |
| بصمة الفشل (لو حصل) | `state/.update-failed` |

إيقاف المؤقت لو احتجت: `NOVA_AUTO_UPDATE=0` في `.env`.

---

## 2) الأسطول (سيرفرات مجانية بدون فيزا)

| النوع | الأمر/المكان | العمر |
|---|---|---|
| GitHub Actions | `Actions → fleet-nodes` (لحد 19 نود × 4 vCPU/16 GB) | 5س 38د للموجة، موجة كل 5 ساعات |
| سيرفر مجاني دائم | `GET /api/fleet/bootstrap?id=node-2` | 24/7 |
| أي جهاز | نفس الأمر بـ `--id my-laptop` | لحد ما يقفل |

الـ workflow فيه **loop**: لو الـ agent خرج لأي سبب بيرجع فوراً، فالموجة فعلاً بتكمل.

**الأسطول بقى opt-in (2026-11-02):** `schedule`/`push` مابيطلقوش موجة غير لو `vars.FLEET_ENABLED=1`
**و** `secrets.NOVA_EXEC_TOKEN` موجود — لأن نود من غير توكن على هوست عام = جهاز بيتنفّذ فيه أي حاجة من بره
(قياس حيّ: `POST /api/local-agent/exec` المجهول كان بيرجع `uid=1001(runner)` من نود حقيقي).
الضغطة اليدوية `Run workflow` لسه بتشتغل من غير شروط.

**الوصول من الصندوق مقفول؟قيس من CI:** `Actions → probe-live-llm` بيضرب على الهوست من runner وبيكتب
`probe-report.txt` في الفرع (بيتحمله بـrebase+retry فالفرع يتحرك وهو شغال). بيقيس `GET /api/ops/version`
(هل الـbundle الجديد وصل؟) و`POST /api/local-agent/exec` المجهول (لازم 403) — ده اللي بيفرّق
«منشور» عن «200 من الـSPA fallback».

قياس القدرة الحقيقي: `GET /api/fleet/capabilities` (نودات متصلة بس).
كتالوج المجاني: `GET /api/fleet/catalogue` (كل حاجة بتطلب بطاقة معلّمة) — الراوتر ده كان متكتب بس
مش مربوط في `routes/index.ts`، اتفعّل دلوقتي فـ `/api/fleet/{capabilities,catalogue,scale-plan}` شغالين.
`GET /api/fleet/scale-plan?target=12` بيحسب عدد الموجات المطلوبة وبيدي أوامر جاهزة.

**التوكن مش اختياري للأسطول:** البوابة بترفض أي نود من غير `NOVA_TOKEN` (401 في الـupgrade).
`deploy/oracle-setup.sh` بيولّده في `/etc/cybernova.env` ويطبعه، وActions بياخده من Secret `NOVA_EXEC_TOKEN`.
**مفيش أدوات نشطة على نودات Actions** (nmap/nuclei متثبتش) — السورس IP بتاع GitHub، والمسح النشط منه
بلاغ بيودّي الحساب. التولشيت الكامل بيتسطّب على النود الدائم أو بـ `POST /api/tools/install {"tool":"nuclei"}`.

---

## 3) حالة السيرفر الحيّة (مرجع)

- 10 فحوص ذاتية: **100% · 10/10** — كل واحدة بتختبر نفسها فعلياً (البوابة بتتسأل، مش بتتفترض).
- الكراولر: **45/45 · 0 أخطاء سيرفر · 0 مسار ناقص**.
- الأسطول: 4 نودات حقيقية (Azure runners) بتنفّذ أوامر فعلية، وفضلوا متصلين بعد restart للـhub.
- التحديث الذاتي: 4 تحديثات اتطبّقت لوحدها بدون أي تدخّل.
- اللغات: **25 لغة** مسجّلة في الواجهة (RTL لعربي/عبري/فارسي/أردو).
- المجلس: 3 نماذج بترد فعلاً (Groq · Gemini · **Pollinations بدون مفتاح**) + OpenRouter 429 + OpenAI مفتاح غلط.

## 3.1) اللغات وبدون مفاتيح

| الحاجة | المسار / المتغير |
|---|---|
| تبديل اللغة | زرار 🌐 في الهيدر · محفوظ في `localStorage` |
| كود اللغات | `artifacts/kali-panel/src/lib/i18n.ts` (25 لغة × 32 نص) |
| نسبة الترجمة الحقيقية | `coverage()` في نفس الملف — مفيش نسبة مزيّفة |
| مقاعد LLM بدون مفاتيح | `ollama` + `pollinations:openai-fast` + `pollinations:mistral` + `pollinations:llama` (4 مقاعد = مجلس بيصوّت فعلاً) |
| تغيير قايمة المقاعد | `NOVA_KEYLESS_SEATS="openai-fast,mistral"` · إطفاء: `NOVA_KEYLESS_LLM=0` |
| مفاتيح من مصدر عندك | `NOVA_KEYS_URL` (https) أو `NOVA_KEYS_FILE` — بيقرأ JSON ويحقن البيئة وقت الإقلاع |
| نطاقات ائتمش يدوياً | `NOVA_SCOPE_DOMAINS=a.com,b.com` → بيتسجّل passive_only أوتوماتيك |
| حالة التزويد | `GET /api/ops/provision` (أسماء بس، مفيش قيم) |

---

## 4) قواعد ثابتة في الكود

1. **مفيش رقم مزيّف**: كل عدّ (أسطول، ذاكرة، ثغرات) بيتقاس من الحالة الحية.
2. **مفيش ترمينال مزيّف**: اتشال نهائياً — الأوامر بتروح للنود الحقيقي وبترجع مخرجاته.
3. **مفيش تحديث بيكسر الموقع**: رجوع تلقائي من النسخة الاحتياطية.
4. **مفيش مفاتيح في الشات**: القيم في `.env` بس.

---

## 5) الفحص بجلسة مصادقة (Authenticated scanning)

من غير جلسة، كل ماسح في الدنيا بيشوف صفحة الـlogin وبس. الجلسة هي الفرق بين
«الترويسات ناقصة» و«الحساب A بيقرا بيانات الحساب B».

| الحاجة | إزاي |
|---|---|
| إضافة جلسة لبرنامج | `POST /api/ops/programs` مع `session: { headers: { "Authorization": "Bearer …" }, cookie: "sid=…" }` |
| أدوات بتستخدمها | nuclei · httpx · katana (`-H` واحد لكل هيدر) + الفحص الداخلي (headers/jspaths) |
| حماية القيمة | `GET /api/ops/programs` بيرجّع **أسماء الهيدرات + بصمة 12 حرف** بس، مفيش قيمة |
| حماية الأدلة | كل بايت بيتخزن كدليل بيعدّي على `redactSecrets()` — الكوكي مش بيتكتب ولا بيتعمله hash |
| اختبار بيقيس ده | `node scripts/test-session-gate.mjs` (18 فحص، كلهم على سيرفر محلي بيرصد الهيدرات) |

القاعدة: الجلسة تبقى **لحسابك انت على برنامج مصرّح**. مفيش جلسة لحد تاني، ومفيش
كوكي بيتنقل بين برامج.

---

## 6) مكتبة الثغرات — من رقم مكتوب لإشعارات حقيقية

**قبل:** `/api/dashboard/stats` كان بيرجّع `totalCves: 75879` · `criticalCves: 30163` ·
`cisaKev: 1284` · `exploitsCatalogued: 49217` · `githubAdvisories: 21540` — خمس أرقام
مكتوبة بالإيد فوق مصفوفة فيها **22 صف**. مفيش قاعدة بيانات وراها.

**بعد:**

| الحاجة | الحقيقة |
|---|---|
| المصدر | `GET https://api.github.com/advisories` (مجاني، بلا مفتاح) |
| الترقيم | cursor (`Link: rel="next"`) — `?page=` **مش شغال** وبي رجّع نفس الصفحة |
| المخزّن | `state/advisory-cache.json` — **1,364 إشعار حقيقي** (critical 261 · high 1,103) |
| الفلتر | `NOVA_ADVISORY_MIN_SEVERITY=high` — عشان الملف يبقى 468 KB مش ملايين |
| الأرقام في الـdashboard | `githubAdvisories` = عدد المخزّن فعلاً · `totalCves` = عدد صفوف جدول CVE · وأي حاجة مش مقاسة = `null` |
| مزامنة | `POST /api/ops/advisories/sync` أو `node scripts/advisory-sync-cli.mjs 25` |
| نوع مهمة جديد | `intel.advisories` — تقنية مكتشفة (أو CVE) → إشعارات حقيقية بأدلة |
| إثبات | `node scripts/test-advisory-library.mjs` → **20/20** (شامل: مزامنة فاشلة ما بتمسحش المكتبة) |
| تحديث يومي | `.github/workflows/advisory-library.yml` (كل يوم 04:17 UTC) |

القاعدة: الثقة `confidence` لأي إشعار = **0.45** — إشعار بيذكر اسم منتج مش دليل إن
الهدف بيشغّله. الإصدار لازم يتأكد قبل أي تقرير.

---

## 7) كوربوس الثغرات الحقيقي (NVD + KEV + EPSS)

البرنامج **كان** متوصّل فعلاً بـ9 مصادر حقيقية (`live-vuln-ingestor.ts`: NVD, GHSA,
EPSS, CIRCL, OSV, DeFiLlama, Shodan InternetDB, PayloadsAllTheThings + مُتعلّم).
المشكلة مكانتش في الاتصال — كانت في إن كل نداء بيسحب **5–10 سجلات** لبانل
«تليمتري»، فمافيش حاجة بتتراكم. عشان كده الأرقام في الـdashboard بقت مكتوبة بالإيد.

دلوقتي فيه طبقة تجميع حقيقية:

| الحاجة | التفاصيل |
|---|---|
| المصدر | NVD 2.0 (كل الـCVEs) + CISA KEV + FIRST EPSS |
| الشكل | سطر JSON لكل CVE + CPE مقسوم (vendor/product/version) + `kev` + `epss` |
| الملفات | `state/vuln-corpus/cves.jsonl.gz` (مش في git) + `state/vuln-corpus-index.json` (في git) |
| السحب | `.github/workflows/vuln-corpus.yml` — **كل 30 دقيقة** incremental + **كل أسبوع** كل القاعدة |
| السرعة | NVD بلا مفتاح = 5 طلبات/30 ثانية (السكربت بيبطّئ نفسه أوتوماتيك) |
| الاستعلام | `GET /api/ops/corpus?product=nginx&minCvss=7` · `?cve=CVE-2024-3094` |
| نوع مهمة | `intel.corpus` — منتج مكتشف → CVEs حقيقية بـKEV/EPSS وأدلة |
| الإثبات | `node scripts/test-vuln-corpus.mjs` → **27/27** |
| التحميل | release tag `vuln-corpus` (الملف المضغوط) |

**قاعدة الصدق:** `measured` = false لحد ما السحب يحصل فعلاً، و`total` هو اللي في
ملف الفهرس بالساعة. مفيش رقم ثابت في الكود.

---

## 🧰 الطبقة دي: المحرك بيجيب أدواته بنفسه (`lib/ops/toolchain.ts`)

**ليه اتعملت:** مقاس على السلوت الحيّ `https://nova.waifly.com` في 2026-11-05T17:14Z:

```
GET /api/ops/version  → { toolsPresent: [], autonomy: { level: "passive", programs: 0 }, opsRouter: true }
GET /api/ops/hunt/candidates → { present: false, path: "ops/bounty/programs-catalog.json", scanned: 0 }
```

يعني الحاوية سليمة وبتجري، بس **بلا إيدين وبلا بيانات**: `scripts/fetch-toolchain.mjs`
كان **خطوة بناء في CI** بس، فأي سيرفر بينزل `nova-24-7.zip` مابيشوفش ولا أداة،
والكتالوج اللي بيولّد الخطة أصلاً مش في الحزمة.

| الحاجة | التفصيل |
|---|---|
| الحالة | `GET /api/ops/tools` — `present/missing` مقروءين من القرص بـ`findBinary()`، + `writable`، + `scriptAvailable`، + آخر محاولة مسجّلة |
| التجهيز | `POST /api/ops/tools/provision {only?:"nuclei,httpx"}` — ورا `opsAllowed` (توكن/نفس الأصل)، بيشغّل `spawn(process.execPath, [script,"--into",dir,"--json"])` **بلا shell** |
| السقف | `timeoutMs` في `provisionToolchain` (الافتراضي 540 s، مقصوص 30 s–20 min) والقتل `SIGKILL` — **مافيش متغير بيئة ليه لحد دلوقتي**، اللي عايز يغيّره يبعتّه في الـcall |
| ضد التحميل المتكرر | `provisionToolchainOnce`: لو فيه أداة موجودة → `already-present`؛ وبعد فشل → `cooldown` (`NOVA_TOOLCHAIN_RETRY_MS`، الافتراضي 10 دقايق)؛ ومحاولة واحدة في نفس الوقت (single-flight) |
| وقت الإقلاع | `NOVA_TOOLCHAIN_FETCH=1` دايمًا، `=auto` بس لو `vendor/bin` فاضي — **الافتراضي مطفي** (~100 MB على قرص 512 MB مع كوربوس منزّل = مخاطرة OOM، فمابنخذلهاش على المستخدم) |
| الكاش | بعد أي تنزيل ناجح `resetBinaryCache()` — من غيره الأداة تتنصب وتفضل «مش موجودة» للابد |
| للشارح | `NOVA_VENDOR_BIN` (المجلد) · `NOVA_TOOLCHAIN_RECORD` (ملف السجل، لافتراضي `state/toolchain-provision.json`) |

**القاعدة اللي اتثبتت على الحزمة (مش على القراءة):** بعد `node scripts/build-standalone.mjs`
و`node server.mjs` locally، نفس الطلبات رجّعت:

```
GET  /api/ops/hunt/candidates → present: true · scanned: 746 · 235 مستبعد
GET  /api/ops/tools           → present: [] · missing: 7 · writable: true · scriptAvailable: true
POST /api/ops/tools/provision → 403 للزائر المجهول (ops_write_requires_token)
POST + Origin نفسه          → 200 · السكربت اتنفّذ فعلاً · «ffuf: failed — api.github.com ماردّش»
```

السطر الأخير هو المقصود: **مافيش نجاح مختلق**. لو الشبكة ماردّتش، الرد بيقول
السكربت مشى (`ran:true`) وماثبتش حاجة (`ok:false`, `installed:0`) — مش «تم التثبيت ✓».

### أداتا المحرك الجديدتان (49 في السجل)
- `tools_install` — بيستدعي `provisionToolchainOnce`؛ يعني «ثبّت nuclei» بقى طلب
  بيتنفّذ، مش اعتذار. و`self-model` بقى يقيس الأدوات، فالجملة اللي في البرومبت
  («أدواتك الأمنية على المكنة: …») بتتكتب من القرص لحظة السؤال.
- `bounty_candidates` — قراية الكتالوج (746 برنامج) كمصدر **أفكار وأهداف** بـ
  `consented:false` صريح في كل سطر؛ الفحص النشط لسه محتاج `program_add` + `scope_check`.
  وفي الوضع المستقل الـdirector بينفّذها هو (`/api/nova/sessions/:id/auto-chat`) بدل
  ما يخلّص بجملة «ابعتلي نطاق» — مقاس على الحزمة: `🤖 خطوة ذاتية · bounty_candidates: 3 مرشّح من 746`.

### البوابة اللي بتمنع الرجوع
`scripts/audit-route-integrity.mjs` (مسجّل في `scripts/agent-gates.mjs` = 18/18) بأربع ضروس،
وكل واحدة مُثبتة بحقنة في `--selftest`:

1. **`spine-symbol`** — أي رمز بيتنادى في `src/routes/**` ولازم يكون متصدّر من `src/lib/**`
   ولازم يكون مستورد في الملف. دي هي علة «الشات عبيط» حرفيًا.
2. **`host-touch-ungated`** — أي `router.post/put/delete` بيلمّ المكنة
   (`spawn|exec*|fs.writeFileSync|execOnLocalAgent|import("child_process")`) لازم يكون
   جوه قرار إذن (`requireOps|checkGate|opsAllowed|assertAuthorized|tokenOk`).
3. **`hollow-ship`** — أي ملف بيانات `ops/…` بيتقرا من `src/**` وقت التشغيل لازم
   `build-standalone.mjs` ينسخه (بالاسم أو بالمجلد).
4. **`twin-fabrication`** — التوأم (`standalone-api.ts`) ممنوع يؤكد تثبيت/فحص/جلب:
   لا `installed: true`، لا «Nmap scan report»، لا «Verified HTTP 200»، ولا `ok:true` جنب `stdout`.
