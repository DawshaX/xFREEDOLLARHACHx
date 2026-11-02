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
node scripts/ops-selftest.mjs                            # 37 حالة، منها حالة الكتالوج
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

## اللي لسه
الكتالوج لسه **مقطوع عن المحرك**: `suggestPlan` و`program_discover` ما بيقرأوهوش. الخطوة الجاية إن
`program_discover("slack.com")` يجيب الـpolicy link والـsafe-harbor من الكتالوج بدل ما يكتفي
بالنطاق — ومحتاجة حالة `ops-selftest` جديدة + سطر في تقرير `live-verify`، مش مجرد idea في الـdocs.
