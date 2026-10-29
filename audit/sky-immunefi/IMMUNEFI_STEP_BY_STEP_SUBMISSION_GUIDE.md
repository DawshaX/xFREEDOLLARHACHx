# الدليل العملي الكامل لتقديم التقرير على منصة Immunefi خطوة بخطوة (100% جاهز للنسخ واللصق)

هذا الملف يوضح لك **أين تذهب بالضبط، وماذا تختار في كل قائمة منسدلة، وماذا تكتب في كل خانة** داخل نموذج التقديم الرسمي لبرنامج **Sky (MakerDAO)** على منصة **Immunefi** لضمان قبول التقرير من أول مرة دون أي خطأ شكلي أو مخالفة للشروط.

---

## الخطوة 1: رابط التقديم الرسمي

1. افتح صفحة برنامج **Sky** الرسمية على Immunefi:
   - `https://immunefi.com/bug-bounty/sky/`
2. اضغط على زر **"Submit a Bug"** (أو ادخل مباشرة إلى لوحة التقديم):
   - `https://bugs.immunefi.com/dashboard/new-submission?utm_source=immunefi`

---

## الخطوة 2: اختيارات القوائم المنسدلة (Dropdown Fields)

عند فتح نموذج التقديم، اختر القيم التالية بدقة:

1. **Program / Project**:
   - `Sky`
2. **Asset Type / Category**:
   - `Smart Contract`
3. **Asset in Scope (الأصل المصاب من قائمة الـ 255 أصلاً)**:
   - ابحث في القائمة عن `UNISWAP_V3_FACET` واختر:
     `https://github.com/sky-ecosystem/diamond-pau/blob/dev/src/facets/uniswap-v3/UniswapV3Facet.sol`
     *(المضاف بتاريخ `6 July 2026`، وعنوانه الحي على Ethereum Mainnet هو `0x445D9Dc752F269Be48250f1A180CAC4c61cE4bab`)*.
4. **Impact in Scope & Severity (التأثير والخطورة من الجدول الرسمي)**:
   - يمكنك اختيار أحد الخيارين التاليين (وكلاهما مقبول رسمياً في الجدول ولا يحتاج أي صلاحيات `Zero Keys Required`):
     - **الخيار الأول (`High`)**:
       `Temporary freezing of funds for at least five blocks`
     - **الخيار الثاني (`Medium`)**:
       `Griefing (e.g. no profit motive for an attacker, but damage to the users or the protocol)`
   - *ملاحظة مهمة*: في Immunefi، إذا اخترت `High (Temporary freezing of funds for at least five blocks)` ورأى المراجعون أنها تندرج تحت `Medium (Griefing - $5,000)` أو `Low ($1,000)`، فإنهم يعدّلون درجة الخطورة داخلياً ويقبلون التقرير طالما أن التأثير المشروح لا يعتمد على اختراق مفتاح ذي صلاحيات (`ALLOCATOR_ROLE`).

---

## الخطوة 3: عنوان التقرير (Title) — انسخ والصق كما هو

```text
UniswapV3Facet.removeLiquidity Inverted _checkSlippage & Missing TWAP Creates a 0.1% Two-Sided Pincer Blocking Withdrawals on Live $30M Grove PAU Position (#1352494) + Coupled TWAP/Slippage Bypass in addLiquidity
```

---

## الخطوة 4: نص التقرير الكامل (Description / Vulnerability Details / Impact / Fix) — انسخ والصق في خانة الوصف

انسخ المحتوى الكامل الموجود في ملف:
- `audit/sky-immunefi/IMMUNEFI_SUBMISSION_REPORT_UNISWAP_V3_FACET.md`

