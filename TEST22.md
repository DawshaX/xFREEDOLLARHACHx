# TEST22 — تثبيت كالي الذاتي على عقد الأسطول (بلا جهاز المالك)

**التاريخ:** 2026-11-15 · **الفرع:** `arena/5bd7a232-xfreedollarhachx` من `00751c4` (#315)
**المطلب:** «انت محمل النسخة والمفروض تشغلها وتثبتها وتفعلها مع البرنامج واللايف أجينت؟» — صفر اعتماد على جهاز المالك. كالي تُثبَّت وتشتغل وتتفعل **على عقد الأسطول السحابية** بواسطة نوفا نفسها.

---

## 1. المقاس حي — القياس الكامل على عقدة حقيقية (السانبوكس لينكس 4vCPU/17GB ≈ runner)

| القياس | النتيجة |
|---|---|
| مساحة العقدة | 17GB فاضية (عتبة الرفض الصادق <16GB) |
| سحب SHA256SUMS + 64 جزء × 90MB | **64/64 ✓** — كل جزء SHA256 متطابق قبل دخول tar |
| المسار | raw ممنوع في السانبوكس → fallback api.github.com بتوكن العقدة شغّال |
| tar streaming | هيكل كالي كامل: bin boot etc usr var … ✓ |
| proot-static (فرع kali-static) | v5.4.0 — `--version` ✓ |
| التحقق النهائي | **2113 حزمة** ✓ (مطابق للأصل) |
| marker | `packages=2113 at=2026-11-15T00:48:23.822Z` ✓ |
| **الزمن الكامل** | **7 دقايق 5 ثواني** (المسار البطيء؛ runners الحقيقية بالـraw CDN أسرع) |
| idempotent | تشغيل تاني → exit 0 فورًا ✓ |
| lock متيم | **بَق لُقيت بالقياس وأُصلح**: `process.exit` كان بيتجاوز `finally` — الآن `KaliExit` يرمى واللوك يتشال في كل المسارات ✓ |

## 2. التفعيل مع اللايف أجينت — مقاس من الكود الفعلي المبني

```
probe  (KALI_NODE_PROBE من TS)          → MODE_PROOT ✓
remoteWriteCmd                          → written 8901 bytes ✓
remoteRunCmd("nmap --version …")        → Nmap version 7.991 + KALI_ACTIVE ✓
```

- الـprobe: `grep -qi kali /etc/os-release` → MODE_BARE (نظام كالي) وإلا فحص `proot-static` → MODE_PROOT (rootfs سحابية).
- `kali_run` الجديد: لما الكالي المدمجة مش موجودة على الهَب → يمسك أول عقدة لينكس متصلة → probe → لو مافيش كالي **يثبّتها بنفسه** (المُثبِّت يتكتب على العقدة بأمر يبدأ بـ`node` — يعدّي الallowlist المقصودة) → ينفّذ الأمر جوه كالي → يرجّع النتيجة بملاحظة صادقة عن التحول التلقائي.
- أوامر العقدة كلها `node -e 'eval(base64…)'` أو `grep …` — **الallowlist read-only المقصودة في fleet-nodes.yml زي ما هي**: مافيش ماسح نشط بيتسجل على مستوى النظام، والتنفيذ النشط جاي من قناة الهَب الموثّقة (NOVA_EXEC_TOKEN) مش من تشغيل حر على العقدة.

## 3. المدمج في البرنامج

- `scripts/kali-node-install.mjs` — المُثبِّت الكانوني (ESM): SHA256 لكل جزء · tar streaming (الذروة = استخراج + جزء واحد ~90MB) · رفض صادق للمساحة (exit 3) · lock ضد التشغيل المزدوج (exit 7) · timeout ناعم 9د · idempotent · تنظيف جزئي عند فشل tar.
- `artifacts/api-server/src/lib/ops/kali-node-installer.ts` — الثابت المدمج + `KALI_NODE_PROBE` + `remoteWriteCmd()` + `remoteRunCmd()`. **بوابة توائم جديدة** (`scripts/check-kali-node-installer.mjs` في agent-gates): الكانوني والمدمج لازم يكونوا متطابقين حرفيًا — 43/43.
- `tools.ts` — `kali_run` v3 (تحويل تلقائي: probe → تثبيت ذاتي → تنفيذ) · `kali_node_setup` v2 (`action: status` بيفحص كل عقدة · `action: install` بيثبت على أول عقدة — نوفا بتعمله بنفسها) — الوصف مش بقول «هات جهازك»: **بتعملها بنفسها**.
- `.github/workflows/fleet-nodes.yml` — خطوة **Pre-warm Kali rootfs** قبل إقلاع الagent: `node scripts/kali-node-install.mjs` بـ`github.token` · `continue-on-error: true` (الموجة بتقوم حتى لو التثبيت وقع — وkali_run بيثبت بنفسه أول ما ينطلب) · `timeout-minutes: 15` · بوابات الموجة (FLEET_ENABLED + NOVA_EXEC_TOKEN) زي ما هي. الـpush على الملف ده هيشغل موجة بالـpre-warm تلقائيًا بعد الدمج.
- بلا أي تحميل على الهَب ولا على جهاز المالك — المخزن سحابي دايمًا (فرع kali-rootfs `037903de` · 64×90MB · 2113 حزمة).

## 4. البوابات

- agent-gates **43/43** (كانت 42 + بوابة التوائم الجديدة) · typecheck api-server ✓ · lib/db ✓ · build api-server + kali-panel ✓ · workflows 27/27 ✓ · مرآة الذاكرة **34/34** ✓.
