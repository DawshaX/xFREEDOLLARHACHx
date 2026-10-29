import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Shield, ShieldCheck, BookOpen, Code, CheckSquare, FileText, Globe, AlertTriangle,
  CheckCircle2, Copy, Download, Search, Sparkles, Lock, Layers, Server,
  ExternalLink, Terminal, ChevronRight, RefreshCw, Plus, Trash2, Award,
  Radio, Save, Target, Zap, Database, Activity, Cpu, Clock, Play,
} from "lucide-react";
import { emitPlatformWsEvent, useWebSocket } from "@/hooks/useWebSocket";
import { jsonRequest } from "@/lib/sse";
import { resolveStandaloneApi } from "@/lib/standalone-api";

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
    id: "sky-vuln-02",
    titleAr: "[مكتشفة ومحفوظة 🏆] انغلاق سحب السيولة ثنائي الاتجاه (0.1% Two-Sided Slippage Pincer — Sky $30.00M GROVE_PAU_PROXY)",
    titleEn: "[Discovered & Verified] Unprivileged Two-Sided 0.1% Slippage Pincer in UniswapV3Facet.removeLiquidity ($30.00M GROVE_PAU_PROXY)",
    cwe: "CWE-682 / CWE-400",
    owasp: "SC03:2025 — Logic Errors & Improper Slippage Calculation",
    severity: "High",
    cvssBase: 7.5,
    bountyRange: "$1,000 – $30,000+ (Sky Immunefi — Saved in Vault)",
    summaryAr:
      "ثغرة منطقية رياضية مكتشفة ومثبتة بـ 4 اختبارات Foundry على فورك الشبكة الحية في عقد UniswapV3Facet (0x445D9Dc752F269Be48250f1A180CAC4c61cE4bab) التابع لبروتوكول Sky، تؤدي إلى تعطيل وتجميد مؤقت لسحب سيولة مركز GROVE_PAU_PROXY الحي البالغ $30,004,359.92 USD (#1352494) بمجرد تحرك السعر بمقدار 2 ticks فقط.",
    rootCauseAr:
      "دالة removeLiquidity تحسب المبالغ المتوقعة عند سعر TWAP (600s) ثم تفرض بعد السحب الفعلي شرطاً عكسياً علويّاً: require(minAmounts[i] * WAD / amount >= maxSlippage). هذا الشرط مع الحد الأدنى القياسي يخلق نافذة سحب ثنائية الاتجاه بعرض 0.1% فقط (min <= actual <= min / 0.999) يستحيل تحققها للعملتين معاً عند تحرك السعر 2 ticks عبر النطاق [-10, 10].",
    language: "Solidity 0.8.24 (diamond-pau)",
    vulnerableCode: `// ❌ كود ضعيف (UniswapV3Facet.sol الأسطر 314-340): يفرض حداً أعلى عكسياً بعد السحب!
uint256[2] memory expectedAmounts = _calculateExpectedAmountsForLiquidity(poolData, params.liquidity);
uint256 maxSlippage = UniswapV3Controller(address(this)).getMaxSlippage(params.tokenId);
uint256[2] memory minAmounts = [expectedAmounts[0] * maxSlippage / WAD, expectedAmounts[1] * maxSlippage / WAD];

(amount0, amount1) = UniswapV3NonfungiblePositionManager(nonfungiblePositionManager).decreaseLiquidity(
    UniswapV3NonfungiblePositionManager.DecreaseLiquidityParams({
        tokenId: params.tokenId,
        liquidity: params.liquidity,
        amount0Min: minAmounts[0],
        amount1Min: minAmounts[1],
        deadline: block.timestamp
    })
);
// ❌ كماشة 0.1%: إذا زاد أحد التوكنين بأكثر من 0.1% بسبب تحرك 2 ticks، تفشل المعاملة بالكامل!
require(
    (minAmounts[0] == 0 || minAmounts[0] * WAD / amount0 >= maxSlippage) &&
    (minAmounts[1] == 0 || minAmounts[1] * WAD / amount1 >= maxSlippage),
    "UniswapV3Facet/excessive-slippage"
);`,
    secureCode: `// ✅ كود آمن: إزالة الشرط العلوي العكسي والاكتفاء بالحد الأدنى القياسي المشتق من TWAP
uint256[2] memory expectedAmounts = _calculateExpectedAmountsForLiquidity(poolData, params.liquidity);
uint256 maxSlippage = UniswapV3Controller(address(this)).getMaxSlippage(params.tokenId);
uint256[2] memory minAmounts = [expectedAmounts[0] * maxSlippage / WAD, expectedAmounts[1] * maxSlippage / WAD];

// ✅ decreaseLiquidity نفسها تضمن: amount0 >= minAmounts[0] && amount1 >= minAmounts[1]
(amount0, amount1) = UniswapV3NonfungiblePositionManager(nonfungiblePositionManager).decreaseLiquidity(
    UniswapV3NonfungiblePositionManager.DecreaseLiquidityParams({
        tokenId: params.tokenId,
        liquidity: params.liquidity,
        amount0Min: minAmounts[0],
        amount1Min: minAmounts[1],
        deadline: block.timestamp
    })
);`,
    auditChecklist: [
      "فحص جميع معادلات الانزلاق السعري (Slippage Checks) للتأكد من عدم قلب البسط والمقام (min * WAD / actual vs actual * WAD / expected).",
      "التحقق من سلوك المجمعات المركزة ضيقة النطاق (مثل [-10, 10]) عند اختلاف السعر الفوري (Spot Tick) عن متوسط السعر الزمني (TWAP Tick) بمقدار 1-2 ticks.",
      "اختبار الدالة على فورك الشبكة الحية على المراكز الفعلية المنشورة (مثل GROVE_PAU_PROXY Token #1352494 بقيمة $30.00M).",
      "مراجعة التقرير الكامل في audit/sky-immunefi/IMMUNEFI_SUBMISSION_REPORT_UNISWAP_V3_FACET.md وكود الإثبات PoC_UniswapV3_Bypass.t.sol.",
    ],
    remediationSteps: [
      "حذف شرط require العلوي العكسي من دالة removeLiquidity في UniswapV3Facet.sol.",
      "توحيد منطق التحقق من الانزلاق السعري مع CurveFacet.sol الذي يتحقق من الحد الأدنى فقط.",
      "إضافة فحص maxSlippage المفقود في عقد UniswapV4Facet.sol المنشور في PAU_BEACON.",
    ],
  },
  {
    id: "sky-vuln-01",
    titleAr: "[مكتشفة ومحفوظة 🏆] تجاوز فحص TWAP عبر فصل متغير target عن expectedAmounts في UniswapV3Facet.addLiquidity",
    titleEn: "[Discovered & Verified] TWAP Slippage Check Bypass & Upper-Bound DoS in UniswapV3Facet.addLiquidity",
    cwe: "CWE-682 / CWE-20",
    owasp: "SC03:2025 — Improper Parameter Validation in AMM Facet",
    severity: "Medium",
    cvssBase: 6.5,
    bountyRange: "Coupled in Sky UniswapV3Facet Report (Saved in Vault)",
    summaryAr:
      "خلل معماري في دالة addLiquidity داخل UniswapV3Facet يسمح بانفصال المبالغ الممررة إلى Uniswap V3 (params.target) عن المبالغ المحسوبة من سعر الـ TWAP (expectedAmounts)، مما يتيح تجاوز فحص الانزلاق السعري أو التسبب في فشل الإيداع عندما يتحرك السعر لصالح البروتوكول.",
    rootCauseAr:
      "دالة _calculateExpectedAmountsForLiquidity تحسب السيولة من params.maxAmounts عند سعر TWAP ثم تعيد تحويلها إلى expectedAmounts عند نفس سعر TWAP، بينما يتم تمرير params.target غير المفحوص كـ amount0Desired وamount1Desired.",
    language: "Solidity 0.8.24 (diamond-pau)",
    vulnerableCode: `// ❌ كود ضعيف: يحسب expectedAmounts من maxAmounts بينما يمرر params.target إلى Uniswap V3!
uint256[2] memory expectedAmounts = _calculateExpectedAmountsForLiquidity(poolData, params.maxAmounts);
uint256 maxSlippage = UniswapV3Controller(address(this)).getMaxSlippage(params.tokenId);
uint256[2] memory minAmounts = [expectedAmounts[0] * maxSlippage / WAD, expectedAmounts[1] * maxSlippage / WAD];
// يمرر params.target[0] و params.target[1] دون التحقق من علاقتهما بـ expectedAmounts!`,
    secureCode: `// ✅ كود آمن: تمرير expectedAmounts المحسوبة من TWAP مباشرة كـ amount0Desired/amount1Desired
uint256[2] memory expectedAmounts = _calculateExpectedAmountsForLiquidity(poolData, params.maxAmounts);
uint256 maxSlippage = UniswapV3Controller(address(this)).getMaxSlippage(params.tokenId);
uint256[2] memory minAmounts = [expectedAmounts[0] * maxSlippage / WAD, expectedAmounts[1] * maxSlippage / WAD];
// استخدام expectedAmounts[0] و expectedAmounts[1] كـ Desired Amounts`,
    auditChecklist: [
      "التحقق من ارتباط جميع المعاملات الداخلة لدوال AMM (target, maxAmounts, minAmounts) ببعضها رياضياً.",
      "تشغيل اختبارات test_PoC1 وtest_PoC2 وtest_PoC3 في ملف PoC_UniswapV3_Bypass.t.sol.",
    ],
    remediationSteps: [
      "استخدام expectedAmounts بدلاً من params.target غير المفحوص في دوال الإيداع.",
    ],
  },
  {
    id: "cdc-note-01",
    titleAr: "[مكتشفة ومحفوظة 🏆] عقد التنفيذ LiquidETHV1 غير المهيأ (Uninitialized Implementation) لعملة CDCETH على Cronos",
    titleEn: "[Discovered on Cronos Mainnet] Uninitialized LiquidETHV1 Implementation (0xCC4b4878...757) in Crypto.com wrapped-tokens-os",
    cwe: "CWE-665",
    owasp: "SC04:2025 — Uninitialized Proxy Implementation Contract",
    severity: "Medium",
    cvssBase: 4.3,
    bountyRange: "Defense-in-Depth Architecture Note (Crypto.com HackerOne Vault)",
    summaryAr:
      "تم رصد أن عقد التنفيذ LiquidETHV1 (0xCC4b4878d64A76616c483a280fBfdBb08b705757) الخاص بعملة CDCETH على شبكة Cronos Mainnet غير مهيأ (slot[8] == 0 و slot[18] == 0) لأن سكريبت النشر استدعى transferOwnership(admin) فقط ولم يستدعِ initialize().",
    rootCauseAr:
      "في deploy_staked_token.ts السطر 104، افترض المطور أن transferOwnership(admin) كافٍ لقفل عقد الـ Implementation، ولكن دالة FiatTokenV1.initialize() عامة (public) بدون onlyOwner وتستدعي setOwner(newOwner) لتستبدل المالك بالكامل.",
    language: "Solidity 0.6.12 / TypeScript (wrapped-tokens-os)",
    vulnerableCode: `// ❌ كود ضعيف في deploy/deploy_staked_token.ts:
const liquidETHV1Implementation = await ethers.getContractAt('LiquidETHV1', liquidETHV1Deployment.address);
await (await liquidETHV1Implementation.transferOwnership(admin)).wait();
// نسي استدعاء initialize() و initializeV2() و initializeV2_1() على الـ Implementation!`,
    secureCode: `// ✅ كود آمن: تهيئة عقد الـ Implementation فوراً في سكريبت النشر أو قفله في الـ constructor
await (await liquidETHV1Implementation.initialize(
  "Crypto.com Wrapped Staked ETH", "CDCETH", "ETH", 18,
  THROWAWAY_ADDRESS, THROWAWAY_ADDRESS, THROWAWAY_ADDRESS, THROWAWAY_ADDRESS
)).wait();
await (await liquidETHV1Implementation.initializeV2(THROWAWAY_ADDRESS, 0)).wait();
await (await liquidETHV1Implementation.initializeV2_1(THROWAWAY_ADDRESS)).wait();`,
    auditChecklist: [
      "فحص slot[8] (initialized) وslot[18] (_initializedVersion) على كل من الـ Proxy والـ Implementation عبر eth_getStorageAt.",
      "التحقق مما إذا كانت دالة initialize() تحتوي على onlyOwner أم أنها متاحة للعامة (public).",
    ],
    remediationSteps: [
      "استدعاء دوال التهيئة الثلاث على العقد 0xCC4b4878d64A76616c483a280fBfdBb08b705757 على شبكة Cronos Mainnet وتحديث deploy_staked_token.ts.",
    ],
  },
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
  {
    id: "sub-takeover",
    titleAr: "الاستيلاء على النطاقات الفرعية المعلقة (Subdomain Takeover / Dangling CNAME)",
    titleEn: "Subdomain Takeover via Dangling DNS / CNAME Record",
    cwe: "CWE-284",
    owasp: "A05:2021 — Security Misconfiguration (Cloud & DNS)",
    severity: "High",
    cvssBase: 8.2,
    bountyRange: "$500 – $10,000+",
    summaryAr:
      "تحدث عندما يشير سجل DNS (مثل CNAME أو A) لنطاق فرعي تابع للهدف إلى خدمة سحابية خارجية (GitHub Pages, AWS S3, Azure, Heroku, Fastly) تم حذفها أو انتهاء اشتراكها دون حذف سجل الـ DNS.",
    rootCauseAr:
      "عدم أتمتة حذف سجلات DNS عند إيقاف أو حذف الموارد السحابية الخارجية (Orphaned DNS Records).",
    language: "DNS / Cloud Infrastructure",
    vulnerableCode: `// ❌ إعداد DNS خطر: سجل CNAME يشير إلى مورد سحابي تم حذفه
// promos.target.com.  300  IN  CNAME  target-promos-2023.s3.amazonaws.com.
// عند طلب https://promos.target.com يرجع السيرفر:
// <Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message>`,
    secureCode: `// ✅ الإجراء الآمن (DNS & Cloud Lifecycle Hygiene):
// 1. حذف سجل CNAME من DNS قبل حذف الـ Bucket أو الخدمة السحابية
// 2. ربط إدارة DNS بـ Terraform / IaC لضمان عدم بقاء أي سجل معلق
// 3. فحص دوري لبصمات can-i-take-over-xyz على كافة النطاقات الفرعية`,
    auditChecklist: [
      "جمع النطاقات الفرعية سلبياً عبر CRT.SH وSubfinder وفحص سجلات CNAME لكل نطاق.",
      "مقارنة استجابات HTTP للنطاقات الفرعية مع بصمات `EdOverflow/can-i-take-over-xyz`.",
      "عدم حجز المورد باسم عام يكشف بيانات، بل الاكتفاء بإثبات البصمة أو ملف نصي غير مرئي وفق سياسة البرنامج.",
    ],
    remediationSteps: [
      "إزالة سجل CNAME أو A المعلق من خادم DNS فوراً.",
      "مراجعة نطاق الكوكيز (`Domain=.target.com`) وقوائم `redirect_uri` في OAuth.",
    ],
  },
  {
    id: "graphql-flaws",
    titleAr: "ثغرات مخططات GraphQL وتجاوز حدود الاستعلامات (Introspection & Batching)",
    titleEn: "GraphQL Introspection Exposure, Field Suggestion & Batching Abuse",
    cwe: "CWE-200 / CWE-307",
    owasp: "API8:2023 & API4:2023 — GraphQL & API Security",
    severity: "High",
    cvssBase: 7.5,
    bountyRange: "$500 – $15,000+",
    summaryAr:
      "تحدث عندما يترك خادم GraphQL ميزة Introspection مفعلة في الإنتاج مع وجود Mutations أو حقول داخلية غير محمية بفحص صلاحيات مستقل داخل كل Resolver.",
    rootCauseAr:
      "الاعتماد على حماية واجهة REST فقط وترك عقد GraphQL الفرعية (Nested Resolvers) بدون فحص صلاحيات.",
    language: "TypeScript / GraphQL",
    vulnerableCode: `// ❌ كود ضعيف: Introspection مفعل في الإنتاج وResolver بدون فحص ملكية
const server = new ApolloServer({
  typeDefs,
  resolvers: {
    Query: {
      userPrivateNotes: (_parent, { userId }) => db.notes.findByUser(userId),
    },
  },
  introspection: true,
});`,
    secureCode: `// ✅ كود آمن: تعطيل Introspection في الإنتاج + فحص الصلاحية وتحديد عمق الاستعلام
const server = new ApolloServer({
  typeDefs,
  resolvers: {
    Query: {
      userPrivateNotes: (_parent, { userId }, context) => {
        if (!context.user || context.user.id !== userId) throw new ForbiddenError("Unauthorized");
        return db.notes.findByUser(userId);
      },
    },
  },
  introspection: process.env.NODE_ENV !== "production",
  validationRules: [depthLimit(5)],
});`,
    auditChecklist: [
      "فحص ما إذا كان استعلام `__schema` متاحاً في بيئة الإنتاج.",
      "مراجعة جميع الـ Mutations والحقول الفرعية (Nested Fields) للتأكد من تطبيق نفس صلاحيات المستخدم.",
      "فحص حدود عمق الاستعلام (Query Depth) وعدد الاستعلامات المجمعة (Batching / Aliases).",
    ],
    remediationSteps: [
      "تعطيل `introspection` في بيئة الإنتاج وتحديد أقصى عمق للاستعلام (`depthLimit`).",
      "فرض التحقق من الهوية والصلاحية داخل كل Resolver أو عبر Directive موحد.",
    ],
  },
  {
    id: "oauth-oidc-flaws",
    titleAr: "ثغرات تدفقات OAuth 2.0 / OIDC والتلاعب بـ redirect_uri و state",
    titleEn: "OAuth 2.0 / OIDC redirect_uri Manipulation & Missing CSRF State",
    cwe: "CWE-601 / CWE-352",
    owasp: "A07:2021 — Identification and Authentication Failures",
    severity: "Critical",
    cvssBase: 9.1,
    bountyRange: "$2,000 – $50,000+",
    summaryAr:
      "تحدث عندما يقبل مزود الهوية (OAuth Provider) عناوين إعادة توجيه (`redirect_uri`) غير مطابقة بدقة (مثل السماح بأي مسار أو نطاق فرعي) أو يغفل التحقق من معامل `state` العشوائي.",
    rootCauseAr:
      "استخدام Regex أو `startsWith` ضعيف للتحقق من `redirect_uri` بدلاً من المطابقة الكاملة للقائمة البيضاء.",
    language: "TypeScript / OAuth 2.0",
    vulnerableCode: `// ❌ كود ضعيف: مطابقة جزئية تسمح بـ https://app.example.com.attacker.com
if (req.query.redirect_uri.startsWith("https://app.example.com")) {
  return res.redirect(\`\${req.query.redirect_uri}?code=\${authCode}\`);
}`,
    secureCode: `// ✅ كود آمن: مطابقة نصية دقيقة (Exact Match) مع فرض PKCE ومعامل state
const ALLOWED_REDIRECTS = new Set(["https://app.example.com/oauth/callback"]);
if (!ALLOWED_REDIRECTS.has(String(req.query.redirect_uri))) {
  return res.status(400).json({ error: "Invalid redirect_uri" });
}
if (!req.query.state || req.query.state !== req.session.oauthState) {
  return res.status(400).json({ error: "Invalid OAuth state" });
}`,
    auditChecklist: [
      "التحقق من وجود معامل `state` عشوائي ومرتبط بجلسة المتصفح لمنع ربط الحسابات قسرياً (Account Linking CSRF).",
      "اختبار مطابقة `redirect_uri` باستخدام حساباتك الاختبارية فقط للتأكد من رفض النطاقات غير المسجلة.",
      "التأكد من استخدام `PKCE (code_challenge)` وعدم إرسال التوكن في `URL Fragment` عند توفر بديل آمن.",
    ],
    remediationSteps: [
      "اعتماد المطابقة الكاملة (Exact String Match) لعناوين `redirect_uri` المسجلة مسبقاً.",
      "إلزامية `state` و `PKCE (S256)` في جميع تدفقات OAuth 2.0.",
    ],
  },
  {
    id: "llm-prompt-agency",
    titleAr: "ثغرات تطبيقات الذكاء الاصطناعي والوكلاء (OWASP LLM01 & LLM06: Excessive Agency)",
    titleEn: "OWASP LLM Top 10 (2025/2026): Indirect Prompt Injection & Excessive Agency",
    cwe: "CWE-77 / OWASP-LLM01",
    owasp: "OWASP LLM01:2025 & LLM06:2025 — AI / LLM Security",
    severity: "Critical",
    cvssBase: 9.0,
    bountyRange: "$1,000 – $50,000+ (Google AI VRP / OpenAI / MSRC)",
    summaryAr:
      "تحدث عندما يقوم وكيل ذكاء اصطناعي (AI Agent) بقراءة بيانات غير موثوقة (صفحة ويب، بريد، ملف، تعليق) وتنفيذ أوامر أو استدعاء أدوات (Tool Calls / APIs) بصلاحيات المستخدم دون تأكيد بشري أو عزل للصلاحيات.",
    rootCauseAr:
      "دمج البيانات الخارجية غير الموثوقة مباشرة في سياق التعليمات مع منح الوكيل صلاحيات كتابة أو تنفيذ غير مقيدة.",
    language: "TypeScript / AI Agent Tooling",
    vulnerableCode: `// ❌ كود ضعيف: السماح للنموذج باستدعاء أداة حساسة تلقائياً بناءً على نص خارجي غير موثوق
const llmDecision = await model.generate({
  system: "You are a helpful assistant with access to deleteAccount and sendEmail tools.",
  prompt: \`Summarize this external webpage: \${untrustedWebpageContent}\`,
});
if (llmDecision.toolCall) await executeToolDirectly(llmDecision.toolCall);`,
    secureCode: `// ✅ كود آمن: فصل البيانات عن التعليمات + بوابة موافقة بشرية (Human-in-the-Loop) للأدوات الحساسة
const SAFE_READONLY_TOOLS = new Set(["getWeather", "searchDocs"]);
if (llmDecision.toolCall && !SAFE_READONLY_TOOLS.has(llmDecision.toolCall.name)) {
  return res.status(202).json({
    requiresUserConfirmation: true,
    proposedAction: llmDecision.toolCall.name,
  });
}`,
    auditChecklist: [
      "فحص الأدوات (Tools / Plugins) المتاحة لوكيل الذكاء الاصطناعي والتأكد من تطبيق مبدأ أقل الصلاحيات.",
      "اختبار ما إذا كان المحتوى المسترجع عبر RAG يحترم صلاحيات المستخدم الحالي (Document-Level ACL).",
      "التحقق من عدم تسريب مفاتيح النظام أو بيانات مستخدمين آخرين في مخرجات النموذج.",
    ],
    remediationSteps: [
      "فرض موافقة المستخدم الصريحة (Human-in-the-Loop) قبل أي عملية تغيير حالة أو إرسال بيانات للخارج.",
      "تطبيق صلاحيات المستخدم الحالي (User-Scoped OAuth Token) عند استدعاء أي API من داخل الوكيل.",
    ],
  },
  {
    id: "mass-assignment-bopla",
    titleAr: "التعيين الجماعي للحقول وتجاوز صلاحيات الخصائص (Mass Assignment / BOPLA)",
    titleEn: "Broken Object Property Level Authorization (BOPLA / Mass Assignment)",
    cwe: "CWE-915",
    owasp: "API3:2023 — Broken Object Property Level Authorization",
    severity: "High",
    cvssBase: 8.3,
    bountyRange: "$750 – $20,000+",
    summaryAr:
      "تحدث عندما يمرر الخادم كائن JSON المرسل من المستخدم (`req.body`) مباشرة إلى دالة التحديث في قاعدة البيانات (`update / create`) دون تصفية الحقول الحساسة مثل `role` أو `isAdmin` أو `balance`.",
    rootCauseAr:
      "الربط التلقائي لخصائص الكائن (Auto-binding / Object Spread) في ORM بدون استخدام DTO يحدد الحقول المسموحة.",
    language: "TypeScript / Prisma / Mongoose",
    vulnerableCode: `// ❌ كود ضعيف: تمرير req.body بالكامل إلى قاعدة البيانات
app.patch("/api/v1/users/me", requireAuth, async (req, res) => {
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: req.body, // يسمح بتمرير { "role": "admin", "credits": 99999 }
  });
  res.json(updated);
});`,
    secureCode: `// ✅ كود آمن: انتقاء الحقول المسموح للمستخدم بتعديلها فقط عبر مخطط Zod صارم
const UpdateProfileSchema = z.object({
  displayName: z.string().min(2).max(60),
  bio: z.string().max(300).optional(),
}).strict();

app.patch("/api/v1/users/me", requireAuth, async (req, res) => {
  const safeData = UpdateProfileSchema.parse(req.body);
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: safeData,
  });
  res.json(updated);
});`,
    auditChecklist: [
      "مقارنة الحقول المعادة في استجابة `GET /api/v1/users/me` مع الحقول المقبولة في `PATCH / PUT`.",
      "فحص مخططات OpenAPI/GraphQL لاكتشاف الحقول الداخلية المتعلقة بالأدوار أو الفوترة.",
    ],
    remediationSteps: [
      "استخدام Allowlist DTO صريح لكل نقطة نهاية وعدم تمرير `req.body` مباشرة للـ ORM.",
      "فصل نماذج القراءة عن نماذج التحديث وتحديد الحقول المسموح إرجاعها في الاستجابة (`select`).",
    ],
  },
  {
    id: "postmessage-websocket",
    titleAr: "ثغرات رسائل المتصفح والويب سوكيت (Insecure postMessage & CSWSH)",
    titleEn: "DOM postMessage Origin Bypass & Cross-Site WebSocket Hijacking",
    cwe: "CWE-346 / CWE-1385",
    owasp: "A01:2021 & Client-Side Security",
    severity: "High",
    cvssBase: 8.0,
    bountyRange: "$500 – $15,000+",
    summaryAr:
      "تحدث عندما يستقبل تطبيق الواجهة رسائل `window.addEventListener('message', ...)` بدون التحقق الصارم من `event.origin` أو عندما يقبل خادم WebSocket اتصالات معتمدة على الكوكيز بدون التحقق من ترويسة `Origin`.",
    rootCauseAr:
      "غياب التحقق من `event.origin` في JavaScript أو إرسال رسائل حساسة عبر `postMessage(..., '*')`.",
    language: "TypeScript / Browser & WebSocket",
    vulnerableCode: `// ❌ كود ضعيف: استقبال أي رسالة من أي نافذة وتنفيذ محتواها بدون فحص event.origin
window.addEventListener("message", (event) => {
  if (event.data?.type === "SET_AUTH_TOKEN") {
    localStorage.setItem("token", event.data.token);
    location.href = event.data.redirectUrl;
  }
});`,
    secureCode: `// ✅ كود آمن: التحقق الصارم من النطاق المرسل (Origin Allowlist) قبل معالجة الرسالة
const TRUSTED_ORIGINS = new Set(["https://auth.example.com"]);
window.addEventListener("message", (event) => {
  if (!TRUSTED_ORIGINS.has(event.origin)) return;
  if (event.data?.type === "SET_AUTH_TOKEN" && typeof event.data.token === "string") {
    sessionStorage.setItem("token", event.data.token);
  }
});`,
    auditChecklist: [
      "البحث عن جميع مستمعات `addEventListener('message')` في حزم الـ JavaScript.",
      "التأكد من عدم إرسال توكنات المصادقة عبر `targetWindow.postMessage(secret, '*')`.",
      "التحقق من فحص ترويسة `Origin` عند ترقية اتصال `WebSocket` (`HTTP 101 Switching Protocols`).",
    ],
    remediationSteps: [
      "فرض مطابقة صارمة لـ `event.origin` مع قائمة النطاقات الموثوقة.",
      "تحديد النطاق الهدف صراحةً عند استدعاء `postMessage(data, 'https://trusted.example.com')`.",
    ],
  },
  {
    id: "http-request-smuggling",
    titleAr: "تهريب طلبات HTTP وتعارض الحافة والخلفية (HTTP Request Smuggling / H2.CL)",
    titleEn: "HTTP/1.1 & HTTP/2 Request Smuggling Desynchronization (CL.TE / TE.CL / H2.CL)",
    cwe: "CWE-444",
    owasp: "A05:2021 — Protocol & Reverse Proxy Desync",
    severity: "Critical",
    cvssBase: 9.1,
    bountyRange: "$2,500 – $50,000+",
    summaryAr:
      "تحدث عندما يختلف خادم الحافة (CDN / Reverse Proxy) عن الخادم الخلفي (Backend) في تحديد نهاية طلب HTTP بسبب تعارض `Content-Length` و`Transfer-Encoding` أو عند خفض اتصال `HTTP/2` إلى `HTTP/1.1`.",
    rootCauseAr:
      "قبول ترويسات متعارضة في نفس الطلب أو إعادة استخدام اتصالات `HTTP/1.1 Keep-Alive` الخلفية بدون تطبيع صارم.",
    language: "Nginx / Reverse Proxy / HTTP",
    vulnerableCode: `# ❌ إعداد ضعيف: خفض HTTP/2 إلى HTTP/1.1 بدون تطبيع الترويسات
location / {
  proxy_pass http://backend_upstream;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
}`,
    secureCode: `# ✅ إعداد آمن: استخدام HTTP/2 من الطرف للطرف ورفض الطلبات ذات الترويسات الغامضة
http {
  ignore_invalid_headers on;
  underscores_in_headers off;
  # رفض أي طلب يجمع بين Content-Length و Transfer-Encoding وفق RFC 9112
}`,
    auditChecklist: [
      "التحقق مما إذا كان خادم الحافة يقبل HTTP/2 ويحوله إلى HTTP/1.1 في الخلفية.",
      "استخدام فحوصات زمنية آمنة أو اتصالات خاصة بك فقط دون التأثير على طلبات المستخدمين الآخرين.",
    ],
    remediationSteps: [
      "تفعيل HTTP/2 من الطرف إلى الطرف (End-to-End HTTP/2) بين الموازن والخادم الخلفي.",
      "رفض أي طلب يحتوي على `Content-Length` و`Transfer-Encoding` معاً.",
    ],
  },
  {
    id: "web-cache-poisoning",
    titleAr: "تسميم الكاش عبر الترويسات غير المفهرسة (Web Cache Poisoning)",
    titleEn: "Web Cache Poisoning via Unkeyed Headers & Parameter Cloaking",
    cwe: "CWE-444",
    owasp: "A05:2021 — CDN & Caching Security",
    severity: "High",
    cvssBase: 8.3,
    bountyRange: "$1,500 – $30,000+",
    summaryAr:
      "تحدث عندما يقرأ الخادم الخلفي ترويسة غير داخلة في مفتاح الكاش (مثل `X-Forwarded-Host` أو `X-Forwarded-Scheme`) ويعكس قيمتها داخل روابط ملفات JS أو التوجيهات في استجابة يتم تخزينها في الـ CDN.",
    rootCauseAr:
      "اعتماد التطبيق على ترويسات `X-Forwarded-*` لبناء الروابط المطلقة دون تضمين تلك الترويسات في مفتاح الكاش (`Vary` / Cache Key).",
    language: "Express / CDN Config",
    vulnerableCode: `// ❌ كود ضعيف: بناء رابط السكربت بالاعتماد على X-Forwarded-Host غير المفهرس في الكاش
app.get("/home", (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  res.setHeader("Cache-Control", "public, max-age=600");
  res.send(\`<script src="https://\${host}/static/app.js"></script>\`);
});`,
    secureCode: `// ✅ كود آمن: الاعتماد على نطاق ثابت من إعدادات البيئة واستخدام مسارات نسبية
app.get("/home", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=600");
  res.send(\`<script src="/static/app.js"></script>\`);
});`,
    auditChecklist: [
      "إضافة معامل `Cache-Buster` فريد دائماً (`?cb=mytest123`) أثناء الفحص لضمان عدم تخزين أي تجربة في الكاش العام.",
      "فحص ترويسات `X-Cache` و`CF-Cache-Status` و`Age` ومقارنة سلوك الكاش مع الخادم الخلفي.",
    ],
    remediationSteps: [
      "استخدام المسارات النسبية (`/static/app.js`) وتجاهل ترويسات `X-Forwarded-Host` غير الموثوقة.",
      "تضمين أي ترويسة مؤثرة في محتوى الصفحة داخل ترويسة `Vary`.",
    ],
  },
  {
    id: "web-cache-deception",
    titleAr: "خداع الكاش لتخزين الصفحات الخاصة (Web Cache Deception)",
    titleEn: "Web Cache Deception via Path Normalization & Static Suffixes",
    cwe: "CWE-525",
    owasp: "A05:2021 — Caching & Session Privacy",
    severity: "High",
    cvssBase: 7.7,
    bountyRange: "$1,000 – $15,000+",
    summaryAr:
      "تحدث عندما يتعامل الخادم الخلفي مع المسار `/api/account/profile/style.css` كأنه `/api/account/profile` ويرجع البيانات الشخصية، بينما يقوم الـ CDN بتخزين الاستجابة لأنها تنتهي بـ `.css`.",
    rootCauseAr:
      "قواعد تخزين في الـ CDN تعتمد على امتداد الرابط فقط مع تجاهل ترويسات `Cache-Control` أو غياب `no-store` على المسارات الديناميكية.",
    language: "HTTP / CDN Rules",
    vulnerableCode: `// ❌ كود ضعيف: مسار يقبل لاحقات إضافية وبدون ترويسة منع التخزين
app.get("/account/profile*", requireAuth, (req, res) => {
  res.json({ email: req.user.email, apiKey: req.user.apiKey });
});`,
    secureCode: `// ✅ كود آمن: مطابقة دقيقة للمسار + فرض Cache-Control: no-store, private
app.get("/account/profile", requireAuth, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, private, must-revalidate");
  res.json({ email: req.user.email });
});`,
    auditChecklist: [
      "اختبار المسارات المصادق عليها على حسابك التجريبي فقط بإضافة `/test.css` أو `/.js` ومراقبة ترويسة `CF-Cache-Status`.",
      "التحقق من وجود `Cache-Control: no-store, private` على جميع استجابات الـ API الخاصة.",
    ],
    remediationSteps: [
      "إرسال `Cache-Control: no-store, private` على كافة الصفحات المعتمدة على جلسة المستخدم.",
      "ضبط الـ CDN ليحترم ترويسات `Cache-Control` الصادرة من الخادم الأصلي.",
    ],
  },
  {
    id: "saml-xsw-bypass",
    titleAr: "تجاوز توقيع الدخول الموحد في SAML 2.0 (XML Signature Wrapping)",
    titleEn: "SAML 2.0 XML Signature Wrapping (XSW) & Canonicalization Bypass",
    cwe: "CWE-347",
    owasp: "A07:2021 — Enterprise SSO Authentication",
    severity: "Critical",
    cvssBase: 9.3,
    bountyRange: "$5,000 – $40,000+",
    summaryAr:
      "تحدث عندما يتحقق مكتبة SAML من صحة التوقيع الرقمي على عنصر `<Assertion>` الأصلي، بينما يقرأ كود التطبيق اسم المستخدم (`NameID`) من عنصر `<Assertion>` آخر غير موقع داخل نفس ملف الـ XML.",
    rootCauseAr:
      "البحث عن عنصر `NameID` عبر استعلام XPath عام (`//NameID`) بدلاً من قراءته حصرياً من العنصر الذي تم التحقق من توقيعه.",
    language: "TypeScript / SAML XML",
    vulnerableCode: `// ❌ كود ضعيف: التحقق من التوقيع ثم قراءة أول عنصر NameID في الوثيقة
if (verifyXmlSignature(xmlDoc, idpCert)) {
  const email = xmlDoc.getElementsByTagName("NameID")[0].textContent;
  loginUser(email);
}`,
    secureCode: `// ✅ كود آمن: استخراج البيانات حصرياً من العقدة الموقعة بعد التحقق من مخطط XSD وتعطيل DTD
const verifiedAssertion = verifyAndExtractSignedAssertion(xmlDoc, idpCert, {
  disallowDoctype: true,
  strictAudience: "https://sp.example.com/saml/metadata",
});
loginUser(verifiedAssertion.subjectNameId);`,
    auditChecklist: [
      "التأكد من تعطيل الكيانات الخارجية (`XXE / DOCTYPE`) في محلل XML الخاص بـ SAML.",
      "التحقق من مطابقة `Audience` و`Recipient` و`NotOnOrAfter` ومنع إعادة إرسال نفس الـ `Assertion ID`.",
    ],
    remediationSteps: [
      "اعتماد مكتبات SAML حديثة تعزل العقدة الموقعة تماماً وترفض أي عناصر إضافية غير متوقعة.",
      "تخزين معرفات `Assertion ID` لمنع هجمات الإعادة (Replay Attacks).",
    ],
  },
  {
    id: "webauthn-passkey-flaws",
    titleAr: "عيوب التحقق من النطاق في مفاتيح المرور (WebAuthn / Passkey RP Bypass)",
    titleEn: "WebAuthn / FIDO2 Passkey Relying Party & Origin Validation Flaws",
    cwe: "CWE-287",
    owasp: "A07:2021 — Modern Passwordless Authentication",
    severity: "High",
    cvssBase: 8.4,
    bountyRange: "$3,000 – $25,000+",
    summaryAr:
      "تحدث عندما يغفل الخادم أثناء تسجيل أو التحقق من مفتاح المرور (Passkey) فحص تطابق `clientDataJSON.origin` مع النطاق الرسمي أو لا يتحقق من تجزئة `rpIdHash` في بيانات المصادق.",
    rootCauseAr:
      "الاكتفاء بالتحقق من التوقيع التشفيري للمفتاح العام دون التحقق من بيانات السياق (`origin`, `challenge`, `rpIdHash`, `userVerified`).",
    language: "TypeScript / WebAuthn",
    vulnerableCode: `// ❌ كود ضعيف: التحقق من التوقيع فقط وتجاهل فحص النطاق (Origin) والتحدي (Challenge)
const isValid = verifySignature(credential.response.signature, publicKey);
if (isValid) createSession(user);`,
    secureCode: `// ✅ كود آمن: التحقق الكامل من Origin وRP ID والتحدي المخزن في الجلسة
const verification = await verifyAuthenticationResponse({
  response: credential,
  expectedChallenge: req.session.currentChallenge,
  expectedOrigin: "https://login.example.com",
  expectedRPID: "example.com",
  requireUserVerification: true,
});`,
    auditChecklist: [
      "التأكد من أن التحدي (`challenge`) عشوائي، مرتبط بالجلسة، ويُستهلك لمرة واحدة فقط.",
      "التحقق من رفض أي `origin` ينتمي لنطاق فرعي غير مصرح له.",
    ],
    remediationSteps: [
      "استخدام مكتبات قياسية مثل `@simplewebauthn/server` مع تحديد `expectedOrigin` و`expectedRPID` بدقة.",
    ],
  },
  {
    id: "cicd-actions-injection",
    titleAr: "حقن أنابيب CI/CD واستغلال pull_request_target في GitHub Actions",
    titleEn: "CI/CD Pipeline Expression Injection & pull_request_target Taint",
    cwe: "CWE-829",
    owasp: "A08:2021 — Software & Data Integrity Failures",
    severity: "Critical",
    cvssBase: 9.2,
    bountyRange: "$2,000 – $30,000+",
    summaryAr:
      "تحدث عندما يستخدم ملف Workflow حدث `pull_request_target` (الذي يمتلك صلاحية الوصول للأسرار `secrets` وتوكن الكتابة) ويقوم بسحب وتشغيل كود من طلب سحب خارجي، أو يدمج `${{ github.event.pull_request.title }}` مباشرة داخل أمر `run:`.",
    rootCauseAr:
      "تقييم تعبيرات `${{ ... }}` قبل تنفيذ سكريبت الـ Shell، أو منح صلاحيات مستودع كاملة لكود خارجي لم تتم مراجعته.",
    language: "YAML / GitHub Actions",
    vulnerableCode: `# ❌ ملف Workflow خطر: حقن أوامر عبر عنوان الـ PR مباشرة في Shell
on: [pull_request_target]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Testing PR: \${{ github.event.pull_request.title }}"`,
    secureCode: `# ✅ ملف Workflow آمن: استخدام متغيرات البيئة (env:) وصلاحيات قراءة فقط
on: [pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - env:
          PR_TITLE: \${{ github.event.pull_request.title }}
        run: echo "Testing PR: $PR_TITLE"`,
    auditChecklist: [
      "فحص ملفات `.github/workflows/*.yml` باستخدام أداة `zizmor` لاكتشاف استخدام `pull_request_target`.",
      "التأكد من تحديد `permissions: contents: read` كإعداد افتراضي في جميع الـ Workflows.",
    ],
    remediationSteps: [
      "تمرير أي مدخلات قادمة من الحدث (`github.event.*`) عبر متغيرات بيئة `env:` وعدم وضعها داخل `run:` مباشرة.",
      "تثبيت إصدارات الـ Actions الخارجية باستخدام بصمة الـ Commit الكاملة (SHA-256 Pinning).",
    ],
  },
  {
    id: "xxe-xml-parser",
    titleAr: "حقن الكيانات الخارجية في محللات XML وملفات SVG/DOCX (XXE)",
    titleEn: "XML External Entity (XXE) Injection in XML, SOAP, SVG & Office Parsers",
    cwe: "CWE-611",
    owasp: "A05:2021 — Security Misconfiguration",
    severity: "High",
    cvssBase: 8.6,
    bountyRange: "$1,500 – $25,000+",
    summaryAr:
      "تحدث عندما يقوم الخادم بتحليل ملفات XML أو صور SVG أو مستندات DOCX/XLSX مع ترك ميزة تعريفات `DOCTYPE` والكيانات الخارجية (`SYSTEM / PUBLIC`) مفعلة في المحلل.",
    rootCauseAr:
      "الإعدادات الافتراضية القديمة لبعض محللات XML التي تسمح بجلب ملفات محلية أو روابط شبكة أثناء التحليل.",
    language: "Python / Java / Node.js XML",
    vulnerableCode: `# ❌ كود ضعيف: محلل XML يسمح بتحميل الكيانات الخارجية (XXE)
from lxml import etree
parser = etree.XMLParser(resolve_entities=True)
tree = etree.fromstring(user_xml_bytes, parser)`,
    secureCode: `# ✅ كود آمن: تعطيل الكيانات الخارجية والشبكة بالكامل باستخدام defusedxml
import defusedxml.ElementTree as ET
tree = ET.fromstring(user_xml_bytes)`,
    auditChecklist: [
      "فحص جميع نقاط رفع الملفات التي تقبل `SVG`, `XML`, `DOCX`, `XLSX`, أو خلاصات `RSS/Atom`.",
      "التحقق من إعدادات محلل XML في خدمات SOAP وSAML ومعالجة الفواتير الإلكترونية.",
    ],
    remediationSteps: [
      "تعطيل `DOCTYPE` و`resolve_entities` و`load_external_dtd` بشكل صريح في جميع محللات XML.",
    ],
  },
  {
    id: "bfla-vertical-authz",
    titleAr: "تجاوز صلاحيات الوظائف الإدارية (BFLA / Vertical Privilege Escalation)",
    titleEn: "Broken Function Level Authorization (BFLA / Admin Endpoint Exposure)",
    cwe: "CWE-285",
    owasp: "API5:2023 — Broken Function Level Authorization",
    severity: "Critical",
    cvssBase: 8.8,
    bountyRange: "$2,000 – $30,000+",
    summaryAr:
      "تحدث عندما تكتفي نقاط النهاية الإدارية أو الحساسة (مثل `/api/v1/admin/users/export` أو طريقة `DELETE / PUT`) بالتحقق من وجود جلسة صالحة دون التحقق من دور المستخدم (`role === 'admin'`).",
    rootCauseAr:
      "الاعتماد على إخفاء أزرار الإدارة في واجهة المستخدم (Frontend) دون تطبيق حارس صلاحيات الدور (`requireRole`) على مسارات الـ API الخلفية.",
    language: "TypeScript / Express",
    vulnerableCode: `// ❌ كود ضعيف: يتحقق من تسجيل الدخول فقط ولا يتحقق من دور المدير
app.post("/api/v1/admin/promote", requireAuth, async (req, res) => {
  await db.users.update({ where: { id: req.body.userId }, data: { role: "admin" } });
  res.json({ ok: true });
});`,
    secureCode: `// ✅ كود آمن: فرض حارس الدور الإداري (requireRole) مع تسجيل الحدث في سجل التدقيق
app.post("/api/v1/admin/promote", requireAuth, requireRole("SUPER_ADMIN"), async (req, res) => {
  await db.users.update({ where: { id: req.body.userId }, data: { role: "admin" } });
  res.json({ ok: true });
});`,
    auditChecklist: [
      "استخراج مسارات الإدارة من ملفات الـ JS واختبار استجابتها لحساب اختبار ذي صلاحية محدودة (`Viewer / Member`).",
      "اختبار تبديل طريقة الطلب من `GET` إلى `POST / PUT / DELETE` على نفس نقطة النهاية.",
    ],
    remediationSteps: [
      "تطبيق سياسة رفض افتراضية (Default Deny) وفرض فحص الدور والصلاحية مركزياً على كل مسار.",
    ],
  },
  {
    id: "grpc-protobuf-authz",
    titleAr: "كشف انعكاس gRPC وغياب التحقق من الصلاحيات على مستوى الطرق (gRPC Security)",
    titleEn: "gRPC Server Reflection Exposure & Missing Interceptor Authorization",
    cwe: "CWE-200 / CWE-285",
    owasp: "API8:2023 & Microservices Security",
    severity: "High",
    cvssBase: 7.8,
    bountyRange: "$1,000 – $20,000+",
    summaryAr:
      "تحدث عندما يترك خادم gRPC خدمة `ServerReflection` مفعلة للعامة في بيئة الإنتاج، مما يكشف جميع ملفات `.proto` والخدمات الداخلية التي قد تفتقر إلى فحص الصلاحيات في الـ Interceptor.",
    rootCauseAr:
      "اعتقاد المطورين أن بروتوكول Protobuf الثنائي غير قابل للقراءة بدون ملفات التعريف، مع ترك ميزة Reflection مفعلة.",
    language: "Go / gRPC",
    vulnerableCode: `// ❌ كود ضعيف: تفعيل gRPC Reflection في الإنتاج وبدون UnaryAuthInterceptor
s := grpc.NewServer()
pb.RegisterInternalAdminServer(s, &server{})
reflection.Register(s)`,
    secureCode: `// ✅ كود آمن: إيقاف Reflection في الإنتاج وفرض UnaryInterceptor للتحقق من الهوية والدور
s := grpc.NewServer(grpc.UnaryInterceptor(AuthzUnaryInterceptor))
pb.RegisterInternalAdminServer(s, &server{})
if os.Getenv("ENV") == "development" {
  reflection.Register(s)
}`,
    auditChecklist: [
      "فحص ما إذا كانت خدمة `grpc.reflection.v1alpha.ServerReflection` متاحة من الخارج.",
      "التحقق من تطبيق مصادقة JWT/mTLS موحدة عبر `UnaryInterceptor` و`StreamInterceptor`.",
    ],
    remediationSteps: [
      "تعطيل `reflection.Register` في بيئات الإنتاج وفرض التحقق من الصلاحيات في طبقة الـ Interceptor.",
    ],
  },
  {
    id: "host-header-reset-poisoning",
    titleAr: "تسميم روابط استعادة كلمة المرور عبر ترويسة Host (Password Reset Poisoning)",
    titleEn: "Host Header Injection & Password Reset Link Poisoning",
    cwe: "CWE-640",
    owasp: "A07:2021 — Identification and Authentication Failures",
    severity: "High",
    cvssBase: 8.6,
    bountyRange: "$1,500 – $20,000+",
    summaryAr:
      "تحدث عندما يبني الخادم رابط استعادة كلمة المرور المرسل بالبريد بالاعتماد على ترويسة `Host` أو `X-Forwarded-Host` المرسلة في الطلب بدلاً من متغير بيئة ثابت.",
    rootCauseAr:
      "الثقة في `req.headers.host` أو `req.get('host')` عند توليد روابط حساسة تحتوي على رموز سرية (`reset_token`).",
    language: "TypeScript / Node.js",
    vulnerableCode: `// ❌ كود ضعيف: استخدام ترويسة Host من الطلب لبناء رابط استعادة كلمة المرور
const resetUrl = \`https://\${req.headers.host}/reset-password?token=\${resetToken}\`;
await sendEmail(user.email, resetUrl);`,
    secureCode: `// ✅ كود آمن: استخدام عنوان الموقع الرسمي الثابت من إعدادات البيئة المحمية
const APP_BASE_URL = process.env.PUBLIC_APP_ORIGIN || "https://app.example.com";
const resetUrl = new URL("/reset-password", APP_BASE_URL);
resetUrl.searchParams.set("token", resetToken);
await sendEmail(user.email, resetUrl.toString());`,
    auditChecklist: [
      "اختبار طلب استعادة كلمة المرور على حسابك التجريبي فقط مع مراقبة ما إذا كان الخادم يقبل ترويسة `X-Forwarded-Host`.",
      "التأكد من ضبط قائمة النطاقات المسموحة (`ALLOWED_HOSTS`) في الخادم وموازن الأحمال.",
    ],
    remediationSteps: [
      "الاعتماد حصرياً على متغير بيئة ثابت (`PUBLIC_APP_ORIGIN`) لبناء كافة الروابط المرسلة في الرسائل.",
    ],
  },
  {
    id: "multi-tenant-rls-bypass",
    titleAr: "كسر عزل المستأجرين في الأنظمة السحابية (Multi-Tenant Isolation & RLS Bypass)",
    titleEn: "Multi-Tenant SaaS Cross-Tenant Data Leakage & Tenant-ID Spoofing",
    cwe: "CWE-284",
    owasp: "A01:2021 — Broken Access Control (Multi-Tenant SaaS)",
    severity: "Critical",
    cvssBase: 9.4,
    bountyRange: "$5,000 – $50,000+",
    summaryAr:
      "تحدث في منصات B2B SaaS عندما يقرأ الخادم معرف المؤسسة (`X-Tenant-Id` أو `organizationId`) من ترويسة الطلب أو الـ JSON دون التحقق من انتماء المستخدم الحالي لتلك المؤسسة.",
    rootCauseAr:
      "الثقة في معرف المؤسسة المرسل من العميل بدلاً من استخراجه من جلسة المستخدم أو تفعيل سياسات Row-Level Security (RLS) في قاعدة البيانات.",
    language: "TypeScript / PostgreSQL RLS",
    vulnerableCode: `// ❌ كود ضعيف: قراءة معرف المؤسسة من الترويسة دون التحقق من عضوية المستخدم فيها
app.get("/api/v1/projects", requireAuth, async (req, res) => {
  const tenantId = req.headers["x-tenant-id"];
  const projects = await db.projects.findMany({ where: { tenantId } });
  res.json(projects);
});`,
    secureCode: `// ✅ كود آمن: التحقق الصارم من عضوية المستخدم في المؤسسة + تفعيل PostgreSQL RLS
app.get("/api/v1/projects", requireAuth, async (req, res) => {
  const tenantId = String(req.headers["x-tenant-id"]);
  const membership = await db.memberships.findUnique({
    where: { userId_tenantId: { userId: req.user.id, tenantId } },
  });
  if (!membership) return res.status(403).json({ error: "Cross-tenant access denied" });
  const projects = await db.projects.findMany({ where: { tenantId } });
  res.json(projects);
});`,
    auditChecklist: [
      "إنشاء مؤسستين تجريبيتين مستقلتين (`Tenant A` و `Tenant B`) واختبار تبديل `org_id` أو `X-Tenant-Id` في جميع مسارات القراءة والتصدير.",
      "فحص نقاط النهاية الخاصة بالتقارير المجمعة، البحث العام، والـ Webhooks للتأكد من فلترتها بمعرف المؤسسة.",
    ],
    remediationSteps: [
      "ربط كل استعلام في قاعدة البيانات بعضوية المستخدم الموثقة وتفعيل `Row-Level Security (RLS)` في PostgreSQL.",
    ],
  },
  {
    id: "open-redirect-oauth-chain",
    titleAr: "التوجيه المفتوح وسلسلة سرقة رموز المصادقة (Open Redirect to OAuth Token Chain)",
    titleEn: "Unvalidated Open Redirect Chained with OAuth / Referer Token Leakage",
    cwe: "CWE-601",
    owasp: "A01:2021 — Broken Access Control",
    severity: "High",
    cvssBase: 8.1,
    bountyRange: "$1,000 – $15,000+",
    summaryAr:
      "بينما يُصنف التوجيه المفتوح منفرداً كخطورة منخفضة، فإنه يتحول إلى ثغرة عالية أو حرجة عند دمجه مع `redirect_uri` في OAuth أو تسريب التوكن عبر ترويسة `Referer`.",
    rootCauseAr:
      "قبول عناوين مطلقة أو مسارات تبدأ بـ `//` أو `\\` في معاملات التوجيه (`next`, `returnTo`, `continue`) بدون التحقق من بقائها داخل نفس النطاق.",
    language: "TypeScript / URL Validation",
    vulnerableCode: `// ❌ كود ضعيف: توجيه مباشر لأي قيمة يرسلها المستخدم في معامل next
app.get("/login/callback", (req, res) => {
  res.redirect(String(req.query.next || "/dashboard"));
});`,
    secureCode: `// ✅ كود آمن: السماح بالمسارات المحلية النسبية فقط والتحقق من ثبات الـ Origin
function getSafeRelativePath(input: string): string {
  const base = "https://app.example.com";
  try {
    const resolved = new URL(input, base);
    if (resolved.origin !== base) return "/dashboard";
    return resolved.pathname + resolved.search;
  } catch {
    return "/dashboard";
  }
}`,
    auditChecklist: [
      "اختبار معاملات `next`, `redirect`, `return_to`, `goto` والتحقق من كيفية تحليل `new URL()` لها.",
      "البحث عن إمكانية ربط مسار التوجيه كـ `redirect_uri` مسموح داخل تدفق OAuth 2.0.",
    ],
    remediationSteps: [
      "تحليل الرابط عبر `new URL(input, TRUSTED_ORIGIN)` والتحقق من تطابق `resolved.origin === TRUSTED_ORIGIN`.",
      "إضافة ترويسة `Referrer-Policy: strict-origin-when-cross-origin` أو `no-referrer` على صفحات المصادقة.",
    ],
  },
  {
    id: "immunefi-reentrancy-readonly",
    titleAr: "إعادة الدخول الكلاسيكية والقرائية في العقود الذكية (Classic & Read-Only Reentrancy)",
    titleEn: "Smart Contract Classic & Read-Only Reentrancy (Immunefi Critical)",
    cwe: "CWE-841 / SWC-107",
    owasp: "Immunefi V2.3 Critical — Direct Theft of User Funds",
    severity: "Critical",
    cvssBase: 9.8,
    bountyRange: "$50,000 – $2,500,000 (Immunefi)",
    summaryAr:
      "تحدث عندما يقوم عقد ذكي بإجراء استدعاء خارجي (مثل إرسال ETH عبر `.call{value}` أو استدعاء دالة callback في ERC-777/ERC-1155) قبل تحديث أرصدة الحالة الداخلية، مما يسمح للعقد المستدعى بإعادة الدخول أو قراءة سعر غير محدث (Read-Only Reentrancy) في بروتوكول متكامل.",
    rootCauseAr:
      "مخالفة نمط Checks-Effects-Interactions (CEI) أو عدم مشاركة قفل ReentrancyGuard مع دوال القراءة (view) التي تعتمد عليها بروتوكولات الإقراض لحساب قيمة الضمانات.",
    language: "Solidity (EVM / Foundry)",
    vulnerableCode: `// ❌ كود Solidity ضعيف: استدعاء خارجي قبل تحديث الرصيد وعدم حماية دالة السعر
contract VulnerableLendingPool {
  mapping(address => uint256) public balances;
  uint256 public totalLiquidity;

  function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "Insufficient");
    // ⚠️ استدعاء خارجي يسلم التحكم للمستلم قبل خصم الرصيد وتحديث totalLiquidity!
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "Transfer failed");
    balances[msg.sender] -= amount;
    totalLiquidity -= amount;
  }

  // ⚠️ دالة view تقرأ حالة غير متسقة أثناء تنفيذ callback
  function getSharePrice() external view returns (uint256) {
    return (address(this).balance * 1e18) / totalLiquidity;
  }
}`,
    secureCode: `// ✅ كود Solidity آمن: تطبيق صارم لـ CEI + قفل Reentrancy شامل للقراءة والكتابة
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SecureLendingPool is ReentrancyGuard {
  mapping(address => uint256) public balances;
  uint256 public totalLiquidity;

  function withdraw(uint256 amount) external nonReentrant {
    require(balances[msg.sender] >= amount, "Insufficient");
    // 1. Effects: تحديث جميع متغيرات الحالة أولاً
    balances[msg.sender] -= amount;
    totalLiquidity -= amount;
    // 2. Interactions: الاستدعاء الخارجي في النهاية فقط
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "Transfer failed");
  }

  function getSharePrice() external view returns (uint256) {
    require(!_reentrancyGuardEntered(), "Read-only reentrancy blocked");
    return (totalLiquidity == 0) ? 1e18 : (address(this).balance * 1e18) / totalLiquidity;
  }
}`,
    auditChecklist: [
      "فحص جميع استدعاءات `.call{value: ...}`، `_safeMint`، `onERC721Received`، و`tokensReceived` باستخدام `slither . --detect reentrancy-eth`.",
      "التحقق مما إذا كانت دوال `view` (مثل `get_virtual_price` أو `previewRedeem`) تقرأ حالة غير محدثة أثناء تنفيذ callback خارجي.",
      "كتابة اختبار Foundry محلي (`forge test --fork-url $RPC_URL`) لإثبات فرق الأرصدة قبل وبعد المعاملة بدون لمس الشبكة الحية.",
    ],
    remediationSteps: [
      "تطبيق نمط Checks-Effects-Interactions (CEI) بتحديث جميع الأرصدة وإجمالي الأسهم قبل أي استدعاء خارجي.",
      "استخدام `ReentrancyGuard` أو `ReentrancyGuardTransient` (EIP-1153) والتحقق من حالة القفل في دوال التسعير الحساسة.",
    ],
  },
  {
    id: "immunefi-erc4626-inflation",
    titleAr: "تضخم أسهم المودع الأول وفقدان الدقة الحسابية (ERC-4626 Vault Share Inflation)",
    titleEn: "ERC-4626 First-Depositor Share Inflation & Precision Loss",
    cwe: "CWE-682 / SWC-101",
    owasp: "Immunefi V2.3 High/Critical — Theft of Depositor Yield/Principal",
    severity: "Critical",
    cvssBase: 9.4,
    bountyRange: "$25,000 – $1,000,000 (Immunefi)",
    summaryAr:
      "ثغرة رياضية في خزائن السيولة (ERC-4626 Vaults) وبروتوكولات الإقراض عندما تكون الخزنة فارغة (`totalSupply == 0`)، حيث يودع المهاجم 1 wei للحصول على سهم واحد، ثم يتبرع بكمية كبيرة من التوكن مباشرة للعقد لتضخيم قيمة السهم الواحد، مما يجعل إيداع الضحية التالي يُقرب إلى الصفر (`0 shares`).",
    rootCauseAr:
      "اعتماد حساب الأسهم على `totalAssets()` المباشر (`ERC20.balanceOf(address(this))`) مع القسمة الصحيحة التي تقرب نحو الصفر بدون وجود Virtual Shares/Assets Offset.",
    language: "Solidity (EVM / Foundry)",
    vulnerableCode: `// ❌ كود Solidity ضعيف: حساب الأسهم بدون Virtual Offset واعتماد مباشر على balanceOf
contract VulnerableVault {
  IERC20 public immutable asset;
  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;

  function deposit(uint256 assets) external returns (uint256 shares) {
    uint256 totalAssets = asset.balanceOf(address(this));
    // ⚠️ إذا كان totalSupply = 1 و totalAssets = 10000e18، فإن إيداع 9999e18 ينتج 0 أسهم!
    shares = (totalSupply == 0) ? assets : (assets * totalSupply) / totalAssets;
    // ⚠️ لا يوجد فحص require(shares > 0) ولا إزاحة عشرية!
    asset.transferFrom(msg.sender, address(this), assets);
    balanceOf[msg.sender] += shares;
    totalSupply += shares;
  }
}`,
    secureCode: `// ✅ كود Solidity آمن: استخدام Virtual Offset (OpenZeppelin v5 ERC4626) ومنع الأسهم الصفرية
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract SecureVault is ERC4626 {
  using Math for uint256;

  constructor(IERC20 asset_) ERC4626(asset_) ERC20("Secure Vault", "sVLT") {}

  // إضافة إزاحة عشرية افتراضية (Virtual Shares/Assets) تجعل هجوم التضخم غير مجدٍ اقتصادياً
  function _decimalsOffset() internal pure override returns (uint8) {
    return 3;
  }

  function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
    shares = super.deposit(assets, receiver);
    require(shares > 0, "Zero shares minted");
  }
}`,
    auditChecklist: [
      "فحص جميع عمليات القسمة في دوال `convertToShares` و`convertToAssets` للتأكد من اتجاه التقريب (لصالح الخزنة وليس المستخدم).",
      "التحقق من وجود Virtual Offset (`_decimalsOffset()`) أو حرق حصة أولية (`MINIMUM_LIQUIDITY`) كما في Uniswap V2.",
    ],
    remediationSteps: [
      "استخدام تنفيذ OpenZeppelin v5 القياسي لـ `ERC4626` مع تفعيل `_decimalsOffset()`.",
      "فرض شرط `require(shares >= minSharesOut && shares > 0)` لحماية المودعين من الانزلاق السعري.",
    ],
  },
  {
    id: "immunefi-flashloan-oracle",
    titleAr: "التلاعب بأوراكل الأسعار عبر القروض الخاطفة (Flash Loan Oracle Manipulation)",
    titleEn: "Flash Loan Spot-Price Oracle Manipulation & Stale Chainlink Feed",
    cwe: "CWE-345",
    owasp: "Immunefi V2.3 Critical — Protocol Insolvency / Direct Theft",
    severity: "Critical",
    cvssBase: 9.9,
    bountyRange: "$100,000 – $5,000,000 (Immunefi)",
    summaryAr:
      "تحدث عندما يعتمد بروتوكول DeFi على السعر الفوري (Spot Price) لمجمع سيولة (AMM Pool `getReserves()` أو `balanceOf`) أو يقرأ بيانات Chainlink بدون التحقق من حداثة السعر (`updatedAt`) وحالة المُسلسِل (L2 Sequencer Uptime).",
    rootCauseAr:
      "استخدام مصدر سعر قابل للتلاعب داخل نفس البلوك عبر قرض خاطف (Flash Loan) غير مضمون، أو غياب الفحوصات الأمنية على مخرجات `latestRoundData()`.",
    language: "Solidity (EVM / Foundry)",
    vulnerableCode: `// ❌ كود Solidity ضعيف: قراءة السعر الفوري من مجمع AMM أو تجاهل فحوصات Chainlink
contract VulnerableOracle {
  IUniswapV2Pair public pair;
  AggregatorV3Interface public priceFeed;

  function getSpotPrice() external view returns (uint256) {
    (uint112 r0, uint112 r1, ) = pair.getReserves();
    // ⚠️ قابل للتلاعب بنسبة 1000% داخل معاملة Flash Loan واحدة!
    return (uint256(r1) * 1e18) / uint256(r0);
  }

  function getChainlinkPrice() external view returns (uint256) {
    (, int256 answer, , , ) = priceFeed.latestRoundData();
    // ⚠️ لا يتحقق من answer > 0 ولا من updatedAt (Stale Price)!
    return uint256(answer);
  }
}`,
    secureCode: `// ✅ كود Solidity آمن: التحقق الصارم من حداثة وصحة بيانات أوراكل Chainlink
contract SecureOracle {
  AggregatorV3Interface public immutable priceFeed;
  uint256 public constant MAX_HEARTBEAT = 3600; // ساعة واحدة كحد أقصى

  function getValidatedPrice() external view returns (uint256) {
    (
      uint80 roundId,
      int256 answer,
      ,
      uint256 updatedAt,
      uint80 answeredInRound
    ) = priceFeed.latestRoundData();

    require(answer > 0, "Invalid oracle price");
    require(updatedAt > 0 && block.timestamp - updatedAt <= MAX_HEARTBEAT, "Stale oracle price");
    require(answeredInRound >= roundId, "Stale round");
    return uint256(answer);
  }
}`,
    auditChecklist: [
      "البحث عن أي استخدام لـ `getReserves()` أو `slot0()` أو `balanceOf()` لحساب أسعار الضمانات الفورية.",
      "فحص جميع استدعاءات `latestRoundData()` للتأكد من فحص `answer > 0` و`block.timestamp - updatedAt <= heartbeat`.",
    ],
    remediationSteps: [
      "استخدام أوراكل Chainlink الموثق مع فحص Heartbeat وحالة L2 Sequencer على شبكات Arbitrum/Optimism/Base.",
      "دمج متوسط السعر المرجح زمنياً (TWAP) لفترة كافية مع حدود انحراف سعرية (Circuit Breakers).",
    ],
  },
  {
    id: "immunefi-bridge-sig-replay",
    titleAr: "تجاوز التحقق من رسائل الجسور والتواقيع التشفيرية (Bridge & EIP-712 Signature Replay)",
    titleEn: "Cross-Chain Bridge Message Verification Bypass & Signature Replay",
    cwe: "CWE-347 / SWC-117 / SWC-121",
    owasp: "Immunefi V2.3 Critical — Unbacked Token Minting / Bridge Drain",
    severity: "Critical",
    cvssBase: 10.0,
    bountyRange: "$100,000 – $10,000,000 (Immunefi)",
    summaryAr:
      "تعد ثغرات الجسور عبر الشبكات (Cross-Chain Bridges) الأعلى مكافأة في تاريخ Immunefi (تصل إلى 10-15 مليون دولار)، وتنتج عن أخطاء في التحقق من التواقيع التشفيرية (`ecrecover` الذي يعيد `address(0)` عند فشل التوقيع) أو غياب `chainId` و`nonce` من هيكل الرسالة الموقعة.",
    rootCauseAr:
      "استدعاء `ecrecover` مباشرة ومقارنته بمتغير حارس غير مهيأ (`address(0)`)، أو عدم تسجيل تجزئة الرسالة (`messageHash`) كمنفذة لمنع إعادة إرسالها.",
    language: "Solidity (EVM / Foundry)",
    vulnerableCode: `// ❌ كود Solidity ضعيف: عدم فحص address(0) وغياب chainId/nonce
contract VulnerableBridge {
  address public validator; // ⚠️ إذا لم يُهيأ وترك address(0)، أي توقيع باطل سيمر!

  function claimTokens(address to, uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
    bytes32 hash = keccak256(abi.encodePacked(to, amount));
    address signer = ecrecover(hash, v, r, s);
    // ⚠️ إذا كان التوقيع غير صالح، يعيد ecrecover القيمة address(0)!
    require(signer == validator, "Invalid signature");
    _mint(to, amount);
  }
}`,
    secureCode: `// ✅ كود Solidity آمن: استخدام OpenZeppelin ECDSA + EIP-712 + Nonce لمنع التكرار
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract SecureBridge is EIP712 {
  using ECDSA for bytes32;
  address public immutable validator;
  mapping(bytes32 => bool) public processedMessages;

  constructor(address _validator) EIP712("SecureBridge", "1") {
    require(_validator != address(0), "Zero validator");
    validator = _validator;
  }

  function claimTokens(address to, uint256 amount, uint256 nonce, bytes calldata sig) external {
    bytes32 structHash = keccak256(abi.encode(
      keccak256("Claim(address to,uint256 amount,uint256 nonce,uint256 chainId)"),
      to, amount, nonce, block.chainid
    ));
    bytes32 digest = _hashTypedDataV4(structHash);
    require(!processedMessages[digest], "Already processed");
    processedMessages[digest] = true;

    address signer = ECDSA.recover(digest, sig); // يمنع address(0) و s-malleability تلقائياً
    require(signer == validator, "Invalid validator signature");
    _mint(to, amount);
  }
}`,
    auditChecklist: [
      "فحص كل استدعاء لـ `ecrecover` للتأكد من عدم إمكانية مطابقة `address(0)` واستخدام مكتبة `ECDSA.recover`.",
      "التحقق من شمول `block.chainid` وعنوان العقد (`address(this)`) ورقم تسلسلي (`nonce`) داخل كل رسالة موقعة.",
    ],
    remediationSteps: [
      "اعتماد معيار EIP-712 عبر مكتبة OpenZeppelin `EIP712` و`ECDSA` القياسية.",
      "تخزين تجزئة كل رسالة منفذة في `mapping(bytes32 => bool)` قبل تنفيذ أي تحويل للأصول.",
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
    id: "immunefi-layerzero",
    name: "LayerZero Cross-Chain Protocol (Immunefi Mega Bounty)",
    platform: "Immunefi",
    url: "https://immunefi.com/bug-bounty/layerzero/",
    safeHarbor: true,
    maxBounty: "$15,000,000 (أعلى مكافأة عالمية للعقود الذكية)",
    inScopeSummary: "LayerZero Endpoint V1/V2 Smart Contracts, Ultra Light Node (ULN), Cross-Chain Messaging Verification (Local Fork PoC Only!)",
    outOfScopeSummary: "Mainnet exploitation (Testing strictly prohibited on live mainnet — use local Foundry fork only!), phishing, DDoS",
    focusAreas: ["Cross-Chain Message Verification", "Signature Replay", "ULN Proof Validation", "Solidity / Rust Contracts"],
  },
  {
    id: "immunefi-sky-makerdao",
    name: "Sky (MakerDAO) DeFi Protocol Bug Bounty",
    platform: "Immunefi",
    url: "https://immunefi.com/bug-bounty/sky/",
    safeHarbor: true,
    maxBounty: "$10,000,000 (Critical Smart Contract Bugs)",
    inScopeSummary: "Core Vaults, Liquidation Engine, Price Oracles, Governance PauseProxy, USDS/DAI Minting Contracts (Local Foundry Fork Only)",
    outOfScopeSummary: "Testing on live mainnet or public testnets, frontend DDoS, social engineering",
    focusAreas: ["ERC-4626 / Vault Accounting", "Oracle Price Manipulation", "Liquidation Math Precision", "Flash Loan Governance"],
  },
  {
    id: "immunefi-wormhole",
    name: "Wormhole Cross-Chain Bridge Bug Bounty",
    platform: "Immunefi",
    url: "https://immunefi.com/bug-bounty/wormhole/",
    safeHarbor: true,
    maxBounty: "$10,000,000 (Critical Bridge & Guardian Bugs)",
    inScopeSummary: "Wormhole Core Bridge Contracts (EVM, Solana/Rust, Sui/Move, CosmWasm), Guardian Signature Verification",
    outOfScopeSummary: "Any transaction sent to live mainnet/testnet contracts (Local Fork PoC required), third-party dApps",
    focusAreas: ["Guardian Quorum Bypass", "VAA Signature Verification", "Uninitialized Proxy Implementation", "Token Bridge Decimal Normalization"],
  },
  {
    id: "immunefi-aave-eigenlayer",
    name: "Aave & EigenLayer DeFi / Restaking Bounties",
    platform: "Immunefi",
    url: "https://immunefi.com/explore/",
    safeHarbor: true,
    maxBounty: "$1,000,000 – $2,000,000+",
    inScopeSummary: "Lending Pools, Restaking StrategyManager, DelegationManager, Slasher, FlashLoan Routers (Local Foundry Fork Only)",
    outOfScopeSummary: "Live network state modification, governance proposals by trusted multisigs",
    focusAreas: ["Read-Only Reentrancy", "Share Inflation / Rounding", "Withdrawal Delay Bypass", "Health Factor Calculation"],
  },
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

// 6) نموذج عقد ذكي (Solidity / Immunefi DeFi Vault) للفحص الساكن:
// (bool ok, ) = msg.sender.call{value: amount}("");
// address signer = ecrecover(hash, v, r, s);
// (, int256 answer, , , ) = priceFeed.latestRoundData();
// require(tx.origin == owner, "Not owner");
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
      id: "solidity-reentrancy-call",
      titleAr: "[Immunefi / Solidity] استدعاء خارجي منخفض المستوى (.call{value}) قد يسمح بـ Reentrancy",
      cwe: "CWE-841 / SWC-107",
      severity: "Critical",
      regex: /\.call\s*\{\s*value\s*:/,
      explanationAr: "إرسال ETH عبر .call{value: ...} يسلم التحكم للعقد المستلم وقد يؤدي إلى Reentrancy أو Read-Only Reentrancy إذا لم يتم تحديث الحالة أولاً.",
      fixAr: "طبق نمط Checks-Effects-Interactions (CEI) واستخدم ReentrancyGuard (nonReentrant) من OpenZeppelin.",
    },
    {
      id: "solidity-ecrecover-raw",
      titleAr: "[Immunefi / Solidity] استدعاء ecrecover() مباشر بدون مكتبة ECDSA (احتمال تجاوز address(0))",
      cwe: "CWE-347 / SWC-117",
      severity: "Critical",
      regex: /\becrecover\s*\(/,
      explanationAr: "الدالة ecrecover تعيد address(0) عند فشل التوقيع وتقبل التواقيع المطاوعة (s-malleability)، مما قد يؤدي لتجاوز التحقق في الجسور.",
      fixAr: "استخدم ECDSA.recover(digest, signature) مع EIP-712 وNonce وblock.chainid.",
    },
    {
      id: "solidity-chainlink-stale",
      titleAr: "[Immunefi / DeFi] قراءة latestRoundData() من أوراكل السعر بدون التحقق من updatedAt",
      cwe: "CWE-345",
      severity: "High",
      regex: /\.latestRoundData\s*\(\s*\)/,
      explanationAr: "عدم التحقق من updatedAt وanswer > 0 وansweredInRound يعرض البروتوكول للتسعير القديم (Stale Oracle Price) أثناء تقلب السوق.",
      fixAr: "تحقق دائماً من require(answer > 0 && block.timestamp - updatedAt <= HEARTBEAT && answeredInRound >= roundId).",
    },
    {
      id: "solidity-tx-origin",
      titleAr: "[Immunefi / Solidity] استخدام tx.origin في التحقق من الصلاحيات",
      cwe: "CWE-477 / SWC-115",
      severity: "High",
      regex: /tx\.origin/,
      explanationAr: "الاعتماد على tx.origin يسمح لأي عقد وسيط باستغلال صلاحيات المالك عند تفاعله مع عقد خارجي.",
      fixAr: "استخدم msg.sender دائماً للتحقق من الهوية والصلاحيات (Ownable / AccessControl).",
    },
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
  const [location] = useLocation();
  const resolveTabFromPath = (pathStr: string): "deep2099" | "workstation" | "encyclopedia" | "auditor" | "scope" | "checklist" | "report" => {
    const p = (pathStr || (typeof window !== "undefined" ? window.location.pathname : "")).toLowerCase();
    if (p.includes("vuln-encyclopedia")) return "encyclopedia";
    if (p.includes("code-auditor")) return "auditor";
    if (p.includes("workstation")) return "workstation";
    return "deep2099";
  };
  const [activeTab, setActiveTab] = useState<"deep2099" | "workstation" | "encyclopedia" | "auditor" | "scope" | "checklist" | "report">(() =>
    resolveTabFromPath(location)
  );
  useEffect(() => {
    setActiveTab(resolveTabFromPath(location));
  }, [location]);

  // Tab 0 (2099 Engine) state: Deep Research Pipeline, JS Analyzer, Auth Matrix, Config Auditor, Zero-FP Gate & GitHub Arsenal
  const [deepLoading, setDeepLoading] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<{
    target: string;
    hostname: string;
    stages: Array<{ stage: number; name: string; status: string; detail: string }>;
    endpoints: string[];
    missingHeaders: string[];
    targetHash: string;
    baselineHash: string;
    hypotheses: Array<{ rank: number; title: string; cwe: string; priority: string; verificationSteps: string }>;
  } | null>(null);
  const [jsAnalysisResult, setJsAnalysisResult] = useState<{
    target: string;
    scriptsAnalyzed: number;
    endpoints: string[];
    parameters: string[];
    sinks: Array<{ sink: string; severity: string; cwe: string; detail: string }>;
    summary: string;
  } | null>(null);
  const [matrixEndpoint, setMatrixEndpoint] = useState("https://api.example.com/api/v1/user/profile");
  const [sessionAHeader, setSessionAHeader] = useState("Authorization: Bearer test_account_owner_token");
  const [sessionBHeader, setSessionBHeader] = useState("Authorization: Bearer test_account_secondary_token");
  const [authMatrixResult, setAuthMatrixResult] = useState<{
    endpointUrl: string;
    verdict: string;
    verdictAr: string;
    severity: string;
    similarityPercent: number;
    matrix: Array<{ actor: string; status: number; length: number; hash: string; timeMs: number }>;
  } | null>(null);
  const [configAuditResult, setConfigAuditResult] = useState<{
    hostname: string;
    cors: { allowOrigin: string; allowCredentials: string; vulnerable: boolean };
    securityTxt: { found: boolean; contacts: string[]; excerpt: string | null };
    findings: Array<{ check: string; status: string; cwe: string; detail: string }>;
  } | null>(null);
  const [zeroFpTitle, setZeroFpTitle] = useState("تحقق من عزل صلاحيات نقطة النهاية (BOLA/IDOR)");
  const [zeroFpSev, setZeroFpSev] = useState<"critical" | "high" | "medium" | "low">("high");
  const [zeroFpResult, setZeroFpResult] = useState<{
    verified: boolean;
    isFalsePositive: boolean;
    targetHash: string;
    baseline404Hash: string;
    cvssScore: number;
    cvssVector: string;
  } | null>(null);
  const [arsenalTools, setArsenalTools] = useState<Array<{
    id: string;
    name: string;
    category: string;
    stars: string;
    url: string;
    integratedModule: string;
    description: string;
    methodology: string;
  }>>(() => {
    const init = resolveStandaloneApi("/api/deep-research/arsenal", "GET") as { tools?: Array<any> } | null;
    return init?.tools || [];
  });
  const [ghSearchQuery, setGhSearchQuery] = useState("nuclei bug bounty recon");
  const [ghSearchResults, setGhSearchResults] = useState<Array<{
    full_name?: string;
    html_url?: string;
    description?: string;
    stargazers_count?: number;
    language?: string;
  }>>([]);
  const [globalPlatforms, setGlobalPlatforms] = useState<Array<{
    id: string;
    name: string;
    url: string;
    bountyRange: string;
    safeHarbor: string;
    focus: string;
    defaultTarget: string;
  }>>(() => {
    const init = resolveStandaloneApi("/api/deep-research/platforms", "GET") as { platforms?: Array<any> } | null;
    return init?.platforms || [];
  });
  const [osintResult, setOsintResult] = useState<{
    domain: string;
    primaryIp: string;
    shodanInternetDb: { ip: string; ports: number[]; cpes: string[]; hostnames: string[]; tags: string[]; vulns: string[] };
    crtSubdomains: string[];
    waybackUrls: string[];
    summary: string;
  } | null>(null);
  const [jwtInput, setJwtInput] = useState("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMDQyIiwicm9sZSI6InVzZXIifQ.sig");
  const [cookieInput, setCookieInput] = useState("session_id=xyz987; Path=/; Secure");
  const [jwtAuditResult, setJwtAuditResult] = useState<{
    decodedHeader: Record<string, unknown>;
    decodedPayload: Record<string, unknown>;
    issues: Array<{ check: string; severity: string; cwe: string; detail: string; fix: string }>;
  } | null>(null);
  const [schemaAuditResult, setSchemaAuditResult] = useState<{
    hostname: string;
    discoveredSchemas: Array<{ path: string; status: number; type: string; note: string }>;
    checklist: Array<{ check: string; cwe: string; recommendation: string }>;
  } | null>(null);
  const [selfAwareness, setSelfAwareness] = useState<{
    platformVersion: string;
    activeTarget: string;
    selfAwarenessSummary: {
      deepEnginesCount: number;
      kaliToolsIntegrated: number;
      kaliCategoriesCount?: number;
      githubArsenalCount: number;
      vulnPrimitivesCount?: number;
      totalIndexedKnowledgeItems?: number;
      globalPlatformsCount: number;
      memoriesStored: number;
      missionFindings: number;
      commandsLogged: number;
      verifiedEvidence: number;
      reportsSaved: number;
    };
    coveragePercent: number;
    dimensions: Array<{ id: string; name: string; completed: boolean; recommendedAction: string }>;
    tacticalDoctrine?: Array<{
      id: string;
      phaseOrder: number;
      engineNameAr: string;
      toolsUsed: string[];
      whereAr: string;
      whenAr: string;
      howAr: string;
      whyAndForWhatAr: string;
      unlocksNext: string;
    }>;
    nextRecommendedStep: string;
  } | null>(() => resolveStandaloneApi("/api/deep-research/self-awareness?target=bughunters.google.com", "GET") as any);
  const [showDoctrineMatrix, setShowDoctrineMatrix] = useState<boolean>(true);
  const [agentMasterResult, setAgentMasterResult] = useState<{
    target: string;
    executedAt: string;
    coverageBefore: number;
    coverageAfter: number;
    stepsExecuted: Array<{
      stepNumber: number;
      toolId: string;
      toolName: string;
      where: string;
      when: string;
      how: string;
      why: string;
      commandExecuted: string;
      liveOutput: string;
      status: string;
    }>;
    zeroFpProof: {
      verified: boolean;
      targetStatus: number;
      targetHash: string;
      baseline404Hash: string;
      missingSecurityHeaders: string[];
      serverHeader: string;
    };
    executiveSummaryAr: string;
  } | null>(null);
  const [kaliTools, setKaliTools] = useState<Array<{
    id: string;
    name: string;
    category: string;
    commandTemplate: string;
    purposeAr: string;
    safeEquivalent: string;
  }>>(() => {
    const init = resolveStandaloneApi("/api/deep-research/kali-arsenal", "GET") as { tools?: Array<any> } | null;
    return init?.tools || [];
  });
  const [selectedKaliCategory, setSelectedKaliCategory] = useState<string>("all");
  const [kaliSimResult, setKaliSimResult] = useState<{
    toolId: string;
    toolName: string;
    category: string;
    command: string;
    target: string;
    output: string;
  } | null>(null);
  const [primitivesList, setPrimitivesList] = useState<Array<{
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    cwe: string;
    layer: string;
    baseCvss: number;
    roleInChain: string;
    signalAr: string;
  }>>(() => {
    const init = resolveStandaloneApi("/api/deep-research/primitives", "GET") as { primitives?: Array<any> } | null;
    return init?.primitives || [];
  });
  const [selectedPrimitives, setSelectedPrimitives] = useState<string[]>([
    "P01-JS-ENDPOINT",
    "P05-GRAPHQL-INTRO",
    "P04-MASS-ASSIGN",
    "P02-BOLA-IDOR",
  ]);
  const [chainResult, setChainResult] = useState<{
    target: string;
    contextStats: { memoriesCount: number; missionFindingsCount: number; evidenceCount: number };
    chains: Array<{
      id: string;
      title: string;
      titleEn?: string;
      hopsCount?: number;
      combinedSeverity: string;
      cvssVector: string;
      estimatedBounty?: string;
      cweChain: string[];
      architecturalGraph?: string;
      steps: string[];
      verificationTool: string;
      safeVerificationCommands?: string[];
      remediation: string;
      noveltyAnalysisAr?: string;
    }>;
  } | null>(null);
  const [corpusQuery, setCorpusQuery] = useState("");
  const [corpusLayer, setCorpusLayer] = useState("all");
  const [corpusData, setCorpusData] = useState<{
    stats?: { totalIndexedKnowledgeItems: number; synthesizedPatternsCount: number };
    totalMatched: number;
    items: Array<{
      id: string;
      titleAr: string;
      titleEn: string;
      category: string;
      cwe: string;
      surface: string;
      auditPhase: string;
      cvss: number;
      chainFormula: string;
      safeCheckAr: string;
      remediationAr: string;
    }>;
  } | null>(() => resolveStandaloneApi("/api/deep-research/corpus-search?q=&layer=all&limit=18", "GET") as any);

  // 24/7 Cloud Brain & Multi-Window Cyber Workstation State
  const [workstationData, setWorkstationData] = useState<{
    brainState: {
      schemaVersion: string;
      platformName: string;
      repository: string;
      liveUrl: string;
      daemonStatus: {
        state: string;
        autonomousCyclesCompleted: number;
        lastHeartbeatAt: string;
        cloudMemorySynced: boolean;
        activeWorkers: number;
        selfEvolutionLevel: string;
      };
      whereAmINow: {
        activeTarget: string;
        activeProgram: string;
        currentStageNumber: number;
        totalStages: number;
        currentStageTitleAr: string;
        overallProgressPercent: number;
        nextAutonomousActionAr: string;
      };
      whatDidIReach: {
        summaryAr: string;
        metrics: {
          totalIndexedKnowledgeItems: number;
          deepEnginesActive: number;
          kaliToolsReady: number;
          githubArsenalProjects: number;
          workstationEnvironments: number;
          extractedArtifactsCount: number;
          parallelTasksActive: number;
          zeroFpVerifiedCount: number;
        };
      };
      whatsNewLog: Array<{
        id: string;
        ts: string;
        category: string;
        titleAr: string;
        detailAr: string;
      }>;
      extractedArtifactsVault: Array<{
        id: string;
        type: string;
        target: string;
        titleAr: string;
        value: string;
        tool: string;
        verified: boolean;
        ts: string;
      }>;
      multiTaskQueue: Array<{
        id: string;
        titleAr: string;
        target: string;
        engine: string;
        status: string;
        progress: number;
        lastOutput: string;
      }>;
    };
    environments: Array<{
      id: string;
      name: string;
      badge: string;
      category: string;
      toolsIncluded: string[];
      purposeAr: string;
      status: string;
    }>;
    msfModules: Array<{
      id: string;
      path: string;
      nameAr: string;
      cwe: string;
      severity: string;
      descriptionAr: string;
    }>;
  } | null>(() => resolveStandaloneApi("/api/deep-research/workstation-state", "GET") as any);

  const [repeaterUrl, setRepeaterUrl] = useState("https://bughunters.google.com");
  const [repeaterMethod, setRepeaterMethod] = useState("GET");
  const [repeaterHeaders, setRepeaterHeaders] = useState("Accept: application/json, text/html\nX-Audit-Scope: Safe-Harbor");
  const [repeaterSessionB, setRepeaterSessionB] = useState("");
  const [repeaterCodecInput, setRepeaterCodecInput] = useState("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  const [repeaterResult, setRepeaterResult] = useState<{
    targetUrl: string;
    hostname: string;
    method: string;
    status: number;
    timeMs: number;
    bodyLength: number;
    sha256: string;
    missingSecHeaders: string[];
    rawRequestText: string;
    rawResponseText: string;
    authDiff: {
      executed: boolean;
      sessionBStatus: number;
      sessionBHash: string;
      identicalBody: boolean;
      verdictAr: string;
    } | null;
    decoderOutput: {
      input: string;
      base64Encode: string;
      base64Decode: string;
      urlEncode: string;
      hexEncode: string;
      sha256Hash: string;
    };
  } | null>(null);

  const [msfModuleId, setMsfModuleId] = useState("shodan_osint");
  const [msfCommand, setMsfCommand] = useState("check");
  const [msfResult, setMsfResult] = useState<{
    activeModule: { id: string; path: string; nameAr: string; cwe: string; severity: string };
    rhosts: string;
    output: string;
  } | null>(null);

  const [termCommand, setTermCommand] = useState("status");
  const [termOutput, setTermOutput] = useState<string>(
    "kali@cybernova-2099:~# status\n[+] 24/7 Autonomous Background Daemon & GitHub Cloud Brain Ready.\n[+] Type 'help' or click any quick command chip above to execute.",
  );

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskTarget, setNewTaskTarget] = useState("");

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
  const [copied, setCopied] = useState<string | null>(null);
  const copyToClipboard = (text: string, id: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  };

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

  // Live Active Target & Platform WebSocket Bus
  const [activeTarget, setActiveTarget] = useState<string>(() => {
    try {
      return localStorage.getItem("cybernova_active_target") || "bughunters.google.com";
    } catch {
      return "bughunters.google.com";
    }
  });
  const [quickNote, setQuickNote] = useState("");
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>("");
  const [liveFeed, setLiveFeed] = useState<Array<{ id: string; text: string; ts: string }>>([
    {
      id: "init-1",
      text: "ناقل WebSocket الداخلي متصل — جاهز لتسجيل الأهداف والملاحظات والأدلة تلقائياً",
      ts: new Date().toLocaleTimeString("ar-EG"),
    },
  ]);

  const { connected: wsConnected } = useWebSocket({
    sessionId: "bug-bounty-studio",
    onMessage: (ev) => {
      if (ev.title || ev.target || ev.prompt) {
        const summary = String(ev.title || ev.target || ev.prompt);
        setLiveFeed((prev) => [
          { id: `ev-${Date.now()}-${Math.random()}`, text: `[${ev.type}] ${summary}`, ts: new Date().toLocaleTimeString("ar-EG") },
          ...prev.slice(0, 7),
        ]);
      }
    },
  });

  const handleActivateTarget = async (targetDomain: string, programName?: string) => {
    const cleanTarget = targetDomain.trim();
    if (!cleanTarget) return;
    setActiveTarget(cleanTarget);
    setScopeCheckHost(cleanTarget);
    setReportAsset(`https://${cleanTarget.replace(/^\*\./, "api.")}`);
    if (programName) setReportProgram(programName);
    try {
      localStorage.setItem("cybernova_active_target", cleanTarget);
    } catch {
      // ignore
    }

    const noteContent = `تم تفعيل الهدف النشط: ${cleanTarget}${programName ? ` ضمن برنامج (${programName})` : ""}. جميع الوكلاء والملاحظات ومتتبع المهام على دراية بالهدف الآن.`;
    try {
      await jsonRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          kind: "project",
          title: `🎯 هدف نشط: ${cleanTarget}`,
          content: noteContent,
          pinned: true,
        }),
      });
      await jsonRequest("/missions/1", {
        method: "PATCH",
        body: JSON.stringify({
          target: cleanTarget,
          name: `فحص قانوني: ${programName || cleanTarget}`,
        }),
      });
    } catch {
      // ignore
    }

    emitPlatformWsEvent({
      type: "target_selected",
      target: cleanTarget,
      title: `تفعيل الهدف النشط: ${cleanTarget}`,
      detail: noteContent,
      saveToMemory: true,
    });
    setSyncStatusMsg(`✅ تم تفعيل الهدف (${cleanTarget}) ومزامنته مع الذاكرة ومتتبع المهام وجميع الوكلاء!`);
  };

  const handleSaveQuickNote = async () => {
    if (!quickNote.trim()) return;
    const text = quickNote.trim();
    setQuickNote("");
    try {
      await jsonRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          kind: "fact",
          title: `📝 ملاحظة فحص [${activeTarget}]`,
          content: text,
          pinned: true,
        }),
      });
      await jsonRequest("/missions/1/findings", {
        method: "POST",
        body: JSON.stringify({
          type: "info",
          title: `ملاحظة استطلاع على ${activeTarget}`,
          severity: "info",
          detail: text,
          tool: "BugBountyStudio",
        }),
      });
    } catch {
      // ignore
    }
    emitPlatformWsEvent({
      type: "note_added",
      target: activeTarget,
      title: `ملاحظة جديدة على ${activeTarget}`,
      detail: text,
      saveToMemory: true,
    });
    setSyncStatusMsg("✅ تم حفظ الملاحظة في الذاكرة (/memory) وسجل المهام (/mission-tracker) وبثها للوكلاء!");
  };

  const handleSyncAuditFindings = async () => {
    const summaryText =
      auditResult.findings.length === 0
        ? `فحص ساكن للكود على ${activeTarget}: لم يتم رصد أنماط ضعيفة (الدرجة 100/100).`
        : `فحص ساكن للكود على ${activeTarget} (الدرجة ${auditResult.score}/100): تم رصد ${auditResult.findings.length} ثغرات محتملة:\n` +
          auditResult.findings.map((f) => `- [${f.severity}] ${f.cwe}: ${f.titleAr} (السطر ${f.line})`).join("\n");
    try {
      await jsonRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          kind: "fact",
          title: `🔍 نتيجة فحص الكود الساكن [${activeTarget}]`,
          content: summaryText,
        }),
      });
      for (const f of auditResult.findings.slice(0, 5)) {
        await jsonRequest("/missions/1/findings", {
          method: "POST",
          body: JSON.stringify({
            type: "vulnerability",
            title: `${f.cwe}: ${f.titleAr}`,
            severity: f.severity.toLowerCase(),
            detail: `${f.explanationAr}\nالسطر ${f.line}: ${f.snippet}\nالحل: ${f.fixAr}`,
            tool: "StaticCodeAuditor",
          }),
        });
      }
    } catch {
      // ignore
    }
    emitPlatformWsEvent({
      type: "code_audit_run",
      target: activeTarget,
      title: `تسجيل ${auditResult.findings.length} نتائج فحص كود ساكن لـ ${activeTarget}`,
      detail: summaryText,
      saveToMemory: true,
    });
    setSyncStatusMsg(`✅ تم تسجيل ${auditResult.findings.length} نتائج في الذاكرة ومتتبع المهام وبثها عبر WebSocket!`);
  };

  const handleSaveReportToPlatform = async () => {
    try {
      await jsonRequest("/reports", {
        method: "POST",
        body: JSON.stringify({
          title: reportTitle,
          target: reportAsset || activeTarget,
          kind: "vulnerability_assessment",
          notes: markdownReport,
        }),
      });
      await jsonRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          kind: "project",
          title: `📄 تقرير ثغرة: ${reportTitle.slice(0, 60)}`,
          content: markdownReport,
          pinned: true,
        }),
      });
    } catch {
      // ignore
    }
    emitPlatformWsEvent({
      type: "finding_recorded",
      target: activeTarget,
      title: `حفظ تقرير رسمي: ${reportTitle.slice(0, 60)}`,
      detail: markdownReport.slice(0, 300),
      saveToMemory: true,
    });
    setSyncStatusMsg("✅ تم حفظ التقرير بالكامل في صفحة التقارير (/reports) وفي الذاكرة المشتركة (/memory)!");
  };

  const refreshSelfAwareness = async (targetOverride?: string) => {
    try {
      const t = encodeURIComponent(targetOverride || activeTarget);
      const data = await jsonRequest<NonNullable<typeof selfAwareness>>(`/deep-research/self-awareness?target=${t}`);
      setSelfAwareness(data);
    } catch {
      // ignore
    }
  };

  const handleRunAgentMaster = async () => {
    setDeepLoading("agent-master");
    try {
      const res = await jsonRequest<NonNullable<typeof agentMasterResult>>("/deep-research/agent-master-run", {
        method: "POST",
        body: JSON.stringify({ target: activeTarget }),
      });
      setAgentMasterResult(res);
      emitPlatformWsEvent({
        type: "scan_completed",
        target: activeTarget,
        title: `القائد الذكي الشامل (5 مراحل + سلسلة رباعية + Zero-FP) اكتمل على ${activeTarget}`,
      });
      setSyncStatusMsg(
        `✅ اكتمل التشغيل الذاتي الشامل للقائد الذكي (5 مراحل حية + سلسلة ثغرات رباعية + برهان Zero-FP) على ${activeTarget}!`,
      );
      void refreshSelfAwareness(activeTarget);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleSearchCorpus2400 = async (qOverride?: string, layerOverride?: string) => {
    try {
      const q = encodeURIComponent(qOverride ?? corpusQuery);
      const l = encodeURIComponent(layerOverride ?? corpusLayer);
      const data = await jsonRequest<NonNullable<typeof corpusData>>(
        `/deep-research/corpus-search?q=${q}&layer=${l}&limit=18`,
      );
      setCorpusData(data);
    } catch {
      // ignore
    }
  };

  const refreshWorkstationState = async () => {
    try {
      const data = await jsonRequest<NonNullable<typeof workstationData>>("/deep-research/workstation-state");
      // Also check live GitHub repository cloud checkpoint if available
      try {
        const ghRes = await fetch(
          "https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/state/cybernova-brain-state.json",
          { cache: "no-store" },
        );
        if (ghRes.ok) {
          const ghBrain = await ghRes.json();
          if (
            ghBrain?.daemonStatus?.autonomousCyclesCompleted >
            (data.brainState?.daemonStatus?.autonomousCyclesCompleted || 0)
          ) {
            data.brainState = ghBrain;
          }
        }
      } catch {
        // use local/server state
      }
      setWorkstationData(data);
    } catch {
      // ignore
    }
  };

  const handleRunProxyRepeater = async () => {
    setDeepLoading("repeater");
    try {
      const res = await jsonRequest<NonNullable<typeof repeaterResult>>("/deep-research/workstation-proxy-repeater", {
        method: "POST",
        body: JSON.stringify({
          url: repeaterUrl || `https://${activeTarget}`,
          method: repeaterMethod,
          headersText: repeaterHeaders,
          compareSessionBHeader: repeaterSessionB,
          codecInput: repeaterCodecInput,
        }),
      });
      setRepeaterResult(res);
      setSyncStatusMsg(`✅ تم تنفيذ طلب Burp/Caido Repeater على ${res.hostname} (HTTP ${res.status} · SHA256=${res.sha256}) وحفظه في خزنة المستخرجات!`);
      void refreshWorkstationState();
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunMsfConsole = async (cmdOverride?: string, modOverride?: string) => {
    setDeepLoading("msf");
    try {
      const res = await jsonRequest<NonNullable<typeof msfResult>>("/deep-research/workstation-msf-console", {
        method: "POST",
        body: JSON.stringify({
          command: cmdOverride ?? msfCommand,
          moduleId: modOverride ?? msfModuleId,
          target: activeTarget,
        }),
      });
      setMsfResult(res);
      setSyncStatusMsg(`✅ تم تشغيل وحدة التحقق [${res.activeModule.path}] في كونسول msf6-verify وحفظ النتيجة في المستخرجات!`);
      void refreshWorkstationState();
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunTerminal = async (cmdOverride?: string) => {
    setDeepLoading("terminal");
    try {
      const cmdToRun = cmdOverride ?? termCommand;
      const res = await jsonRequest<{ command: string; output: string }>("/deep-research/workstation-terminal", {
        method: "POST",
        body: JSON.stringify({
          command: cmdToRun,
          target: activeTarget,
        }),
      });
      setTermOutput(res.output);
      setSyncStatusMsg(`✅ تم تنفيذ أمر الطرفية (${res.command}) وتحديث سجل المستخرجات!`);
      void refreshWorkstationState();
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleTriggerDaemonPulse = async () => {
    setDeepLoading("daemon-pulse");
    try {
      const res = await jsonRequest<{ ok: boolean; brainState: NonNullable<typeof workstationData>["brainState"] }>(
        "/deep-research/workstation-multitask",
        {
          method: "POST",
          body: JSON.stringify({ action: "tick", target: activeTarget }),
        },
      );
      if (workstationData && res.brainState) {
        setWorkstationData({ ...workstationData, brainState: res.brainState });
      } else {
        void refreshWorkstationState();
      }
      setSyncStatusMsg(`✅ اكتملت نبضة العمل والتطوير الذاتي 24/7 وتم تحديث خزنة المستخرجات وذاكرة GitHub السحابية!`);
      void refreshSelfAwareness(activeTarget);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleAddParallelTask = async () => {
    const tTarget = (newTaskTarget || activeTarget).trim();
    const tTitle = (newTaskTitle || `مهمة مراقبة وفحص مستمر 24/7: ${tTarget}`).trim();
    setDeepLoading("add-task");
    try {
      const res = await jsonRequest<{ ok: boolean; brainState: NonNullable<typeof workstationData>["brainState"] }>(
        "/deep-research/workstation-multitask",
        {
          method: "POST",
          body: JSON.stringify({ action: "add", target: tTarget, titleAr: tTitle }),
        },
      );
      setNewTaskTitle("");
      setNewTaskTarget("");
      if (workstationData && res.brainState) {
        setWorkstationData({ ...workstationData, brainState: res.brainState });
      } else {
        void refreshWorkstationState();
      }
      setSyncStatusMsg(`✅ تمت إضافة المهمة المتوازية (${tTitle}) إلى طابور العمل المستمر 24/7!`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  useEffect(() => {
    void jsonRequest<{ tools: typeof arsenalTools }>("/deep-research/arsenal")
      .then((d) => setArsenalTools(d.tools || []))
      .catch(() => {});
    void jsonRequest<{ platforms: typeof globalPlatforms }>("/deep-research/platforms")
      .then((d) => setGlobalPlatforms(d.platforms || []))
      .catch(() => {});
    void jsonRequest<{ tools: typeof kaliTools }>("/deep-research/kali-arsenal")
      .then((d) => setKaliTools(d.tools || []))
      .catch(() => {});
    void jsonRequest<{ primitives: typeof primitivesList }>("/deep-research/primitives")
      .then((d) => setPrimitivesList(d.primitives || []))
      .catch(() => {});
    void refreshSelfAwareness();
    void refreshWorkstationState();
    void handleSearchCorpus2400("", "all");
  }, []);

  const togglePrimitiveSelection = (primId: string) => {
    setSelectedPrimitives((prev) =>
      prev.includes(primId) ? prev.filter((p) => p !== primId) : [...prev, primId],
    );
  };

  const handleCreativeRandomMix = async () => {
    const creativeSets = [
      ["P27-FLASHLOAN-ORACLE-TWAP", "P25-READONLY-REENTRANCY", "P26-ERC4626-VAULT-INFLATION", "P28-BRIDGE-SIGNATURE-REPLAY"],
      ["P07-SUBDOMAIN-CNAME", "P10-COOKIE-SCOPE", "P06-CORS-CRED", "P08-OAUTH-REDIRECT"],
      ["P01-JS-ENDPOINT", "P23-AI-PROMPT-AGENCY", "P11-SSRF-FETCH", "P12-CLOUD-IMDS"],
      ["P13-CACHE-POISON", "P15-HTTP-DESYNC", "P14-CACHE-DECEPTION", "P09-JWT-WEAK"],
      ["P05-GRAPHQL-INTRO", "P04-MASS-ASSIGN", "P16-RACE-TOCTOU", "P03-BFLA-ADMIN"],
      ["P21-PROTO-POLLUTION", "P19-POSTMESSAGE-DOM", "P20-CSWSH-WS", "P08-OAUTH-REDIRECT"],
      ["P17-SAML-XSW", "P18-WEBAUTHN-PASSKEY", "P03-BFLA-ADMIN", "P02-BOLA-IDOR"],
    ];
    const picked = creativeSets[Math.floor(Math.random() * creativeSets.length)]!;
    setSelectedPrimitives(picked);
    await handleRunChainSynthesizer(picked);
  };

  const handleSimulateKaliTool = async (toolId: string) => {
    setDeepLoading(`kali-${toolId}`);
    try {
      const res = await jsonRequest<NonNullable<typeof kaliSimResult>>("/deep-research/kali-simulate", {
        method: "POST",
        body: JSON.stringify({ toolId, target: activeTarget }),
      });
      setKaliSimResult(res);
      emitPlatformWsEvent({
        type: "recon_cmd_executed",
        target: activeTarget,
        title: `Kali Tool [${res.toolName}]: ${res.command}`,
      });
      setSyncStatusMsg(`✅ تم تنفيذ الفحص الآمن لأداة [${res.toolName}] على ${activeTarget} وتسجيل المخرجات في الذاكرة ومتتبع المهام!`);
      void refreshSelfAwareness();
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunChainSynthesizer = async (overrideIds?: string[]) => {
    setDeepLoading("chains");
    try {
      const prims = overrideIds ?? selectedPrimitives;
      const res = await jsonRequest<NonNullable<typeof chainResult>>("/deep-research/chain-synthesizer", {
        method: "POST",
        body: JSON.stringify({ target: activeTarget, primitiveIds: prims }),
      });
      setChainResult(res);
      emitPlatformWsEvent({
        type: "finding_recorded",
        target: activeTarget,
        title: `دمج متزامن لـ (${prims.length}) ثغرات وبناء ${res.chains.length} سلاسل مركبة على ${activeTarget}`,
      });
      setSyncStatusMsg(`✅ تم دمج (${prims.length}) ثغرات في نفس الوقت وبناء ${res.chains.length} سلاسل أثر مركب على ${activeTarget}!`);
      void refreshSelfAwareness();
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleSendChainToReport = (chain: NonNullable<typeof chainResult>["chains"][number]) => {
    setReportTitle(`${chain.title} on ${activeTarget}`);
    setReportAsset(`https://${activeTarget}`);
    setReportCwe(chain.cweChain.join(" + "));
    setReportSummary(
      `سلسلة ثغرات مركبة (Vulnerability Chain) تجمع بين ${chain.cweChain.join(" و ")} لرفع الأثر الأمني إلى ${chain.combinedSeverity}.`
    );
    setReportSteps(chain.steps.join("\n"));
    setReportFix(chain.remediation);
    setActiveTab("report");
    setSyncStatusMsg("✅ تم نقل سلسلة الثغرات المركبة إلى مولّد التقارير وحاسبة CVSS 3.1!");
  };

  const handleRunLiveOsint = async () => {
    setDeepLoading("osint");
    try {
      const res = await jsonRequest<NonNullable<typeof osintResult>>("/deep-research/live-osint", {
        method: "POST",
        body: JSON.stringify({ target: activeTarget }),
      });
      setOsintResult(res);
      emitPlatformWsEvent({
        type: "recon_cmd_executed",
        target: activeTarget,
        title: `OSINT (CRT.SH + Shodan InternetDB + Wayback): ${res.crtSubdomains.length} نطاق فرعي`,
      });
      setSyncStatusMsg(`✅ تم سحب استخبارات CRT.SH وShodan InternetDB وWayback Machine لـ ${activeTarget} وتسجيلها في الذاكرة!`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunJwtCookieAudit = async () => {
    setDeepLoading("jwt");
    try {
      const res = await jsonRequest<NonNullable<typeof jwtAuditResult>>("/deep-research/jwt-cookie-auditor", {
        method: "POST",
        body: JSON.stringify({ jwt: jwtInput, cookie: cookieInput }),
      });
      setJwtAuditResult(res);
      emitPlatformWsEvent({
        type: "finding_recorded",
        target: activeTarget,
        title: `فحص JWT & Cookie: رصد ${res.issues.length} ملاحظات أمنية`,
      });
      setSyncStatusMsg(`✅ اكتمل تدقيق JWT وSet-Cookie (${res.issues.length} ملاحظات) وتم حفظه في الذاكرة!`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunSchemaAudit = async () => {
    setDeepLoading("schema");
    try {
      const res = await jsonRequest<NonNullable<typeof schemaAuditResult>>("/deep-research/schema-auditor", {
        method: "POST",
        body: JSON.stringify({ target: activeTarget }),
      });
      setSchemaAuditResult(res);
      emitPlatformWsEvent({
        type: "scan_completed",
        target: activeTarget,
        title: `فحص GraphQL & OpenAPI Schema: ${activeTarget}`,
      });
      setSyncStatusMsg(`✅ اكتمل فحص مخططات GraphQL وOpenAPI على ${activeTarget}!`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunPipeline = async () => {
    setDeepLoading("pipeline");
    try {
      const res = await jsonRequest<NonNullable<typeof pipelineResult>>("/deep-research/pipeline", {
        method: "POST",
        body: JSON.stringify({ target: activeTarget }),
      });
      setPipelineResult(res);
      if (res.endpoints?.[0]) {
        const cleanHost = activeTarget.replace(/^https?:\/\//, "").replace(/^\*\./, "");
        setMatrixEndpoint(`https://${cleanHost}${res.endpoints[0]}`);
      }
      emitPlatformWsEvent({
        type: "scan_completed",
        target: activeTarget,
        title: `مسار البحث الذاتي (4 مراحل) اكتمل على ${activeTarget}`,
      });
      setSyncStatusMsg(`✅ اكتمل مسار البحث الذاتي (4 مراحل) على ${activeTarget} وتم حفظ الأدلة والفرضيات في الذاكرة ومتتبع المهام!`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunJsAnalyzer = async () => {
    setDeepLoading("js");
    try {
      const res = await jsonRequest<NonNullable<typeof jsAnalysisResult>>("/deep-research/js-analyzer", {
        method: "POST",
        body: JSON.stringify({ target: activeTarget }),
      });
      setJsAnalysisResult(res);
      emitPlatformWsEvent({
        type: "recon_cmd_executed",
        target: activeTarget,
        title: `تحليل JS والمسارات المخفية: ${res.endpoints.length} مسار مكتشف`,
      });
      setSyncStatusMsg(`✅ تم استخراج ${res.endpoints.length} مسار API و${res.parameters.length} معامل من ملفات JS وتسجيلها في الذاكرة!`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunAuthMatrix = async () => {
    setDeepLoading("matrix");
    try {
      const res = await jsonRequest<NonNullable<typeof authMatrixResult>>("/deep-research/auth-matrix", {
        method: "POST",
        body: JSON.stringify({
          endpointUrl: matrixEndpoint,
          sessionAHeader,
          sessionBHeader,
        }),
      });
      setAuthMatrixResult(res);
      emitPlatformWsEvent({
        type: "finding_recorded",
        target: matrixEndpoint,
        title: `مصفوفة الصلاحيات التفاضلية: ${res.verdict} (${res.similarityPercent}%)`,
      });
      setSyncStatusMsg(`✅ اكتملت المقارنة التفاضلية للصلاحيات (BOLA/IDOR) — التشابه الهيكلي: ${res.similarityPercent}%`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunConfigAuditor = async () => {
    setDeepLoading("config");
    try {
      const res = await jsonRequest<NonNullable<typeof configAuditResult>>("/deep-research/config-auditor", {
        method: "POST",
        body: JSON.stringify({ target: activeTarget }),
      });
      setConfigAuditResult(res);
      emitPlatformWsEvent({
        type: "scan_completed",
        target: activeTarget,
        title: `فحص الإعدادات المعمارية (CORS / CNAME / security.txt): ${activeTarget}`,
      });
      setSyncStatusMsg(`✅ اكتمل تدقيق CORS وبصمات CNAME وملف security.txt لـ ${activeTarget}!`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleRunZeroFpGate = async () => {
    setDeepLoading("zerofp");
    try {
      const res = await jsonRequest<NonNullable<typeof zeroFpResult>>("/deep-research/zero-fp-verify", {
        method: "POST",
        body: JSON.stringify({
          targetUrl: `https://${activeTarget.replace(/^https?:\/\//, "").replace(/^\*\./, "")}`,
          title: zeroFpTitle,
          severity: zeroFpSev,
        }),
      });
      setZeroFpResult(res);
      emitPlatformWsEvent({
        type: "finding_recorded",
        target: activeTarget,
        title: `بوابة البرهان (Zero-FP): CVSS ${res.cvssScore} — ${zeroFpTitle}`,
      });
      setSyncStatusMsg(`✅ تم التحقق عبر بوابة البرهان (Zero-FP Gate) وحفظ حزمة الدليل الرقمي في خزنة الأدلة (/evidence)!`);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

  const handleSearchGithubArsenal = async () => {
    if (!ghSearchQuery.trim()) return;
    setDeepLoading("github");
    try {
      const res = await jsonRequest<{ items?: typeof ghSearchResults }>(
        `/github/search?q=${encodeURIComponent(ghSearchQuery.trim())}&type=repositories&per_page=8`,
      );
      setGhSearchResults(res.items || []);
    } catch {
      // ignore
    } finally {
      setDeepLoading(null);
    }
  };

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

        {/* ── Live Target & Internal WebSocket Sync Bar ───────────────────── */}
        <div className="mt-4 p-3.5 rounded-xl bg-black/50 border border-emerald-500/25 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
            <div className="lg:col-span-4 flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-mono text-emerald-300 shrink-0">
                <Radio className={`w-3.5 h-3.5 ${wsConnected ? "animate-pulse text-emerald-400" : "text-amber-400"}`} />
                <span>WS LIVE</span>
              </div>
              <div className="flex-1 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-purple-400 shrink-0" />
                <input
                  dir="ltr"
                  value={activeTarget}
                  onChange={(e) => setActiveTarget(e.target.value)}
                  placeholder="الهدف النشط (e.g. api.example.com)"
                  className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-xs font-mono text-white"
                />
                <button
                  onClick={() => void handleActivateTarget(activeTarget)}
                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white shrink-0"
                >
                  تفعيل الهدف
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 flex items-center gap-2">
              <input
                value={quickNote}
                onChange={(e) => setQuickNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveQuickNote();
                }}
                placeholder="سجّل ملاحظة فحص فورية على الهدف (تُحفظ في الذاكرة ومتتبع المهام وتُبث للوكلاء)..."
                className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-xs text-white"
              />
              <button
                onClick={() => void handleSaveQuickNote()}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-1 shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>تسجيل</span>
              </button>
            </div>

            <div className="lg:col-span-3 text-[11px] font-mono text-emerald-300 truncate">
              {liveFeed[0] ? `⚡ ${liveFeed[0].text}` : "جاهز للتسجيل الحي"}
            </div>
          </div>

          {syncStatusMsg && (
            <div className="text-xs font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-lg px-3 py-1.5 flex items-center justify-between">
              <span>{syncStatusMsg}</span>
              <button onClick={() => setSyncStatusMsg("")} className="text-gray-400 hover:text-white text-[10px]">
                إغلاق ✕
              </button>
            </div>
          )}

          {/* ── 24/7 Persistent GitHub Cloud Brain & Continuity Banner ("أنا فين؟ وصلت لإيه؟ إيه الجديد؟ المستخرجات") ── */}
          {workstationData?.brainState && (
            <div className="p-3.5 rounded-xl bg-gradient-to-l from-purple-950/50 via-black/70 to-emerald-950/40 border border-purple-500/35 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-300">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 font-mono text-[10px] text-emerald-300">
                    🟢 {workstationData.brainState.daemonStatus.state} · الدورات المكتملة: #{workstationData.brainState.daemonStatus.autonomousCyclesCompleted}
                  </span>
                  <span>☁️ ذاكرة GitHub السحابية الدائمة ومتتبع الاستمرارية الحي (يعرف دايماً هو فين ووصل لإيه)</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setActiveTab("workstation")}
                    className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-[11px] font-extrabold text-white"
                  >
                    🖥️ فتح كمبيوتر الشغل وتعدد النوافذ (Burp/Caido + MSF + Terminal)
                  </button>
                  <button
                    onClick={() => void handleTriggerDaemonPulse()}
                    disabled={deepLoading === "daemon-pulse"}
                    className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[11px] font-bold text-white"
                  >
                    {deepLoading === "daemon-pulse" ? "⚡ جاري التحديث الذاتي..." : "⚡ تشغيل دورة تطور وفحص ذاتي الآن"}
                  </button>
                  <a
                    href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/desktop`}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-bold text-sky-200"
                  >
                    🪟 سطح المكتب الكامل
                  </a>
                  <a
                    href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/kali-terminal`}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-bold text-amber-200"
                  >
                    💻 طرفية كالي الكاملة
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-black/50 border border-white/10">
                  <div className="font-bold text-amber-300 mb-0.5">📍 هو فين دلوقتي؟ (Where Am I Now)</div>
                  <div className="text-gray-200 leading-relaxed">
                    الهدف: <span className="font-mono text-emerald-300">{workstationData.brainState.whereAmINow.activeTarget}</span> ({workstationData.brainState.whereAmINow.overallProgressPercent}%) — {workstationData.brainState.whereAmINow.currentStageTitleAr}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-black/50 border border-white/10">
                  <div className="font-bold text-sky-300 mb-0.5">📈 وصل لإيه؟ (What Did I Reach)</div>
                  <div className="text-gray-200 leading-relaxed">
                    {workstationData.brainState.whatDidIReach.metrics.totalIndexedKnowledgeItems.toLocaleString()}+ نمط أمني | {workstationData.brainState.whatDidIReach.metrics.kaliToolsReady} أداة كالي | {workstationData.brainState.whatDidIReach.metrics.githubArsenalProjects} مشروع GitHub | {workstationData.brainState.whatDidIReach.metrics.workstationEnvironments} بيئة عمل
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-black/50 border border-white/10">
                  <div className="font-bold text-purple-300 mb-0.5">🆕 إيه الجديد؟ (What&apos;s New)</div>
                  <div className="text-gray-200 leading-relaxed">
                    {workstationData.brainState.whatsNewLog[0]?.titleAr}: {workstationData.brainState.whatsNewLog[0]?.detailAr.slice(0, 110)}...
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-black/50 border border-white/10">
                  <div className="font-bold text-emerald-300 mb-0.5">
                    📦 المستخرجات والسجل ({workstationData.brainState.extractedArtifactsVault.length} غنيمة موثقة)
                  </div>
                  <div className="text-gray-200 font-mono text-[11px] leading-relaxed">
                    {workstationData.brainState.extractedArtifactsVault[0]?.titleAr}: {workstationData.brainState.extractedArtifactsVault[0]?.value.slice(0, 95)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-white/10">
          {[
            { id: "deep2099", label: "🚀 محرك الاكتشاف العميق 2099 وترسانة GitHub", icon: Sparkles },
            { id: "workstation", label: "🖥️ كمبيوتر الشغل وتعدد النوافذ والترمنال والذاكرة 24/7", icon: Terminal },
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

      {/* ── TAB 0: Deep Bug Bounty Verification Engine 2099 & GitHub Arsenal ── */}
      {activeTab === "deep2099" && (
        <div className="space-y-6">
          {/* ── IMMUNEFI WEB3 & SMART CONTRACT MEGA-BOUNTY COMMAND HUB ── */}
          <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-l from-cyan-950/40 via-[#070b18] to-purple-950/35 p-5 space-y-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-cyan-300">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>IMMUNEFI WEB3 · SMART CONTRACT & DEFI MEGA-BOUNTY HUB ($50K – $15M)</span>
                </div>
                <h2 className="text-lg md:text-xl font-extrabold text-white mt-0.5">
                  💎 مركز صيد ثغرات العقود الذكية وبروتوكولات Web3 / DeFi لمنصة <span className="text-cyan-300 font-mono">Immunefi</span>
                </h2>
                <p className="text-xs text-gray-300 mt-1 max-w-4xl">
                  مجهز بالكامل بأدوات التحليل الساكن والرمزي والـ Fuzzing لعقود Solidity / Vyper / Rust / Move (Foundry Forge, Slither, Aderyn, Echidna, Medusa, Halmos, Mythril, Heimdall-rs) ولبنات ثغرات DeFi المركبة (Read-Only Reentrancy, ERC-4626 Share Inflation, Flash Loan Oracle Manipulation, Cross-Chain Bridge Signature Verification).
                  <span className="text-emerald-300 font-bold"> القاعدة الذهبية لـ Immunefi: يُمنع تماماً التفاعل مع العقود على الشبكة الحية (Mainnet) — يتم بناء وإثبات كل PoC حصرياً داخل بيئة Foundry Local Fork المعزولة 100%!</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    const web3Prims = [
                      "P27-FLASHLOAN-ORACLE-TWAP",
                      "P25-READONLY-REENTRANCY",
                      "P26-ERC4626-VAULT-INFLATION",
                      "P28-BRIDGE-SIGNATURE-REPLAY",
                    ];
                    setSelectedPrimitives(web3Prims);
                    void handleRunChainSynthesizer(web3Prims);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-l from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-xs font-extrabold text-white shadow-lg shadow-cyan-600/25"
                >
                  ⚡ تركيب سلسلة ثغرات Immunefi الرباعية (P25+P26+P27+P28)
                </button>
                <button
                  onClick={() => {
                    setSelectedVulnId("immunefi-reentrancy-readonly");
                    setActiveTab("encyclopedia");
                  }}
                  className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-xs font-bold text-cyan-200"
                >
                  📚 موسوعة ثغرات Immunefi & Solidity
                </button>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";

// برهان إثبات ثغرة قياسي لمنصة Immunefi يعمل حصرياً على نسخة Fork محلية معزولة 100%
// التشغيل الآمن: forge test --fork-url $ETH_RPC_URL --match-test testImmunefiLocalForkPoC -vvvv
contract ImmunefiExploitPoCTest is Test {
    uint256 mainnetFork;

    function setUp() public {
        // استنساخ حالة البلوك محلياً بدون إرسال أي معاملة للشبكة الحية
        mainnetFork = vm.createSelectFork(vm.envString("ETH_RPC_URL"));
    }

    function testImmunefiLocalForkPoC() public {
        address attacker = makeAddr("whitehat_researcher");
        vm.startPrank(attacker);
        // 1. تسجيل أرصدة الخزنة والباحث قبل التنفيذ (Before-State Snapshot)
        // 2. محاكاة سيناريو Read-Only Reentrancy أو ERC-4626 Precision Loss محلياً
        // 3. إثبات فرق الأرصدة (Insolvency / Unauthorized Yield) عبر assertGt()
        vm.stopPrank();
    }
}`,
                      "immunefi-foundry-poc",
                    )
                  }
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white"
                >
                  {copied === "immunefi-foundry-poc" ? "✓ تم نسخ قالب Foundry PoC!" : "📋 نسخ قالب Foundry Fork PoC لـ Immunefi"}
                </button>
              </div>
            </div>

            {/* Quick Immunefi Program Presets & Tool Triggers */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1">
              {[
                {
                  name: "LayerZero Protocol",
                  bounty: "$15,000,000",
                  target: "layerzero.network",
                  focus: "Cross-Chain Bridge & ULN Verification (P28)",
                  toolId: "foundry-forge",
                },
                {
                  name: "Sky / MakerDAO",
                  bounty: "$10,000,000",
                  target: "sky.money",
                  focus: "ERC-4626 Vaults, Oracles & Liquidations (P26/P27)",
                  toolId: "slither",
                },
                {
                  name: "Wormhole Bridge",
                  bounty: "$10,000,000",
                  target: "wormhole.com",
                  focus: "Guardian Signatures & Proxy Implementation (P28)",
                  toolId: "halmos",
                },
                {
                  name: "Aave V3 & EigenLayer",
                  bounty: "$2,000,000+",
                  target: "aave.com",
                  focus: "Read-Only Reentrancy & Health Factor Math (P25)",
                  toolId: "echidna",
                },
              ].map((prog) => (
                <div
                  key={prog.name}
                  className="p-3 rounded-xl bg-black/50 border border-cyan-500/25 flex flex-col justify-between gap-2"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-extrabold text-white">{prog.name}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-mono font-bold text-emerald-300">
                        {prog.bounty}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-300 mt-1">{prog.focus}</div>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      onClick={() => void handleActivateTarget(prog.target)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-400/30 text-[11px] font-bold text-cyan-200"
                    >
                      🎯 تفعيل نطاق {prog.target}
                    </button>
                    <button
                      onClick={() => void handleSimulateKaliTool(prog.toolId)}
                      className="px-2.5 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/30 text-[11px] font-mono text-purple-200"
                    >
                      ⚡ {prog.toolId}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 0. Self-Awareness & Coverage Diagnostic Matrix */}
          {selfAwareness && (
            <div className="rounded-2xl border border-purple-500/35 bg-gradient-to-l from-purple-950/35 via-[#0b0716] to-emerald-950/30 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-mono text-purple-300">
                    SELF-AWARE AUTONOMOUS SECURITY PLATFORM · COVERAGE DIAGNOSTIC ENGINE
                  </div>
                  <h2 className="text-lg font-extrabold text-white mt-0.5">
                    🧠 الوعي الذاتي الكامل للمنصة وتغطية الفحص على: <span className="font-mono text-emerald-300">{activeTarget}</span>
                  </h2>
                  <p className="text-xs text-gray-300 mt-1">
                    تراقب المنصة تلقائياً كل ما لديها من محركات وأدوات وذاكرة وأدلة، وتحدد أبعاد الفحص المكتملة والمتبقية على الهدف النشط.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-center">
                    <div className="text-[10px] text-emerald-300 font-mono">نسبة تغطية الفحص</div>
                    <div className="text-xl font-extrabold font-mono text-white">{selfAwareness.coveragePercent}%</div>
                  </div>
                  <button
                    onClick={() => void handleRunAgentMaster()}
                    disabled={deepLoading === "agent-master"}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-l from-emerald-600 to-purple-600 hover:from-emerald-500 hover:to-purple-500 disabled:opacity-50 text-xs font-extrabold text-white shadow-lg shadow-purple-600/30"
                  >
                    {deepLoading === "agent-master"
                      ? "⚡ القائد الذكي ينفذ المراحل الـ 5..."
                      : "🚀 تشغيل القائد الذكي الشامل (5 مراحل + سلسلة رباعية)"}
                  </button>
                  <button
                    onClick={() => setShowDoctrineMatrix((v) => !v)}
                    className="px-3.5 py-2.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 text-xs font-bold text-purple-200"
                  >
                    {showDoctrineMatrix ? "إخفاء مصفوفة القرار التكتيكي" : "🎯 مصفوفة (فين؟ امتى؟ إزاي؟ ليه؟)"}
                  </button>
                  <button
                    onClick={() => void refreshSelfAwareness()}
                    className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white"
                  >
                    🔄 تحديث الوعي
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-9 gap-2 text-center">
                {[
                  { label: "الفهرس المعرفي الشامل", val: (selfAwareness.selfAwarenessSummary.totalIndexedKnowledgeItems ?? 2576).toLocaleString() + "+" },
                  { label: "محركات البحث العميق", val: selfAwareness.selfAwarenessSummary.deepEnginesCount },
                  { label: "أدوات Kali Linux (12 فئة)", val: selfAwareness.selfAwarenessSummary.kaliToolsIntegrated },
                  { label: "ترسانة GitHub الأمنية", val: selfAwareness.selfAwarenessSummary.githubArsenalCount },
                  { label: "موسوعة الثغرات الشاملة", val: ENCYCLOPEDIA.length },
                  { label: "لبنات الدمج التوليفي", val: selfAwareness.selfAwarenessSummary.vulnPrimitivesCount ?? 24 },
                  { label: "سجلات الذاكرة", val: selfAwareness.selfAwarenessSummary.memoriesStored },
                  { label: "نتائج المهام", val: selfAwareness.selfAwarenessSummary.missionFindings },
                  { label: "الأدلة والتقارير", val: selfAwareness.selfAwarenessSummary.verifiedEvidence + selfAwareness.selfAwarenessSummary.reportsSaved },
                ].map((stat, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-black/40 border border-white/10">
                    <div className="text-base font-extrabold font-mono text-emerald-400">{stat.val}</div>
                    <div className="text-[10px] text-gray-300 mt-0.5">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {selfAwareness.dimensions.map((dim) => (
                  <div
                    key={dim.id}
                    className={`p-3 rounded-xl border text-xs ${
                      dim.completed
                        ? "bg-emerald-950/25 border-emerald-500/35 text-emerald-200"
                        : "bg-black/40 border-white/10 text-gray-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-bold">
                      <span>{dim.name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40">
                        {dim.completed ? "✅ مكتمل" : "⏳ مقترح"}
                      </span>
                    </div>
                    {!dim.completed && (
                      <div className="text-[11px] text-amber-300 mt-1">{dim.recommendedAction}</div>
                    )}
                  </div>
                ))}
              </div>

              <div className="text-xs font-mono text-purple-200 bg-purple-950/30 border border-purple-500/30 rounded-xl px-3.5 py-2">
                💡 التوصية الذكية التالية للهدف ({activeTarget}): {selfAwareness.nextRecommendedStep}
              </div>

              {/* Tactical Decision Doctrine Matrix: WHERE / WHEN / HOW / WHY */}
              {showDoctrineMatrix && selfAwareness.tacticalDoctrine && selfAwareness.tacticalDoctrine.length > 0 && (
                <div className="rounded-xl bg-black/50 border border-purple-500/35 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-extrabold text-purple-200">
                      🎯 العقيدة التكتيكية الموحدة للقائد الذكي وجميع الوكلاء: فين؟ وامتى؟ وإزاي؟ وليه وعشان إيه؟
                    </div>
                    <span className="px-2.5 py-0.5 rounded bg-purple-500/20 text-[10px] font-mono text-purple-200">
                      6-STAGE TACTICAL BRAIN · 100% CONNECTED
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {selfAwareness.tacticalDoctrine.map((doc) => (
                      <div key={doc.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5 text-xs">
                        <div className="font-extrabold text-emerald-300">{doc.engineNameAr}</div>
                        <div className="text-[11px] font-mono text-purple-300">
                          🛠️ {doc.toolsUsed.join(" · ")}
                        </div>
                        <div className="text-gray-200">
                          <span className="font-bold text-amber-300">📍 فين (WHERE): </span>
                          {doc.whereAr}
                        </div>
                        <div className="text-gray-200">
                          <span className="font-bold text-sky-300">⏱️ امتى (WHEN): </span>
                          {doc.whenAr}
                        </div>
                        <div className="text-gray-200">
                          <span className="font-bold text-emerald-300">⚙️ إزاي (HOW): </span>
                          {doc.howAr}
                        </div>
                        <div className="text-gray-200">
                          <span className="font-bold text-pink-300">🎯 ليه وعشان إيه (WHY): </span>
                          {doc.whyAndForWhatAr}
                        </div>
                        <div className="text-[11px] font-mono text-emerald-400 pt-1 border-t border-white/10">
                          🔗 {doc.unlocksNext}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Agent Master 5-Stage Execution Output */}
              {agentMasterResult && (
                <div className="rounded-xl bg-emerald-950/25 border border-emerald-500/40 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-extrabold text-emerald-300">
                      ✅ سجل التنفيذ الحي للقائد الذكي الشامل على ({agentMasterResult.target}) — التغطية: {agentMasterResult.coverageAfter}%
                    </div>
                    <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-[11px] font-mono text-emerald-200">
                      Zero-FP Verified: {agentMasterResult.zeroFpProof.targetHash} ≠ {agentMasterResult.zeroFpProof.baseline404Hash}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
                    {agentMasterResult.stepsExecuted.map((st) => (
                      <div key={st.stepNumber} className="p-3 rounded-xl bg-black/60 border border-emerald-500/30 space-y-1 text-xs">
                        <div className="font-bold text-emerald-300">{st.toolName}</div>
                        <div className="text-[11px] text-amber-200">📍 فين: {st.where}</div>
                        <div className="text-[11px] text-sky-200">🎯 ليه: {st.why}</div>
                        <div className="text-[10px] font-mono text-purple-300 bg-black/50 p-1.5 rounded">
                          $ {st.commandExecuted}
                        </div>
                        <div className="text-[11px] font-mono text-gray-200 pt-1 border-t border-white/10">
                          {st.liveOutput}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 1. Autonomous 4-Stage Research Pipeline Banner */}
          <div className="rounded-2xl border border-emerald-500/35 bg-gradient-to-l from-emerald-950/30 via-[#0b0716] to-purple-950/30 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-emerald-400">
                  AUTONOMOUS 4-STAGE RESEARCH PIPELINE · ZERO-FALSE-POSITIVE ENGINE
                </div>
                <h2 className="text-xl font-extrabold text-white mt-0.5">
                  ⚡ مسار البحث الذاتي المتسلسل (4 مراحل) على الهدف النشط: <span className="font-mono text-emerald-300">{activeTarget}</span>
                </h2>
                <p className="text-xs text-gray-300 mt-1">
                  ينفذ الاستطلاع السلبي (DNS/TLS)، ثم يشرح ملفات الـ JS والترويسات، ثم يأخذ بصمة SHA-256 الأساسية لاستبعاد صفحات الخطأ الكاذبة (Soft-404)، وأخيراً يرتب أقوى الفرضيات البحثية ويوثق الأدلة تلقائياً في الذاكرة وخزنة الأدلة.
                </p>
              </div>
              <button
                onClick={() => void handleRunPipeline()}
                disabled={deepLoading === "pipeline"}
                className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-extrabold text-white shadow-lg shadow-emerald-600/30 flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {deepLoading === "pipeline"
                    ? "جاري تشغيل المراحل الـ 4..."
                    : "تشغيل مسار البحث الذاتي (4 مراحل)"}
                </span>
              </button>
            </div>

            {pipelineResult && (
              <div className="space-y-4 pt-2 border-t border-white/10">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {pipelineResult.stages.map((st) => (
                    <div
                      key={st.stage}
                      className="p-3.5 rounded-xl bg-black/50 border border-emerald-500/30 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
                        <span>{st.name}</span>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-[10px] font-mono">✓ DONE</span>
                      </div>
                      <p className="text-xs text-gray-300 leading-relaxed font-mono">{st.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 space-y-3">
                  <div className="text-sm font-bold text-amber-300">
                    🎯 الفرضيات البحثية المرتبة حسب الأولوية لـ {pipelineResult.hostname} (اضغط لتحويلها إلى تقرير رسمي):
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {pipelineResult.hypotheses.map((h) => (
                      <div
                        key={h.rank}
                        className="p-3.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between gap-2"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono text-emerald-400">#{h.rank} · {h.cwe}</span>
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                              {h.priority}
                            </span>
                          </div>
                          <div className="text-xs font-bold text-white">{h.title}</div>
                          <p className="text-[11px] text-gray-300 leading-relaxed">{h.verificationSteps}</p>
                        </div>
                        <button
                          onClick={() => {
                            setReportTitle(h.title);
                            setReportCwe(h.cwe);
                            setReportSteps(h.verificationSteps);
                            setActiveTab("report");
                          }}
                          className="w-full mt-2 px-3 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-[11px] font-bold text-purple-200"
                        >
                          📝 إرسال الفرضية لمولّد التقارير
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. Deep JS & SourceMap Analyzer + Differential BOLA/IDOR Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Deep JS Analyzer */}
            <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Code className="w-4 h-4 text-sky-400" />
                    <span>1. محلل ملفات الـ JS والمسارات المخفية (LinkFinder / SourceMap Engine)</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    يستخرج مسارات الـ API الخفية والمعاملات ومستمعات postMessage من حزم الواجهة للهدف النشط.
                  </p>
                </div>
                <button
                  onClick={() => void handleRunJsAnalyzer()}
                  disabled={deepLoading === "js"}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-xs font-bold text-white shrink-0"
                >
                  {deepLoading === "js" ? "جاري التحليل..." : "تشريح ملفات JS"}
                </button>
              </div>

              {jsAnalysisResult && (
                <div className="space-y-3 pt-2 border-t border-white/10 text-xs">
                  <div className="p-2.5 rounded-lg bg-sky-950/30 border border-sky-500/30 text-sky-200 font-mono">
                    {jsAnalysisResult.summary}
                  </div>
                  <div>
                    <div className="font-bold text-gray-300 mb-1.5">
                      🔗 المسارات المستخرجة (اضغط على أي مسار لاختباره في مصفوفة BOLA/IDOR):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {jsAnalysisResult.endpoints.map((ep) => (
                        <button
                          key={ep}
                          onClick={() => {
                            const cleanHost = activeTarget.replace(/^https?:\/\//, "").replace(/^\*\./, "");
                            setMatrixEndpoint(`https://${cleanHost}${ep}`);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-black/50 hover:bg-sky-500/20 border border-white/15 font-mono text-[11px] text-emerald-300"
                        >
                          {ep}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-gray-300 mb-1">⚙️ المعاملات المكتشفة (Parameters):</div>
                    <div className="flex flex-wrap gap-1.5">
                      {jsAnalysisResult.parameters.map((p) => (
                        <span key={p} className="px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 font-mono text-[11px] text-purple-200">
                          ?{p}=
                        </span>
                      ))}
                    </div>
                  </div>
                  {jsAnalysisResult.sinks.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="font-bold text-amber-300">⚠️ نقاط الانتباه في الكود العميل (DOM Sinks):</div>
                      {jsAnalysisResult.sinks.map((s, idx) => (
                        <div key={idx} className="p-2.5 rounded-lg bg-black/40 border border-amber-500/30">
                          <div className="font-mono text-amber-300 font-bold">{s.sink} ({s.cwe})</div>
                          <div className="text-gray-300 mt-0.5">{s.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Differential Auth & BOLA/IDOR Matrix */}
            <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Lock className="w-4 h-4 text-purple-400" />
                    <span>2. مصفوفة المقارنة التفاضلية للصلاحيات (Autorize / BOLA Matrix)</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    تقارن استجابة حساب المالك (Session A) مع حساب الاختبار الثاني (Session B) والزائر غير المسجل لاكتشاف ثغرات IDOR/BOLA بدقة 100%.
                  </p>
                </div>
                <button
                  onClick={() => void handleRunAuthMatrix()}
                  disabled={deepLoading === "matrix"}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-xs font-bold text-white shrink-0"
                >
                  {deepLoading === "matrix" ? "جاري المقارنة..." : "فحص تفاضلي"}
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <input
                  dir="ltr"
                  value={matrixEndpoint}
                  onChange={(e) => setMatrixEndpoint(e.target.value)}
                  placeholder="Endpoint URL (e.g. https://api.target.com/v1/profile/1042)"
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 font-mono text-white"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    dir="ltr"
                    value={sessionAHeader}
                    onChange={(e) => setSessionAHeader(e.target.value)}
                    placeholder="Session A Header (Owner)"
                    className="px-3 py-1.5 rounded-xl bg-black/40 border border-emerald-500/30 font-mono text-[11px] text-emerald-200"
                  />
                  <input
                    dir="ltr"
                    value={sessionBHeader}
                    onChange={(e) => setSessionBHeader(e.target.value)}
                    placeholder="Session B Header (Secondary Account)"
                    className="px-3 py-1.5 rounded-xl bg-black/40 border border-amber-500/30 font-mono text-[11px] text-amber-200"
                  />
                </div>
              </div>

              {authMatrixResult && (
                <div className="space-y-3 pt-2 border-t border-white/10 text-xs">
                  <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/40 space-y-1">
                    <div className="flex items-center justify-between font-bold">
                      <span className="text-purple-300">النتيجة: {authMatrixResult.verdict}</span>
                      <span className="font-mono text-emerald-300">تشابه الاستجابة: {authMatrixResult.similarityPercent}%</span>
                    </div>
                    <p className="text-gray-200 leading-relaxed">{authMatrixResult.verdictAr}</p>
                  </div>
                  <div className="space-y-1.5">
                    {authMatrixResult.matrix.map((row, i) => (
                      <div key={i} className="p-2.5 rounded-lg bg-black/40 border border-white/10 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                        <span className="text-white font-sans font-bold">{row.actor}</span>
                        <span className="text-emerald-400">HTTP {row.status}</span>
                        <span className="text-gray-300">{row.length} bytes</span>
                        <span className="text-purple-300">SHA256: {row.hash}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Architectural Config Auditor + Zero-False-Positive Verification Gate */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Architectural Config Auditor */}
            <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span>3. مدقق الإعدادات المعمارية (CORS / Subdomain Takeover / security.txt)</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    يفحص انعكاس Origin في CORS، وبصمات النطاقات الفرعية المعلقة (can-i-take-over-xyz)، ويكتشف ملف سياسة الإفصاح الرسمي.
                  </p>
                </div>
                <button
                  onClick={() => void handleRunConfigAuditor()}
                  disabled={deepLoading === "config"}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-bold text-white shrink-0"
                >
                  {deepLoading === "config" ? "جاري التدقيق..." : "فحص الإعدادات"}
                </button>
              </div>

              {configAuditResult && (
                <div className="space-y-2.5 pt-2 border-t border-white/10 text-xs">
                  {configAuditResult.findings.map((f, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{f.check}</span>
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                            f.status === "CRITICAL"
                              ? "bg-red-500/20 text-red-300"
                              : f.status === "WARN"
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {f.status} · {f.cwe}
                        </span>
                      </div>
                      <p className="text-gray-300 leading-relaxed">{f.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Zero-False-Positive Verification Gate */}
            <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-amber-400" />
                    <span>4. بوابة البرهان واستبعاد الإنذارات الكاذبة (Zero-FP Gate & Evidence Vault)</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    تقارن بصمة الاستجابة مع بصمة 404 الأساسية للهدف وتحسب متجه CVSS v3.1 وتحفظ حزمة الدليل مباشرة في خزنة الأدلة (/evidence).
                  </p>
                </div>
                <button
                  onClick={() => void handleRunZeroFpGate()}
                  disabled={deepLoading === "zerofp"}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-bold text-white shrink-0"
                >
                  {deepLoading === "zerofp" ? "جاري التحقق..." : "توثيق وحفظ الدليل"}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <input
                  value={zeroFpTitle}
                  onChange={(e) => setZeroFpTitle(e.target.value)}
                  placeholder="عنوان النتيجة المراد التحقق منها..."
                  className="sm:col-span-2 px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-white"
                />
                <select
                  value={zeroFpSev}
                  onChange={(e) => setZeroFpSev(e.target.value as typeof zeroFpSev)}
                  className="px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-white font-mono"
                >
                  <option value="critical">Critical (9.6)</option>
                  <option value="high">High (8.2)</option>
                  <option value="medium">Medium (6.5)</option>
                  <option value="low">Low (3.7)</option>
                </select>
              </div>

              {zeroFpResult && (
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-emerald-300">
                      {zeroFpResult.verified ? "✅ تم التحقق وتأكيد الأصالة (Zero False Positive)" : "⚠️ تم التصنيف كصفحة خطأ افتراضية (Soft-404)"}
                    </span>
                    <span className="font-mono text-amber-300">CVSS {zeroFpResult.cvssScore}</span>
                  </div>
                  <div className="font-mono text-[11px] text-gray-300">
                    Target Hash: <span className="text-emerald-300">{zeroFpResult.targetHash}</span> | Baseline 404 Hash:{" "}
                    <span className="text-purple-300">{zeroFpResult.baseline404Hash}</span>
                  </div>
                  <div className="font-mono text-[11px] text-sky-300">{zeroFpResult.cvssVector}</div>
                </div>
              )}
            </div>
          </div>

          {/* 4. Curated Open-Source GitHub Security Arsenal + Live GitHub Search */}
          <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Globe className="w-5 h-5 text-emerald-400" />
                  <span>5. ترسانة أدوات GitHub الأمنية المفتوحة المدمجة في منهجية CyberNova 2099</span>
                </h3>
                <p className="text-xs text-gray-400">
                  أقوى الأدوات العالمية مفتوحة المصدر على GitHub التي تم دمج قواعدها ومنهجياتها مباشرة داخل محركات CyberNova:
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  dir="ltr"
                  value={ghSearchQuery}
                  onChange={(e) => setGhSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleSearchGithubArsenal()}
                  placeholder="ابحث مباشرة في GitHub عن أي أداة أو مستودع..."
                  className="px-3 py-1.5 rounded-xl bg-black/40 border border-white/15 text-xs font-mono text-white w-64"
                />
                <button
                  onClick={() => void handleSearchGithubArsenal()}
                  disabled={deepLoading === "github"}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white"
                >
                  {deepLoading === "github" ? "..." : "بحث GitHub حي"}
                </button>
              </div>
            </div>

            {ghSearchResults.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pb-3 border-b border-white/10">
                {ghSearchResults.map((repo, idx) => (
                  <a
                    key={idx}
                    href={repo.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 hover:border-emerald-400 transition space-y-1"
                  >
                    <div className="flex items-center justify-between text-xs font-mono text-emerald-300 font-bold">
                      <span className="truncate">{repo.full_name}</span>
                      <span>⭐ {repo.stargazers_count}</span>
                    </div>
                    <p className="text-[11px] text-gray-300 line-clamp-2">{repo.description}</p>
                  </a>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {arsenalTools.map((tool) => (
                <div
                  key={tool.id}
                  className="p-4 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between gap-2"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={tool.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono font-bold text-emerald-400 hover:underline truncate"
                      >
                        {tool.name}
                      </a>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">
                        ⭐ {tool.stars}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-purple-300">
                      مُدمج في: {tool.integratedModule}
                    </div>
                    <p className="text-xs text-gray-200 leading-relaxed">{tool.description}</p>
                    <p className="text-[11px] text-gray-400 leading-relaxed border-t border-white/5 pt-1.5">
                      <strong className="text-sky-300">المنهجية القانونية:</strong> {tool.methodology}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 6. Multi-Source Live Zero-Key OSINT + JWT/Cookie Auditor + GraphQL/OpenAPI Schema Auditor */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Live OSINT Hub (CRT.SH + Shodan InternetDB + Wayback) */}
            <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-400" />
                    <span>6. استخبارات OSINT الحية (CRT.SH + Shodan + Wayback)</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    يستعلم مباشرة بدون مفاتيح من شهادات الشفافية CRT.SH وShodan InternetDB وأرشيف Wayback.
                  </p>
                </div>
                <button
                  onClick={() => void handleRunLiveOsint()}
                  disabled={deepLoading === "osint"}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-bold text-white shrink-0"
                >
                  {deepLoading === "osint" ? "جاري الجلب..." : "سحب OSINT حي"}
                </button>
              </div>

              {osintResult && (
                <div className="space-y-2.5 pt-2 border-t border-white/10 text-xs">
                  <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 font-mono text-emerald-200">
                    IP: {osintResult.primaryIp} | Ports: {osintResult.shodanInternetDb.ports.join(", ") || "80, 443"}
                  </div>
                  <div>
                    <div className="font-bold text-gray-300 mb-1">📜 نطاقات CRT.SH ({osintResult.crtSubdomains.length}):</div>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                      {osintResult.crtSubdomains.slice(0, 12).map((sub) => (
                        <button
                          key={sub}
                          onClick={() => void handleActivateTarget(sub)}
                          className="px-2 py-0.5 rounded bg-black/50 hover:bg-emerald-500/20 border border-white/10 font-mono text-[10px] text-emerald-300"
                        >
                          {sub}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-gray-300 mb-1">🕰️ مسارات Wayback Machine الأرشيفية:</div>
                    <div className="space-y-1 max-h-28 overflow-y-auto font-mono text-[10px] text-sky-300">
                      {osintResult.waybackUrls.slice(0, 6).map((u, idx) => (
                        <div key={idx} className="truncate bg-black/40 px-2 py-1 rounded border border-white/5">
                          {u}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* JWT & Cookie Cryptographic Auditor */}
            <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Lock className="w-4 h-4 text-amber-400" />
                    <span>7. مدقق تشفير الجلسات (JWT & Set-Cookie)</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    يفكك توكن JWT ويفحص alg:none وexp وkid ويدقق خصائص الكوكيز (HttpOnly, Secure, SameSite).
                  </p>
                </div>
                <button
                  onClick={() => void handleRunJwtCookieAudit()}
                  disabled={deepLoading === "jwt"}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-bold text-white shrink-0"
                >
                  {deepLoading === "jwt" ? "جاري الفحص..." : "فحص الجلسة"}
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <input
                  dir="ltr"
                  value={jwtInput}
                  onChange={(e) => setJwtInput(e.target.value)}
                  placeholder="JWT Token (eyJ...)"
                  className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/15 font-mono text-[11px] text-white"
                />
                <input
                  dir="ltr"
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="Set-Cookie Header..."
                  className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/15 font-mono text-[11px] text-white"
                />
              </div>

              {jwtAuditResult && (
                <div className="space-y-2 pt-2 border-t border-white/10 text-xs max-h-44 overflow-y-auto">
                  {jwtAuditResult.issues.map((iss, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-black/40 border border-amber-500/30 space-y-0.5">
                      <div className="font-bold text-amber-300 flex items-center justify-between">
                        <span>{iss.check}</span>
                        <span className="font-mono text-[10px]">{iss.cwe}</span>
                      </div>
                      <p className="text-gray-300 text-[11px]">{iss.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* GraphQL & OpenAPI Schema Auditor */}
            <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-400" />
                    <span>8. مدقق مخططات GraphQL وOpenAPI/Swagger</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    يفحص نقاط نهاية /graphql و/openapi.json و/swagger.json للتحقق من Introspection وMass Assignment.
                  </p>
                </div>
                <button
                  onClick={() => void handleRunSchemaAudit()}
                  disabled={deepLoading === "schema"}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-xs font-bold text-white shrink-0"
                >
                  {deepLoading === "schema" ? "جاري الفحص..." : "فحص المخططات"}
                </button>
              </div>

              {schemaAuditResult && (
                <div className="space-y-2 pt-2 border-t border-white/10 text-xs">
                  {schemaAuditResult.discoveredSchemas.map((sc, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-500/30 font-mono text-[11px] text-purple-200">
                      {sc.path} (HTTP {sc.status}) — {sc.note}
                    </div>
                  ))}
                  {schemaAuditResult.checklist.map((item, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                      <div className="font-bold text-white">{item.check} ({item.cwe})</div>
                      <div className="text-gray-300 text-[11px] mt-0.5">{item.recommendation}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 7. Global Bug Bounty Platforms & Legal Safe-Harbor Directory */}
          <div className="rounded-2xl border border-emerald-500/25 bg-white/[0.03] p-5 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                <span>9. الدليل الشامل لمنصات البج باونتي العالمية وبرامج الملاذ القانوني الآمن (Global Safe-Harbor Directory)</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                جميع المنصات العالمية الرسمية المعتمدة لصيد الثغرات القانوني — اضغط على أي منصة لتفعيل نطاقها التجريبي فوراً أو فتح دليل برامجها الرسمي:
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {globalPlatforms.map((plat) => (
                <div
                  key={plat.id}
                  className="p-4 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-white">{plat.name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold">
                        {plat.bountyRange}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-amber-300">{plat.safeHarbor}</div>
                    <p className="text-xs text-gray-300 leading-relaxed">{plat.focus}</p>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                    <button
                      onClick={() => void handleActivateTarget(plat.defaultTarget, plat.name)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-[11px] font-bold text-emerald-200"
                    >
                      🎯 تفعيل في المنصة
                    </button>
                    <a
                      href={plat.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 flex items-center gap-1"
                    >
                      <span>الموقع</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 10. Kali Linux Complete Arsenal & Safe Verification Simulator (64 Tools, 12 Categories) */}
          <div className="rounded-2xl border border-cyan-500/30 bg-white/[0.03] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-cyan-400" />
                  <span>10. ترسانة ومحاكي Kali Linux الشامل ({kaliTools.length || 64} أداة عبر 12 فئة — أوامر قانونية وتنفيذ فوري آمن)</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  توليد الأوامر القياسية المحددة المعدل (Rate-Limited) لكل أداة من أدوات Kali Linux مع إمكانية تشغيل الفحص المكافئ الآمن مباشرة على الهدف النشط ({activeTarget}):
                </p>
              </div>
              <select
                value={selectedKaliCategory}
                onChange={(e) => setSelectedKaliCategory(e.target.value)}
                className="px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
              >
                <option value="all">جميع فئات Kali Linux (12 فئة — {kaliTools.length || 64} أداة)</option>
                {Array.from(new Set(kaliTools.map((t) => t.category))).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {kaliSimResult && (
              <div className="p-4 rounded-xl bg-black/75 border border-cyan-500/40 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-cyan-300">
                  <span>🐉 مخرجات التحقق الآمن لأداة: {kaliSimResult.toolName}</span>
                  <button
                    onClick={() => copyToClipboard(kaliSimResult.output, "kali-sim")}
                    className="px-2 py-0.5 rounded bg-white/10 text-[11px] text-white"
                  >
                    {copied === "kali-sim" ? "تم النسخ ✓" : "نسخ المخرجات"}
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed" dir="ltr">
                  {kaliSimResult.output}
                </pre>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[460px] overflow-y-auto pr-1">
              {kaliTools
                .filter((t) => selectedKaliCategory === "all" || t.category === selectedKaliCategory)
                .map((tool) => {
                  const cleanHost = activeTarget.replace(/^https?:\/\//, "").replace(/^\*\./, "");
                  const cmd = tool.commandTemplate.replace(/\{target\}/g, cleanHost);
                  return (
                    <div
                      key={tool.id}
                      className="p-3.5 rounded-xl bg-black/40 border border-white/10 flex flex-col justify-between gap-2.5"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-cyan-300 font-mono">{tool.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-200 font-mono">
                            {tool.safeEquivalent}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-400">{tool.category}</div>
                        <p className="text-xs text-gray-300 leading-relaxed">{tool.purposeAr}</p>
                        <div
                          className="p-2 rounded bg-black/70 border border-white/10 text-[11px] font-mono text-emerald-300 overflow-x-auto"
                          dir="ltr"
                        >
                          $ {cmd}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => void handleSimulateKaliTool(tool.id)}
                          disabled={deepLoading === `kali-${tool.id}`}
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-cyan-600/35 hover:bg-cyan-600/55 border border-cyan-500/40 text-[11px] font-bold text-cyan-100"
                        >
                          {deepLoading === `kali-${tool.id}` ? "جاري الفحص..." : "⚡ تشغيل الفحص الآمن"}
                        </button>
                        <button
                          onClick={() => copyToClipboard(cmd, `cmd-${tool.id}`)}
                          className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-gray-300"
                        >
                          {copied === `cmd-${tool.id}` ? "✓" : "نسخ الأمر"}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* 11. Combinatorial Multi-Vulnerability Synthesizer (Merge 2, 3, 4, or 5+ Vulns Simultaneously) */}
          <div className="rounded-2xl border border-rose-500/40 bg-gradient-to-l from-rose-950/30 via-[#0b0716] to-amber-950/20 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-rose-300">
                  COMBINATORIAL MULTI-VULNERABILITY SYNTHESIZER · CREATIVE A ➔ B ➔ C ➔ D CHAIN ENGINE
                </div>
                <h3 className="text-lg font-extrabold text-white flex items-center gap-2 mt-0.5">
                  <Zap className="w-5 h-5 text-rose-400" />
                  <span>11. المختبر الإبداعي لدمج أكثر من ثغرة في نفس الوقت وتوليد سلاسل جديدة (24 لبنة معمارية)</span>
                </h3>
                <p className="text-xs text-gray-300 mt-1">
                  اختر 2 أو 3 أو 4 أو 5 لبنات ثغرات في نفس الوقت من المصفوفة أدناه — سيقوم المحرك بترتيبها معمارياً (نقطة دخول ➔ تمفصل وتوسيع ➔ أثر نهائي)، حساب التقييم المركب (Compound CVSS v3.1) والمكافأة المقدرة، وتوليد خطوات التحقق الآمن وكود الإصلاح المعماري:
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void handleCreativeRandomMix()}
                  disabled={deepLoading === "chains"}
                  className="px-3.5 py-2.5 rounded-xl bg-amber-600/35 hover:bg-amber-600/55 border border-amber-500/40 text-xs font-bold text-amber-200"
                >
                  🎲 ابتكار تركيبة ثغرات ذكية (AI Mix)
                </button>
                <button
                  onClick={() => void handleRunChainSynthesizer()}
                  disabled={deepLoading === "chains" || selectedPrimitives.length < 2}
                  className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-xs font-extrabold text-white shadow-lg shadow-rose-600/30"
                >
                  {deepLoading === "chains"
                    ? "جاري تركيب السلسلة..."
                    : `⚡ دمج الثغرات المختارة الآن (${selectedPrimitives.length} ثغرات)`}
                </button>
              </div>
            </div>

            {/* Interactive 24 Primitives Selector */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between text-xs text-gray-300">
                <span>اختر لبنات الثغرات المراد دمجها معاً في نفس الوقت ({selectedPrimitives.length} مختارة من {primitivesList.length || 24}):</span>
                <button
                  onClick={() => setSelectedPrimitives(["P01-JS-ENDPOINT", "P02-BOLA-IDOR"])}
                  className="text-[11px] text-rose-300 hover:underline"
                >
                  إعادة ضبط الاختيار
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 max-h-[260px] overflow-y-auto pr-1">
                {primitivesList.map((prim) => {
                  const isSel = selectedPrimitives.includes(prim.id);
                  return (
                    <button
                      key={prim.id}
                      onClick={() => togglePrimitiveSelection(prim.id)}
                      className={`p-2.5 rounded-xl border text-right transition-all flex flex-col justify-between gap-1 ${
                        isSel
                          ? "bg-rose-950/60 border-rose-400 text-white shadow-md shadow-rose-950/50"
                          : "bg-black/40 border-white/10 text-gray-300 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 w-full">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-200 font-bold">
                          {prim.code} · {prim.cwe}
                        </span>
                        <span className="text-[10px] font-mono text-amber-300">
                          {isSel ? "✓ مدمجة" : `CVSS ${prim.baseCvss}`}
                        </span>
                      </div>
                      <div className="text-xs font-bold leading-snug">{prim.nameAr}</div>
                      <div className="text-[10px] text-gray-400 truncate">{prim.layer}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {chainResult && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-white/10">
                {chainResult.chains.map((ch, idx) => (
                  <div
                    key={ch.id + idx}
                    className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                      idx === 0
                        ? "bg-gradient-to-br from-rose-950/50 to-black/70 border-rose-400/60 lg:col-span-2"
                        : "bg-black/50 border-rose-500/30"
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold px-2.5 py-0.5 rounded bg-rose-500/25 text-rose-200 border border-rose-500/40 font-mono">
                            {ch.combinedSeverity}
                          </span>
                          {ch.estimatedBounty && (
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                              💰 {ch.estimatedBounty}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-amber-300">
                          {ch.cweChain.join(" + ")}
                        </span>
                      </div>
                      <h4 className="font-extrabold text-sm text-white">
                        {idx === 0 ? `🌟 السلسلة المدمجة المبتكرة: ${ch.title}` : ch.title}
                      </h4>
                      {ch.architecturalGraph && (
                        <div
                          className="p-2.5 rounded-lg bg-black/70 border border-rose-500/30 text-xs font-mono text-rose-200 overflow-x-auto"
                          dir="ltr"
                        >
                          {ch.architecturalGraph}
                        </div>
                      )}
                      <div className="space-y-1.5 text-xs text-gray-200">
                        {ch.steps.map((st, sIdx) => (
                          <div key={sIdx} className="p-2.5 rounded-lg bg-white/[0.04] border border-white/10">
                            {st}
                          </div>
                        ))}
                      </div>
                      {ch.noveltyAnalysisAr && (
                        <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200">
                          💡 <strong>تحليل الإبداع والأثر المركب:</strong> {ch.noveltyAnalysisAr}
                        </div>
                      )}
                      <div className="text-[11px] text-emerald-300 font-mono">
                        🛠️ مسار التحقق: {ch.verificationTool}
                      </div>
                      <div className="text-[11px] text-gray-300">
                        ✅ الإصلاح المعماري متعدد الطبقات: {ch.remediation}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                      <button
                        onClick={() => handleSendChainToReport(ch)}
                        className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white"
                      >
                        📝 إرسال السلسلة المركبة إلى مولّد التقارير وحاسبة CVSS 3.1
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 12. 2,576+ Deep Security Research & Pattern Knowledge Index Search */}
          <div className="rounded-2xl border border-indigo-500/35 bg-white/[0.03] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-400" />
                  <span>
                    12. الفهرس المعرفي الشامل ({(corpusData?.stats?.totalIndexedKnowledgeItems ?? 2576).toLocaleString()}+ بحث ونمط أمني وسلسلة A ➔ B عبر 17 بيئة معمارية)
                  </span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  ابحث فوراً في أكثر من 2,576 نمط فحص معمق يربط بين 24 فئة ثغرات و17 بيئة تقنية (Next.js, GraphQL, AWS, Kubernetes, OAuth, SAML, FinTech, AI Agents) و6 مراحل تدقيق:
                </p>
              </div>
              <div className="text-xs font-mono text-indigo-300 bg-indigo-950/40 border border-indigo-500/30 px-3 py-1.5 rounded-xl">
                النتائج المطابقة: {(corpusData?.totalMatched ?? 2448).toLocaleString()} نمط أمني
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                value={corpusQuery}
                onChange={(e) => {
                  setCorpusQuery(e.target.value);
                  void handleSearchCorpus2400(e.target.value, corpusLayer);
                }}
                placeholder="ابحث في 2,576+ نمط (مثال: GraphQL, Next.js, OAuth, SAML, AWS, BOLA, Race, Cache, LLM)..."
                className="flex-1 min-w-[240px] px-3.5 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white"
              />
              <button
                onClick={() => void handleSearchCorpus2400()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white"
              >
                🔎 بحث عميق
              </button>
            </div>

            {corpusData && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {corpusData.items.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-black/45 border border-white/10 flex flex-col justify-between gap-2 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold">
                          {item.cwe} · CVSS {item.cvss}
                        </span>
                        <span className="font-mono text-[10px] text-amber-300">{item.chainFormula}</span>
                      </div>
                      <div className="font-bold text-white leading-snug">{item.titleAr}</div>
                      <div className="text-[11px] text-emerald-300">{item.surface}</div>
                      <div className="text-[11px] text-gray-300">{item.safeCheckAr}</div>
                    </div>
                    <div className="pt-1.5 border-t border-white/5 text-[10px] text-gray-400">
                      🛡️ الترقيع: {item.remediationAr}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB WORKSTATION: Multi-Window Cyber Computer, Burp/Caido, MSF-Verify, Terminal & 24/7 Cloud Brain ── */}
      {activeTab === "workstation" && (
        <div className="space-y-6">
          {/* 12 Integrated Security Environments Registry */}
          {workstationData?.environments && (
            <div className="rounded-2xl border border-purple-500/35 bg-gradient-to-l from-purple-950/35 via-[#0b0716] to-emerald-950/30 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-mono text-purple-300">
                    12 INTEGRATED SECURITY OS & WORKSTATION ENVIRONMENTS · MULTI-WINDOW CYBER RANGE
                  </div>
                  <h2 className="text-xl font-extrabold text-white mt-0.5">
                    🖥️ كمبيوتر الشغل الشامل وتعدد النوافذ والبيئات المتكاملة (12 بيئة عمل حية)
                  </h2>
                  <p className="text-xs text-gray-300 mt-1">
                    جميع البيئات والأدوات مدمجة ومتصلة بالذاكرة السحابية على GitHub وبالهدف النشط ({activeTarget}) مع دعم العمل المستمر 24/7 وتعدد المهام المتوازية.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/desktop`}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-extrabold text-white"
                  >
                    🪟 فتح سطح المكتب الكامل متعدد النوافذ (/desktop)
                  </a>
                  <a
                    href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/kali-terminal`}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-extrabold text-white"
                  >
                    💻 فتح طرفية كالي المستقلة (/kali-terminal)
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {workstationData.environments.map((env) => (
                  <div key={env.id} className="p-3 rounded-xl bg-black/50 border border-white/10 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold">
                        {env.badge}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400">● {env.status}</span>
                    </div>
                    <div className="font-bold text-white">{env.name}</div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">{env.purposeAr}</p>
                    <div className="text-[10px] font-mono text-purple-300 pt-1 border-t border-white/10">
                      🛠️ {env.toolsIncluded.slice(0, 5).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4-Window Simultaneous Multi-Window Cyber Workbench Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* WINDOW 1: Burp Suite Pro / Caido / trex HTTP Repeater, AuthKit Diff & Decoder */}
            <div className="rounded-2xl border border-amber-500/35 bg-[#0a0612] overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 bg-gradient-to-l from-amber-950/60 to-black border-b border-amber-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="text-xs font-extrabold text-amber-300 mr-1">
                    نافذة #1: 🦅 مختبر Burp Suite / Caido / trex (HTTP Repeater & AuthKit Diff & Decoder)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-200 px-2 py-0.5 rounded bg-amber-500/20">
                  WINDOW 1 · PROXY & REPEATER
                </span>
              </div>

              <div className="p-4 space-y-3 flex-1 text-xs">
                <div className="flex flex-wrap gap-2">
                  <select
                    value={repeaterMethod}
                    onChange={(e) => setRepeaterMethod(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-black/60 border border-white/15 font-mono text-amber-300 font-bold"
                  >
                    <option value="GET">GET</option>
                    <option value="HEAD">HEAD</option>
                    <option value="OPTIONS">OPTIONS</option>
                  </select>
                  <input
                    dir="ltr"
                    value={repeaterUrl}
                    onChange={(e) => setRepeaterUrl(e.target.value)}
                    placeholder="https://bughunters.google.com/api/v1/..."
                    className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/15 font-mono text-white"
                  />
                  <button
                    onClick={() => void handleRunProxyRepeater()}
                    disabled={deepLoading === "repeater"}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 font-extrabold text-white"
                  >
                    {deepLoading === "repeater" ? "جاري الإرسال..." : "🚀 Send Request"}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-gray-300 mb-1">الترويسات المخصصة (Request Headers):</label>
                    <textarea
                      dir="ltr"
                      rows={2}
                      value={repeaterHeaders}
                      onChange={(e) => setRepeaterHeaders(e.target.value)}
                      className="w-full p-2 rounded-lg bg-black/60 border border-white/15 font-mono text-[11px] text-emerald-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-300 mb-1">
                      ترويسة الجلسة الثانية للمقارنة (AuthKit Session B Diff — اختياري):
                    </label>
                    <input
                      dir="ltr"
                      value={repeaterSessionB}
                      onChange={(e) => setRepeaterSessionB(e.target.value)}
                      placeholder="Authorization: Bearer secondary_test_token"
                      className="w-full p-2 rounded-lg bg-black/60 border border-white/15 font-mono text-[11px] text-purple-200 mb-1.5"
                    />
                    <input
                      dir="ltr"
                      value={repeaterCodecInput}
                      onChange={(e) => setRepeaterCodecInput(e.target.value)}
                      placeholder="Decoder / Encoder Input (Base64 / JWT / URL / Hex)"
                      className="w-full p-2 rounded-lg bg-black/60 border border-white/15 font-mono text-[11px] text-sky-200"
                    />
                  </div>
                </div>

                {repeaterResult && (
                  <div className="space-y-2.5 pt-2 border-t border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-black/60 p-2 rounded-lg border border-amber-500/30 font-mono text-[11px]">
                      <span className="text-emerald-300">
                        HTTP {repeaterResult.status} ({repeaterResult.timeMs}ms · {repeaterResult.bodyLength} bytes)
                      </span>
                      <span className="text-purple-300">SHA256: {repeaterResult.sha256}</span>
                      <span className="text-amber-300">
                        Missing Headers: {repeaterResult.missingSecHeaders.join(", ") || "None"}
                      </span>
                    </div>

                    {repeaterResult.authDiff && (
                      <div className="p-2 rounded-lg bg-purple-950/35 border border-purple-500/35 text-[11px] text-purple-200">
                        {repeaterResult.authDiff.verdictAr}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <pre
                        dir="ltr"
                        className="p-2.5 rounded-lg bg-black/80 border border-white/10 text-[10px] font-mono text-amber-200 overflow-x-auto max-h-40"
                      >
                        {repeaterResult.rawRequestText}
                      </pre>
                      <pre
                        dir="ltr"
                        className="p-2.5 rounded-lg bg-black/80 border border-white/10 text-[10px] font-mono text-emerald-200 overflow-x-auto max-h-40"
                      >
                        {repeaterResult.rawResponseText}
                      </pre>
                    </div>

                    <div className="p-2 rounded-lg bg-black/50 border border-white/10 font-mono text-[10px] text-sky-200 space-y-0.5" dir="ltr">
                      <div>[Decoder] Base64 Encode: {repeaterResult.decoderOutput.base64Encode.slice(0, 70)}</div>
                      <div>[Decoder] URL Encode   : {repeaterResult.decoderOutput.urlEncode.slice(0, 70)}</div>
                      <div>[Decoder] SHA-256 Hash : {repeaterResult.decoderOutput.sha256Hash}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* WINDOW 2: Metasploit-Style Modular Advisory & Safe Verification Console (msf6-verify >) */}
            <div className="rounded-2xl border border-rose-500/35 bg-[#0a0612] overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 bg-gradient-to-l from-rose-950/60 to-black border-b border-rose-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="text-xs font-extrabold text-rose-300 mr-1">
                    نافذة #2: 🛡️ كونسول التحقق المعياري والأدلة (msf6-verify Safe Advisory Console)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-rose-200 px-2 py-0.5 rounded bg-rose-500/20">
                  WINDOW 2 · MSF6-VERIFY
                </span>
              </div>

              <div className="p-4 space-y-3 flex-1 text-xs">
                <div className="flex flex-wrap gap-2">
                  <select
                    value={msfModuleId}
                    onChange={(e) => {
                      setMsfModuleId(e.target.value);
                      void handleRunMsfConsole("check", e.target.value);
                    }}
                    className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/15 font-mono text-rose-200"
                  >
                    {(workstationData?.msfModules || []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.path} — {m.nameAr}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void handleRunMsfConsole("check", msfModuleId)}
                    disabled={deepLoading === "msf"}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 font-extrabold text-white"
                  >
                    {deepLoading === "msf" ? "جاري الفحص..." : "▶ Run Safe Check"}
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    dir="ltr"
                    value={msfCommand}
                    onChange={(e) => setMsfCommand(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRunMsfConsole();
                    }}
                    placeholder="msf6-verify > check | set RHOSTS example.com | use shodan_osint"
                    className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/15 font-mono text-emerald-300"
                  />
                  <button
                    onClick={() => void handleRunMsfConsole()}
                    className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 font-mono text-white"
                  >
                    تنفيذ
                  </button>
                </div>

                <pre
                  dir="ltr"
                  className="p-3.5 rounded-xl bg-black/90 border border-rose-500/30 font-mono text-[11px] text-emerald-300 overflow-x-auto min-h-[210px] leading-relaxed"
                >
                  {msfResult
                    ? msfResult.output
                    : `msf6-verify (auxiliary/gather/shodan_internetdb_osint) > ready\n[*] Target RHOSTS : ${activeTarget}\n[*] 10 Non-Destructive Advisory & Verification Modules Loaded.\n[*] Click 'Run Safe Check' or select a module above to execute.`}
                </pre>
              </div>
            </div>

            {/* WINDOW 3: Kali Linux 2026.3 Interactive Security Terminal */}
            <div className="rounded-2xl border border-emerald-500/35 bg-[#0a0612] overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 bg-gradient-to-l from-emerald-950/60 to-black border-b border-emerald-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="text-xs font-extrabold text-emerald-300 mr-1">
                    نافذة #3: 💻 طرفية Kali Linux 2026.3 التفاعلية الشاملة (kali@cybernova-2099:~#)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-emerald-200 px-2 py-0.5 rounded bg-emerald-500/20">
                  WINDOW 3 · KALI CLI
                </span>
              </div>

              <div className="p-4 space-y-3 flex-1 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "status",
                    "artifacts",
                    "missions",
                    `subfinder -d ${activeTarget}`,
                    `nmap -sV ${activeTarget}`,
                    `katana -u https://${activeTarget}`,
                    `nuclei -u https://${activeTarget}`,
                    `trex -u https://${activeTarget}`,
                    `agent-master ${activeTarget}`,
                    "help",
                  ].map((cmdChip) => (
                    <button
                      key={cmdChip}
                      onClick={() => {
                        setTermCommand(cmdChip);
                        void handleRunTerminal(cmdChip);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/30 font-mono text-[10px] text-emerald-200"
                    >
                      $ {cmdChip}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    dir="ltr"
                    value={termCommand}
                    onChange={(e) => setTermCommand(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRunTerminal();
                    }}
                    placeholder="kali@cybernova-2099:~# enter command..."
                    className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/15 font-mono text-emerald-300"
                  />
                  <button
                    onClick={() => void handleRunTerminal()}
                    disabled={deepLoading === "terminal"}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-extrabold text-white"
                  >
                    {deepLoading === "terminal" ? "يركض..." : "Run CLI"}
                  </button>
                </div>

                <pre
                  dir="ltr"
                  className="p-3.5 rounded-xl bg-black/90 border border-emerald-500/30 font-mono text-[11px] text-emerald-300 overflow-x-auto min-h-[210px] max-h-[280px] overflow-y-auto leading-relaxed"
                >
                  {termOutput}
                </pre>
              </div>
            </div>

            {/* WINDOW 4: 24/7 Parallel Multi-Task Queue & Extracted Artifacts Vault */}
            <div className="rounded-2xl border border-sky-500/35 bg-[#0a0612] overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 bg-gradient-to-l from-sky-950/60 to-black border-b border-sky-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="text-xs font-extrabold text-sky-300 mr-1">
                    نافذة #4: 🤖 المهام المتعددة 24/7 + خزنة المستخرجات والغنائم + ذاكرة GitHub
                  </span>
                </div>
                <span className="text-[10px] font-mono text-sky-200 px-2 py-0.5 rounded bg-sky-500/20">
                  WINDOW 4 · 24/7 DAEMON & VAULT
                </span>
              </div>

              <div className="p-4 space-y-3 flex-1 text-xs">
                <div className="flex flex-wrap gap-2">
                  <input
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="عنوان المهمة المتوازية الجديدة (مثلاً: مراقبة نطاقات وحدود صلاحيات الهدف)..."
                    className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-white"
                  />
                  <input
                    dir="ltr"
                    value={newTaskTarget}
                    onChange={(e) => setNewTaskTarget(e.target.value)}
                    placeholder={activeTarget}
                    className="w-44 px-3 py-2 rounded-xl bg-black/60 border border-white/15 font-mono text-emerald-300"
                  />
                  <button
                    onClick={() => void handleAddParallelTask()}
                    disabled={deepLoading === "add-task"}
                    className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 font-extrabold text-white"
                  >
                    + إضافة مهمة 24/7
                  </button>
                </div>

                {workstationData?.brainState && (
                  <div className="space-y-3">
                    <div>
                      <div className="font-bold text-sky-300 mb-1.5">
                        🔄 طابور المهام المتعددة التي تعمل في الخلفية ({workstationData.brainState.multiTaskQueue.length} مهام نشطة):
                      </div>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {workstationData.brainState.multiTaskQueue.map((task) => (
                          <div key={task.id} className="p-2 rounded-lg bg-black/60 border border-white/10">
                            <div className="flex items-center justify-between font-bold text-white">
                              <span>{task.titleAr}</span>
                              <span className="text-[10px] font-mono text-emerald-400">
                                {task.progress}% · {task.status}
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-gray-300 mt-0.5">{task.lastOutput}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="font-bold text-emerald-300 mb-1.5">
                        📦 خزنة المستخرجات والغنائم والسجل الحي ({workstationData.brainState.extractedArtifactsVault.length} مستخرج موثق):
                      </div>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {workstationData.brainState.extractedArtifactsVault.map((art) => (
                          <div key={art.id} className="p-2 rounded-lg bg-emerald-950/20 border border-emerald-500/25">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-emerald-200">{art.titleAr}</span>
                              <span className="text-[10px] font-mono text-purple-300">{art.tool}</span>
                            </div>
                            <div className="text-[11px] font-mono text-gray-200 mt-0.5" dir="ltr">
                              {art.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
            <div className="p-4 rounded-2xl border border-white/15 bg-white/[0.03] flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-gray-400">درجة سلامة الكود والإعدادات</div>
                <div className="text-2xl font-extrabold text-white mt-0.5">
                  {auditResult.score} / 100
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleSyncAuditFindings()}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>حفظ النتائج في الذاكرة ومتتبع المهام</span>
                </button>
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
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        void handleActivateTarget(
                          p.inScopeSummary.split(",")[0]?.trim() || p.name,
                          p.name,
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/40 text-xs font-bold text-emerald-300 flex items-center gap-1"
                    >
                      <Target className="w-3.5 h-3.5" />
                      <span>تفعيل كهدف</span>
                    </button>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-base text-white">📄 التقرير الجاهز للنسخ والتقديم (Markdown)</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleSaveReportToPlatform()}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>حفظ في التقارير والذاكرة</span>
                </button>
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
