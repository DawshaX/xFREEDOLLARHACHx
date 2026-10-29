import { useState, useMemo, useEffect } from "react";
import {
  Shield, BookOpen, Code, CheckSquare, FileText, Globe, AlertTriangle,
  CheckCircle2, Copy, Download, Search, Sparkles, Lock, Layers, Server,
  ExternalLink, Terminal, ChevronRight, RefreshCw, Plus, Trash2, Award,
} from "lucide-react";

// ─── 1) Vulnerability & Secure Code Encyclopedia Data ─────────────────────────
export interface VulnEntry {
  id: string;
  titleAr: string;
  titleEn: string;
  cwe: string;
  owasp: string;
  severity: "Critical" | "High" | "Medium";
  cvssBase: number;
  bountyRange: string;
  summaryAr: string;
  rootCauseAr: string;
  language: string;
  vulnerableCode: string;
  secureCode: string;
  auditChecklist: string[];
  remediationSteps: string[];
}

const ENCYCLOPEDIA: VulnEntry[] = [
  {
    id: "idor-bola",
    titleAr: "تجاوز الصلاحيات والوصول المباشر للكائنات (IDOR / BOLA)",
    titleEn: "Insecure Direct Object Reference / Broken Object Level Authorization",
    cwe: "CWE-639 / CWE-285",
    owasp: "API1:2023 / A01:2021 — Broken Access Control",
    severity: "High",
    cvssBase: 8.2,
    bountyRange: "$500 – $15,000+",
    summaryAr:
      "تحدث عندما يعتمد الخادم على معرّف يرسله المستخدم (مثل user_id أو invoice_id أو doc_id) لجلب أو تعديل بيانات دون التحقق برمجياً من أن المستخدم الحالي يملك صلاحية الوصول لهذا السجل تحديداً.",
    rootCauseAr:
      "الخلط بين المصادقة (Authentication: من أنت؟) والتفويض على مستوى السجل (Object-Level Authorization: هل يحق لك الوصول لهذا المورد؟) في طبقة الـ Controller أو الـ ORM.",
    language: "TypeScript / Express",
    vulnerableCode: `// ❌ كود ضعيف: يثق في req.params.invoiceId دون التحقق من ملكية المستخدم
app.get("/api/invoices/:invoiceId", requireAuth, async (req, res) => {
  const invoice = await db.invoices.findUnique({
    where: { id: req.params.invoiceId }
  });
  if (!invoice) return res.status(404).json({ error: "Not found" });
  return res.json(invoice);
});`,
    secureCode: `// ✅ كود آمن: يربط الاستعلام بمعرّف المستخدم الموثّق في الجلسة (req.user.id)
app.get("/api/invoices/:invoiceId", requireAuth, async (req, res) => {
  const invoice = await db.invoices.findFirst({
    where: {
      id: req.params.invoiceId,
      ownerUserId: req.user.id // تحقق إلزامي من الملكية على مستوى قاعدة البيانات
    }
  });
  if (!invoice) return res.status(404).json({ error: "Not found or unauthorized" });
  return res.json(invoice);
});`,
    auditChecklist: [
      "مراجعة جميع مسارات API التي تستقبل معرفات (ID / UUID / slug) في الرابط أو في JSON body.",
      "التحقق مما إذا كان استعلام قاعدة البيانات يتضمن شرط ملكية (tenant_id / user_id) مستمداً من الجلسة الموثقة وليس من مدخلات العميل.",
      "فحص عمليات التعديل (PUT/PATCH/DELETE) وعمليات التصدير (Export / GraphQL nodes) للتأكد من تطبيق نفس سياسة التفويض.",
      "استخدام حسابين تجريبيين مملوكين لك شخصياً (Account A & Account B) داخل بيئة الاختبار للتحقق القانوني من عزل البيانات.",
    ],
    remediationSteps: [
      "تطبيق فحص الملكية المركزي (Policy / Ownership Middleware) في كل استعلام قاعدة بيانات.",
      "استخدام معرفات UUID عشوائية مع عدم الاعتماد عليها وحدها كبديل عن فحص الصلاحيات.",
      "كتابة اختبارات تكامل آلية (Integration Tests) تتحقق من رفض وصول مستخدم أ لموارد مستخدم ب.",
    ],
  },
  {
    id: "ssrf",
    titleAr: "تزوير الطلبات من جانب الخادم (SSRF)",
    titleEn: "Server-Side Request Forgery (SSRF)",
    cwe: "CWE-918",
    owasp: "A10:2021 / API7:2023 — Server-Side Request Forgery",
    severity: "Critical",
    cvssBase: 9.1,
    bountyRange: "$1,000 – $31,337+",
    summaryAr:
      "تنشأ عندما يقوم الخادم بجلب رابط خارجي (URL) يحدده المستخدم (مثل جلب صورة بروفايل من رابط، أو معاينة رابط Webhook، أو تحويل HTML إلى PDF) دون تقييد العناوين الداخلية والشبكات الخاصة.",
    rootCauseAr:
      "تمرير عنوان URL القادم من المستخدم مباشرة إلى مكتبات الجلب (مثل fetch أو axios أو requests) مع السماح بالتحويلات التلقائية (Redirects) أو عناوين IP الداخلية (127.0.0.1, 169.254.169.254, 10.0.0.0/8).",
    language: "TypeScript / Node.js",
    vulnerableCode: `// ❌ كود ضعيف: يجلب أي رابط يمرره المستخدم بما في ذلك الشبكة الداخلية
app.post("/api/webhook/preview", async (req, res) => {
  const { targetUrl } = req.body;
  const response = await fetch(targetUrl);
  const text = await response.text();
  res.json({ preview: text.slice(0, 500) });
});`,
    secureCode: `// ✅ كود آمن: يتحقق من البروتوكول، القائمة البيضاء، ويمنع عناوين IP الداخلية
import { URL } from "node:url";
import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIP(ip: string): boolean {
  return /^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2\\d|3[0-1])\\.|0\\.|::1|fc00:|fe80:)/.test(ip);
}

app.post("/api/webhook/preview", async (req, res) => {
  const parsed = new URL(req.body.targetUrl);
  if (parsed.protocol !== "https:") return res.status(400).json({ error: "HTTPS only" });
  const { address } = await dns.lookup(parsed.hostname);
  if (!net.isIP(address) || isPrivateIP(address)) {
    return res.status(403).json({ error: "Internal/private network addresses are blocked" });
  }
  const response = await fetch(parsed.toString(), { redirect: "error" });
  res.json({ status: response.status });
});`,
    auditChecklist: [
      "حصر جميع الميزات التي تطلب روابط خارجية: Webhooks, URL Preview, PDF Generators, Image Importers, OIDC Discovery.",
      "مراجعة الكود للتأكد من فحص نتيجة الـ DNS قبل الاتصال مباشرة (منع DNS Rebinding).",
      "التحقق من تعطيل التحويل التلقائي (HTTP Redirects) أو إعادة فحص الوجهة الجديدة بعد كل تحويل.",
      "التأكد من تفعيل IMDSv2 على خوادم السحابة وعزل حاويات جلب الروابط في شبكة منفصلة.",
    ],
    remediationSteps: [
      "فرض قائمة بيضاء (Allowlist) للنطاقات المسموح بالاتصال بها متى أمكن.",
      "فحص الـ IP الناتج من الـ DNS وحظر جميع نطاقات RFC1918 و Link-Local (169.254.169.254) و Loopback.",
      "تعطيل `redirect: 'follow'` واستخدام `redirect: 'error'` أو التحقق من كل Redirect يدوياً.",
    ],
  },
  {
    id: "sqli",
    titleAr: "حقن قواعد البيانات (SQL Injection)",
    titleEn: "SQL Injection (SQLi)",
    cwe: "CWE-89",
    owasp: "A03:2021 — Injection",
    severity: "Critical",
    cvssBase: 9.8,
    bountyRange: "$1,500 – $25,000+",
    summaryAr:
      "تحدث عندما يتم دمج مدخلات المستخدم نصياً داخل جملة استعلام SQL بدلاً من تمريرها كمعاملات منفصلة (Parameterized Queries)، مما يسمح بتغيير منطق الاستعلام.",
    rootCauseAr:
      "استخدام القوالب النصية (Template Literals / String Concatenation) لبناء جمل SELECT أو ORDER BY أو WHERE في الكود الخلفي.",
    language: "TypeScript / PostgreSQL",
    vulnerableCode: `// ❌ كود ضعيف: دمج نصي مباشر لمدخلات البحث داخل جملة SQL
app.get("/api/users/search", async (req, res) => {
  const q = req.query.q as string;
  const result = await pool.query(
    \`SELECT id, username, email FROM users WHERE username LIKE '%\${q}%'\`
  );
  res.json(result.rows);
});`,
    secureCode: `// ✅ كود آمن: استخدام المعاملات المفصولة (Parameterized Query $1)
app.get("/api/users/search", async (req, res) => {
  const q = String(req.query.q || "");
  const result = await pool.query(
    "SELECT id, username, email FROM users WHERE username LIKE $1 LIMIT 50",
    [\`%\${q}%\`]
  );
  res.json(result.rows);
});`,
    auditChecklist: [
      "البحث في الكود المصدري عن أي استخدام لـ `pool.query(\`...\${` أو `sql.raw(` أو `queryRawUnsafe`.",
      "فحص معاملات الترتيب `sort` و `order` و `column` لأن المعاملات القياسية لا تغطي أسماء الأعمدة وتحتاج قائمة بيضاء صريحة.",
      "مراجعة الدوال المخزنة (Stored Procedures) التي تبني SQL ديناميكي باستخدام EXECUTE.",
    ],
    remediationSteps: [
      "الاعتماد الكامل على Prepared Statements / Parameterized Queries أو ORM آمن مثل Drizzle / Prisma.",
      "استخدام قائمة بيضاء صارمة (Allowlist) لأسماء الأعمدة واتجاه الترتيب (ASC / DESC).",
      "تطبيق مبدأ الصلاحيات الأقل (Least Privilege) لحساب قاعدة البيانات الخاص بالتطبيق.",
    ],
  },
  {
    id: "xss",
    titleAr: "البرمجة النصية عبر المواقع (XSS — Stored / Reflected / DOM)",
    titleEn: "Cross-Site Scripting (XSS)",
    cwe: "CWE-79",
    owasp: "A03:2021 — Injection",
    severity: "High",
    cvssBase: 7.5,
    bountyRange: "$300 – $7,500+",
    summaryAr:
      "تحدث عندما يقوم التطبيق بعرض بيانات قادمة من المستخدم داخل صفحة الويب (DOM) دون ترميز مخرجات مناسب للسياق (Contextual Output Encoding) أو تطهير (Sanitization).",
    rootCauseAr:
      "استخدام دوال خطرة مثل `innerHTML` أو `dangerouslySetInnerHTML` أو `document.write` أو قبول روابط `javascript:` في خصائص `href` و `src`.",
    language: "TypeScript / React",
    vulnerableCode: `// ❌ كود ضعيف: حقن HTML خام وقبول أي بروتوكول في الروابط
export function UserBio({ bioHtml, websiteUrl }: { bioHtml: string; websiteUrl: string }) {
  return (
    <div>
      <div dangerouslySetInnerHTML={{ __html: bioHtml }} />
      <a href={websiteUrl}>زيارة الموقع</a>
    </div>
  );
}`,
    secureCode: `// ✅ كود آمن: تطهير الـ HTML بـ DOMPurify والتحقق من بروتوكول الرابط
import DOMPurify from "dompurify";

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "#";
  } catch {
    return "#";
  }
}

export function UserBio({ bioHtml, websiteUrl }: { bioHtml: string; websiteUrl: string }) {
  const cleanHtml = DOMPurify.sanitize(bioHtml, { USE_PROFILES: { html: true } });
  return (
    <div>
      <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />
      <a href={safeUrl(websiteUrl)} rel="noopener noreferrer">زيارة الموقع</a>
    </div>
  );
}`,
    auditChecklist: [
      "فحص جميع أماكن استخدام `dangerouslySetInnerHTML` أو `v-html` أو `innerHTML` في الواجهة الأمامية.",
      "مراجعة الروابط الديناميكية `<a href={userUrl}>` والتأكد من رفض بروتوكولات `javascript:` و `data:`.",
      "فحص رؤوس الاستجابة للتأكد من وجود سياسة `Content-Security-Policy (CSP)` قوية وعلامة `HttpOnly` على الكوكيز.",
      "مراجعة رفع الملفات (مثل SVG أو HTML) والتأكد من تقديمها من نطاق معزول أو مع `Content-Disposition: attachment`.",
    ],
    remediationSteps: [
      "الاعتماد على الترميز التلقائي في React/JSX وتجنب `dangerouslySetInnerHTML` إلا مع `DOMPurify`.",
      "تفعيل ترويسة `Content-Security-Policy` مع `nonce` أو `strict-dynamic`.",
      "ضبط `Content-Type: application/json; charset=utf-8` و `X-Content-Type-Options: nosniff` لجميع استجابات API.",
    ],
  },
  {
    id: "subdomain-takeover",
    titleAr: "الاستحواذ على النطاقات الفرعية اليتيمة (Subdomain Takeover)",
    titleEn: "Subdomain Takeover (Dangling DNS Records)",
    cwe: "CWE-284 / CWE-350",
    owasp: "A05:2021 — Security Misconfiguration",
    severity: "High",
    cvssBase: 8.1,
    bountyRange: "$500 – $10,000+",
    summaryAr:
      "تحدث عندما يشير سجل DNS لنطاق فرعي (مثل CNAME أو A) إلى خدمة سحابية خارجية (GitHub Pages, AWS S3, Azure, Vercel, Heroku) تم حذف المشروع منها دون حذف سجل الـ DNS نفسه.",
    rootCauseAr:
      "غياب أتمتة تنظيف سجلات DNS عند إيقاف أو إلغاء الخدمات السحابية المؤقتة أو حملات التسويق القديمة.",
    language: "DNS / Cloud Infrastructure",
    vulnerableCode: `# ❌ سجل DNS يتيم (Dangling CNAME):
# النطاق الفرعي يشير إلى مستودع GitHub Pages أو Bucket لم يعد موجوداً
promo.example.com.  300  IN  CNAME  example-legacy.github.io.
# وعند فتح الرابط يرجع: "There isn't a GitHub Pages site here."`,
    secureCode: `# ✅ الإجراء الآمن:
# 1. حذف سجل الـ DNS فوراً قبل إيقاف الخدمة السحابية
# 2. أو حجز الاسم في الخدمة السحابية لمنع أي طرف خارجي من المطالبة به
# 3. أتمتة إدارة DNS عبر Terraform / Infrastructure-as-Code`,
    auditChecklist: [
      "فحص سجلات CNAME و NS للنطاقات المصرح بها في الـ Scope والتحقق مما إذا كانت ترجع رسائل خطأ مزود الخدمة (NoSuchBucket / 404 GitHub Pages / NXDOMAIN).",
      "التحقق من تأثير النطاق الفرعي على الكوكيز المشتركة (`Domain=.example.com`) وسياسات CORS و OAuth Redirect URIs.",
      "تنبيه مهم: في معظم برامج البج باونتي، يكفي إثبات وجود السجل اليتيم في التقرير دون نشر أي محتوى مضلل عليه.",
    ],
    remediationSteps: [
      "إزالة سجلات DNS (CNAME / A / ALIAS / NS) قبل حذف المورد السحابي.",
      "إجراء فحص دوري آلي لجميع سجلات DNS لاكتشاف أي سجل يشير إلى خدمة غير نشطة.",
    ],
  },
  {
    id: "cors-misconfig",
    titleAr: "إعدادات CORS الخاطئة وتسريب البيانات عبر النطاقات",
    titleEn: "CORS Misconfiguration with Credentials",
    cwe: "CWE-942",
    owasp: "A05:2021 — Security Misconfiguration",
    severity: "High",
    cvssBase: 7.5,
    bountyRange: "$400 – $5,000+",
    summaryAr:
      "تحدث عندما يقوم الخادم بعكس (Reflect) أي نطاق مرسل في ترويسة `Origin` داخل `Access-Control-Allow-Origin` مع تفعيل `Access-Control-Allow-Credentials: true`.",
    rootCauseAr:
      "محاولة المطور حل مشاكل CORS أثناء التطوير بتفعيل `origin: true` أو استخدام تعبير نمطي (Regex) غير مكتمل مثل `origin.endsWith('example.com')` الذي يقبل `evilexample.com`.",
    language: "TypeScript / Express",
    vulnerableCode: `// ❌ كود ضعيف: يعكس أي Origin مع السماح بإرسال الكوكيز
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true
}));`,
    secureCode: `// ✅ كود آمن: قائمة بيضاء صارمة ومحددة للنطاقات الموثوقة فقط
const ALLOWED_ORIGINS = new Set([
  "https://app.example.com",
  "https://admin.example.com"
]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
      cb(null, true);
    } else {
      cb(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));`,
    auditChecklist: [
      "فحص استجابة الخادم عند إرسال ترويسة `Origin` وملاحظة ما إذا كان الخادم يعكسها نصياً مع `Access-Control-Allow-Credentials: true`.",
      "فحص قبول `Origin: null` أو النطاقات التي تنتهي بنفس الاسم بدون نقطة فاصلة.",
      "التأكد مما إذا كانت نقطة النهاية تعتمد على الكوكيز تلقائياً أم على ترويسة `Authorization` مخصصة.",
    ],
    remediationSteps: [
      "استخدام قائمة مطابقة تامة (Exact Match Set) للنطاقات المسموح لها بدلاً من التعبيرات النمطية الفضفاضة.",
      "عدم تفعيل `Access-Control-Allow-Credentials: true` على المسارات التي لا تتطلب مشاركة جلسات عبر النطاقات.",
    ],
  },
  {
    id: "jwt-oauth-flaws",
    titleAr: "ثغرات المصادقة وتوكنات JWT و OAuth 2.0",
    titleEn: "JWT Validation & OAuth 2.0 Implementation Flaws",
    cwe: "CWE-287 / CWE-347",
    owasp: "A07:2021 — Identification and Authentication Failures",
    severity: "Critical",
    cvssBase: 9.0,
    bountyRange: "$1,000 – $20,000+",
    summaryAr:
      "تشمل فك تشفير JWT بـ `jwt.decode()` بدلاً من التحقق من التوقيع بـ `jwt.verify()`، أو قبول خوارزمية `none`، أو عدم التحقق من تطابق `redirect_uri` و `state` في تدفق OAuth 2.0.",
    rootCauseAr:
      "الاعتماد على قراءة محتوى التوكن قبل التحقق الرياضي من توقيعه، أو السماح بمطابقة جزئية لرابط إعادة التوجيه `redirect_uri` في OAuth.",
    language: "TypeScript / JWT",
    vulnerableCode: `// ❌ كود ضعيف: يستخدم decode() التي تقرأ البيانات دون التحقق من التوقيع!
export function getUserFromToken(token: string) {
  const payload = jwt.decode(token) as { sub: string; role: string };
  return payload;
}`,
    secureCode: `// ✅ كود آمن: يتحقق من التوقيع، الخوارزمية المحددة، الصلاحية، والجهة المصدرة
export function getUserFromToken(token: string) {
  return jwt.verify(token, process.env.JWT_PUBLIC_KEY!, {
    algorithms: ["RS256"],
    issuer: "https://auth.example.com",
    audience: "https://api.example.com"
  });
}`,
    auditChecklist: [
      "فحص الكود للتأكد من استخدام `jwt.verify` مع تحديد مصفوفة `algorithms` صراحةً.",
      "مراجعة تدفق OAuth للتأكد من إلزامية معامل `state` العشوائي المرتبط بالجلسة لمنع Login CSRF.",
      "التحقق من مطابقة `redirect_uri` حرفياً (Exact URI Match) لمنع تسريب كود التفويض عبر Open Redirect.",
    ],
    remediationSteps: [
      "تثبيت خوارزمية التوقيع المسموحة (`RS256` أو `ES256`) ورفض أي توكن يخالفها.",
      "تطبيق PKCE (Proof Key for Code Exchange) في جميع تدفقات OAuth 2.0.",
    ],
  },
  {
    id: "business-logic-race",
    titleAr: "ثغرات منطق الأعمال وحالات التسابق (Business Logic & Race Conditions)",
    titleEn: "Business Logic Flaws & Time-of-Check to Time-of-Use (TOCTOU)",
    cwe: "CWE-362 / CWE-840",
    owasp: "A04:2021 — Insecure Design",
    severity: "High",
    cvssBase: 8.1,
    bountyRange: "$1,000 – $25,000+",
    summaryAr:
      "تحدث عندما يقرأ الخادم الرصيد أو حالة الكوبون في خطوة، ثم يحدثه في خطوة لاحقة بدون قفل ذري (Atomic Transaction / Row Lock)، مما يسمح للطلبات المتزامنة بتجاوز الحد المسموح.",
    rootCauseAr:
      "فصل عملية التحقق `SELECT balance` عن عملية الخصم `UPDATE balance` خارج معاملة ذرية أو بدون قفل `FOR UPDATE`.",
    language: "TypeScript / SQL",
    vulnerableCode: `// ❌ كود ضعيف: فحص الرصيد ثم الخصم في خطوتين منفصلتين (عرضة لـ Race Condition)
const wallet = await db.query("SELECT balance FROM wallets WHERE user_id = $1", [userId]);
if (wallet.balance >= amount) {
  await db.query("UPDATE wallets SET balance = balance - $1 WHERE user_id = $2", [amount, userId]);
}`,
    secureCode: `// ✅ كود آمن: عملية ذرية واحدة تتحقق وتخصم في نفس جملة الـ UPDATE مع Idempotency Key
const res = await db.query(
  \`UPDATE wallets
   SET balance = balance - $1
   WHERE user_id = $2 AND balance >= $1
   RETURNING balance\`,
  [amount, userId]
);
if (res.rowCount === 0) throw new Error("Insufficient balance");`,
    auditChecklist: [
      "مراجعة العمليات المالية، نقاط المكافآت، استخدام الكوبونات، والتحويلات بين الحسابات.",
      "التأكد من وجود مفاتيح عدم التكرار (`Idempotency-Key`) على جميع طلبات الدفع والسحب.",
      "فحص التعامل مع القيم السالبة (`amount < 0`) أو الكسور العشرية غير المتوقعة أو تغير العملة بين خطوة التسعير وخطوة الدفع.",
    ],
    remediationSteps: [
      "استخدام تحديثات ذرية مشروطة (`WHERE balance >= $1`) أو أقفال صفوف (`SELECT ... FOR UPDATE`) داخل Transaction.",
      "التحقق الصارم من القيم الموجبة والحدود المنطقية ومفاتيح `Idempotency-Key`.",
    ],
  },
];

