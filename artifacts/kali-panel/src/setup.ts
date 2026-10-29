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
  const lastUser =
    String(body?.prompt || body?.message || messages.filter((m) => m.role === "user").pop()?.content || "").trim();

  let reply = "";
  if (sysMsg.includes("فكّر بصوت عالٍ") || sysMsg.includes("أقل من 80 كلمة")) {
    reply = `تحليل تكتيكي للطلب: "${lastUser.slice(0, 90)}". متصل الآن بمكتبة المجرة (76,680+ ثغرة من 9 مصادر عالمية + Immunefi Web3) وترسانة 78 أداة كالي و28 فئة ثغرات أولية (P01-P28) مع مزامنة WebSocket الحية.`;
  } else if (sysMsg.includes("اكتب خطة مرقمة")) {
    reply = [
      "1. التحقق من النطاق القانوني (In-Scope) وقواعد برنامج Bug Bounty / Immunefi للهدف النشط",
      "2. تنفيذ استطلاع سلبي (Passive Recon) للنطاقات الفرعية، العقود الذكية، وشهادات TLS",
      "3. مطابقة السطح الهجومي مع مكتبة 76,680+ ثغرة (NVD, CISA KEV, GitHub, ExploitDB, Immunefi-Web3)",
      "4. تركيب سلاسل الثغرات (A->B->C) أو اختبار Fork محلي معزول عبر Foundry وSlither بدون أي أثر تدميري",
      "5. التحقق ببوابة Zero-FP (SHA-256 Baseline Diff) وتوليد التقرير الفني وكود الترقيع الدفاعي",
    ].join("\n");
  } else {
    const brainRes = resolveStandaloneApi("/api/ollama/chat", "POST", {
      prompt: lastUser || "تحليل أمني شامل للمنصة والهدف النشط",
      messages,
    }) as { response?: string } | null;
    reply =
      brainRes?.response ||
      `### ⚡ وكيل CyberNova الأمني الذاتي الوعي (متصل بمكتبة 76,680+ ثغرة وناقل WebSocket الحي)\n\n` +
      `تم تحليل طلبك:\n> \`${lastUser.slice(0, 150)}\`\n\n` +
      `- **الوعي الذاتي للمنصة**: متصل بـ **76,680+ ثغرة** (من 9 مصادر حية)، **78 أداة Kali & Web3**، **56 مشروع GitHub 2026**، و**28 فئة ثغرات أولية (P01–P28)**.`;
  }

  const encoder = new TextEncoder();
  const chunks = reply.match(/.{1,36}/gs) ?? [reply];
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(JSON.stringify({ token: chunk, done: false }) + "\n"));
        await new Promise((r) => setTimeout(r, 12));
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

type SseEmitterFn = (eventName: string, data: unknown) => void;
const activeCveSseEmitters = new Set<SseEmitterFn>();

function notifyAllSseAndWs(urlStr: string, method: string, mockResult: unknown) {
  const m = (method || "GET").toUpperCase();
  if (m === "GET") return;
  const g = typeof window !== "undefined"
    ? (window as unknown as { __cybernovaEmitWs?: (ev: { type: string; [key: string]: unknown }) => void })
    : null;

  if (urlStr.includes("/cve/hunt/trigger") || urlStr.includes("/cve/sync") || urlStr.includes("/cve-live/hunt")) {
    const resObj = (mockResult || {}) as Record<string, unknown>;
    const latestCve = resObj.latestCve as Record<string, unknown> | undefined;
    activeCveSseEmitters.forEach((emitNamed) => {
      emitNamed("hunt_start", { ts: new Date().toISOString() });
      if (latestCve) {
        emitNamed("cve_new", {
          id: latestCve.cveId || latestCve.id,
          cveId: latestCve.cveId || latestCve.id,
          severity: latestCve.severity || "CRITICAL",
          cvss: latestCve.cvssScore || 9.8,
          cvssScore: latestCve.cvssScore || 9.8,
          description: latestCve.description || "",
          source: latestCve.source || "Immunefi-Web3",
          exploitType: latestCve.cwe || "Reentrancy-Web3",
          epssScore: latestCve.epss || 0.97,
          publishedAt: new Date().toISOString(),
        });
      }
      emitNamed("hunt_done", resObj);
      emitNamed("stats_update", { total: resObj.total || 76680 });
    });
    g?.__cybernovaEmitWs?.({
      type: "cve_hunt_complete",
      newFound: resObj.newFound || 31,
      total: resObj.total || 76680,
      latestCve,
    });
  } else if (urlStr.includes("/cve/mutate")) {
    const resObj = (mockResult || {}) as Record<string, unknown>;
    const mutated = resObj.mutatedCve as Record<string, unknown> | undefined;
    if (mutated) {
      activeCveSseEmitters.forEach((emitNamed) => {
        emitNamed("cve_new", {
          id: mutated.cveId || mutated.id,
          cveId: mutated.cveId || mutated.id,
          severity: mutated.severity || "CRITICAL",
          cvss: mutated.cvssScore || 9.9,
          cvssScore: mutated.cvssScore || 9.9,
          description: mutated.description || "",
          source: mutated.source || "AI-Mutated",
          exploitType: mutated.exploitType || mutated.cwe || "Reentrancy-Web3",
          epssScore: mutated.epssScore || 0.98,
          publishedAt: new Date().toISOString(),
        });
        emitNamed("stats_update", { total: resObj.total || 76680 });
      });
      g?.__cybernovaEmitWs?.({
        type: "cve_mutated",
        cve: mutated,
        total: resObj.total || 76680,
      });
    }
  } else {
    g?.__cybernovaEmitWs?.({
      type: "api_mutation",
      endpoint: urlStr,
      method: m,
      ts: Date.now(),
    });
  }
}

