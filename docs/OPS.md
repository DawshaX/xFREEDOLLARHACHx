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

**قبل ما التحديث يلمس الشبكة: قياس القرص (المرحلة 63).** `live-update.py` بيقرا
`os.statvfs(dest)` و بيرفض (`exit 1`، ولا ملف اتغيّر) لو الفاضل أقل من `NOVA_UPDATE_MIN_FREE_MB`
(افتراضي 60 MB: 3 MB تنزيل + ~12 MB فك ضغط + ~12 MB نسخة احتياطية + هامش). `=0` يلغي الفحص.
السطر اللي بيطبعه بيوضّح الرقمين: `· القرص: 18731MB فاضل (مطلوب 1MB)` أو
`✗ القرص الفاضل 42MB أقل من 60MB — مفيش تحديث (مفيش ملف اتغيّر)`. متقاس بالتشغيل الفعلي:
حد خرافي = رفض قبل الشبكة في مللي-ثانية، وحد صغير = تعدّي للتنزيل.

**ملفات `state/` والتحديث الذاتي (المرحلة 63):** `deploy/live-update.py` بيحمي `state/`
عشان ذاكرة المكنة، بس الحماية دي كانت بتخلي بيانات CI المنشورة (`hunt-latest.json`،
`advisory-cache.json`، `verified-live.json`، `vuln-corpus-index.json`، `nova-brain-latest.json`،
`free-hosts.json`، `cryptocom-hackerone-scope.json`) ما توصلش أي مكنة محدَّثة أبدًا — حتى لو
الحزمة فيها الملف. من المرحلة دي الباندر بيولّد `update-manifest.json` فيه `refreshState`
(متولّد من `STATE_DATA` نفسه، مش قائمة تانية) والإنستولر بينقل الملفات دي بس، وبشرط
**«الأحدث يكسب»**: لو النسخة على المكنة أحدث بتتساب وتتبصّط في اللوج. المستثنى صراحةً في
`neverOverwrite`: `nova-memory.json`، `cybernova-brain-state.json` (بنكته `autonomous-brain-pulse.mjs`
على المكنة — مسحها = مسح «وقفنا فين») `discovered-vulnerabilities-vault.json` (الأجنت بيعدّلها حيًا)،
`nova-mission-log.json` (بيتكتب على المكنة)، `corpus-last-failure.json`. الضرس الخامس في
`audit-route-integrity.mjs` بيمنع الفارق: مانيفست من غير توليد من `STATE_DATA.filter(` = أحمر،
و`live-update.py` مابيقرأش المانيفست = أحمر.

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
| قبل ما ينزّل يقيس | `freeMB` من `fs.statfsSync` على قرص `vendor/bin` · لو أقل من `NOVA_TOOLCHAIN_MIN_FREE_MB` (افتراضي 180) بيرجع `error:"no-space"` + `refused:"no-space"` **من غير أي طلب شبكة** — أحسن من تنزيل نص المجموعة وتفجير قرص 512 MB وتجميد المكنة |
| وقت الإقلاع | الحزمة المحمولة (من المرحلة 60) بتفتح `NOVA_TOOLCHAIN_FETCH=1` و`NOVA_PROVISION_TOOLS=1` لوحدها، و`index.ts` بينادي `provisionToolchainOnce()` بعد `NOVA_PROVISION_DELAY_MS` (90 ثانية) — يعني المكنة تجرّب تجيب أدواتها نفسها وهي شغّالة، والحارس الثلاثة فوق (already-present/cooldown/no-space) تمنع السخونة. `=auto` معناه «جرّب بس لو `vendor/bin` فاضي». الإطفاء: `NOVA_PROVISION_TOOLS=0` |
| الكاش | بعد أي تنزيل ناجح `resetBinaryCache()` — من غيره الأداة تتنصب وتفضل «مش موجودة» للابد |
| للشارح | `NOVA_VENDOR_BIN` (المجلد) · `NOVA_TOOLCHAIN_RECORD` (ملف السجل، لافتراضي `state/toolchain-provision.json`) · `NOVA_TOOLCHAIN_MIN_FREE_MB` (حد المساحة، بيتقرا عند كل قرار مش لحظة الاستيراد) |

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