// ─── 2) Official Bug Bounty Programs Directory ───────────────────────────────
interface BountyProgram {
  id: string;
  name: string;
  platform: string;
  url: string;
  safeHarbor: boolean;
  maxBounty: string;
  inScopeSummary: string;
  outOfScopeSummary: string;
  focusAreas: string[];
}

const DEFAULT_PROGRAMS: BountyProgram[] = [
  {
    id: "google-vrp",
    name: "Google Vulnerability Reward Program (VRP)",
    platform: "Google Bug Hunters",
    url: "https://bughunters.google.com/",
    safeHarbor: true,
    maxBounty: "$31,337+ (Up to $100k+ for Cloud/Mobile)",
    inScopeSummary: "*.google.com, *.youtube.com, *.blogger.com, Google Cloud, Android & Chrome official services",
    outOfScopeSummary: "DoS/DDoS, Social Engineering, Physical attacks, Automated high-rate scanning causing disruption",
    focusAreas: ["IDOR / Access Control", "SSRF", "OAuth / Auth Logic", "XSS in sensitive origins", "Cloud Isolation"],
  },
  {
    id: "github-bounty",
    name: "GitHub Security Bug Bounty",
    platform: "HackerOne",
    url: "https://hackerone.com/github",
    safeHarbor: true,
    maxBounty: "$30,000+",
    inScopeSummary: "github.com, api.github.com, *.githubusercontent.com, GitHub Actions, GitHub Packages",
    outOfScopeSummary: "User-generated pages on github.io (unless platform flaw), brute force, social engineering",
    focusAreas: ["Fine-grained PAT permissions", "Actions Workflow Isolation", "GraphQL API Authorization", "SSRF"],
  },
  {
    id: "cloudflare-bounty",
    name: "Cloudflare Public Bug Bounty",
    platform: "HackerOne",
    url: "https://hackerone.com/cloudflare",
    safeHarbor: true,
    maxBounty: "$15,000+",
    inScopeSummary: "dash.cloudflare.com, api.cloudflare.com, Cloudflare Workers, Pages, Zero Trust",
    outOfScopeSummary: "Customer websites behind Cloudflare, volumetric DDoS",
    focusAreas: ["Tenant Isolation", "API Token Scoping", "Workers Sandbox", "Auth Bypass"],
  },
  {
    id: "shopify-bounty",
    name: "Shopify Bug Bounty Program",
    platform: "HackerOne",
    url: "https://hackerone.com/shopify",
    safeHarbor: true,
    maxBounty: "$50,000+",
    inScopeSummary: "*.myshopify.com (your own test stores only!), admin.shopify.com, Shopify POS & GraphQL APIs",
    outOfScopeSummary: "Live merchant stores not owned by you, automated credential stuffing",
    focusAreas: ["Checkout Business Logic", "Staff Permission Escalation", "IDOR across stores", "OAuth App Scoping"],
  },
  {
    id: "hackerone-bounty",
    name: "HackerOne Platform Security",
    platform: "HackerOne",
    url: "https://hackerone.com/security",
    safeHarbor: true,
    maxBounty: "$25,000+",
    inScopeSummary: "hackerone.com, api.hackerone.com, HackerOne Hai AI features",
    outOfScopeSummary: "Disclosure of public reports, rate limit testing",
    focusAreas: ["Report Confidentiality (IDOR)", "GraphQL Nodes", "Program Scope Access Control"],
  },
];