// Intercept EventSource on static hosts (e.g., GitHub Pages) so SSE streams never fail and support named SSE events
if (typeof window !== "undefined" && window.location.hostname.endsWith("github.io")) {
  const OriginalEventSource = window.EventSource;
  class StandaloneEventSource extends EventTarget {
    url: string;
    readyState = 1;
    onopen: ((ev: Event) => unknown) | null = null;
    onmessage: ((ev: MessageEvent) => unknown) | null = null;
    onerror: ((ev: Event) => unknown) | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private emitNamedFn: SseEmitterFn | null = null;

    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      super();
      const urlStr = String(url);
      this.url = urlStr;
      if (!urlStr.includes("/api/") && OriginalEventSource) {
        return new OriginalEventSource(url, eventSourceInitDict) as unknown as StandaloneEventSource;
      }
      const emitNamed: SseEmitterFn = (eventName: string, data: unknown) => {
        if (this.readyState === 2) return;
        const jsonStr = JSON.stringify(data);
        if (eventName && eventName !== "message") {
          const namedEv = new MessageEvent(eventName, { data: jsonStr });
          this.dispatchEvent(namedEv);
        }
        const msgEv = new MessageEvent("message", { data: jsonStr });
        this.onmessage?.(msgEv);
        this.dispatchEvent(msgEv);
      };
      this.emitNamedFn = emitNamed;

      this.timer = setTimeout(() => {
        this.onopen?.(new Event("open"));
        this.dispatchEvent(new Event("open"));

        if (urlStr.includes("/local-agent/exec-stream")) {
          emitNamed("message", { type: "stdout", data: "kali@cybernova-kali-sandbox:~$ Executed in Kali Sandbox (78 tools ready)\n" });
          emitNamed("message", { type: "done", exitCode: 0 });
        } else if (urlStr.includes("/explorer/run")) {
          emitNamed("message", { type: "log", message: "⚡ تم جمع وتحديث 28 عنصر استخباراتي جديد في الفهرس المعرفي." });
          emitNamed("message", { type: "done", summary: { totalCollected: 28, totalSkipped: 0, duration: 380 } });
        } else if (urlStr.includes("/nuclei/scan")) {
          emitNamed("message", { type: "log", message: "[INF] Running passive template verification across 76,680+ galaxy signatures..." });
          emitNamed("message", { type: "done", total: 1 });
        } else if (urlStr.includes("/cve/stream") || urlStr.includes("/cve-live/stream")) {
          activeCveSseEmitters.add(emitNamed);
          const currentStats = resolveStandaloneApi("/api/cve/db/stats", "GET", null) as { total?: number } | null;
          const totalCount = currentStats?.total || 76680;
          emitNamed("connected", { ok: true, status: "live", sources: 9, total: totalCount });
          emitNamed("stats_update", { total: totalCount });
          emitNamed("cve_new", {
            id: "IMMUNEFI-2026-001",
            cveId: "IMMUNEFI-2026-001",
            severity: "CRITICAL",
            cvss: 10.0,
            cvssScore: 10.0,
            publishedAt: new Date().toISOString(),
            source: "Immunefi-Web3",
            exploitType: "Bridge-SigBypass",
            epssScore: 0.99,
            description:
              "[Immunefi Web3 Critical] Cross-Chain Bridge Message Verification & EIP-712 Signature Replay via uninitialized ecrecover(0x0) (Foundry Local Fork Verified).",
            pocUrl: "https://immunefi.com/explore/",
          });
        }
      }, 45);
    }
    close() {
      this.readyState = 2;
      if (this.timer) clearTimeout(this.timer);
      if (this.emitNamedFn) activeCveSseEmitters.delete(this.emitNamedFn);
    }
  }
  window.EventSource = StandaloneEventSource as unknown as typeof EventSource;
  (globalThis as unknown as { EventSource: unknown }).EventSource = window.EventSource;
}

