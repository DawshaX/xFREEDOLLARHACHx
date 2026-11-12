# 📓 سجل الملاحظات الشامل — مراجعة 2026-11-09 (الزائر الحقيقي + فهم الماكينة)

> ملف واحد يجمع كل ملاحظات جولة المراجعة: انطباع الزائر، الحقائق المقاسة، التصحيحات، خريطة الماكينة، القدرات النائمة، وبنود الخطة.
> **المرجع التنفيذي الدائم:** `docs/ROADMAP.md` (يتحدث مع كل مراجعة). هذا الملف = سجل الجولة كاملاً كما حدثت.
> **القواعد المحفورة:** مافيش حذف — بنكمّل وبنوصّل · الصدق قبل الإبهار · لا استعجال: افهم ثم احكم ثم نفّذ · المنصة جسد وحواس الشات ليصطاد ثغرات حقيقية فاهماً «إيه وليه وعشان إيه».

---

## 1️⃣ انطباع الزائر/المشتري (أول جولة — قبل التصحيح)

**أبهرته:** الهوية البصرية والشخصية (CYBERNOVA · رحلة المليار · البسملة) · الواجهة العربية RTL الكاملة (نادرة في المجال) · الاتساع (84 صفحة / ~160 روت) · ويدجتس الصدق («غير مقاس»، «0 أداة متاحة مقيسة من الـAPI») · العقيدة التكتيكية **«فين؟ امتى؟ إزاي؟ ليه وعشان إيه؟»** — أثمن نص في المنصة · موسوعة 33 فئة · حاسبة CVSS · قوائم الفحص المنهجية · قالب Foundry Fork مع التحذير الأخلاقي الصح.

**تعثر فيه (وقتها):** تناقض ظاهري على الشاشة (211K أم 0؟) · صفوف NOVA-HYPOTHESIS/CVE-2026 بجوار CVEs حقيقية · ترويسة «9 مصادر متصلة لحظياً» فوق صفوف «غير مقاس» · رابط برهان NVD بمعرّف داخلي (SKY-VULN-02) · 47 روت Placeholder · عشر صفحات أجينت متوازية · شريط «API LIVE / WS SYNC / TARGET» على استضافة ساكنة · رسائل ديكورية «INTRUDER DETECTED».

## 2️⃣ تصحيح الحكم — بالحفر والأرقام (المبدأ الثالث اتطبق)

| الادعاء على الشاشة | الحقيقة المقاسة | المصدر |
|---|---|---|
| «211,256 ثغرة حقيقية» | **صحيح 100%** — ملف الكوربوس الحي: `measured:true` · 2026-11-09T01:53Z · NVD 2.0 + CISA KEV + EPSS · KEV=623 · EPSS=202,405 · منتجات=42,254 · كامل `complete:true` وعينة 800 صف للعرض | `state/vuln-corpus-live.json` على Pages |
| نمو الكوربوس 168K ← 211K | **حقيقي** — سحب تزايدي كل 30 دقيقة بأسلوب `deepen` | وركفلو `vuln-corpus.yml` + نسختي الملف محلياً/حياً |
| «العقل يعمل 24/7» | **حقيقي كجدول** — آخر نبضة `e494465 chore(brain): a turn was thought` ذاتية الدفع لـmain الساعة 05:04Z، وتلاها `d25c8e2 free-host survey` 06:15Z | git log origin/main |
| «غنايم/أدلة موثقة» | ملفاتها **موجودة فعلاً**: `discovered-vulnerabilities-vault.json` (41KB، بعدّادات) · `sky-immunefi-audit-report.json` (24KB) · `nova-mission-log.json` (36KB — **20 مهمة موثقة** على example.com من repo-build) · `cybernova-brain-state.json` (136KB فيه whereAmINow/whatDidIReach) | `public/state/` |
| «0 ثغرة مُخزّنة» | **صادقة هي الأخرى** — لكنها مخزن **آخر** (مزامنة المتصفح الحية، فارغة فعلاً) | `lib/corpus-live.ts` + لوحة HomeDashboard |

**الخلاصة المُصححة:** لا اختلاق في الأرقام الكبرى — المشكلة الجوهرية = **مخزنان صادقان على شاشة واحدة بلا لافتة تفرقة** + أركان مبنية صح من الأول لكن **غير موصولة** (زي ما قال المالك حرفياً: «مش متوصلين صح أو في مكان تاني»).

## 3️⃣ كيف تدور الماكينة فعلاً (خريطة مقاسة من الوركفلوز)

14 جدولة حية على GitHub Actions:
`*/15m` نبضة العقل (تفكر وتدفع main) · `*/30m` سحب CVE تزايدي · `*/10m` keepalive · `*/30m` ووتشدوغ + backend-health · `*/3h` لايف-ميشن · `*/6h` هانت-لايف + لايف-فريفاي + لايف-أوديت · يومي: advisory-library 04:17 + agent-gates 06:20 · أسبوعي: bounty-catalog (إثنين) + free-store (أربعاء) · nova-runner بطابور main.
**يدوية/حدثية:** autonomous-brain-pulse (الكبرى) · probe-live-llm · toolchain-vendor (المرآة «بتموت لو اتنسيت» — تحذير الكود نفسه) · fleet-nodes · standalone-bundle · deploy-pages (حدثي على push:main).

## 4️⃣ صندوق عدّة الأجينت — 66 أداة موجودة (grep من `agent/tools.ts`)

