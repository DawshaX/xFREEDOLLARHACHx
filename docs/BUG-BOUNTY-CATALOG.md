# كتالوج برامج الـbug bounty — البيانات، مش الإذن

## إيه ده
`ops/bounty/programs-catalog.json`: قائمة برامج HackerOne + bugcrowd الكاملة، بأهدافها المعلنة
(نطاقات/wildcards/IPs/CIDRs)، قيمة الـbounty، حالة الاستجابة، و`safe_harbor`. بيتولّد بـ
`scripts/sync-bounty-programs.mjs` من `arkadiyt/bounty-targets-data` — بيانات منشورة بيحدّثها
CI صاحبها يوميًا من صفحة كل برنامج — وبيتنشر على `main` أسبوعيًا بـ
`.github/workflows/bounty-catalog.yml` (اتنين الفجر UTC، `17 3 * * 1`).

آخر قياس محلي (2026-11-02): **746 برنامج · 511 offers-bounty · 634 ليهم نطاقات · 4945 نطاق +
1594 wildcard · 780 KB**.

## إيه اللي مش ده
**مش تصريح، ولا نصف تصريح.** كل مدخل اتكتب له `consented:false` و`mode:"passive_only"`، والمحرك
بيرفض أي فحص نشط لحد ما البرنامج يتسجّل في `state/programs.json` مع الجملة المكتوبة
`I have written permission for <host>` — ودي مش حاجة بتتحقّق من ملف: المتصفح بيقراها من نص
يكتبه الإنسان. مافيش كود في السكربت ده بيكتب في `state/programs.json`، ومافيش كود هيفعله.

## ليه الـcatalog على أي حال
قبل كده كانت الحلقة محتاجة مستخدم يكتب النطاق بيده عشان `program_discover` يشتغل، فالمنصة كانت
«بتعرف تفحص» بس مافيش حاجة تغذيها بأهداف. دلوقتي الأمر بقى lookup: اسأل باسم البرنامج، والخطة
تتبنى من الأهداف المعلنة — والحارس (`ops-selftest`) بيتأكد إن الملف موجود، مقروء، مليان، وإن
مافيش مدخل اتسربله وضع نشاط.

## الأوامر
```bash
node scripts/sync-bounty-programs.mjs                    # تنزيل + توليد على ops/bounty/
node scripts/sync-bounty-programs.mjs --check            # مقارنة بالمتتبّع + حراسة الانكماش (>30% = فشل)
node scripts/sync-bounty-programs.mjs --from-file x.json # شغل أوفلاين (للتجربة والصناديق المقفولة)
node scripts/sync-bounty-programs.mjs --print --compact  # للمواسير
node scripts/ops-selftest.mjs                            # 49 حالة، منها 9 حالات للكتالوج
```

## قرارات شكل البيانات (مقاسة على الردود، مش متخيَّلة)
- HackerOne **مالوش `asset_type: DOMAIN`** خالص: النطاقات بتيجي `WILDCARD` (1..)، والروابط `URL`
  (36715 عنصر في العينة)، و`IP_ADDRESS`/`CIDR` لوحدهم. أي نوع تاني (`GOOGLE_PLAY_APP_ID`,
  `HARDWARE`, `SOURCE_CODE`, `APPLE_STORE_APP_ID`, `OTHER_APK`…) بيتحسب **مش هدف شبكي** وبيترفض —
  من غيره `com.coloros.assistantscreen` كان بيدخل قايممة النطاقات ويخلي `subfinder` يلف في الهوا.
- bugcrowd شكله مختلف تمامًا (`targets.in_scope[].type` حروف صغيرة، `target`/`uri` بدل
  `asset_identifier`، ومالوش `handle` — الـslug بيتشتق من الـURL). من غير الخرايط دي كان بيرجع
  **297 برنامج و0 ناتج** — وده كان هيعدّي لولا إن `kept:0` بقى فشل صريح.
- `out_of_scope` مش بيتقري خالص: اللي برّه النطاق برّه، حتى لو كان أسهل للـscanner.
- الشبكة في الصناديق المقفولة: `fetch` بيفشل وcurl بينجح — السكربت بيسقط لـcurl تلقائيًا (مقاس هنا).

## المحرك بيقرا الكتالوج فعلًا (2026-11-03)
`program_discover` بقى بيغنّي نفسه من الكتالوج قبل ما يرد. القياس على محرك شغال (`node dist/index.mjs`،
بلا database، زي ما CI بيشتغل):