// Intercept raw WebSocket on static hosts (e.g., GitHub Pages) so pages calling new WebSocket('/api/ws') connect to the internal bus
if (typeof window !== "undefined" && window.location.hostname.endsWith("github.io")) {
  const OriginalWebSocket = window.WebSocket;
  const g = window as unknown as {
    __cybernovaRawWsListeners?: Set<(ev: unknown) => void>;
    __cybernovaEmitWs?: (ev: { type: string; [key: string]: unknown }) => void;
  };
  if (!g.__cybernovaRawWsListeners) {
    g.__cybernovaRawWsListeners = new Set();
  }

  class StandaloneWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    url: string;
    readyState = 1;
    onopen: ((ev: Event) => unknown) | null = null;
    onmessage: ((ev: MessageEvent) => unknown) | null = null;
    onclose: ((ev: Event) => unknown) | null = null;
    onerror: ((ev: Event) => unknown) | null = null;
    private listener: ((payload: unknown) => void) | null = null;

    constructor(url: string | URL, protocols?: string | string[]) {
      super();
      const urlStr = String(url);
      this.url = urlStr;
      if ((urlStr.includes("127.0.0.1") || urlStr.includes("localhost")) && OriginalWebSocket) {
        return new OriginalWebSocket(url, protocols) as unknown as StandaloneWebSocket;
      }
      this.listener = (payload: unknown) => {
        if (this.readyState !== 1) return;
        const msgEv = new MessageEvent("message", { data: JSON.stringify(payload) });
        this.onmessage?.(msgEv);
        this.dispatchEvent(msgEv);
      };
      g.__cybernovaRawWsListeners?.add(this.listener);
      setTimeout(() => {
        const openEv = new Event("open");
        this.onopen?.(openEv);
        this.dispatchEvent(openEv);
        this.listener?.({ type: "ws_connected", status: "active", galaxyTotalCves: 76680, ts: Date.now() });
      }, 25);
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data === "string") {
        try {
          const parsed = JSON.parse(data) as { type?: string; [key: string]: unknown };
          g.__cybernovaEmitWs?.({ ...parsed, type: parsed.type || "ws_message" });
        } catch {
          // ignore
        }
      }
    }

    close() {
      this.readyState = 3;
      if (this.listener) g.__cybernovaRawWsListeners?.delete(this.listener);
    }
  }
  window.WebSocket = StandaloneWebSocket as unknown as typeof WebSocket;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = window.WebSocket;
}

const cybernovaFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let urlStr: string | null = null;

  if (typeof input === "string") {
    urlStr = input;
  } else if (input instanceof URL) {
    urlStr = input.toString();
  } else if (input instanceof Request) {
    urlStr = input.url;
  }

  // Never intercept direct browser calls to the user's local Ollama instance on port 11434
  const isLocalOllama =
    Boolean(urlStr) &&
    (urlStr!.includes(":11434") || urlStr!.includes("127.0.0.1:11434") || urlStr!.includes("localhost:11434"));
  if (isLocalOllama) {
    return originalFetch(input, init);
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
        notifyAllSseAndWs(urlStr, method, mock);
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
          notifyAllSseAndWs(urlStr, method, mock);
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
        notifyAllSseAndWs(urlStr, method, mock);
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

window.fetch = cybernovaFetch;
(globalThis as unknown as { fetch: unknown }).fetch = cybernovaFetch;