### أدوات المحرك (العدد مقروء من `AGENT_TOOLS` في كل تشغيل — مش رقم مكتوب في العنوان)
- `tools_install` — بيستدعي `provisionToolchainOnce`؛ يعني «ثبّت nuclei» بقى طلب
  بيتنفّذ، مش اعتذار. و`self-model` بقى يقيس الأدوات، فالجملة اللي في البرومبت
  («أدواتك الأمنية على المكنة: …») بتتكتب من القرص لحظة السؤال.
- `bounty_candidates` — قراية الكتالوج (746 برنامج) كمصدر **أفكار وأهداف** بـ
  `consented:false` صريح في كل سطر؛ الفحص النشط لسه محتاج `program_add` + `scope_check`.
  وفي الوضع المستقل الـdirector بينفّذها هو (`/api/nova/sessions/:id/auto-chat`) بدل
  ما يخلّص بجملة «ابعتلي نطاق» — مقاس على الحزمة: `🤖 خطوة ذاتية · bounty_candidates: 3 مرشّح من 746`.

### البوابة اللي بتمنع الرجوع
`scripts/audit-route-integrity.mjs` (مسجّل في `scripts/agent-gates.mjs` — والعدد بيتقال من تشغيل السكربت
نفسه، مش من رقم مكتوب هنا) بخمس ضروس، وكل واحدة مُثبتة بحقنة في `--selftest`:

1. **`spine-symbol`** — أي رمز بيتنادى في `src/routes/**` ولازم يكون متصدّر من `src/lib/**`
   ولازم يكون مستورد في الملف. دي هي علة «الشات عبيط» حرفيًا.
2. **`host-touch-ungated`** — أي `router.post/put/delete` بيلمّ المكنة
   (`spawn|exec*|fs.writeFileSync|execOnLocalAgent|import("child_process")`) لازم يكون
   جوه قرار إذن (`requireOps|checkGate|opsAllowed|assertAuthorized|tokenOk`).
3. **`hollow-ship`** — أي ملف بيانات `ops/…` بيتقرا من `src/**` وقت التشغيل لازم
   `build-standalone.mjs` ينسخه (بالاسم أو بالمجلد).
4. **`twin-fabrication`** — التوأم (`standalone-api.ts`) ممنوع يؤكد تثبيت/فحص/جلب:
   لا `installed: true`، لا «Nmap scan report»، لا «Verified HTTP 200»، ولا `ok:true` جنب `stdout`.
5. **`hollow-state`** (من المرحلة 62) — أي `state/*.json` **متتبَّع** وبيقراه السورس أو البانل
   وقت التشغيل لازم `build-standalone.mjs` ينسخه بالحرف. اللي كشفها قياس حيّ: ملاحظة `hunt` ما
   بتظهرش على الهَب و`advisories` بتردّ `measured:false`، لأن `state/hunt-latest.json` (19 موضع
   قراءة) و`state/advisory-cache.json` (12 موضع) ما كنوش بيلحقوا بالحزمة. الملفات اللي بتتكتب على
   المكنة (`proactive-log.json`، `toolchain-provision.json`، `fleet-servers.json`) مستثناة لوحدها
   لأنها مش متتبَّعة — القاعدة بتتغذى من `git ls-files state` مش من قائمة يدوية.

و`scripts/audit-no-cjk-in-text.mjs` (من المرحلة 61): أي ملف نصّي متتبَّع — سورس السيرفر،
السكربتات، الـdocs، الـdeploy، وملفات بياناتنا — ممنوع فيه حرف شرق-آسيوي واحد. السبب مقاس:
وصف `bounty_run` كان فيه حرف شرق-آسيوي بدل كلمة «هدف» في نص عربي، وده بيتاكل جوه الـprompt فالنموذج يلّفه.
المستثنى الوحيد هو `i18n.ts` (قواميس zh/ja/ko)، وسببه مكتوب جوه البوابة نفسها. وفيه
`--selftest` بأربع حالات بتثبت إن الحقنة بينمسك — عشان بوابة خضرا على فاضي أخطر من عدما.



---

## مفتاح الأتمتة الحقيقي (مرحلة 57)

قبل كده كان `POST /api/autonomous/enable` بيتجاب من `routes/stubs.ts` بيردّ
`{ok:true,active:true}` من غير أي أثر. دلوقتي ليها راوتر وحالة:

