/**
 * KALI AI Report Generation & Enhancement Utilities
 * 
 * توفر هذه الملف دوال مساعدة لـ:
 * 1. توليد التقارير (Report Generation)
 * 2. اقتراح الاستغلال التلقائي (Auto-Exploit Suggestion)
 * 3. تحليل النتائج والثغرات
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface KaliReportData {
  sessionId: string;
  timestamp: number;
  missionGoal?: string;
  deviceContext?: {
    hostname: string;
    user: string;
    platform: string;
    ip?: string;
    cpu?: string;
    mem?: string;
  };
  steps: Array<{
    n: number;
    title: string;
    status: "pending" | "running" | "done" | "failed" | "skipped";
    command?: string;
    result?: string;
  }>;
  findings: Array<{
    id: string;
    type: string;
    value: string;
    severity?: string;
    detail?: string;
    source?: string;
    ts: number;
  }>;
  chatHistory: Array<{
    role: "user" | "assistant" | "system";
    text: string;
  }>;
}

export interface ExploitSuggestion {
  tool: string;
  command: string;
  reason: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  description: string;
}

// ── Report Generation ────────────────────────────────────────────────────────

/**
 * توليد تقرير نصي منسق من بيانات Kali AI
 */
export function generateKaliReport(data: KaliReportData): string {
  const date = new Date(data.timestamp);
  const lines: string[] = [];

  // Header
  lines.push("═".repeat(80));
  lines.push("KALI AI v7 — تقرير الاختبار الأمني");
  lines.push("═".repeat(80));
  lines.push("");

  // Metadata
  lines.push("📋 معلومات التقرير");
  lines.push("─".repeat(80));
  lines.push(`التاريخ: ${date.toLocaleString("ar-SA")}`);
  lines.push(`معرّف الجلسة: ${data.sessionId}`);
  if (data.missionGoal) lines.push(`الهدف: ${data.missionGoal}`);
  lines.push("");

  // Device Context
  if (data.deviceContext) {
    lines.push("🖥️ سياق الجهاز");
    lines.push("─".repeat(80));
    lines.push(`المضيف: ${data.deviceContext.hostname}`);
    lines.push(`المستخدم: ${data.deviceContext.user}`);
    lines.push(`النظام: ${data.deviceContext.platform}`);
    if (data.deviceContext.ip) lines.push(`عنوان IP: ${data.deviceContext.ip}`);
    if (data.deviceContext.cpu) lines.push(`المعالج: ${data.deviceContext.cpu}`);
    if (data.deviceContext.mem) lines.push(`الذاكرة: ${data.deviceContext.mem}`);
    lines.push("");
  }

  // Findings Summary
  lines.push("🔍 ملخص الثغرات");
  lines.push("─".repeat(80));
  const criticalCount = data.findings.filter(f => f.severity === "critical").length;
  const highCount = data.findings.filter(f => f.severity === "high").length;
  const mediumCount = data.findings.filter(f => f.severity === "medium").length;
  const lowCount = data.findings.filter(f => f.severity === "low").length;

  lines.push(`إجمالي الثغرات: ${data.findings.length}`);
  lines.push(`  🔴 حرجة: ${criticalCount}`);
  lines.push(`  🟠 عالية: ${highCount}`);
  lines.push(`  🟡 متوسطة: ${mediumCount}`);
  lines.push(`  🔵 منخفضة: ${lowCount}`);
  lines.push("");

  // Detailed Findings
  if (data.findings.length > 0) {
    lines.push("📌 تفاصيل الثغرات");
    lines.push("─".repeat(80));
    data.findings.forEach((finding, idx) => {
      const severityEmoji = {
        critical: "🔴",
        high: "🟠",
        medium: "🟡",
        low: "🔵",
        info: "ℹ️",
      }[finding.severity || "info"] || "•";

      lines.push(`${idx + 1}. ${severityEmoji} [${finding.type.toUpperCase()}] ${finding.value}`);
      if (finding.detail) lines.push(`   الوصف: ${finding.detail}`);
      if (finding.source) lines.push(`   المصدر: ${finding.source}`);
      lines.push("");
    });
  }

  // Steps Execution
  if (data.steps.length > 0) {
    lines.push("⚙️ خطوات التنفيذ");
    lines.push("─".repeat(80));
    data.steps.forEach((step, idx) => {
      const statusIcon = {
        pending: "⏳",
        running: "🔄",
        done: "✅",
        failed: "❌",
        skipped: "⊘",
      }[step.status] || "•";

      lines.push(`${idx + 1}. ${statusIcon} [${step.status.toUpperCase()}] ${step.title}`);
      if (step.command) lines.push(`   الأمر: ${step.command}`);
      if (step.result) {
        const resultPreview = step.result.substring(0, 200).replace(/\n/g, "\n   ");
        lines.push(`   النتيجة: ${resultPreview}${step.result.length > 200 ? "..." : ""}`);
      }
      lines.push("");
    });
  }

  // Recommendations
  lines.push("💡 التوصيات");
  lines.push("─".repeat(80));
  if (criticalCount > 0) {
    lines.push("⚠️ يجب معالجة الثغرات الحرجة فوراً:");
    data.findings
      .filter(f => f.severity === "critical")
      .forEach(f => {
        lines.push(`   • ${f.value}: ${f.detail || "راجع التفاصيل أعلاه"}`);
      });
    lines.push("");
  }

  if (highCount > 0) {
    lines.push("⚠️ ثغرات عالية الأهمية يجب معالجتها قريباً:");
    data.findings
      .filter(f => f.severity === "high")
      .slice(0, 5)
      .forEach(f => {
        lines.push(`   • ${f.value}`);
      });
    lines.push("");
  }

  lines.push("✓ تم إنشاء هذا التقرير بواسطة KALI AI v7");
  lines.push("═".repeat(80));

  return lines.join("\n");
}