// ─── 3) Static Code & Header Auditor Rules ───────────────────────────────────
interface AuditFinding {
  id: string;
  titleAr: string;
  cwe: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  line: number;
  snippet: string;
  explanationAr: string;
  fixAr: string;
}

const SAMPLE_VULNERABLE_CODE = `// نموذج كود ومقتطف إعدادات للفحص الدفاعي الساكن (SAST)
import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";

const app = express();

// 1) إعدادات CORS متساهلة مع الكوكيز
app.use(cors({ origin: "*", credentials: true }));

// 2) فك تشفير التوكن بدون التحقق من التوقيع
app.get("/api/profile/:userId", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1] || "";
  const user = jwt.decode(token);

  // 3) استعلام SQL نصي مباشر (SQL Injection)
  const q = \`SELECT * FROM accounts WHERE id = '\${req.params.userId}'\`;
  const data = await db.query(q);

  // 4) جلب رابط خارجي بدون فحص الشبكة الداخلية (SSRF)
  const avatarResp = await fetch(req.query.avatarUrl as string);

  res.send(\`<div class="profile">\${req.query.bio}</div>\`);
});

// 5) رؤوس استجابة HTTP للمراجعة:
// Access-Control-Allow-Origin: *
// Access-Control-Allow-Credentials: true
// Server: Apache/2.4.49
`;