```
POST /api/ops/programs/discover {"target":"aces-dev.wnba.com"}
  program.name        "NBA Public Bug Bounty"        ← كان «hackerone:aces-dev.wnba.com» أو النطاق
  program.policy_url  https://hackerone.com/nba-public ← كان null لأن مافيش security.txt
  program.passive_only true                          ← ماتبدلش: الإذن لسه الجملة بالحرف
  evidence.bounty_program {handle:"nba-public", matched_on:"aces-dev.wnba.com",
                           matched_kind:"domain", submission_state:"open", response_efficiency:84}
  evidence.catalog {present:true, programs:746, fetchedAt:"2026-11-02T17:25:01.547Z"}
```

- **`GET /api/ops/bounty/catalog`** — حالة الكتالوج (موجود؟ كام برنامج؟ وإمتى آخر تحديث؟)
  و`?host=example.com` بيرجّع المطابقة نفسها أو `match:null`. مقاس الآن: `746 برنامج (511 بمكافأة)`.
- **قواعد المطابقة** (`artifacts/api-server/src/lib/ops/bounty-catalog.ts`): نطاق صريح (1000) >
  wildcard على أبوّتنا (100) > أبوعلى الـwildcard (90) > أصل `URL` (80). الذيل لوحده ما بيكفيش:
  `evil-example.com` **مابيطابقش** `example.com` — وده مقس في `ops-selftest`.
- **`matched_kind:"wildcard_apex"`** = إحنا على `example.com` واللي في الكتالوج `*.example.com`.
  دي أضعف بدرجة مقصودة، و`discoverProgram` بيحذّر نصًا: النطاق الأب غالبًا برّه الـscope.
  الـscanner ما بيوسّعش نفسه من الكتالوج أبدًا — الـhosts بتيجي من الهدف المدخل بس.
- **`submission_state` / `paused`** بيترجموا لتحذير «البرنامج مقفول الاستقبال — استطلاع لحد ما يفتح»،
  عشان ما نبنيش خطة على برنامج بعتله يوم السبت ومالوش قارئ.
- **الكتالوج مش إذن — وده بنيوي لا لفظي**: `lookupBountyProgram` بترجّع كائن مافيهوش `consented`/`passive_only`/
  `mode` خالص، و`ops-selftest` بيفشل لو أي حقل منهم تسرّب. وفي `programs-catalog.json` كل الـ746
  `consented:false / mode:"passive_only"` — الحالة دي بتتفحص سطر سطر في الاختبار.
- **طزاجة**: `ops-selftest` بيفشل لو `fetched_at` أقدم من 30 يوم، وحلقة `live-verify` بتدي **فشل**
  لو أقدم من 21 يوم (الجدول أسبوعي) — مش تحذير أدبي. المسار بيتحلّق من `cwd` لفوق، و
  `NOVA_BOUNTY_CATALOG=<path>` بيتoverride للتستات والاختبارات المعزولة.
- **IP/CIDR**: `ips`/`cidrs` موجودة في الكتالوج (1594 wildcard + نطاقات) بس **مقروءة للعرض بس** —
  `scope_check` لسه ما بيقبولش نطاق من نوع CIDR من الكتالوج. لو احتجنا hunt على شبكة كاملة، دي
  الخطوة الجاية، ومحتاجة gate خاص بيها مش enrichment.

## من الكتالوج لخطة، ومن الدليل لمسودة (2026-11-03)

الطبقة اللي فوق كانت سياق بس: 746 برنامج قاعدين في ملف، والمهام شغالة في حتة، ومفيش أي
مكان بيجمع النتايج ولا بيقرب الكتالوج من `suggestPlan`. اتقفلت التلات فتحات:

- **`huntCandidates()`** في `bounty-catalog.ts` — بترجّع المرشّحين مرتّبين بأجود استجابة
  (`response_efficiency` تنازلي، وبعدين `max_payout_usd`)، ومفلوترة تلقائيًا لـ`bounties:true`
  وغير الموقوفة/المقفولة الاستقبال (`includeClosed:true` للعرض). كل سطر بيوصل ومعه
  `consented:false` و`mode:"passive_only"` و`network_context_only:true` — يعني الإذن مش
  متسلسل من سطر في JSON. `counts` بتقول كام نطاق/wildcard/URL/CIDR/IP، و`filteredOut` بتقول
  كام اتساب وليه (`notBounty/pausedOrClosed/lowEfficiency/platform/query`).