سلسلة الصيد كاملة: `program_discover` ← `scope_check` (قانونية النطاق!) ← `recon_target` ← `subdomain_enum`/`dns_lookup`/`port_scan`/`tls_audit`/`http_headers_audit` ← `vuln_search`/`cve_lookup`/`exploit_search`/`corpus_stats`/`advisory_search` ← `finding_verify` ← `record_finding` ← `vault_draft` ← `report_generate`.
وحوالينها: `web_search/fetch` · `github_search` · `browser_open` · `memory_save/recall/search/stats` · `mission_create/status` · `job_*` · `fleet_list/exec/profile` · `tools_install`/`kali_toolbox` · `terminal_exec` · `ui_action/ui_navigate` (يدوس في الواجهة بنفسه!) · `platform_status/self_report` · باقي الأدوات في `docs/ROADMAP.md` ملحق S.

## 5️⃣ القدرات النائمة — موجودة بزرّها (S1–S12)

| # | القدرة | الزر | الحالة |
|---|---|---|---|
| S1 | بحث الكوربوس الكامل (211K) من الشات | تشغيل العقدة (كودسبيس) — سيرفر vuln-corpus جاهز ويُفهرس | **أولوية قصوى = البند 1** |
| S2 | تنفيذ أوامر `run_shell` | `ENABLE_AGENT_SHELL=1` | مقفول عمداً |
| S3 | أدوات تمسّ الهدف على الرنر | `NOVA_RUNNER_ALLOW_ACTIVE=1` | مقفول (قانونية IP جيت-هَب) |
| S4 | أتمتة أعمق | `NOVA_OPS_AUTONOMY=standard\|deep` | سلبي افتراضياً |
| S5 | مقاعد المجلس المقفلة (Anthropic/Gemini/Cerebras/Groq/Mistral/GH-Models) | مفاتيح API | الشغال: Pollinations + عقل محلي (ببلاش) |
| S6 | ذاكرة Supabase السحابية (`nova-state`) | تعمل تحت SUPERVISED؛ pooler للإيصال الرباعي | نصف موصولة |
| S7 | مرآة التول-شين | وركفلو يدوي + `NOVA_TOOLCHAIN_MIRROR*` | خاملة |
| S8 | تجهيز التول-شين عند الإقلاع | `NOVA_TOOLCHAIN_AT_BOOT=1` (على هوست دايم) | خاملة (ONDEMAND يعمل ✔) |
| S9 | أسطول ماكينات حقيقي | `NOVA_FLEET_MACHINES/AGENTS` + fleet-nodes | يدوي |
| S10 | صوت الأجينت | `NOVA_VOICE` شغال سيرفرياً — **اللوحة لا تعرضه** | غير معروض |
| S11 | هَب WS داخلي حقيقي | `NOVA_HUB_URL` | «WS SYNC» على Pages شكلية |
| S12 | نبضة العقل الكبرى | `autonomous-brain-pulse` يدوية | المجدول = الصغيرة |

## 6️⃣ بنود الخطة العشرة (التفصيل الكامل في `docs/ROADMAP.md`)

1. **توصيل الكوربوس 211K للشات كأداة بحث** (قبول: من /agent-pro يسأل «ثغرات Metabase الحرجة؟» ← يرد من المخزون بمصدره)
2. لافتات تفرقة المخازن على كل لوحة
3. روابط برهان صحيحة + عزل «مختبر الفرضيات» عن CVEs الحقيقية
4. شريط الحالة العلوي يقرأ من القياس
5. إكمال الـ47 Placeholder واحداً واحداً (دفعة أولى: Header Analyzer · Encoder · Hash · SSL · DNS/WHOIS)
6. توصيل صفحات الأجينت العشرة على العمود `/agent-pro`
7. توصيل التراث المزدوج (`cve-db/exploit-db/github/web-search`) + إزالة تكرار «Nova Intelligence»
8. جولة «ابدأ من هنا» للزائر + شريط جانبي بنبضات حقيقية
9. سجل الخطة الرسمي (تم — هذا الملف وROADMAP)
10. المعلقات: Dependabot 1 low · قرارات `NOVA_VENDOR_MAX_MB`/`NOVA_TOOLCHAIN_AT_BOOT`/`NOVA_URL` keepalive · نقرات المالك (كودسبيس + waifly)

## 7️⃣ تقسيم المسؤولية

- **على الوكيل:** البنود 1–8 تنفيذاً بالدورة المتفق عليها (فهم بالأرقام → أصغر شريحة → gates 35/35 → دفع → تحقق حي من الرابط → تحديث الملف).
- **على المالك (نقرتان معلقتان):** إنشاء الكودسبيس (ينوّر S1/S2/S4) · تفعيل سب-دومين waifly · قرار قانونية S3 سيادي.

## 8️⃣ خريطة «أرواح» البرنامج (أماكن كل حاجة)

- الواجهة: `artifacts/kali-panel/src/pages/` (84) · الناف: `components/NavSidebar.tsx` · شريط الحالة: `components/AppShell.tsx` · الشيم الساكن: `setup.ts` + توأما `standalone-api.ts`
- المحرك: `artifacts/api-server/src/` — الوكيل وأدواته `lib/agent/` · الكوربوس `lib/ops/vuln-corpus.ts` · التول-شين `lib/ops/toolchain*.ts`
- الحالة الحية (تلقائية التحديث): `artifacts/kali-panel/public/state/*.json`
- العقل والجدولات: `scripts/nova-brain.mjs` + `.github/workflows/` (21 وركفلو)
- الحراسة: `scripts/agent-gates.mjs` (35 بوابة) + فاحصا `audit-twins`/`audit-connections` إلزاميان لأي مسار `/api/*` جديد
- قاعدة كتابة: tsconfig اللوحة أشد (TS5076: لا خلط `??` مع `||` بلا أقواس)

---
*آخر تحديث: 2026-11-09 — يُعاد بناؤه كل مراجعة؛ الخطة الحية في `docs/ROADMAP.md`.*
