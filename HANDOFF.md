# 🛡️ وثيقة الأساس والتسليم المستمر — منصة CyberNova (`xFREEDOLLARHACHx`)

> **قاعدة ذهبية لأي جلسة جديدة:** اقرأ هذا الملف أولاً قبل كتابة أي كود أو اتخاذ أي خطوة. هذا المستودع (`DawshaX/xFREEDOLLARHACHx`) هو المقر الرئيسي الموحّد لمنصة الأمان والبحث الأمني الأخلاقي.

---

## 1️⃣ المبادئ الأساسية المتفق عليها (غير قابلة للتجاوز)

1. **الهدوء والعقلانية:** لا استعجال ولا تعديل عشوائي؛ كل خطوة تُفهم وتُناقش وتُوثّق هنا أولاً.
2. **قانوني وأخلاقي ومجاني 100%:** العمل مخصص للأمن السيبراني الأخلاقي، الفحص الدفاعي، تحليل الشيفرات المصدرية (SAST)، إدارة نطاقات البج باونتي المصرح بها (HackerOne / Google VRP)، وبناء الوعي والمعرفة الأمنية، باستخدام أدوات ونماذج مجانية ومفتوحة المصدر بالكامل.
3. **التوثيق اللحظي على GitHub:** كل تقدم أو تعديل أو خطة يُرفع فوراً على `DawshaX/xFREEDOLLARHACHx` ليظل السجل كاملاً لو انتقلنا لأي محادثة أو جلسة جديدة.
4. **عدم المساس بالمصانع الأخرى:** مستودعات المصانع الأخرى (`DawshaX/youtube`, `DawshaX/Dollars`, `DawshaX/XTreNDAW`, `DawshaX/daousha`) تظل محفوظة ومستقلة تماماً.

---

## 2️⃣ ما تم إنجازه في خطوة التأسيس والنقل

* تم سحب الأرشيف الأصلي `Hello-Brother (copy 1).zip` من المستودع القديم `DawshaX/nova`.
* تم فك الضغط بالكامل وفحص جميع الملفات للتأكد من خلوها من أي مفاتيح سرية مكشوفة.
* تم رفع الهيكل الكامل للمنصة مفكوكاً ومنظماً إلى المستودع الجديد: `https://github.com/DawshaX/xFREEDOLLARHACHx`.

---

## 3️⃣ التشريح الكامل للمنصة الحالية (ما بداخل `xFREEDOLLARHACHx`)

المنصة عبارة عن **Monorepo متكامل بـ TypeScript + pnpm workspaces** يتكون من 3 طبقات رئيسية:

### أ) الواجهة الأمامية (`artifacts/kali-panel`) — React + Vite + Tailwind
تضم أكثر من **50 شاشة ووحدة متخصصة**، أهمها:
* **مركز الثغرات والمخاطر:** `VulnCenter.tsx`, `VulnsPage.tsx`, `RiskCenter.tsx`, `AttackSurface.tsx`, `ActiveScanner.tsx`, `Scanner.tsx`, `NucleiEngine.tsx`.
* **مكتبة الثغرات والتهديدات العالمية (تحديث لحظي):**
  * `CveLive.tsx` & `CveSearch.tsx` & `cve-db.tsx` (ربط مع قواعد بيانات الثغرات العالمية).
  * `cwe.tsx` (تصنيف نقاط الضعف البرمجية CWE).
  * `mitre.tsx` (إطار MITRE ATT&CK التكتيكي).
  * `ThreatIntelligence.tsx` & `ThreatDetectionDashboard.tsx` & `IocTracker.tsx`.
* **المعرفة والكتب والـ Playbooks:**
  * `Knowledge.tsx` & `nova-knowledge.tsx` (مكتبة المعرفة الأمنية والبرمجية).
  * `Playbooks.tsx` (خطط ومنهجيات الفحص المنظم خطوة بخطوة).
* **الوكيل الذكي متعدد النماذج (Multi-AI):**
  * `LiveAgent.tsx`, `NovaAgentV6.tsx`, `NovaCommander.tsx`, `NovaIntelligence.tsx`.
  * لوحة إدارة 7 مزودات ذكاء اصطناعي مجانية (`Groq`, `Gemini`, `OpenRouter`, `Mistral`, `HuggingFace`, `Together`, `Ollama`).
* **إدارة المهام والأدلة والتقارير (Bug Bounty Workflow):**
  * `Workspaces.tsx` (مساحات العمل لكل برنامج أو هدف مصرح به).
  * `MissionTracker.tsx` (تتبع مراحل الفحص).
  * `EvidenceDashboard.tsx` (توثيق الأدلة والملاحظات).
  * `Reports.tsx` (توليد تقارير الثغرات الاحترافية).

### ب) الخادم الخلفي (`artifacts/api-server`) — Express 5 + TypeScript
يضم **45+ مسار API (`src/routes/`)** و **33 محرك ومكتبة داخلية (`src/lib/`)**:
* `ai-multi-router.ts`: موجه ذكي يربط 7 نماذج AI مجانية مع التبديل التلقائي (Fallback).
* `cve-monitor.ts` & `nova-cve-monitor.ts` & `osv-intel.ts` & `cve-classifier.ts`: رادار رصد وتصنيف الثغرات من 7 مصادر عالمية (NVD, CISA, OSV, GitHub, CIRCL...).
* `novaRag.ts` & `novaRagV2.ts` & `nova-learner.ts`: نظام ذاكرة واسترجاع معرفي (RAG) لربط الكتب البرمجية والمراجع الأمنية بالتحليل.
* `risk-engine.ts` & `llm-analyzer.ts`: محرك تقييم خطورة الثغرات وتحليلها.
* `security-tools.ts` & `audit.ts`: إدارة أدوات الفحص وسجل التدقيق الكامل.

### ج) قاعدة البيانات والمواصفات (`lib/`)
* `lib/db/src/schema/`: **33 جدول PostgreSQL (Drizzle ORM)** تغطي كل شيء (`cves`, `cwe`, `mitre`, `ioc`, `threats`, `risk_scores`, `evidence`, `reports`, `knowledge`, `playbooks`, `assets`, `workspaces`, `agentSessions`, `bot_memory`...).
* `lib/api-spec/openapi.yaml` + `lib/api-zod` + `lib/api-client-react`: عقود API موثقة بالكامل.

---

## 4️⃣ خارطة الطريق للمرحلة القادمة

1. **تجهيز نسخة العرض المباشر (Live Dashboard / GitHub Pages):** بحيث تفتح المنصة من المتصفح في أي وقت ومن أي جهاز بدون تعقيد.
2. **تغذية مكتبة المعرفة الأمنية والبرمجية (Vulnerability & Code Audit Encyclopedia):**
   * موسوعة كاملة لأنواع الثغرات (OWASP Top 10, Web/API Vulnerabilities, Logic Flaws, Auth/Access Control, Subdomain Takeover, Cloud Misconfigurations) مع شرح الكود الضعيف وكيفية اكتشافه وإصلاحه.
3. **وحدة البج باونتي القانونية (HackerOne / Google VRP Assistant):**
   * قراءة نطاق البرنامج (Scope)، تحليل الأصول المسموحة، قائمة فحص منهجية (Methodology Checklist)، ومساعد كتابة التقرير النهائي (PoC & Impact & Remediation Report Builder) لتقديمه بشكل احترافي.