- **`GET /api/ops/hunt/candidates`** — نفس الرد + `registered` (تقاطع `sample_hosts` مع
  البرامج المسجّلة في المحرك) و`permissionModel` بجملتها. **`POST /api/ops/hunt/plan { target }`**
  بيجيب `security.txt` بـ`discoverProgram({register:false})` و`suggestPlan` — **من غير ما يسجّل
  حاجة**: طلب خطة مش إذن.
- **خزانة النتائج `artifacts/api-server/src/lib/ops/findings-vault.ts`** — المخزن الوحيد
  (`state/findings-vault.json`، متجاه الـgit). المفتاح من المحتوى
  (`host | kind | template-id أو العنوان | المسار من غير query/fragment`)، فالـsync idempotent:
  `added:0` في التشغيل التاني و`occurrences` بتزيد. بيقرأ كمان `state/discovered-vulnerabilities-vault.json`
  (بتاع deep-research) **للدمج بس** بيرجّعه `verified:false` لأن المصدر ده مابيدّيش إعادة إنتاج.
  `GET /api/ops/findings`، `GET /api/ops/findings/status`، `POST /api/ops/findings/sync` (وراء
  `opsAllowed`)، و`GET /api/ops/findings/:key/report-draft`.
- **بوابة المسودة:** المسودة بتتكتب من سجل `verified:true` وبس. غير كده الرد
  `409 {error:"not-reproduced", reasonAr}` (و`404 not-found` لو المفتاح غلط) —مسودة لنتيجة
  مش مثبتة أسوأ من مفيش مسودة. اللي بيتكتب: الهدف، الخطورة المطبّعة، CWE/CVSS تقديري، عدد
  المشاهدات والمهمات، خطوات إعادة الإنتاج، كل ملف دليل بحجمه و`sha256`، بلوك إعادة الإنتاج
  (بوابة التحقق)، سياسة البرنامج من الكتالوج + حالة الاستقبال وقت التوليد، و«مافيش هنا حكم
  impact» صراحةً + تحذير إن سكانس مقطوع = تغطية ناقصة ما تتبعتش.
- **الواجهة:** `NovaHuntSurface` في `NovaBrainOps.tsx` ومحطوط في صفحة الأسطول
  (`NovaFleetUnified.tsx`، جوّه `view === "ops"`) — مرشّحين + «خطّط» + خزانة + «مسودة».
  على Pages التوأم الثابت بيردّ بنفس الشكل + `standalone:true` والسبب، مش بصفر مخترع.

### مقاس على المحرك نفسه (باوندل `node server.mjs`، بلا أدوات أمنية)

| الخطوة | الرد |
|---|---|
| sync على خزانة فاضية | `added:11 · fromLegacy:11 · total:11` |
| sync تاني | `added:0 · updated:11 · total:11` — مافيش تكرار |
| بعد جوب حقيقي (`recon.dns` على scanme.nmap.org) | `fromJobs:7 · added:2 · total:16 · scanned:2` |
| خطورة السجلات القديمة | 7 دلاء نصّية → `critical:2 · high:5 · medium:3 · low:1` (+`severityRaw` بيحفظ أصل النص) |
| مسودة على نتيجة مش مثبتة | `HTTP 409` + «لسه ماعادش إنتاجها (POST …/verify)» |
| `hunt/candidates?limit=12&minEfficiency=80` | 12 مرشّح من 746 · `filteredOut.notBounty:235` · كل سطر `consented:false` |

الـverify نفسه اتعمل على 3 نتايج ورجّع `verified 0/3` («لم يُعاد إنتاج نفس البصمة») — في
sandbox الشبكة مابتتكررش حرفيًا، فده سلوك البوابة مش عطل: ماحدش قدر يحوّل نتيجة لمشيدة
بالمصادفة، والمسودة فضلت مرفوضة. المسار الإيجابي (مثبتة → 200 + سياسة + sha256) متغطّي في
`ops-selftest` ببيانات ثابتة، وفي CI بأرقامها الحقيقية.

## اللي لسه
- قراية `ips`/`cidrs` في `scope_check` (فوق) — لسه display-only، وده **مقيس**:
  `huntCandidates` بيطبّعهم في `counts` ومعاهم `network_context_only:true`، و`ops-selftest` بيفشّش
  إن مافيش كود بيحوّل `cidrs` لـ`allowed_hosts`، وإن الـcandidate ما بيصدّرش `allowed_hosts` أصلًا.
- الطبقة دي كلها على السيرفر (المحرك). على Pages مافيش `node:fs`، فالواجهة الثابتة بتفضل
  تعرض الحالة من `/api/*` للسيرفر نفسه — وده مقصود، مش نقص.