وهو مقسّم بالترتيب القياسي الذي يطلبه مراجعو Immunefi:
1. **Executive Summary & Compliance Note** (توضيح أن التأثير الأساسي لا يتطلب أي صلاحية `ALLOCATOR_ROLE` ويؤثر مباشرة على المركز الحي `Token ID 1352494` بقيمة `$30,004,359.92 USD` داخل `GROVE_PAU_PROXY` `0x0DcD9298e163dFD3c0B5b00F0d9093C36e40A153`).
2. **Detailed Mathematical Root Cause**:
   - **`SKY-VULN-02` (`UniswapV3Facet.removeLiquidity` — الأسطر `451–515` و `972–978`)**: غياب استشارة الـ TWAP (`twapTick`) وتمرير المخرجات الفورية `amounts` إلى `_checkSlippage(amounts.amount, min.amount, maxSlippage)`، مما يحصر الموزع الصادق في كماشة مزدوجة بعرض `0.1%` فقط ($\text{min} \le \text{actual} \le \text{min}/0.999$) فيفشل سحب الـ 30 مليون دولار بـ `"Price slippage check"` أو `"UniswapV3Facet/min-amount-below-bound"` عند أي تحرك سعري يتجاوز `0.1%` (أو بتدخل خارجي غير مصرح به بتكلفة رسوم أقل من `$5` لكل بلوك).
   - **`SKY-VULN-01` (`UniswapV3Facet.addLiquidity` — الأسطر `659–748`)**: حساب `expectedLiquidity = min(L0, L1)` عند سعر الـ TWAP والتحقق من `min` مقابل `expectedAmounts` دون التحقق من تناسب `target` (`amount0Desired`, `amount1Desired`) مع `expectedAmounts`.
   - **`SKY-VULN-03` (`UniswapV4Facet.sol` `0x75D35ffB8e6B871E12EB549CcF6afD324c46E47D` — الأسطر `176–309`)**: إغفال فحص `maxSlippages[poolId]` بالكامل في دوال السيولة الثلاث `mintPosition` و `increasePosition` و `decreasePosition`.
3. **Recommended Remediation Patch**: الكود المقترح لإصلاح `_validateAddLiquidityParameters` و `removeLiquidity`.

---

## الخطوة 5: قسم إثبات المفهوم (Proof of Concept — Foundry Local Fork)

في خانة الـ **Proof of Concept (PoC)** (أو كمرفق ملف `PoC_UniswapV3_Bypass.t.sol`):

1. **ضع خطوات التشغيل للمراجع (Triager Reproduction Steps)**:
```bash
git clone -b dev https://github.com/sky-ecosystem/diamond-pau.git
cd diamond-pau
git submodule update --init
# انسخ ملف PoC_UniswapV3_Bypass.t.sol إلى المسار:
# test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol
MAINNET_RPC_URL=https://gateway.tenderly.co/public/mainnet forge test --match-path test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol -vv
```
2. **انسخ كود الملف الكامل من**:
   - `audit/sky-immunefi/PoC_UniswapV3_Bypass.t.sol`
   والذي يحتوي على الـ **4 اختبارات الكاملة (`4 passed, 0 failed`)**:
   - `test_PoC1_addAndRemoveLiquidity_zeroExpectedLiquidityBypass` (Block `22,181,045`)
   - `test_PoC2_addLiquidity_nonZeroExpectedLiquidity_inRangeSpot_bypassesTWAP` (Block `22,181,045`)
   - `test_PoC3_removeLiquidity_invertedSlippageCheck_revertsHonestAllocatorOnSmallTickShift` (Block `22,181,045`)
   - `test_PoC4_liveGrovePAU_30MillionUSD_Position_1352494` (Block `26,300,000` — يختبر مباشرة العقد الحي `GROVE_PAU_CONTROLLER` `0xbf83F5974B932c7D842254042717D6A2706CE5eE` وعقد `GROVE_PAU_PROXY` `0x0DcD9298e163dFD3c0B5b00F0d9093C36e40A153` والمركز الحي `Token ID 1352494` بقيمة `$30,004,359.92 USD`).

---

## قواعد ذهبية حاسمة (احذر مخالفتها أبداً)

1. **إياك وإرسال أي معاملة حقيقية على شبكة Ethereum Mainnet أو أي Testnet عامة**:
   - شروط Sky و Immunefi تمنع منعاً باتاً التجربة على العقود الحية على Mainnet؛ جميع الاختبارات في `PoC_UniswapV3_Bypass.t.sol` تعمل 100% على **Local Fork** داخل Foundry فقط وهو المطلوب رسمياً.
2. **لا تذكر في ملخص التأثير الأساسي أن الهجوم يحتاج اختراق `ALLOCATOR_ROLE`**:
   - ركّز دائماً على أن **التأثير الأساسي (`test_PoC3` و `test_PoC4 - Part A`) يحدث بدون أي صلاحيات نهائياً (`Unprivileged`)** ضد الموزع الصادق (`LIVE_GROVE_ALLOCATOR` `0xdBD17832df0e57b1732cE1C84c652E820e549BAa`) على المركز الحي بقيمة `$30M`، وأن اختبارات `test_PoC1` و `test_PoC2` و `test_PoC4 - Part B` توثق كيف أن نفس الخلل الرياضي يكسر أيضاً حماية الـ TWAP و `maxSlippage` المنصوص عليها في `docs/THREAT_MODEL.md`.