function runStaticAudit(input: string): { score: number; findings: AuditFinding[] } {
  const lines = input.split("\n");
  const findings: AuditFinding[] = [];

  const rules: Array<{
    id: string;
    titleAr: string;
    cwe: string;
    severity: "Critical" | "High" | "Medium" | "Low";
    regex: RegExp;
    explanationAr: string;
    fixAr: string;
  }> = [
    {
      id: "sql-concat",
      titleAr: "دمج نصي مباشر داخل استعلام قاعدة بيانات (احتمال SQL Injection)",
      cwe: "CWE-89",
      severity: "Critical",
      regex: /(SELECT|INSERT|UPDATE|DELETE)\s+.*(\$\{|['"]\s*\+\s*)/i,
      explanationAr: "بناء جملة SQL عبر دمج المتغيرات نصياً يسمح بتغيير منطق الاستعلام والوصول لبيانات غير مصرح بها.",
      fixAr: "استخدم المعاملات المفصولة (Parameterized Queries مثل $1, $2 أو ?).",
    },
    {
      id: "jwt-decode",
      titleAr: "استخدام jwt.decode() دون التحقق من التوقيع الرقمي",
      cwe: "CWE-347",
      severity: "Critical",
      regex: /jwt\.decode\s*\(/,
      explanationAr: "الدالة jwt.decode() تقرأ محتوى التوكن فقط ولا تتحقق من صحة التوقيع، مما يسمح بتزوير الهوية.",
      fixAr: "استبدلها بـ jwt.verify(token, secretOrPublicKey, { algorithms: ['RS256'] }).",
    },
    {
      id: "eval-exec",
      titleAr: "تنفيذ ديناميكي للكود أو الأوامر (eval / child_process exec)",
      cwe: "CWE-95 / CWE-78",
      severity: "Critical",
      regex: /\b(eval|Function|execSync|exec)\s*\(/,
      explanationAr: "تنفيذ النصوص ككود أو أوامر نظام يفتح الباب لتنفيذ أوامر عن بعد إذا وصلت إليه مدخلات المستخدم.",
      fixAr: "تجنب eval تماماً، واستخدم execFile بمعاملات مفصولة بدلاً من exec.",
    },
    {
      id: "ssrf-fetch",
      titleAr: "جلب رابط قادم من مدخلات المستخدم مباشرة (احتمال SSRF)",
      cwe: "CWE-918",
      severity: "High",
      regex: /\b(fetch|axios\.get|axios\.post|http\.get)\s*\(\s*req\.(query|body|params)/,
      explanationAr: "تمرير رابط من req.query أو req.body مباشرة إلى دالة الجلب قد يسمح بالوصول لعناوين الشبكة الداخلية.",
      fixAr: "تحقق من البروتوكول (HTTPS)، وافحص الـ IP الناتج من DNS لحظر النطاقات الداخلية (127.0.0.1 / 169.254.169.254).",
    },
    {
      id: "xss-sink",
      titleAr: "حقن مخرجات غير مرمزة في الصفحة (احتمال XSS)",
      cwe: "CWE-79",
      severity: "High",
      regex: /(dangerouslySetInnerHTML|\.innerHTML\s*=|res\.send\s*\(\s*`[^`]*\$\{req\.)/,
      explanationAr: "إدراج مدخلات المستخدم مباشرة داخل HTML دون تطهير أو ترميز يسمح بتنفيذ سكربتات داخل متصفح الضحية.",
      fixAr: "استخدم DOMPurify لتطهير الـ HTML أو اعتمد على ترميز JSX القياسي واستجابات JSON.",
    },
    {
      id: "cors-wildcard-creds",
      titleAr: "إعدادات CORS تجمع بين النطاق المفتوح (*) وإرسال الكوكيز (Credentials)",
      cwe: "CWE-942",
      severity: "High",
      regex: /(origin\s*:\s*['"]\*['"].*credentials\s*:\s*true|Access-Control-Allow-Origin:\s*\*)/i,
      explanationAr: "تفعيل CORS المفتوح أو عكس الـ Origin مع الكوكيز يعرض بيانات الجلسة للقراءة من نطاقات خارجية.",
      fixAr: "حدد قائمة بيضاء صريحة (Allowlist) للنطاقات الموثوقة فقط.",
    },
    {
      id: "hardcoded-secret",
      titleAr: "مفتاح سري أو توكن مكتوب نصياً في الكود (Hardcoded Secret)",
      cwe: "CWE-798",
      severity: "High",
      regex: /(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{25,}|PASSWORD\s*=\s*['"][^'"]{6,}['"])/,
      explanationAr: "كتابة المفاتيح السرية داخل الكود المصدري يعرضها للتسرب عبر سجل Git.",
      fixAr: "انقل جميع المفاتيح إلى متغيرات البيئة (Environment Variables / GitHub Secrets).",
    },
    {
      id: "server-banner",
      titleAr: "كشف إصدار الخادم التفصيلي في الترويسة (Server Version Disclosure)",
      cwe: "CWE-200",
      severity: "Low",
      regex: /Server:\s*(Apache|nginx|Microsoft-IIS)\/[0-9.]+/i,
      explanationAr: "إظهار رقم الإصدار الدقيق للخادم يسهل مطابقته مع الثغرات المعروفة لهذا الإصدار.",
      fixAr: "أخفِ رقم الإصدار عبر إعداد ServerTokens Prod أو server_tokens off.",
    },
  ];

  lines.forEach((lineText, idx) => {
    for (const rule of rules) {
      if (rule.regex.test(lineText)) {
        findings.push({
          id: `${rule.id}-${idx + 1}`,
          titleAr: rule.titleAr,
          cwe: rule.cwe,
          severity: rule.severity,
          line: idx + 1,
          snippet: lineText.trim(),
          explanationAr: rule.explanationAr,
          fixAr: rule.fixAr,
        });
      }
    }
  });

  const penalty = findings.reduce((acc, f) => {
    if (f.severity === "Critical") return acc + 25;
    if (f.severity === "High") return acc + 15;
    if (f.severity === "Medium") return acc + 8;
    return acc + 3;
  }, 0);

  return {
    score: Math.max(0, 100 - penalty),
    findings,
  };
}

// ─── 4) Interactive Methodology Checklists ───────────────────────────────────
interface ChecklistCategory {
  id: string;
  titleAr: string;
  items: Array<{ id: string; textAr: string; hintAr: string }>;
}

const CHECKLISTS: ChecklistCategory[] = [
  {
    id: "scope-recon",
    titleAr: "1. التحقق من النطاق وفهم بنية الهدف (Scope & Architecture Mapping)",
    items: [
      { id: "sr-1", textAr: "قراءة سياسة البرنامج (Program Policy) وتحديد الأصول الداخلة في النطاق (In-Scope) بدقة 100%", hintAr: "لا تفحص أي نطاق فرعي أو خدمة غير مذكورة صراحةً في جدول In-Scope." },
      { id: "sr-2", textAr: "التأكد من شروط الملاذ الآمن (Safe Harbor) وترويسة التعريف المطلوبة (مثل X-Bug-Bounty: HackerOne-username)", hintAr: "بعض البرامج تطلب إرسال User-Agent أو Header خاص لتمييز فحصك القانوني." },
      { id: "sr-3", textAr: "تحليل التقنيات المستخدمة (Frontend Framework, API Gateway, Auth Mechanism, Cloud Provider)", hintAr: "يساعدك في معرفة فئات الأخطاء البرمجية المحتملة في هذا المعمار." },
    ],
  },
  {
    id: "auth-session",
    titleAr: "2. فحص المصادقة وإدارة الجلسات (Authentication & Session Security)",
    items: [
      { id: "as-1", textAr: "مراجعة تدفق تسجيل الدخول واستعادة كلمة المرور ورموز التحقق (OTP / Magic Links)", hintAr: "تحقق من انتهاء صلاحية الرابط عند أول استخدام ومن ربطه بالحساب الصحيح." },
      { id: "as-2", textAr: "مراجعة تدفق OAuth 2.0 / SSO والتحقق من معامل state ومطابقة redirect_uri", hintAr: "غياب state قد يؤدي إلى ربط حساب مهاجم بجلسة المستخدم." },
      { id: "as-3", textAr: "التحقق من إبطال الجلسة (Session Revocation) فعلياً على الخادم عند تسجيل الخروج أو تغيير كلمة المرور", hintAr: "هل يظل توكن JWT القديم صالحاً بعد تغيير كلمة المرور؟" },
    ],
  },
  {
    id: "access-idor",
    titleAr: "3. فحص الصلاحيات وعزل البيانات (Authorization & IDOR / BOLA)",
    items: [
      { id: "ac-1", textAr: "إنشاء حسابين تجريبيين مملوكين لك (User A & User B) لاختبار عزل البيانات الأفقي (Horizontal Isolation)", hintAr: "تأكد أن User B لا يمكنه قراءة أو تعديل موارد User A عبر تغيير المعرّف." },
      { id: "ac-2", textAr: "اختبار الصلاحيات الرأسية (Vertical Privilege Escalation) بين الأدوار (Viewer vs Admin / Member vs Owner)", hintAr: "هل يمكن لعضو بصلاحية القراءة فقط استدعاء مسارات الإدارة في الـ API؟" },
      { id: "ac-3", textAr: "فحص الحقول الحساسة في طلبات التحديث (Mass Assignment / Broken Object Property Level Authorization)", hintAr: "هل يقبل الخادم حقولاً مثل role أو is_verified أو plan_tier في طلب PATCH؟" },
    ],
  },
  {
    id: "business-logic",
    titleAr: "4. فحص منطق الأعمال والواجهات البرمجية (Business Logic & API Integrity)",
    items: [
      { id: "bl-1", textAr: "مراجعة خطوات العمل متعددة المراحل (Multi-step Workflows) وإمكانية تخطي خطوة وسيطة", hintAr: "هل يتحقق الخادم في الخطوة 3 من اكتمال الخطوة 2 فعلياً؟" },
      { id: "bl-2", textAr: "فحص التعامل مع القيم الحدية (أرقام سالبة، صفر، مصفوفات فارغة، أنواع بيانات غير متوقعة في JSON)", hintAr: "اختبر كيف يتعامل الـ Validator مع الأنواع المختلفة." },
      { id: "bl-3", textAr: "مراجعة استعلامات GraphQL والتأكد من توحيد فحص الصلاحيات داخل كل Resolver فرعي", hintAr: "أحياناً يكون المسار REST محمياً بينما نفس البيانات متاحة عبر عقدة GraphQL فرعية." },
    ],
  },
];

export default function BugBountyStudio() {
  const [activeTab, setActiveTab] = useState<"encyclopedia" | "auditor" | "scope" | "checklist" | "report">("encyclopedia");

  // Tab 1 state: Encyclopedia
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVulnId, setSelectedVulnId] = useState<string>(ENCYCLOPEDIA[0].id);

  // Tab 2 state: Static Auditor
  const [codeInput, setCodeInput] = useState(SAMPLE_VULNERABLE_CODE);
  const auditResult = useMemo(() => runStaticAudit(codeInput), [codeInput]);

  // Tab 3 state: Scope & Programs
  const [programs, setPrograms] = useState<BountyProgram[]>(() => {
    try {
      const saved = localStorage.getItem("cybernova_bounty_programs");
      return saved ? JSON.parse(saved) : DEFAULT_PROGRAMS;
    } catch {
      return DEFAULT_PROGRAMS;
    }
  });
  const [newProgName, setNewProgName] = useState("");
  const [newProgScope, setNewProgScope] = useState("");
  const [scopeCheckHost, setScopeCheckHost] = useState("api.github.com");

  useEffect(() => {
    try {
      localStorage.setItem("cybernova_bounty_programs", JSON.stringify(programs));
    } catch {}
  }, [programs]);

  // Tab 4 state: Checklists
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("cybernova_bounty_checklist");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("cybernova_bounty_checklist", JSON.stringify(checkedItems));
    } catch {}
  }, [checkedItems]);

  // Tab 5 state: CVSS & Report Builder
  const [reportTitle, setReportTitle] = useState("Broken Object Level Authorization (IDOR) on /api/v1/invoices/:id allows reading other tenants' invoices");
  const [reportProgram, setReportProgram] = useState("GitHub / HackerOne Program");
  const [reportAsset, setReportAsset] = useState("https://api.example.com/v1/invoices/{id}");
  const [reportCwe, setReportCwe] = useState("CWE-639: Authorization Bypass Through User-Controlled Key");
  const [reportSummary, setReportSummary] = useState(
    "نقطة النهاية `/api/v1/invoices/:id` تتحقق من تسجيل دخول المستخدم (Authentication) لكنها لا تتحقق من ملكية الفاتورة للمستخدم الحالي (Object-Level Authorization)، مما يسمح لأي حساب موثق بقراءة بيانات فواتير حساب آخر."
  );
  const [reportSteps, setReportSteps] = useState(
    "1. أنشئ حسابين تجريبيين مملوكين لك (Account A و Account B).\n2. من Account A، أنشئ فاتورة تجريبية واحتفظ بمعرفها `INV-1042`.\n3. أرسل طلب `GET /api/v1/invoices/INV-1042` باستخدام توكن جلسة Account B.\n4. لاحظ أن الخادم يرجع `200 OK` مع كامل بيانات فاتورة Account A بدلاً من `403 Forbidden` أو `404 Not Found`."
  );
  const [reportImpact, setReportImpact] = useState(
    "كشف غير مصرح به للبيانات المالية والفواتير الخاصة بالمستخدمين الآخرين (خرق سرية البيانات Confidentiality High)."
  );
  const [reportFix, setReportFix] = useState(
    "إضافة شرط التحقق من ملكية السجل `WHERE id = $1 AND owner_user_id = $2` بالاعتماد على معرّف المستخدم المستخرج من الجلسة الموثقة."
  );
  const [cvssAV, setCvssAV] = useState<"N" | "A" | "L" | "P">("N");
  const [cvssAC, setCvssAC] = useState<"L" | "H">("L");
  const [cvssPR, setCvssPR] = useState<"N" | "L" | "H">("L");
  const [cvssUI, setCvssUI] = useState<"N" | "R">("N");
  const [cvssC, setCvssC] = useState<"H" | "L" | "N">("H");
  const [cvssI, setCvssI] = useState<"H" | "L" | "N">("L");
  const [cvssA, setCvssA] = useState<"H" | "L" | "N">("N");
  const [copiedReport, setCopiedReport] = useState(false);

  const cvssResult = useMemo(() => {
    const avMap = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
    const acMap = { L: 0.77, H: 0.44 };
    const prMap = { N: 0.85, L: 0.62, H: 0.27 };
    const uiMap = { N: 0.85, R: 0.62 };
    const ciaMap = { H: 0.56, L: 0.22, N: 0 };

    const iscBase = 1 - (1 - ciaMap[cvssC]) * (1 - ciaMap[cvssI]) * (1 - ciaMap[cvssA]);
    const impact = 6.42 * iscBase;
    const exploitability = 8.22 * avMap[cvssAV] * acMap[cvssAC] * prMap[cvssPR] * uiMap[cvssUI];
    const raw = impact <= 0 ? 0 : Math.min(10, Math.ceil((impact + exploitability) * 10) / 10);
    const severity =
      raw >= 9.0 ? "Critical" : raw >= 7.0 ? "High" : raw >= 4.0 ? "Medium" : raw > 0 ? "Low" : "None";
    const vector = `CVSS:3.1/AV:${cvssAV}/AC:${cvssAC}/PR:${cvssPR}/UI:${cvssUI}/S:U/C:${cvssC}/I:${cvssI}/A:${cvssA}`;
    return { score: raw.toFixed(1), severity, vector };
  }, [cvssAV, cvssAC, cvssPR, cvssUI, cvssC, cvssI, cvssA]);

  const markdownReport = useMemo(() => {
    return `# ${reportTitle}

- **Program:** ${reportProgram}
- **Target Asset:** \`${reportAsset}\`
- **Weakness (CWE):** ${reportCwe}
- **Severity:** **${cvssResult.severity} (${cvssResult.score})**
- **CVSS v3.1 Vector:** \`${cvssResult.vector}\`

---

## 1. Executive Summary (ملخص الثغرة)
${reportSummary}

---

## 2. Steps to Reproduce — Safe Verification (خطوات التحقق الآمن على حسابات اختبارية)
${reportSteps}

---

## 3. Security & Business Impact (الأثر الأمني)
${reportImpact}

---

## 4. Recommended Remediation (الحل البرمجي المقترح)
${reportFix}
`;
  }, [reportTitle, reportProgram, reportAsset, reportCwe, cvssResult, reportSummary, reportSteps, reportImpact, reportFix]);

  const filteredVulns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ENCYCLOPEDIA;
    return ENCYCLOPEDIA.filter(
      (v) =>
        v.titleAr.toLowerCase().includes(q) ||
        v.titleEn.toLowerCase().includes(q) ||
        v.cwe.toLowerCase().includes(q) ||
        v.owasp.toLowerCase().includes(q) ||
        v.summaryAr.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const selectedVuln = useMemo(
    () => ENCYCLOPEDIA.find((v) => v.id === selectedVulnId) || ENCYCLOPEDIA[0],
    [selectedVulnId]
  );

  const totalChecklistCount = CHECKLISTS.reduce((acc, c) => acc + c.items.length, 0);
  const completedChecklistCount = Object.values(checkedItems).filter(Boolean).length;

  return (
    <div dir="rtl" className="min-h-full bg-[#05020a] text-gray-100 p-4 md:p-6 space-y-6 font-sans">
      {/* ── Header Banner ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-l from-emerald-950/40 via-[#0b0716] to-red-950/30 p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono uppercase tracking-wider">
              <Shield className="w-4 h-4" />
              <span>CYBERNOVA ETHICAL SECURITY & BUG BOUNTY STUDIO · VRP & HACKERONE EDITION</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white">
              🛡️ استوديو البج باونتي القانوني وموسوعة الأمان والبرمجة الشاملة
            </h1>
            <p className="text-sm text-gray-300 max-w-4xl">
              منصة متكاملة للبحث الأمني الأخلاقي القانوني 100%: موسوعة علمية وعملية للثغرات والكود الآمن، فاحص دفاعي ساكن للشيفرات والـ Headers، إدارة نطاقات برامج HackerOne و Google VRP، قوائم فحص منهجية، ومولّد تقارير احترافية مع حاسبة CVSS v3.1.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
              <div className="text-xs text-emerald-300">الموسوعة البرمجية</div>
              <div className="text-lg font-bold text-emerald-400">{ENCYCLOPEDIA.length} فئات كبرى</div>
            </div>
            <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center">
              <div className="text-xs text-amber-300">تقدم المنهجية</div>
              <div className="text-lg font-bold text-amber-400">
                {completedChecklistCount}/{totalChecklistCount}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-white/10">
          {[
            { id: "encyclopedia", label: "📚 موسوعة الثغرات والكود الآمن", icon: BookOpen },
            { id: "auditor", label: "🔍 الفاحص الدفاعي للكود والـ Headers", icon: Code },
            { id: "scope", label: "🎯 نطاقات برامج HackerOne & Google VRP", icon: Globe },
            { id: "checklist", label: "✅ قوائم الفحص المنهجية", icon: CheckSquare },
            { id: "report", label: "📝 مولّد التقارير وحاسبة CVSS 3.1", icon: FileText },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as typeof activeTab)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  active
                    ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/30"
                    : "bg-white/5 text-gray-300 hover:bg-white/10"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── TAB 1: Vulnerability & Secure Code Encyclopedia ───────────────── */}
      {activeTab === "encyclopedia" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sidebar list */}
          <div className="lg:col-span-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute right-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن ثغرة (IDOR, SSRF, SQLi, CWE, OWASP)..."
                className="w-full pr-9 pl-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-2 max-h-[650px] overflow-y-auto pr-1">
              {filteredVulns.map((v) => {
                const isSelected = v.id === selectedVuln.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVulnId(v.id)}
                    className={`w-full text-right p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? "bg-emerald-950/50 border-emerald-500/60 shadow-md"
                        : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          v.severity === "Critical"
                            ? "bg-red-500/20 text-red-300 border border-red-500/40"
                            : "bg-orange-500/20 text-orange-300 border border-orange-500/40"
                        }`}
                      >
                        {v.severity} · CVSS {v.cvssBase}
                      </span>
                      <span className="text-xs font-mono text-emerald-400">{v.cwe}</span>
                    </div>
                    <div className="font-bold text-sm text-white">{v.titleAr}</div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">{v.titleEn}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail view */}
          <div className="lg:col-span-8 space-y-5">
            <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-mono text-emerald-400">{selectedVuln.owasp}</span>
                  <h2 className="text-xl font-bold text-white mt-1">{selectedVuln.titleAr}</h2>
                  <p className="text-xs font-mono text-gray-400">{selectedVuln.titleEn}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 font-bold">
                    💰 متوسط المكافآت: {selectedVuln.bountyRange}
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-xs text-red-300 font-mono">
                    {selectedVuln.cwe}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="text-xs font-bold text-emerald-400 mb-1">📖 المفهوم العلمي الدقيق</div>
                  <p className="text-sm text-gray-200 leading-relaxed">{selectedVuln.summaryAr}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="text-xs font-bold text-amber-400 mb-1">⚙️ السبب الجذري في البرمجة (Root Cause)</div>
                  <p className="text-sm text-gray-200 leading-relaxed">{selectedVuln.rootCauseAr}</p>
                </div>
              </div>

              {/* Code comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-red-500/30 bg-red-950/20 overflow-hidden">
                  <div className="px-3 py-2 bg-red-500/20 border-b border-red-500/30 text-xs font-bold text-red-200 flex items-center justify-between">
                    <span>❌ الكود الضعيف (Vulnerable Pattern)</span>
                    <span className="font-mono">{selectedVuln.language}</span>
                  </div>
                  <pre dir="ltr" className="p-3 text-xs font-mono text-red-100 overflow-x-auto leading-relaxed">
                    {selectedVuln.vulnerableCode}
                  </pre>
                </div>

                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 overflow-hidden">
                  <div className="px-3 py-2 bg-emerald-500/20 border-b border-emerald-500/30 text-xs font-bold text-emerald-200 flex items-center justify-between">
                    <span>✅ الكود الآمن بعد الإصلاح (Secure Pattern)</span>
                    <span className="font-mono">{selectedVuln.language}</span>
                  </div>
                  <pre dir="ltr" className="p-3 text-xs font-mono text-emerald-100 overflow-x-auto leading-relaxed">
                    {selectedVuln.secureCode}
                  </pre>
                </div>
              </div>

              {/* Checklist & Remediation */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                  <div className="text-sm font-bold text-sky-400">🔎 منهجية الفحص والتحقق الأخلاقي</div>
                  <ul className="space-y-1.5 text-xs text-gray-200">
                    {selectedVuln.auditChecklist.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-sky-400 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                  <div className="text-sm font-bold text-emerald-400">🛠️ خطوات المعالجة والترقيع الدفاعي</div>
                  <ul className="space-y-1.5 text-xs text-gray-200">
                    {selectedVuln.remediationSteps.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-emerald-400 font-bold">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: Static Code & Headers Auditor ──────────────────────────── */}
      {activeTab === "auditor" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Code className="w-5 h-5 text-emerald-400" />
                <span>محرر فحص الكود المصدري ورؤوس HTTP (Static Auditor)</span>
              </h2>
              <button
                onClick={() => setCodeInput(SAMPLE_VULNERABLE_CODE)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-gray-200 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>استعادة المثال التجريبي</span>
              </button>
            </div>
            <textarea
              dir="ltr"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              rows={20}
              className="w-full p-4 rounded-2xl bg-[#090612] border border-white/15 font-mono text-xs text-emerald-100 focus:outline-none focus:border-emerald-500 leading-relaxed"
              placeholder="Paste JavaScript/TypeScript, SQL, Python, or HTTP Response Headers here..."
            />
          </div>

          <div className="lg:col-span-6 space-y-4">
            <div className="p-4 rounded-2xl border border-white/15 bg-white/[0.03] flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-400">درجة سلامة الكود والإعدادات</div>
                <div className="text-2xl font-extrabold text-white mt-0.5">
                  {auditResult.score} / 100
                </div>
              </div>
              <div className="text-left">
                <span
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                    auditResult.findings.length === 0
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-red-500/20 text-red-300 border border-red-500/40"
                  }`}
                >
                  {auditResult.findings.length === 0
                    ? "✅ لم يتم رصد أنماط ضعيفة"
                    : `⚠️ تم رصد ${auditResult.findings.length} ملاحظات أمنية`}
                </span>
              </div>
            </div>

            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {auditResult.findings.map((f) => (
                <div
                  key={f.id}
                  className="p-4 rounded-xl border border-white/10 bg-white/[0.03] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        f.severity === "Critical"
                          ? "bg-red-500/20 text-red-300 border border-red-500/40"
                          : f.severity === "High"
                          ? "bg-orange-500/20 text-orange-300 border border-orange-500/40"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      }`}
                    >
                      {f.severity} · السطر {f.line}
                    </span>
                    <span className="text-xs font-mono text-emerald-400">{f.cwe}</span>
                  </div>
                  <div className="font-bold text-sm text-white">{f.titleAr}</div>
                  <pre dir="ltr" className="p-2 rounded-lg bg-black/50 text-[11px] font-mono text-red-200 overflow-x-auto">
                    {f.snippet}
                  </pre>
                  <p className="text-xs text-gray-300">{f.explanationAr}</p>
                  <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200">
                    <strong>🛠️ الإصلاح الموصى به:</strong> {f.fixAr}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: Official Bug Bounty Programs & Scope Validator ─────────── */}
      {activeTab === "scope" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Scope Validator Box */}
            <div className="p-5 rounded-2xl border border-emerald-500/30 bg-white/[0.03] space-y-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                <span>فاحص تطابق النطاق القانوني (Scope Validator)</span>
              </h3>
              <p className="text-xs text-gray-300">
                أدخل اسم النطاق (Hostname) للتحقق مما إذا كان يطابق قواعد النطاقات المسموحة في البرامج المسجلة:
              </p>
              <input
                dir="ltr"
                type="text"
                value={scopeCheckHost}
                onChange={(e) => setScopeCheckHost(e.target.value)}
                placeholder="e.g. api.github.com"
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-sm font-mono text-white"
              />
              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200 space-y-1">
                <div>
                  النطاق المدخل: <code className="font-mono font-bold">{scopeCheckHost || "—"}</code>
                </div>
                <div>
                  💡 تذكّر دائماً مراجعة صفحة السياسة الرسمية للبرنامج قبل إرسال أي طلب اختباري.
                </div>
              </div>
            </div>

            {/* Add Custom Program Box */}
            <div className="lg:col-span-2 p-5 rounded-2xl border border-white/15 bg-white/[0.03] space-y-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>إضافة برنامج بج باونتي جديد لمساحة عملك (يحفظ تلقائياً)</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={newProgName}
                  onChange={(e) => setNewProgName(e.target.value)}
                  placeholder="اسم البرنامج (مثال: Yahoo / HackerOne)"
                  className="px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-sm text-white"
                />
                <input
                  type="text"
                  value={newProgScope}
                  onChange={(e) => setNewProgScope(e.target.value)}
                  placeholder="النطاقات المسموحة (مثال: *.yahoo.com, api.yahoo.com)"
                  className="px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-sm text-white"
                />
              </div>
              <button
                onClick={() => {
                  if (!newProgName.trim()) return;
                  setPrograms((prev) => [
                    {
                      id: `custom-${Date.now()}`,
                      name: newProgName.trim(),
                      platform: "HackerOne / Custom",
                      url: "https://hackerone.com/directory/programs",
                      safeHarbor: true,
                      maxBounty: "حسب خطورة الثغرة (CVSS)",
                      inScopeSummary: newProgScope.trim() || "*.example.com",
                      outOfScopeSummary: "DoS, Social Engineering, Out-of-scope subdomains",
                      focusAreas: ["IDOR", "SSRF", "XSS", "Auth Logic"],
                    },
                    ...prev,
                  ]);
                  setNewProgName("");
                  setNewProgScope("");
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white"
              >
                + حفظ البرنامج في قائمتي
              </button>
            </div>
          </div>

          {/* Programs Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {programs.map((p) => (
              <div key={p.id} className="p-5 rounded-2xl border border-white/15 bg-white/[0.03] space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-mono text-emerald-400">{p.platform}</span>
                    <h3 className="text-lg font-bold text-white">{p.name}</h3>
                  </div>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-white flex items-center gap-1"
                  >
                    <span>الصفحة الرسمية</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <div className="text-xs text-amber-300 font-bold">🏆 المكافآت: {p.maxBounty}</div>
                <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/25 text-xs text-emerald-100">
                  <strong>✅ داخل النطاق (In-Scope):</strong> <span dir="ltr">{p.inScopeSummary}</span>
                </div>
                <div className="p-3 rounded-xl bg-red-950/20 border border-red-500/25 text-xs text-red-100">
                  <strong>⛔ خارج النطاق (Out-of-Scope):</strong> {p.outOfScopeSummary}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {p.focusAreas.map((fa) => (
                    <span key={fa} className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-gray-300">
                      {fa}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 4: Interactive Methodology Checklists ─────────────────────── */}
      {activeTab === "checklist" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-2xl border border-white/15 bg-white/[0.03]">
            <div>
              <h2 className="text-lg font-bold text-white">✅ قائمة الفحص المنهجي للباحث الأخلاقي</h2>
              <p className="text-xs text-gray-400">
                كل خطوة تنجزها تُحفظ تلقائياً في متصفحك لتتابع عملك بهدوء وبدون نسيان أي تفصيلة.
              </p>
            </div>
            <button
              onClick={() => setCheckedItems({})}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-gray-200"
            >
              تصفير القائمة لدورة جديدة
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CHECKLISTS.map((cat) => (
              <div key={cat.id} className="p-5 rounded-2xl border border-white/15 bg-white/[0.03] space-y-3">
                <h3 className="font-bold text-base text-emerald-400">{cat.titleAr}</h3>
                <div className="space-y-2.5">
                  {cat.items.map((item) => {
                    const checked = !!checkedItems[item.id];
                    return (
                      <label
                        key={item.id}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                          checked
                            ? "bg-emerald-950/30 border-emerald-500/40"
                            : "bg-black/30 border-white/10 hover:bg-white/[0.04]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCheckedItems((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                          }
                          className="mt-1 w-4 h-4 accent-emerald-500"
                        />
                        <div className="space-y-1">
                          <div className={`text-sm font-medium ${checked ? "line-through text-emerald-300" : "text-white"}`}>
                            {item.textAr}
                          </div>
                          <div className="text-xs text-gray-400">{item.hintAr}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 5: Report Builder & CVSS v3.1 Calculator ──────────────────── */}
      {activeTab === "report" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Form & CVSS */}
          <div className="lg:col-span-6 space-y-4">
            <div className="p-5 rounded-2xl border border-white/15 bg-white/[0.03] space-y-4">
              <h3 className="font-bold text-base text-emerald-400">🧮 حاسبة CVSS v3.1 التفاعلية</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-gray-400 mb-1">Attack Vector (AV)</label>
                  <select
                    value={cvssAV}
                    onChange={(e) => setCvssAV(e.target.value as typeof cvssAV)}
                    className="w-full p-2 rounded-lg bg-black/50 border border-white/15 text-white"
                  >
                    <option value="N">Network (N)</option>
                    <option value="A">Adjacent (A)</option>
                    <option value="L">Local (L)</option>
                    <option value="P">Physical (P)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">Complexity (AC)</label>
                  <select
                    value={cvssAC}
                    onChange={(e) => setCvssAC(e.target.value as typeof cvssAC)}
                    className="w-full p-2 rounded-lg bg-black/50 border border-white/15 text-white"
                  >
                    <option value="L">Low (L)</option>
                    <option value="H">High (H)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">Privileges (PR)</label>
                  <select
                    value={cvssPR}
                    onChange={(e) => setCvssPR(e.target.value as typeof cvssPR)}
                    className="w-full p-2 rounded-lg bg-black/50 border border-white/15 text-white"
                  >
                    <option value="N">None (N)</option>
                    <option value="L">Low (L)</option>
                    <option value="H">High (H)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">User Interact (UI)</label>
                  <select
                    value={cvssUI}
                    onChange={(e) => setCvssUI(e.target.value as typeof cvssUI)}
                    className="w-full p-2 rounded-lg bg-black/50 border border-white/15 text-white"
                  >
                    <option value="N">None (N)</option>
                    <option value="R">Required (R)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">Confidentiality (C)</label>
                  <select
                    value={cvssC}
                    onChange={(e) => setCvssC(e.target.value as typeof cvssC)}
                    className="w-full p-2 rounded-lg bg-black/50 border border-white/15 text-white"
                  >
                    <option value="H">High (H)</option>
                    <option value="L">Low (L)</option>
                    <option value="N">None (N)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">Integrity (I)</label>
                  <select
                    value={cvssI}
                    onChange={(e) => setCvssI(e.target.value as typeof cvssI)}
                    className="w-full p-2 rounded-lg bg-black/50 border border-white/15 text-white"
                  >
                    <option value="H">High (H)</option>
                    <option value="L">Low (L)</option>
                    <option value="N">None (N)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">Availability (A)</label>
                  <select
                    value={cvssA}
                    onChange={(e) => setCvssA(e.target.value as typeof cvssA)}
                    className="w-full p-2 rounded-lg bg-black/50 border border-white/15 text-white"
                  >
                    <option value="H">High (H)</option>
                    <option value="L">Low (L)</option>
                    <option value="N">None (N)</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end">
                  <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-center font-bold text-emerald-300">
                    {cvssResult.severity} ({cvssResult.score})
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-2xl border border-white/15 bg-white/[0.03] space-y-3">
              <h3 className="font-bold text-base text-white">📝 بيانات تقرير HackerOne / Google VRP</h3>
              <input
                type="text"
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                placeholder="عنوان التقرير"
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-sm text-white"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={reportProgram}
                  onChange={(e) => setReportProgram(e.target.value)}
                  placeholder="اسم البرنامج"
                  className="px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-sm text-white"
                />
                <input
                  dir="ltr"
                  type="text"
                  value={reportAsset}
                  onChange={(e) => setReportAsset(e.target.value)}
                  placeholder="الرابط أو الأصل المصاب"
                  className="px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-sm font-mono text-white"
                />
              </div>
              <textarea
                rows={3}
                value={reportSummary}
                onChange={(e) => setReportSummary(e.target.value)}
                placeholder="ملخص الثغرة..."
                className="w-full p-3 rounded-xl bg-black/40 border border-white/15 text-xs text-white"
              />
              <textarea
                rows={4}
                value={reportSteps}
                onChange={(e) => setReportSteps(e.target.value)}
                placeholder="خطوات التحقق الآمن..."
                className="w-full p-3 rounded-xl bg-black/40 border border-white/15 text-xs text-white"
              />
              <textarea
                rows={2}
                value={reportFix}
                onChange={(e) => setReportFix(e.target.value)}
                placeholder="الحل البرمجي المقترح..."
                className="w-full p-3 rounded-xl bg-black/40 border border-white/15 text-xs text-white"
              />
            </div>
          </div>

          {/* Markdown Output */}
          <div className="lg:col-span-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-white">📄 التقرير الجاهز للنسخ والتقديم (Markdown)</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(markdownReport);
                  setCopiedReport(true);
                  setTimeout(() => setCopiedReport(false), 2000);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedReport ? "✓ تم النسخ!" : "نسخ التقرير بالكامل"}</span>
              </button>
            </div>
            <pre
              dir="ltr"
              className="p-5 rounded-2xl bg-[#090612] border border-white/15 text-xs font-mono text-emerald-100 overflow-x-auto whitespace-pre-wrap leading-relaxed min-h-[480px]"
            >
              {markdownReport}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