/**
 * توليد تقرير HTML قابل للطباعة
 */
export function generateKaliReportHTML(data: KaliReportData): string {
  const date = new Date(data.timestamp);
  const criticalCount = data.findings.filter(f => f.severity === "critical").length;
  const highCount = data.findings.filter(f => f.severity === "high").length;
  const mediumCount = data.findings.filter(f => f.severity === "medium").length;
  const lowCount = data.findings.filter(f => f.severity === "low").length;

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير KALI AI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      box-shadow: 0 0 20px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #ff4444;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 28px;
      color: #ff4444;
      margin-bottom: 10px;
    }
    .header p {
      color: #666;
      font-size: 14px;
    }
    .section {
      margin-bottom: 30px;
    }
    .section h2 {
      font-size: 18px;
      color: #333;
      border-left: 4px solid #ff4444;
      padding-left: 15px;
      margin-bottom: 15px;
    }
    .metadata {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      background: #f9f9f9;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .metadata-item {
      font-size: 13px;
    }
    .metadata-label {
      color: #666;
      font-weight: bold;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #f0f0f0;
      padding: 15px;
      border-radius: 5px;
      text-align: center;
    }
    .stat-card .number {
      font-size: 24px;
      font-weight: bold;
      color: #ff4444;
    }
    .stat-card .label {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
    }
    .finding {
      background: #fafafa;
      border-left: 4px solid #ff4444;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 3px;
    }
    .finding.high {
      border-left-color: #ff8800;
    }
    .finding.medium {
      border-left-color: #ffaa00;
    }
    .finding.low {
      border-left-color: #00aaff;
    }
    .finding-title {
      font-weight: bold;
      margin-bottom: 8px;
    }
    .finding-detail {
      font-size: 13px;
      color: #666;
      margin-bottom: 5px;
    }
    .step {
      background: #f9f9f9;
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 3px;
      border-left: 3px solid #00aa00;
    }
    .step.failed {
      border-left-color: #ff4444;
    }
    .step-title {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .step-command {
      background: #000;
      color: #0f0;
      padding: 8px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
      margin: 5px 0;
      overflow-x: auto;
    }
    .recommendation {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 3px;
    }
    .footer {
      text-align: center;
      border-top: 1px solid #ddd;
      padding-top: 20px;
      margin-top: 30px;
      font-size: 12px;
      color: #999;
    }
    @media print {
      body { background: white; }
      .container { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>☠ تقرير اختبار الأمن — KALI AI v7</h1>
      <p>${date.toLocaleString("ar-SA")}</p>
    </div>

    <div class="section">
      <h2>📋 معلومات التقرير</h2>
      <div class="metadata">
        <div class="metadata-item">
          <span class="metadata-label">معرّف الجلسة:</span> ${data.sessionId}
        </div>
        <div class="metadata-item">
          <span class="metadata-label">التاريخ:</span> ${date.toLocaleString("ar-SA")}
        </div>
        ${data.missionGoal ? `<div class="metadata-item"><span class="metadata-label">الهدف:</span> ${data.missionGoal}</div>` : ""}
      </div>
    </div>

    ${
      data.deviceContext
        ? `
    <div class="section">
      <h2>🖥️ سياق الجهاز</h2>
      <div class="metadata">
        <div class="metadata-item">
          <span class="metadata-label">المضيف:</span> ${data.deviceContext.hostname}
        </div>
        <div class="metadata-item">
          <span class="metadata-label">المستخدم:</span> ${data.deviceContext.user}
        </div>
        <div class="metadata-item">
          <span class="metadata-label">النظام:</span> ${data.deviceContext.platform}
        </div>
        ${data.deviceContext.ip ? `<div class="metadata-item"><span class="metadata-label">IP:</span> ${data.deviceContext.ip}</div>` : ""}
      </div>
    </div>
    `
        : ""
    }

    <div class="section">
      <h2>📊 ملخص الثغرات</h2>
      <div class="stats">
        <div class="stat-card">
          <div class="number">${criticalCount}</div>
          <div class="label">🔴 حرجة</div>
        </div>
        <div class="stat-card">
          <div class="number">${highCount}</div>
          <div class="label">🟠 عالية</div>
        </div>
        <div class="stat-card">
          <div class="number">${mediumCount}</div>
          <div class="label">🟡 متوسطة</div>
        </div>
        <div class="stat-card">
          <div class="number">${lowCount}</div>
          <div class="label">🔵 منخفضة</div>
        </div>
      </div>
    </div>

    ${
      data.findings.length > 0
        ? `
    <div class="section">
      <h2>🔍 تفاصيل الثغرات</h2>
      ${data.findings
        .map(
          finding => `
        <div class="finding ${finding.severity || "low"}">
          <div class="finding-title">[${finding.type.toUpperCase()}] ${finding.value}</div>
          ${finding.detail ? `<div class="finding-detail">الوصف: ${finding.detail}</div>` : ""}
          ${finding.source ? `<div class="finding-detail">المصدر: ${finding.source}</div>` : ""}
        </div>
      `
        )
        .join("")}
    </div>
    `
        : ""
    }

    ${
      data.steps.length > 0
        ? `
    <div class="section">
      <h2>⚙️ خطوات التنفيذ</h2>
      ${data.steps
        .map(
          step => `
        <div class="step ${step.status === "failed" ? "failed" : ""}">
          <div class="step-title">${step.n}. [${step.status.toUpperCase()}] ${step.title}</div>
          ${step.command ? `<div class="step-command">$ ${step.command}</div>` : ""}
          ${step.result ? `<div class="finding-detail">النتيجة: ${step.result.substring(0, 150)}</div>` : ""}
        </div>
      `
        )
        .join("")}
    </div>
    `
        : ""
    }

    <div class="section">
      <h2>💡 التوصيات</h2>
      ${
        criticalCount > 0
          ? `
        <div class="recommendation">
          <strong>⚠️ يجب معالجة الثغرات الحرجة فوراً:</strong>
          <ul style="margin-top: 10px; margin-right: 20px;">
            ${data.findings
              .filter(f => f.severity === "critical")
              .map(f => `<li>${f.value}</li>`)
              .join("")}
          </ul>
        </div>
      `
          : ""
      }
      ${
        highCount > 0
          ? `
        <div class="recommendation">
          <strong>⚠️ ثغرات عالية الأهمية:</strong>
          <ul style="margin-top: 10px; margin-right: 20px;">
            ${data.findings
              .filter(f => f.severity === "high")
              .slice(0, 5)
              .map(f => `<li>${f.value}</li>`)
              .join("")}
          </ul>
        </div>
      `
          : ""
      }
    </div>

    <div class="footer">
      <p>✓ تم إنشاء هذا التقرير بواسطة KALI AI v7</p>
      <p>هذا التقرير سري وخاص بالاستخدام الداخلي فقط</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * تصدير التقرير كملف نصي
 */
export function downloadKaliReport(data: KaliReportData, format: "txt" | "html" = "txt") {
  const content = format === "html" ? generateKaliReportHTML(data) : generateKaliReport(data);
  const mimeType = format === "html" ? "text/html" : "text/plain";
  const extension = format === "html" ? "html" : "txt";

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kali-report-${data.sessionId}-${Date.now()}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Auto-Exploit Suggestions ────────────────────────────────────────────────

/**
 * قاموس الخدمات والأدوات المناسبة للاستغلال
 */
const SERVICE_EXPLOIT_MAP: Record<string, ExploitSuggestion[]> = {
  ssh: [
    {
      tool: "hydra",
      command: "hydra -l admin -P /usr/share/wordlists/rockyou.txt {target} ssh",
      reason: "محاولة كسر كلمة المرور عبر SSH",
      riskLevel: "medium",
      description: "أداة Brute Force لاختبار كلمات المرور الضعيفة على SSH",
    },
    {
      tool: "searchsploit",
      command: "searchsploit openssh {version}",
      reason: "البحث عن ثغرات معروفة في OpenSSH",
      riskLevel: "high",
      description: "البحث في قاعدة بيانات Exploit-DB عن ثغرات معروفة",
    },
  ],
  http: [
    {
      tool: "nikto",
      command: "nikto -h http://{target}",
      reason: "فحص شامل لثغرات خادم الويب",
      riskLevel: "low",
      description: "أداة فحص شاملة لخوادم الويب تبحث عن الملفات والثغرات المعروفة",
    },
    {
      tool: "sqlmap",
      command: "sqlmap -u 'http://{target}?id=1' --dbs --batch",
      reason: "اختبار SQL Injection",
      riskLevel: "high",
      description: "أداة متخصصة في اكتشاف واستغلال ثغرات SQL Injection",
    },
    {
      tool: "gobuster",
      command: "gobuster dir -u http://{target} -w /usr/share/wordlists/dirb/common.txt",
      reason: "البحث عن المجلدات والملفات المخفية",
      riskLevel: "low",
      description: "أداة Fuzzing لاكتشاف المسارات والملفات المخفية",
    },
  ],
  https: [
    {
      tool: "sslscan",
      command: "sslscan {target}:443",
      reason: "فحص ضعف SSL/TLS",
      riskLevel: "low",
      description: "أداة فحص شهادات SSL وتكوينات TLS",
    },
  ],
  ftp: [
    {
      tool: "hydra",
      command: "hydra -l anonymous -P /usr/share/wordlists/rockyou.txt {target} ftp",
      reason: "محاولة كسر كلمة المرور عبر FTP",
      riskLevel: "medium",
      description: "أداة Brute Force لاختبار كلمات المرور على FTP",
    },
  ],
  smtp: [
    {
      tool: "nmap",
      command: "nmap -p 25 --script smtp-commands {target}",
      reason: "اختبار خدمة SMTP",
      riskLevel: "low",
      description: "فحص خدمة البريد الإلكترونية",
    },
  ],
  smb: [
    {
      tool: "smbclient",
      command: "smbclient -L //{target}",
      reason: "اكتشاف مشاركات SMB",
      riskLevel: "low",
      description: "أداة للتفاعل مع خوادم SMB",
    },
    {
      tool: "metasploit",
      command: "msfconsole -x 'search smb_enum'",
      reason: "البحث عن ثغرات SMB معروفة",
      riskLevel: "high",
      description: "إطار Metasploit للبحث عن ثغرات SMB",
    },
  ],
  rdp: [
    {
      tool: "hydra",
      command: "hydra -l administrator -P /usr/share/wordlists/rockyou.txt {target} rdp",
      reason: "محاولة كسر كلمة المرور عبر RDP",
      riskLevel: "medium",
      description: "أداة Brute Force لاختبار كلمات المرور على RDP",
    },
  ],
  mysql: [
    {
      tool: "hydra",
      command: "hydra -l root -P /usr/share/wordlists/rockyou.txt {target} mysql",
      reason: "محاولة كسر كلمة المرور عبر MySQL",
      riskLevel: "medium",
      description: "أداة Brute Force لاختبار كلمات المرور على MySQL",
    },
  ],
  postgresql: [
    {
      tool: "hydra",
      command: "hydra -l postgres -P /usr/share/wordlists/rockyou.txt {target} postgres",
      reason: "محاولة كسر كلمة المرور عبر PostgreSQL",
      riskLevel: "medium",
      description: "أداة Brute Force لاختبار كلمات المرور على PostgreSQL",
    },
  ],
};

/**
 * اقتراح أدوات استغلال بناءً على الخدمة المكتشفة
 */
export function suggestExploits(service: string, target: string): ExploitSuggestion[] {
  const normalizedService = service.toLowerCase().split("/")[0];
  const suggestions = SERVICE_EXPLOIT_MAP[normalizedService] || [];

  return suggestions.map(s => ({
    ...s,
    command: s.command.replace("{target}", target),
  }));
}

/**
 * استخراج الخدمات من نتائج Nmap
 */
export function extractServicesFromNmap(nmapOutput: string): Array<{ port: string; service: string }> {
  const services: Array<{ port: string; service: string }> = [];
  const lines = nmapOutput.split("\n");

  for (const line of lines) {
    // مثال: 22/tcp   open  ssh
    const match = line.match(/(\d+)\/tcp\s+open\s+(\S+)/);
    if (match) {
      services.push({
        port: match[1],
        service: match[2],
      });
    }
  }

  return services;
}

// ── Mission Progress Visualization ──────────────────────────────────────────

export interface MissionProgressData {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  currentStep: number;
  percentage: number;
}

/**
 * حساب تقدم المهمة
 */
export function calculateMissionProgress(
  steps: Array<{ status: "pending" | "running" | "done" | "failed" | "skipped" }>
): MissionProgressData {
  const totalSteps = steps.length;
  const completedSteps = steps.filter(s => s.status === "done").length;
  const failedSteps = steps.filter(s => s.status === "failed").length;
  const currentStep = steps.findIndex(s => s.status === "running") + 1 || completedSteps + 1;
  const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return {
    totalSteps,
    completedSteps,
    failedSteps,
    currentStep,
    percentage,
  };
}

/**
 * تحويل البيانات إلى رسم بياني نصي
 */
export function renderProgressBar(progress: MissionProgressData): string {
  const barLength = 40;
  const filledLength = Math.round((progress.percentage / 100) * barLength);
  const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

  return `
[${bar}] ${progress.percentage}%
الخطوات المكتملة: ${progress.completedSteps}/${progress.totalSteps}
الخطوات الفاشلة: ${progress.failedSteps}
الخطوة الحالية: ${progress.currentStep}
  `.trim();
}