| المسار | auth | بيعمل إيه |
|---|---|---|
| `GET /api/autonomous/status` | مفتوح | الحالة المقروة: `enabled`, `level`, `source` (`panel`/`env`/`default`), `file`, `fileExists`, `lockedByEnv`, `daemon:{running,state,cycles,lastHeartbeatAt,activeTarget}`, `subscribers` |
| `POST /api/autonomous/enable` | `x-nova-token` (أو same-origin كما في `/ops`) | بيكتب `state/autonomy.json`، بيشغّل `startAutonomousBackgroundDaemon()`، وبيردّ **بالحالة بعد القراءة** (لو القياس مش مطابق للطلب → `ok:false` برسالة، مش «تم ✓») |
| `POST /api/autonomous/disable` | توكن | بيقفل المستوى وفي النسخة اللي فيها `stopAutonomousBackgroundDaemon()` بيلغي المؤقّت فعلاً |
| `POST /api/autonomous/tick` | توكن | دورة حالّية على `tickAutonomousDaemon(target)` — للنتاجة اللحظية بدل ما يستنى اللفة الجاية |
| `GET /api/autonomous/stream` | مفتوح | SSE: أول حدث `status` مقاس، وبعدين `tick_start/tick_done/tick_error/enabled/disabled` من مجرّة الديمون (`lib/autonomy-events.ts`) |

**الأولويات:** `NOVA_OPS_AUTONOMY` لو مضبوط = قرار مشغّل وقفل (المتصفح ما
بيتجاوزهوش، بيردّ `ok:false` مع السبب) ← بعدين `state/autonomy.json` (لوحة
التحكم) ← بعدين `passive`. `ops/autonomy.ts:autonomyLevel()` بيقرأ من نفس المصدر،
فمفيش شاشة تقدر تقول «مفعّل» والمحرك يقول غير كده.

للتشغيل من المتصفح: `LiveAgentPanel` بيحط التوكن من `localStorage["cybernova_ops_token"]`
في `x-nova-token` — نفس مفتاح `ops-client.ts`. من بره:

```bash
curl -X POST https://nova.waifly.com/api/autonomous/enable \
  -H "x-nova-token: $NOVA_EXEC_TOKEN" -H 'Content-Type: application/json' -d '{"level":"standard"}'
curl https://nova.waifly.com/api/autonomous/status | jq '.daemon, .level, .source'
```

## بوابة أمانة الـstubs

`node scripts/audit-stub-honesty.mjs` — بيحلّل ترتيب تركيب `routes/index.ts`
(مع الـprefix ومقابل `:param`) بيقسّم `stubs.ts` ميت/لايف، وبيفشل لو ستاب **لايف**
ادّى نجاح على طلب تغيير حالة أو لفّق `active/started/killed:true` من غير شغل،
أو لو حد استورد من طبقة `src/lib/lib` الظلية. `--selftest` بيثبت إنه بيلحق
الحقن. اتقاس النهاردة: 100 handler → 72 ميت / 28 لايف / 0 ادّعاء.

## مفاتيح جديدة/مهملة

- `SHODAN_API_KEY` (اختياري): لو موجود `GET /api/tools/shodan?q=…` بيعمل استعلام
  `api.shodan.io/shodan/host/search` حقيقي؛ لو مش موجود بيردّ
  `{ok:false,noSource:true,error:"no_shodan_key",reasonAr,howAr}` — **مش** بيعيد
  12 مضيف مختلقين زي ما كان. البديل المجاني الدائم: `/api/deep-research/live-osint`.
- `NOVA_PLAN_TIMEOUT_MS` (افتراضي 12000، مقصوص `3000..60000`): سقف زمني لاستدعاء الموديل في **التخطيط** بس.
  القياس اللي خلفه: سؤال قدرة بسيط استنا `llmComplete` 65 ثانية وطلع غلط، والتحية استنت 8.3 ثانية على حزمة
  مبنية. لو الميزانية خلصت بيتطبع `[plan] مافيش خطة من الموديل جوه Xms` والمخطّط الحتمي بيكمّل (الأدوات
  بتتنفّذ فعلًا) — `=3000` لمحادثة فورية على مزوّد بطيء، و`=60000` لو عايز الموديل ياخد راحته في الطلب التقيل.
