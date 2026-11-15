# TEST30 — جولة الإصلاح: الأعطال الأربعة + القديمة الثلاثة — بالقياس مش بالطبقات

**التاريخ:** 2026-11-15 · **الفرع:** `arena/f91419b3-xfreedollarhachx` من `01cdbb7` (#324)
**القاعدة الجديدة المتبناة (رسالة المالك 5):** قبل أي كود جديد — «العطل اللي هصلحه دلوقتي: ___». كل إصلاح هنا بيبدأ بالسطر ده. مافيش طبقة جديدة من غير تبرير قدام الأعطال المعلقة.

---

## 0. إجابات الأسئلة الأربعة (بسطر واحد)

1. **TEST29 مدموجة؟** أيوه — **PR #324 → merge commit `01cdbb70bb19486b515b4f3b4f6c9565acf64a17`** على main.
2. **الباندل وصل Releases؟** أيوه — **nova-24-7.zip updatedAt `2026-11-15T08:06:46Z`** (بعد الدمج بـ54ث). والهَب حي: `watchdog_last_run = 2026-11-15T08:16:37Z` (صف settings في Supabase nova-db).
3. **claim guard وplatformSelfReport async؟** سليم: `enforceClaims` (core.ts سطرين 1486/1702) بيقارن ضد `buildSelfModel()` — **مش** ضد platformSelfReport. الاستدعاء الوحيد للدالة: tools.ts:2107 وله `await` ✓. self-heal.ts كان فيه import ميت من غير استدعاء — اتشال. ملفات الـclaim guard: `claim-guard.ts` · `core.ts` (موقعين) · `scripts/test-claim-guard.mjs`.
4. **canExecuteOnNode كانت `agents.length > 0`؟** أيوه (platform-tools.ts:92) — اتصلحت تحت (§2).

## 1. العطل اللي هصلحه: canExecuteOnNode بتكدب (شكوى #1)

- **العطل:** `canExecuteOnNode: agents.length > 0` — عقدة Ubuntu بتتعدّ «كالي متاحة» والـLLM بيوعى بتنفيذ مفيش.
- **الإصلاح (مقاس):** وحدة جديدة `kali-node-probe.ts` — كل عقدة لينكس بتتقاس بـKALI_NODE_PROBE (بالتوازي، كاش ≤3د على state/kali_node_probes_v1.json). capabilities بقت: `canExecuteKali: kaliNodeCount > 0` + `kaliNodeCount` (عدد العقد اللي فيها كالي **فعلاً** مقاس) جنب canExecuteOnNode (تنفيذ shell — ده حقيقي لأي عقدة).
- **الإثبات الحي:** هَب fleet-only + عقدتين أجينت حقيقيتين (A بـrootfs كالي، B فاضية) → `/api/ops/kali/nodes` رجّع **kaliNodeCount: 1 · linuxNodeCount: 2 · modes [proot, none]** — القياس فرّق بينهم فعلاً.
- **علّة اكتشفت بالقياس وهي بتتصلح قبل ما تخرج:** أول تنفيذ راح لـself-node (الهَب بيسجل نفسه كأجينت) — فلتر الأسطول `isLinuxFleetNode` كان ساقط من مسار العقد. اتصلح فورًا (self-node مستبعد من القياس والتنفيذ — زي kali_run بالحرف).

## 2. العطل اللي هصلحه: 15/19 skipped + فشل عقدة واقفة الكل (شكوى #2 و#3)

- **ليه 15 skipped — بالحرف من الـYAML:** المصفوفة ثابتة `1..19` (GitHub مافيهوش range)، وprepare بيحسب WANTED من متغير `FLEET_NODES` (=4) — فالوظايف 5-19 بتفضّل نفسها عمدًا («node X not needed this wave») عشان ميقلعش runner كامل علشان يتخطاه. **ده كان مقصود للتوفير** — وقرارك الجديد بيلغيه: الموجات المجدولة وب-push بقت **19/19** (الدقائق مجانية على repo public، والحد 20 concurrent). السبب متعلّق بالحرف في الـYAML (تعليق فوق prepare وفوق gate).
- **الوقت الحقيقي:** الموجة السارية (43677572239، schedule، بـ4) لسه شغالة (6h cap لحد ~13:07Z) وconcurrency group واقف وقيادها — الدمج ده هيعمل push على الـYAML → الموجة اللي بعدها هتقف في الصف وتشتغل 19/19 أول ما تفضل. `workflow_dispatch` و`variables API` رجعوا **403** للتوكن ده — الصادق: التفعيل الفوري اليدوي مش متاح من هنا؛ الـpush trigger هو المفعّل المقاس.
- **failover في kali_run (tools.ts):** فشل تثبيت عقدة بقى `continue` للعقدة اللي بعدها مع سجل محاولات (node/step/note) — الفشل الكلي بس لما كل العقد تفشل، والرسالة بتعدّ المحاولات بالتفصيل. **prewarm-first:** العقد الجاهزة (probe) بتتجرب الأول — تنفيذها فوري بلا تثبيت؛ بعدها غير الجاهزة بالترتيب للتثبيت الذاتي.
- **الإثبات الحي للترتيب:** نفس الهَب والعقدتين — `echo NODE_ID=$NOVA_AGENT_ID && nmap --version` راح للعقدة الجاهزة: **stdout: `NODE_ID=fleet-agent-prewarmed-a` · nmap 7.991 · 60ms** (كان هيأخد 5-8د تثبيت قبل الإصلاح). وقتلت الجاهزة → جرّبها (null) → جرّب الفاضية (مش جاهزة) → **404 صادق `kali_no_plane`** — مافيش ادعاء نجاح من عقدة ميتة.

## 3. الأعطال القديمة الثلاثة

- **Postgres TLS (SELF_SIGNED_CERT_IN_CHAIN):** الحالة: **متصلحة في الكود من إصلاح N1 (2026-11-09)** — سلّم CA صارم في lib/db/src/index.ts: `NOVA_DB_CA` → **CA مثبّت في الحزمة** (`db-bundled-ca.ts` فيه شهادة ✓، بيتزامن من سلسلة المضيف الحي بـdb-ca-sync) → جذور النظام؛ تشفير دايمًا + `DB_SSL_NOTE_AR` صادق على السطح. اللي مش قادر أقيسه من هنا: لوج إقلاع waifly نفسه (السانبوكس محجوب عنه) — لو لسه بيقول SELF_SIGNED يبقى الـCA المثبّت محتاج إعادة sync من مضيف جديد، وده command واحد معروف في الوثائق.
- **الداتا المختلقة:** اتشالت من standalone-api.ts (التوأم، اتزامن الاتنين): `/proxy/dns` كانت بترجع A/MX/TXT/NS **مفبركين** لأي دومين → بقت `noSource: true` + خطوات القياس الحي (/api/tools/dns). `/proxy/subdomains` سابدومينات وIPs مخترعة → صادقة. `/proxy/portscan` منافذ «مفتوحة» مفبركة → صادقة. `/risk/stats` كانت مكتوبة بإيد (2140/5430/5120/2130/1120/3290/avgScore 7.8) → بقت **محسوبة من العناصر نفسها** + `measured: true`، و`hasPoc: true` الثابتة بقت من الحقل المقاس، وادعاء ollama المتاح اتشال من التوأم الساكن.
- **«2,113 أداة» غلط تسمية:** قست بأمرك بالحرف على rootfs v11 (مثبتة الجلسة دي: 64/64 SHA256 · 7د · exit 0): **`find /usr/bin -maxdepth 1 -type f -executable | wc -l` = 1,952** · **/usr/sbin = 294** → **إجمالي 2,246 أداة تنفيذية · 2,113 حزمة** (dpkg). العرض بقى يقول الاتنين بالأسماء الصح (kali-env status + إشعارات التثبيت + tools.ts + صفحة /kali-env).

## 4. القياس النهائي المطلوب (رسالة 4) — بأمر فعلي مش حزمة موجودة

على rootfs كالي حقيقية (v11)، عبر **نفس endpoint الطرفية في /kali-env** (`POST /api/ops/kali/exec`):

```
cmd: "nmap --version | head -1 && msfconsole -q -x \"version; exit\" && burpsuite --version"
```

**الرد الفعلي (JSON):**
```json
{
  "plane": "الهَب — كالي المدمجة (rootfs + proot)",
  "exitCode": 0,
  "durationMs": 39373,
  "stdout": "Nmap version 7.991 ( https://nmap.org )\nFramework: 6.5.7-dev\nConsole  : 6.5.7-dev\n2026.10.1-54773 Burp Suite \n"
}
```
- **metasploit ردّ فعليًا** (Framework 6.5.7-dev — بيدأ في ~35-60ث فأضفت باراميتر `timeout` (5-300ث) للمسارين بدل ال60ث الصارمة) و**burpsuite ردّ** (2026.10.1-54773).
- **إصلاح مقاس اتدفن في المُثبِّت:** OpenJDK 25 كان بيفشل `libjli.so` → المُثبِّت بيكتب `etc/ld.so.conf.d/zz-nova-java-jli.conf` + `ldconfig` جوه proot بعد الاستخراج — على كل عقدة جديدة `burpsuite --version` بيرد bare (مقاس). قبل الإصلاح: `java: error while loading shared libraries: libjli.so`.
- **الصادق:** screenshot من nova.waifly.com نفسها مش قادر آخده — الهَب بره الشبكة المسموحة للسانبوكس (مقاس: exit 35). القياس ده من **نفس الكود ونفس المسار** اللي الطرفية على waifly بتنده عليه، وبيوصلك بعد الدمج بالباندل + بطاقة «🏷️ البنية الشغالة: commit · اتبنت» في ‎/kali-env بتقول لك فورًا إن التحديث وصل ولا لأ.

## 5. إضافات مباشرة على شكوى «الصفحة زي ما هي»

- بطاقة الإحصائيات في ‎/kali-env بقت **دايمًا ظاهرة** (كانت بتتخبي لما total=0 — فالتحديث بيوصلك والصفحة تبان زي ما هي): الأصفار صادقة + جملة «مافيش تنفيذ مسجّل لسه».
- **بصمة البنية** من `/api/nova-core/version` (commit + builtAt) ظاهرة في البطاقة — مافيش «مش عارف أنسخة إيه شغالة» تاني.

## 6. البوابات

tsc الاتنين ✓ · builds ✓ · agent-gates **43/43** (88s) · audit-twins/connections ✓ (التوأم اتزامن) · مرآة 34/34 (جوا gates).
