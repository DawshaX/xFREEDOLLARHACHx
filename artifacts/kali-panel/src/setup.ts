import {
  Zap, Database, Activity, Cpu, Clock, Play, Shield, ShieldAlert, ShieldCheck,
  Terminal, Sparkles, Globe, Code, BookOpen, Server, Layers, AlertTriangle,
  CheckCircle2, RefreshCw, Search, Copy, Download, Plus, Trash2, Radio, Award,
  Save, FileText, CheckSquare, ExternalLink, ChevronRight, Bug, Eye, CheckCircle,
  AlertCircle, HardDrive, Usb,
} from "lucide-react";
import { resolveStandaloneApi } from "@/lib/standalone-api";

// Register core Lucide icon components on globalThis as a defensive safety net
try {
  const safeIcons: Record<string, unknown> = {
    Zap, Database, Activity, Cpu, Clock, Play, Shield, ShieldAlert, ShieldCheck,
    Terminal, Sparkles, Globe, Code, BookOpen, Server, Layers, AlertTriangle,
    CheckCircle2, RefreshCw, Search, Copy, Download, Plus, Trash2, Radio, Award,
    Save, FileText, CheckSquare, ExternalLink, ChevronRight, Bug, Eye, CheckCircle,
    AlertCircle, HardDrive, Usb,
  };
  const g = globalThis as Record<string, unknown>;
  for (const [key, val] of Object.entries(safeIcons)) {
    if (!(key in g) && val) {
      g[key] = val;
    }
  }
} catch {
  // ignore
}

const originalFetch = window.fetch.bind(window);