- `NOVA_UI_*` مافيش: أوامر اللوحة (`browser_open`/`ui_navigate`) ماشية على `GET /api/nova-core/ui` + بث
  `nova:ui` على `/api/ws` — واللي بيفرّق «اتنفّذ» عن «اتطلب» هو `deliveredAt` المسجّل لما اللوحة تسحب الأمر.
- `packageManager: pnpm@10.34.9` في `package.json` + كل الـworkflows مثبّتة على
  نفس النسخة (قبل كده 5 منهم على `version: 10` — أي major جديد بيقصف
  `--frozen-lockfile` بـ`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`).
- `state/autonomy.json`: حالة تشغيل، بيتكتب جوه `NOVA_STATE_DIR` أو `state/` —
  ملف صغير تقدر تشرّه لو عايز تثبّت المستوى عند إعادة التشغيل.
- `NOVA_RELEASE_API_URL`: بيغيّر مسار `api.github.com/.../releases/tags/...` اللي
  التحديث الذاتي بيقرا منه. موجود للتستات (وبيرفض به الهَب المحمي بسوء الفهم) —
  سيبه فاضي في الإنتاج.
- `NOVA_UPDATE_ASSET_URL`: أصل الحزمة اللي بنعمله `HEAD` ونقرا `Last-Modified` لو
  الـAPI رفض. الافتراضي `github.com/DawshaX/xFREEDOLLARHACHx/releases/download/nova-portable/nova-24-7.zip`.

## الأسرار: مش في الكود (من المرحلة 58)

`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `OPENCLAW_GATEWAY` / `OPENCLAW_TOKEN` كانت مكتوبة
حرفيًا في `lib/nova-cron.ts` وفي البانل، فنزلت منشورة في الحزمة العامة وعلى GitHub Pages.
القاعدة من دلوقتي (وببوّابة `scripts/audit-src-secrets.mjs`):

- السيرفر: `process.env` وبس. `tg_pulse` من غير مفاتيح بترجع `skipped: TELEGRAM_BOT_TOKEN/…`
  مش رسالة نجاح.
- المتصفح: `localStorage` بمفاتيح `nova_tg_bot_token` / `nova_tg_chat_id` / `nova_openclaw_token`
  / `nova_openclaw_gateway`، والخانات في «تنبيهات تيليجرام» و«بوابة ngrok» بتحفظ هناك.
- أي سطر مقصوده مثال/اختبار: `// allow-secret-literal` جنبه.
- **لازم**: التوكن اللي اتنشر يتلغى من BotFather ويتعمل جديد، و`NOVA_EXEC_TOKEN` كمان.

## الصوت الدائم والمهام الحيّة (المرحلة 59)

| إيه | ازاي يتقفل/يتفتح |
|---|---|
| جدول `nova-cron` (6 مهام) | `NOVA_CRON_ENABLED=0` يطفيها. من غيره بتتشغّل مع `index.ts`. |
| الملاحقين | `NOVA_WATCHERS=0` يطفيهم · `NOVA_WATCH_INTERVAL_MS=300000` المدة (أقل حاجة 30s) |
| ملاحظات حية | `GET /api/nova-core/watch` (قراية مفتوحة) · `POST /api/nova-core/watch/tick` (عندك `NOVA_OPS_TOKEN` بس، و`{"force":true}` يكرر نفس الحالة) |
| السجل | `state/proactive-log.json` — حالة تشغيل، **متتعملهاش commit** |
| التوصيل للمستخدم | `ws-hub` بيبعت `watch_note` · تليجرام بيشتغل لو `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` في environment (لو مش موجودين السطر بيتسجّل `skipped:`) |
| الخزنة الدائمة | `NOVA_PERMANENT_VAULT` يغيّر مسار `state/discovered-vulnerabilities-vault.json` |
| خزنة الشغل | `NOVA_FINDINGS_VAULT` (افتراضي `state/findings-vault.json` — مش موجود في المستودع، فالأجنت بيقرا الدائمة أوتوماتيك) |
| تشخيص من بره | `GET /api/nova-core/watch/probe` — نفس القرايات دي على طول من غير كتابة/بثّ/فلتر تكرار (ده اللي بيكشف «ليه الملاحظة ساكتة» مش «فيها إيه») |
| إعادة تشغيل الصوت | `NOVA_VOICE=0` يقفل طبقة إعادة صياغة الردّ الصوتي؛ من غيره الردّ المباشر بيتقال بصوت البرنامج مع `capabilityTruthLine()` |
| أدوات الإقلاع | `NOVA_PROVISION_TOOLS=0` يطفي محاولة التنزيل وقت الإقلاع · `NOVA_PROVISION_DELAY_MS` مدّة الانتظار (90000) · في الحزمة الاتنين مفتوحين افتراضيًا |
| لوج الملاحقين | `watchStatus` بيرجّع `ticks/emittedTotal/writeFailed/lastError` و`lastTickAtDisk` مقابل `lastTickAtMemory` — الصمت له سبب مقاس دلوقتي |

