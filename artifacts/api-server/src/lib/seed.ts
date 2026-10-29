import {
  db,
  cvesTable,
  mitreTechniquesTable,
  cweTable,
  notificationsTable,
  workspacesTable,
  agentTasksTable,
  scheduledJobsTable,
  webhooksTable,
  memoryTable,
  ragFilesTable,
  bookmarksTable,
  auditLogTable,
  conversationsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function ensureSeed(): Promise<void> {
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cvesTable);
  if ((existing?.count ?? 0) > 0) return;

  logger.info("Seeding CyberNova database with reference data...");

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const cveSamples: {
    cveId: string;
    severity: "critical" | "high" | "medium" | "low";
    cvssScore: number;
    description: string;
    daysAgo: number;
  }[] = [
    { cveId: "CVE-2025-31161", severity: "critical", cvssScore: 9.8, description: "ثغرة تنفيذ أوامر عن بُعد في خادم CrushFTP عبر بروتوكول AS2 تتيح للمهاجم تجاوز المصادقة وتنفيذ تعليمات بصلاحيات النظام.", daysAgo: 1 },
    { cveId: "CVE-2025-29927", severity: "critical", cvssScore: 9.1, description: "ثغرة تجاوز المصادقة في إطار عمل Next.js عبر هيدر x-middleware-subrequest تسمح بالوصول إلى مسارات محمية.", daysAgo: 2 },
    { cveId: "CVE-2025-24813", severity: "critical", cvssScore: 9.8, description: "ثغرة تنفيذ كود عن بُعد في Apache Tomcat عبر معالجة طلبات PUT تتيح رفع ملفات serialized خبيثة.", daysAgo: 2 },
    { cveId: "CVE-2025-22457", severity: "critical", cvssScore: 9.0, description: "تجاوز سعة المخزن المؤقت في Ivanti Connect Secure ضمن مكوّن المصادقة قد يؤدي إلى تنفيذ كود قبل المصادقة.", daysAgo: 3 },
    { cveId: "CVE-2025-30406", severity: "critical", cvssScore: 9.0, description: "ثغرة استخدام مفتاح ASP.NET ثابت في CentreStack من Gladinet تسمح بتنفيذ كود عن بُعد عن طريق ViewState.", daysAgo: 3 },
    { cveId: "CVE-2025-27590", severity: "high", cvssScore: 8.6, description: "ثغرة Path Traversal في خادم Wazuh تسمح بكتابة ملفات تعريفية اعتباطياً ضمن مسار البيانات.", daysAgo: 4 },
    { cveId: "CVE-2025-21333", severity: "high", cvssScore: 7.8, description: "ثغرة في بروتوكول Hyper-V في Windows تتيح رفع الصلاحيات إلى SYSTEM عبر تفاعل افتراضي خاص.", daysAgo: 4 },
    { cveId: "CVE-2025-21298", severity: "critical", cvssScore: 9.8, description: "Use-After-Free في معالجة OLE في Microsoft Outlook تتيح تنفيذ كود عن بُعد عبر بريد إلكتروني RTF خبيث.", daysAgo: 5 },
    { cveId: "CVE-2025-1097", severity: "high", cvssScore: 8.4, description: "ثغرة Cross-Site Scripting مخزَّنة في لوحة Grafana عبر مكوّن DataSource تسمح للمهاجم باختطاف جلسة المسؤول.", daysAgo: 5 },
    { cveId: "CVE-2025-0411", severity: "medium", cvssScore: 6.5, description: "ثغرة في 7-Zip تسمح بتجاوز علامة Mark-of-the-Web عند فك ضغط ملفات متداخلة.", daysAgo: 6 },
    { cveId: "CVE-2024-50623", severity: "critical", cvssScore: 9.8, description: "ثغرة رفع ملفات عشوائية في Cleo Harmony وVLTrader تتيح تنفيذ كود عن بُعد دون مصادقة.", daysAgo: 7 },
    { cveId: "CVE-2024-49138", severity: "high", cvssScore: 7.8, description: "ثغرة رفع صلاحيات في Windows Common Log File System Driver مستغلَّة في البرية.", daysAgo: 8 },
    { cveId: "CVE-2024-43451", severity: "medium", cvssScore: 6.5, description: "ثغرة تسريب NTLM hash في Windows عبر معالجة ملفات MSHTML.", daysAgo: 9 },
    { cveId: "CVE-2024-38812", severity: "critical", cvssScore: 9.8, description: "تجاوز سعة في خدمة DCERPC في VMware vCenter Server يؤدي إلى تنفيذ كود عن بُعد.", daysAgo: 10 },
    { cveId: "CVE-2024-47575", severity: "critical", cvssScore: 9.8, description: "ثغرة مصادقة مفقودة في FortiManager (FortiJump) تسمح بتنفيذ كود اعتباطي عبر طلبات API محرَّفة.", daysAgo: 11 },
    { cveId: "CVE-2024-21413", severity: "critical", cvssScore: 9.8, description: "ثغرة Microsoft Outlook MonikerLink تتيح تنفيذ كود وتسريب NTLM عند معاينة بريد خبيث.", daysAgo: 12 },
    { cveId: "CVE-2024-3094", severity: "critical", cvssScore: 10.0, description: "باب خلفي مزروع في مكتبة xz-utils (liblzma) يُمكِّن من تنفيذ أوامر عن بُعد عبر OpenSSH على أنظمة Linux.", daysAgo: 14 },
    { cveId: "CVE-2024-6387", severity: "high", cvssScore: 8.1, description: "ثغرة regreSSHion في OpenSSH تسمح بتنفيذ كود عن بُعد بصلاحيات root عبر حالة سباق في معالج SIGALRM.", daysAgo: 16 },
    { cveId: "CVE-2024-1709", severity: "critical", cvssScore: 10.0, description: "تجاوز مصادقة في ConnectWise ScreenConnect يسمح بإنشاء حساب مسؤول عبر طلب SetupWizard مكشوف.", daysAgo: 18 },
    { cveId: "CVE-2023-46604", severity: "critical", cvssScore: 9.8, description: "ثغرة Apache ActiveMQ في معالجة OpenWire تتيح تنفيذ كود عن بُعد وانتشار فدية HelloKitty.", daysAgo: 22 },
  ];

  await db.insert(cvesTable).values(
    cveSamples.map((c) => ({
      cveId: c.cveId,
      severity: c.severity,
      cvssScore: c.cvssScore,
      description: c.description,
      publishedAt: new Date(now - c.daysAgo * day),
      source: "NVD",
      references: [],
      techniques: [],
    })),
  );

  await db.insert(mitreTechniquesTable).values([
    { techniqueId: "T1190", name: "Exploit Public-Facing Application", tactic: "Initial Access", description: "استغلال ثغرات في تطبيق متاح عبر الإنترنت للوصول الأولي.", platforms: ["Linux", "Windows", "macOS", "Network"] },
    { techniqueId: "T1059", name: "Command and Scripting Interpreter", tactic: "Execution", description: "تنفيذ أوامر عبر Bash/PowerShell/Python للتحكم في النظام.", platforms: ["Linux", "Windows", "macOS"] },
    { techniqueId: "T1566", name: "Phishing", tactic: "Initial Access", description: "إرسال رسائل تصيد لإيصال حمولة خبيثة أو سرقة بيانات الاعتماد.", platforms: ["Linux", "Windows", "macOS", "Office 365"] },
    { techniqueId: "T1078", name: "Valid Accounts", tactic: "Defense Evasion", description: "استخدام حسابات مشروعة للاستمرار وتجاوز الكشف.", platforms: ["Windows", "Linux", "Azure AD", "SaaS"] },
    { techniqueId: "T1505", name: "Server Software Component", tactic: "Persistence", description: "تثبيت مكوّنات خبيثة كـ webshell في خوادم الويب.", platforms: ["Linux", "Windows"] },
    { techniqueId: "T1486", name: "Data Encrypted for Impact", tactic: "Impact", description: "تشفير البيانات لمنع الوصول وطلب فدية.", platforms: ["Linux", "Windows", "macOS"] },
    { techniqueId: "T1003", name: "OS Credential Dumping", tactic: "Credential Access", description: "استخراج بيانات الاعتماد من ذاكرة LSASS أو ملفات SAM.", platforms: ["Windows"] },
    { techniqueId: "T1021", name: "Remote Services", tactic: "Lateral Movement", description: "استخدام خدمات SMB/RDP/SSH للتنقل الجانبي بين الأنظمة.", platforms: ["Linux", "Windows", "macOS"] },
    { techniqueId: "T1041", name: "Exfiltration Over C2 Channel", tactic: "Exfiltration", description: "إرسال البيانات المسروقة عبر قناة القيادة والتحكم.", platforms: ["Linux", "Windows", "macOS"] },
    { techniqueId: "T1071", name: "Application Layer Protocol", tactic: "Command and Control", description: "إخفاء حركة C2 ضمن HTTP/DNS لتجنب الكشف.", platforms: ["Linux", "Windows", "macOS"] },
    { techniqueId: "T1547", name: "Boot or Logon Autostart Execution", tactic: "Persistence", description: "إنشاء مدخلات تشغيل تلقائي للاستمرارية.", platforms: ["Windows", "Linux", "macOS"] },
    { techniqueId: "T1027", name: "Obfuscated Files or Information", tactic: "Defense Evasion", description: "تشفير وتشويش الحمولة لتجاوز أدوات الحماية.", platforms: ["Linux", "Windows", "macOS"] },
  ]);

  await db.insert(cweTable).values([
    { cweId: "CWE-79", name: "Cross-site Scripting (XSS)", abstraction: "Base", description: "تنفيذ سكربت ضار في متصفح الضحية بسبب عدم تنقية المدخلات." },
    { cweId: "CWE-89", name: "SQL Injection", abstraction: "Base", description: "حقن أوامر SQL عبر مدخلات غير معقَّمة في الاستعلامات." },
    { cweId: "CWE-22", name: "Path Traversal", abstraction: "Base", description: "الوصول إلى ملفات خارج المسار المقصود عبر تسلسلات ../" },
    { cweId: "CWE-78", name: "OS Command Injection", abstraction: "Base", description: "حقن أوامر نظام التشغيل عبر مدخلات تُمرَّر إلى الصدفة." },
    { cweId: "CWE-352", name: "Cross-Site Request Forgery", abstraction: "Base", description: "خداع متصفح الضحية لإرسال طلبات بنية المهاجم." },
    { cweId: "CWE-287", name: "Improper Authentication", abstraction: "Class", description: "ضعف أو غياب آلية التحقق من هوية المستخدم." },
    { cweId: "CWE-502", name: "Deserialization of Untrusted Data", abstraction: "Base", description: "إعادة بناء كائنات من بيانات غير موثوقة قد يؤدي إلى تنفيذ كود." },
    { cweId: "CWE-918", name: "Server-Side Request Forgery", abstraction: "Base", description: "إجبار الخادم على إرسال طلبات إلى وجهات يتحكم بها المهاجم." },
    { cweId: "CWE-434", name: "Unrestricted Upload of File", abstraction: "Base", description: "السماح برفع ملفات بدون التحقق من النوع/المحتوى." },
    { cweId: "CWE-611", name: "XML External Entity (XXE)", abstraction: "Base", description: "معالجة كيانات XML خارجية تُمكِّن من تسريب الملفات والـ SSRF." },
    { cweId: "CWE-94", name: "Code Injection", abstraction: "Class", description: "حقن كود برمجي يُنفَّذ في سياق التطبيق." },
    { cweId: "CWE-770", name: "Allocation of Resources Without Limits", abstraction: "Base", description: "استهلاك موارد بدون حد قد يؤدي إلى تعطل الخدمة." },
  ]);

  await db.insert(notificationsTable).values([
    { kind: "critical", title: "تحديث NVD", body: "تم رصد 14 ثغرة حرجة جديدة خلال الساعة الأخيرة.", read: false },
    { kind: "warning", title: "CISA KEV", body: "تمت إضافة CVE-2025-31161 إلى قائمة KEV واستغلال نشط.", read: false },
    { kind: "success", title: "اكتمال فحص", body: "انتهى وكيل Scanner من فحص شبكة 10.10.0.0/24.", read: false },
    { kind: "info", title: "وصلت تقارير", body: "تم إنشاء تقرير أسبوعي PDF جاهز للتنزيل.", read: true },
    { kind: "info", title: "Webhook", body: "تم تأكيد قناة Discord للإشعارات الحرجة.", read: true },
  ]);

  await db.insert(workspacesTable).values([
    { name: "Red Team — Q4", color: "#22d3ee", active: true },
    { name: "Blue Team Daily", color: "#a855f7", active: false },
    { name: "Threat Intel", color: "#f97316", active: false },
  ]);

  await db.insert(agentTasksTable).values([
    { title: "تعداد نطاقات example.com الفرعية", agent: "scanner", status: "completed", progress: 100, output: "وُجد 23 نطاقاً فرعياً نشطاً." },
    { title: "تجميع آخر CVEs لمنتجات Microsoft", agent: "researcher", status: "running", progress: 65 },
    { title: "إنشاء تقرير تنفيذي عن CVE-2025-29927", agent: "reporter", status: "queued", progress: 0 },
    { title: "تنسيق المهام الفرعية", agent: "orchestrator", status: "running", progress: 40 },
  ]);

  await db.insert(scheduledJobsTable).values([
    { name: "مزامنة NVD اليومية", cron: "0 3 * * *", target: "nvd.sync", lastStatus: "success", nextRunAt: new Date(now + day) },
    { name: "تحديث CISA KEV", cron: "*/30 * * * *", target: "kev.sync", lastStatus: "success", nextRunAt: new Date(now + 30 * 60 * 1000) },
    { name: "فحص الشهادات الأسبوعي", cron: "0 4 * * 1", target: "ssl.audit", lastStatus: "pending", nextRunAt: new Date(now + 2 * day) },
    { name: "تقرير تنفيذي شهري", cron: "0 9 1 * *", target: "report.exec", lastStatus: "success", nextRunAt: new Date(now + 14 * day) },
  ]);

  // Notification webhooks are intentionally not seeded. Configure them explicitly after review.

  await db.insert(memoryTable).values([
    { kind: "preference", title: "اللغة المفضلة", content: "المستخدم يفضل الردود باللغة العربية الفصحى." },
    { kind: "project", title: "نطاقات الاختبار", content: "النطاقات المسموح اختبارها: example.com, lab.local, demo.test" },
    { kind: "fact", title: "نظام التشغيل", content: "البيئة المستخدمة: Kali Linux 2025.1 على ARM64." },
    { kind: "contact", title: "مسؤول الأمن", content: "Ahmed Al-Hassan — ahmed@cyber.local — +966 5x xxx xxxx" },
  ]);

  await db.insert(ragFilesTable).values([
    { name: "OWASP-Top10-2024.pdf", kind: "pdf", size: 482910, chunks: 24, content: "OWASP Top 10 2024: Broken Access Control, Cryptographic Failures, Injection..." },
    { name: "internal-pentest-scope.md", kind: "markdown", size: 4820, chunks: 6, content: "نطاق الاختبار يغطي شبكة 10.10.0.0/24 مع تركيز على خوادم الويب وخدمات SSH." },
    { name: "nmap-cheatsheet.txt", kind: "text", size: 6210, chunks: 8, content: "nmap -sV -sC -p- target — مسح شامل مع كشف الإصدارات والسكربتات الافتراضية." },
  ]);

  await db.insert(bookmarksTable).values([
    { kind: "cve", refId: "CVE-2024-3094", label: "xz-utils backdoor" },
    { kind: "technique", refId: "T1190", label: "Exploit Public-Facing Application" },
    { kind: "tool", refId: "shodan", label: "Shodan-like Search" },
    { kind: "link", refId: "https://attack.mitre.org", label: "MITRE ATT&CK Matrix" },
  ]);

  await db.insert(auditLogTable).values([
    { actor: "user", action: "auth.login", target: "session", result: "success", detail: "تم تسجيل دخول جديد من المتصفح." },
    { actor: "orchestrator", action: "task.spawn", target: "scanner", result: "success", detail: "بدأ فحص subdomain enumeration." },
    { actor: "scanner-agent", action: "scan.complete", target: "example.com", result: "success", detail: "23 subdomain found." },
    { actor: "researcher-agent", action: "cve.fetch", target: "NVD", result: "success", detail: "تم تحميل 47 ثغرة جديدة." },
    { actor: "system", action: "webhook.dispatch", target: "discord", result: "success", detail: "إشعار CVE-2025-31161 أُرسل." },
    { actor: "user", action: "memory.add", target: "preference", result: "success", detail: "تم تخزين تفضيل لغوي." },
  ]);

  await db.insert(conversationsTable).values([
    { title: "تحليل CVE-2025-29927", model: "dolphin-llama3" },
    { title: "خطة اختبار اختراق Q4", model: "dolphin-llama3" },
  ]);

  logger.info("Seed complete.");
}