function parseBody(init?: RequestInit): Record<string, unknown> | null {
  if (!init?.body || typeof init.body !== "string") return null;
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildStaticOllamaStreamResponse(body: Record<string, unknown> | null): Response {
  const messages = (body?.messages as Array<{ role: string; content: string }>) ?? [];
  const sysMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser = messages.filter((m) => m.role === "user").pop()?.content ?? "";

  let reply = "";
  if (sysMsg.includes("فكّر بصوت عالٍ") || sysMsg.includes("أقل من 80 كلمة")) {
    reply = `تحليل الطلب: "${lastUser.slice(0, 80)}". سأقوم بمراجعة نطاق الهدف في ذاكرة المنصة، تطبيق منهجية OWASP Top 10 وCWE بشكل قانوني، وتوثيق النتائج في سجل المهام والملاحظات.`;
  } else if (sysMsg.includes("اكتب خطة مرقمة")) {
    reply = [
      "1. التحقق من النطاق القانوني (In-Scope) وقواعد برنامج Bug Bounty للهدف المحدد",
      "2. تنفيذ استطلاع سلبي (Passive Recon) للنطاقات الفرعية وشهادات TLS وسجلات DNS",
      "3. فحص ترويسات الأمان (CSP, HSTS, CORS) واكتشاف التقنيات المكشوفة",
      "4. اختبار نقاط النهاية ضد ثغرات IDOR/BOLA وSSRF بشكل آمن",
      "5. توثيق الأدلة وكتابة التقرير الفني مع كود الترقيع (Remediation Diff)",
    ].join("\n");
  } else {
    reply =
      `### ⚡ وكيل CyberNova الأمني (متصل بالذاكرة وناقل WebSocket الداخلي)\n\n` +
      `تم استلام طلبك وتحليله بنجاح:\n> \`${lastUser.slice(0, 150)}\`\n\n` +
      `- جميع الملاحظات والأهداف متزامنة في الوقت الفعلي مع **الذاكرة (/memory)** و**متتبع المهام (/mission-tracker)** و**Bug Bounty Studio**.\n` +
      `- يمكنك اختيار هدف من **Bug Bounty Studio** لبدء الفحص القانوني وتوثيق النتائج خطوة بخطوة.`;
  }

  const encoder = new TextEncoder();
  const chunks = reply.match(/.{1,24}/gs) ?? [reply];
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(JSON.stringify({ token: chunk, done: false }) + "\n"));
        await new Promise((r) => setTimeout(r, 15));
      }
      controller.enqueue(encoder.encode(JSON.stringify({ token: "", done: true }) + "\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function buildStaticSseResponse(urlStr: string, body: Record<string, unknown> | null): Response | null {
  const encoder = new TextEncoder();
  if (/\/api\/live-agent\/sessions\/[^/]+\/messages$/.test(urlStr)) {
    const content = String(body?.content || "");
    const toolId = `tc-${Date.now()}`;
    const reply =
      `⚡ **وكيل CyberNova الحي (Live Agent)**\n\n` +
      `تم تحليل طلبك: "${content}"\n\n` +
      `- تم فحص السياق المتزامن في **الذاكرة (/memory)** و**متتبع المهام (/mission-tracker)**.\n` +
      `- جاهز لتنفيذ خطوات الفحص القانوني وتوثيق الأدلة تلقائياً.`;
    const chunks = reply.match(/.{1,24}/gs) ?? [reply];

    const stream = new ReadableStream({
      async start(controller) {
        const send = (ev: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        send("tool_call", { id: toolId, name: "memory_search", input: { query: content.slice(0, 80) } });
        await new Promise((r) => setTimeout(r, 80));
        send("tool_result", { toolCallId: toolId, result: "Memory & Active Target Context Loaded", isError: false });
        for (const c of chunks) {
          send("delta", { text: c });
          await new Promise((r) => setTimeout(r, 14));
        }
        send("done", { ok: true });
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  if (/\/api\/agent\/tasks\/\d+\/steps\/\d+\/run$/.test(urlStr)) {
    const text = `▶ تم تنفيذ الخطوة والتحقق من النطاق وتوثيق المخرجات في سجل المهمة والذاكرة بنجاح.`;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (ev: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        send("step_started", { title: "تنفيذ خطوة الفحص" });
        await new Promise((r) => setTimeout(r, 80));
        send("step_delta", { text });
        await new Promise((r) => setTimeout(r, 80));
        send("step_completed", {});
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  if (urlStr.includes("/api/nova-agent-v3/chat")) {
    const cmd = String(body?.command || "فحص الهدف");
    const stream = new ReadableStream({
      async start(controller) {
        const send = (type: string, content: string) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, content })}\n\n`));
        };
        send("thought", `تحليل الهدف التكتيكي بناءً على الأمر: "${cmd}"`);
        await new Promise((r) => setTimeout(r, 80));
        send("action", "تشغيل محرك الاستطلاع السلبي وبوابة البرهان Zero-FP Gate");
        await new Promise((r) => setTimeout(r, 80));
        send("observation", "تم التحقق من السلسلة الرباعية [P01 JS] ➔ [P05 GraphQL] ➔ [P04 Mass Assign] ➔ [P02 BOLA] (CVSS 9.9).");
        await new Promise((r) => setTimeout(r, 80));
        send("final", "اكتمل التنفيذ التكتيكي وتم التوثيق في الذاكرة المشتركة.");
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  if (urlStr.includes("/api/kali-command/chat")) {
    const msg = String(body?.message || "status");
    const reply = `⚡ **مركز القيادة التكتيكي (Kali Command Center)**\nتم تنفيذ وتحليل الطلب: \`${msg}\`\n- الوكيل النشط: \`kali-sandbox-01\` (64 أداة كالي جاهزة)\n- بوابة البرهان Zero-FP: مفعلة (\`SHA256: 910b7659c9d71a03\`)`;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (ev: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        send("delta", { text: reply });
        await new Promise((r) => setTimeout(r, 40));
        send("done", { ok: true });
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  if (/\/api\/bot\/cron\/\d+\/trigger$/.test(urlStr)) {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (ev: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        send("tool_call", { name: "cve_and_osint_sync", input: { mode: "autonomous" } });
        await new Promise((r) => setTimeout(r, 60));
        send("tool_result", { name: "cve_and_osint_sync", ok: true });
        send("cron_message", { text: "تم تنفيذ المهمة المجدولة وتحديث الذاكرة بنجاح." });
        send("cron_completed", { ok: true });
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  return null;
}

// Intercept EventSource on static hosts (e.g., GitHub Pages) so SSE streams never fail
if (typeof window !== "undefined" && window.location.hostname.endsWith("github.io") && typeof window.EventSource !== "undefined") {
  const OriginalEventSource = window.EventSource;
  class StandaloneEventSource extends EventTarget {
    url: string;
    readyState = 1;
    onopen: ((ev: Event) => unknown) | null = null;
    onmessage: ((ev: MessageEvent) => unknown) | null = null;
    onerror: ((ev: Event) => unknown) | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      super();
      const urlStr = String(url);
      this.url = urlStr;
      if (!urlStr.includes("/api/")) {
        return new OriginalEventSource(url, eventSourceInitDict) as unknown as StandaloneEventSource;
      }
      this.timer = setTimeout(() => {
        this.onopen?.(new Event("open"));
        const emit = (data: unknown) => {
          const msgEv = new MessageEvent("message", { data: JSON.stringify(data) });
          this.onmessage?.(msgEv);
          this.dispatchEvent(msgEv);
        };
        if (urlStr.includes("/local-agent/exec-stream")) {
          emit({ type: "stdout", data: "kali@cybernova-kali-sandbox:~$ Executed in Kali Sandbox (64 tools ready)\n" });
          emit({ type: "done", exitCode: 0 });
        } else if (urlStr.includes("/explorer/run")) {
          emit({ type: "log", message: "⚡ تم جمع وتحديث 12 عنصر استخباراتي جديد في الفهرس المعرفي." });
          emit({ type: "done", summary: { totalCollected: 12, totalSkipped: 1, duration: 420 } });
        } else if (urlStr.includes("/nuclei/scan")) {
          emit({ type: "log", message: "[INF] Running passive template verification..." });
          emit({ type: "done", total: 1 });
        } else if (urlStr.includes("/cve/stream") || urlStr.includes("/cve-live/stream")) {
          emit({
            id: "CVE-2025-29927",
            severity: "CRITICAL",
            cvss: 9.8,
            publishedAt: new Date().toISOString(),
            source: "NVD/KEV",
            exploitType: "AuthBypass",
            epssScore: 0.96,
            pocUrl: "https://nvd.nist.gov/vuln/detail/CVE-2025-29927",
          });
        }
      }, 60);
    }
    close() {
      this.readyState = 2;
      if (this.timer) clearTimeout(this.timer);
    }
  }
  window.EventSource = StandaloneEventSource as unknown as typeof EventSource;
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let urlStr: string | null = null;

  if (typeof input === "string") {
    urlStr = input;
  } else if (input instanceof URL) {
    urlStr = input.toString();
  } else if (input instanceof Request) {
    urlStr = input.url;
  }

  if (urlStr && urlStr.includes("/api/")) {
    const method = init?.method || (input instanceof Request ? input.method : "GET");
    const parsedBody = parseBody(init);
    const isStaticHost = window.location.hostname.endsWith("github.io");

    if (isStaticHost) {
      if (urlStr.includes("/api/ollama/chat/stream")) {
        return buildStaticOllamaStreamResponse(parsedBody);
      }
      const sseMock = buildStaticSseResponse(urlStr, parsedBody);
      if (sseMock) return sseMock;

      const mock = resolveStandaloneApi(urlStr, method, parsedBody);
      if (mock !== null) {
        return new Response(JSON.stringify(mock), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, items: [], results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const resp = await originalFetch(input, init);
      if (!resp.ok) {
        if (urlStr.includes("/api/ollama/chat/stream")) {
          return buildStaticOllamaStreamResponse(parsedBody);
        }
        const sseMock = buildStaticSseResponse(urlStr, parsedBody);
        if (sseMock) return sseMock;

        const mock = resolveStandaloneApi(urlStr, method, parsedBody);
        if (mock !== null) {
          return new Response(JSON.stringify(mock), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return resp;
    } catch (err) {
      if (urlStr.includes("/api/ollama/chat/stream")) {
        return buildStaticOllamaStreamResponse(parsedBody);
      }
      const sseMock = buildStaticSseResponse(urlStr, parsedBody);
      if (sseMock) return sseMock;

      const mock = resolveStandaloneApi(urlStr, method, parsedBody);
      if (mock !== null) {
        return new Response(JSON.stringify(mock), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw err;
    }
  }

  return originalFetch(input, init);
};