الأرقام اللي بتقولها الملاحظات كلها مقروءة من الملفات نفسها (`hunt-latest.json`، `counts` الخزنة،
`advisory-cache.json`، `vendor/bin`) — مفيش رقم مكتوب في الكود ده الآن محروس بـ`audit-no-invented-intel`
(R6 قدرات مقاسة، R7 هوية واحدة).

## فين بيشوف كل بايت (قياس 2026-11-07 16:00Z)

| الحاجة | المكان | الرقم المتقاس |
| --- | --- | --- |
| ذاكرة المكنة الطويلة | `state/nova-memory.json` على المكنة (المسار السريع) | 20 سجل · 24,825 بايت (`/api/nova-core/storage`) |
| نسخة تعيش بعد المكنة | Supabase `cybernova-ops` → `public.nova_memory` صف `main` | بتتكتب من دالة `nova-state`؛ القياس من `GET /api/memory/stats` → `mirror.state` |
| الكوربوس | نفس القاعدة، `public.corpus_cve` | 115,990 ثغرة · 152MB — مش على قرص المكنة |
| أدلة الصيد | `state/hunt/evidence/*.txt.gz` | مضغوطة (8.4MB → 1.15MB) بميزانية `HUNT_EVIDENCE_MAX_MB=32`؛ اللي عليه مرجع في حالة دائمة بيتحمى |
| لوج التحديث | `state/auto-update.log` | بيلف عند 256KB (قِيس: 359KB → 24KB) |
| نسخة رجوع التحديث | `<install>/backups/` | آخر 3، وبس الملفات اللي اتغيّرت فعلًا (قِيس: 93 بايت مكان 11.8MB) |
| أدوات الأمان | `/home/container/vendor/bin` | 12 أداة؛ `auto` على مكنة مُشرَفة مع حارس قرص 1.5GB |

ليه مافيش مفتاح على المكنة: الحزمة بتتنزّل من release **عام** (المستودع عام —
متقاس من `gh api repos/... → visibility: public`)، فأي سر جواها بقى مقروء لأي
حد. الكتابة للقاعدة بتعدي علي `supabase/functions/nova-state/index.ts` اللي
مفتاح الخدمة جوّه Supabase نفسها، والباب بيرفض أي مسح للذاكرة (حارس anti-wipe)
ويقصر الكتابة علي صف واحد. سؤال «اتحفظت ولا لأ؟» ليه رد واحد: `GET /api/nova-core/state` — بيرجع حجم ملف
الذاكرة على القرص + تاريخ آخر كتابة + حالة النسخة في القاعدة + حكم صريح
(«محفوظة على القرص + نسخة في القاعدة» / «على القرص بس» / «النسخة معلقة: …»).
وفي الإقلاع نفسه الصف الفاضي بيتعبّى من القرص (`bootstrapped: true` في لوج
الإقلاع) — عشان مكنة عندها سجلات ما تفضلش شهور «محفوظ على القرص بس» لو مافيش
كتابة جديدة؛ والقراءة اللي بتقع ما بتكتبش خالص (مفيش push على عميان).
عايز تكتب مباشرة من المكنة؟ حط
`NOVA_SUPABASE_SERVICE_KEY` في اللوحة — المسار ده بياخد الأولوية و`via` بتبقى
`rest`. قفل additive: `NOVA_STATE_EDGE=0`.

