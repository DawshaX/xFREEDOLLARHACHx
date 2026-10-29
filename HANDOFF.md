# 🛡️ وثيقة الأساس والتسليم المستمر — منصة CyberNova (`xFREEDOLLARHACHx`)

> **قاعدة ذهبية لأي جلسة جديدة:** اقرأ هذا الملف أولاً قبل كتابة أي كود أو اتخاذ أي خطوة. هذا المستودع (`DawshaX/xFREEDOLLARHACHx`) هو المقر الرئيسي الموحّد لمنصة الأمان والبحث الأمني الأخلاقي.

---

## 1️⃣ المبادئ الأساسية المتفق عليها (غير قابلة للتجاوز)

1. **الهدوء والعقلانية:** لا استعجال ولا تعديل عشوائي؛ كل خطوة تُفهم وتُناقش وتُوثّق هنا أولاً.
2. **قانوني وأخلاقي ومجاني 100%:** العمل مخصص للأمن السيبراني الأخلاقي، الفحص الدفاعي، تحليل الشيفرات المصدرية (SAST)، إدارة نطاقات البج باونتي المصرح بها (HackerOne / Google VRP)، وبناء الوعي والمعرفة الأمنية، باستخدام أدوات ونماذج مجانية ومفتوحة المصدر بالكامل.
3. **التوثيق اللحظي على GitHub:** كل تقدم أو تعديل أو خطة يُرفع فوراً على `DawshaX/xFREEDOLLARHACHx` ليظل السجل كاملاً لو انتقلنا لأي محادثة أو جلسة جديدة.
4. **عدم المساس بالمصانع الأخرى:** مستودعات المصانع الأخرى (`DawshaX/youtube`, `DawshaX/Dollars`, `DawshaX/XTreNDAW`, `DawshaX/daousha`) تظل محفوظة ومستقلة تماماً.

---

## 2️⃣ سجل التقدم والإنجازات (يُحدّث لحظياً)

### ✅ المرحلة 1: فك الضغط والنقل والتأسيس
* سحب الأرشيف `Hello-Brother (copy 1).zip` من `DawshaX/nova` وفك ضغطه بالكامل (486 ملفاً) وفحصه أمنياً.
* رفع المشروع كاملاً ومفكوكاً إلى `DawshaX/xFREEDOLLARHACHx`.

### ✅ المرحلة 2: بناء «استوديو البج باونتي القانوني وموسوعة الأمان الشاملة» (`BugBountyStudio.tsx`)
* المسارات المضافة في الواجهة الأمامية (`artifacts/kali-panel/src/pages/BugBountyStudio.tsx`):
  * `/bug-bounty-studio` — استوديو البج باونتي القانوني المتكامل.
  * `/vuln-encyclopedia` — موسوعة الثغرات والبرمجة الآمنة (`IDOR/BOLA`, `SSRF`, `SQLi`, `XSS`, `Subdomain Takeover`, `CORS Misconfiguration`, `JWT/OAuth Flaws`, `Business Logic & Race Conditions`) مع مقارنة الكود الضعيف بالكود الآمن وخطوات الفحص والترقيع.
  * `/code-auditor` — الفاحص الدفاعي الساكن للكود المصدري ورؤوس HTTP/CORS مع حساب درجة الأمان (0–100) واقتراح الإصلاحات.
  * إدارة نطاقات برامج البج باونتي الرسمية (Google VRP, GitHub, Cloudflare, Shopify, HackerOne) مع إمكانية إضافة برامج مخصصة وحفظها تلقائياً.
  * قوائم الفحص المنهجية التفاعلية (Checklists) المحفوظة تلقائياً في المتصفح.
  * مولّد تقارير HackerOne / Google VRP الاحترافية بصيغة Markdown مع حاسبة `CVSS v3.1` التفاعلية.

### ✅ المرحلة 3: إصلاح التشغيل المستقل والاستضافة التلقائية على GitHub Pages
* تحديث `lib/db/src/index.ts` و `artifacts/api-server/src/routes/dashboard.ts` ليعمل الخادم الخلفي (`api-server`) بسلاسة حتى في الوضع المستقل بدون قاعدة بيانات خارجية.
* تحديث `artifacts/kali-panel/vite.config.ts` لربط `/api` بالخادم الخلفي تلقائياً عبر الـ Proxy.
* إضافة `.github/workflows/deploy-pages.yml` لبناء ونشر المنصة تلقائياً على **GitHub Pages** (`https://dawshax.github.io/xFREEDOLLARHACHx/`) مع كل تحديث على الفرع `main`.

---

## 3️⃣ كيفية التشغيل السريع في أي بيئة

```bash
# 1) تشغيل الخادم الخلفي (المنفذ 8080)
PORT=8080 pnpm --filter @workspace/api-server run dev

# 2) تشغيل الواجهة الأمامية (المنفذ 3000 مع Proxy تلقائي إلى 8080)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/kali-panel run dev
```
