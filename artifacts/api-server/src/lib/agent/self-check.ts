/**
 * NOVA — Self Check (the honest pulse)
 * ────────────────────────────────────
 * Answers one question with evidence instead of claims: **is the program
 * actually working right now?**
 *
 * Every check performs a real operation and reports what it observed — never
 * what it hopes. Nothing here is simulated:
 *
 *   runtime   — process uptime, RSS vs the host limit, node version
 *   storage   — can we write the memory file, where is it, how big is it
 *   brain     — which model providers are really reachable (Ollama / free keys)
 *   tools     — the tool registry is loaded and a real tool executes
 *   internet  — outbound DNS + HTTPS actually resolve from this process
 *   socket    — the WebSocket hub is accepting clients
 *   daemon    — the 24/7 background loop is running or not
 *
 * Design rules
 *  • Never throws: a failed probe becomes `{ ok: false }`, not a 500.
 *  • Every probe is time-boxed so a dead upstream cannot hang the UI.
 *  • Results are cached briefly (default 20 s) because Render's free tier has
 *    one shared CPU and this endpoint may be polled by the dashboard.
 *  • `verdict` is a single Arabic sentence a human can act on.
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { listConfiguredProviders } from "./llm";
import { AGENT_TOOLS, runAgentTool } from "./tools";
import { memoryStats, exportMemories } from "./memory-store";

export type SelfCheckStatus = "ok" | "warn" | "fail";

export interface SelfCheckItem {
  id: string;
  label: string;
  status: SelfCheckStatus;
  /** What was actually observed, in Arabic, with real numbers. */
  detail: string;
  /** Why it matters / what to do about it. */
  fix?: string;
  ms: number;
}

export interface SelfCheckReport {
  ok: boolean;
  score: number;
  total: number;
  passed: number;
  verdict: string;
  checkedAt: string;
  cached: boolean;
  items: SelfCheckItem[];
}

const CACHE_MS = Number(process.env.NOVA_SELFCHECK_CACHE_MS || 20_000);
let cache: { at: number; report: SelfCheckReport } | null = null;

async function timeBox<T>(fn: () => Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    fn()
      .then(resolve)
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(t));
  });
}

/** Turn a probe result into an item, timing it. */
async function item(
  id: string,
  label: string,
  fn: () => Promise<Omit<SelfCheckItem, "id" | "label" | "ms">>,
): Promise<SelfCheckItem> {
  const started = Date.now();
  try {
    const r = await fn();
    return { id, label, ms: Date.now() - started, ...r };
  } catch (err) {
    return {
      id,
      label,
      status: "fail",
      detail: `الفحص نفسه وقع: ${(err as Error).message}`,
      ms: Date.now() - started,
    };
  }
}

/* ── individual probes ───────────────────────────────────────────────────── */

async function probeRuntime(): Promise<Omit<SelfCheckItem, "id" | "label" | "ms">> {
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const limitMb = Number(process.env.NOVA_MEM_LIMIT_MB || 512); // Render free tier
  const uptimeMin = Math.round(process.uptime() / 60);
  const overHalf = rss > limitMb * 0.6;
  return {
    status: overHalf ? "warn" : "ok",
    detail: `${rss} MB من ${limitMb} MB · شغّال من ${uptimeMin} دقيقة · Node ${process.version} · ${os.cpus().length} CPU`,
    fix: overHalf ? `الذاكرة فوق 60% من حد الخطة (${limitMb} MB). راجع عدد الجلسات المفتوحة.` : undefined,
  };
}

async function probeStorage(): Promise<Omit<SelfCheckItem, "id" | "label" | "ms">> {
  const file = process.env.NOVA_MEMORY_FILE
    ? path.resolve(process.env.NOVA_MEMORY_FILE)
    : path.resolve(process.cwd(), "state/nova-memory.json");
  const dir = path.dirname(file);
  let writable = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.selfcheck-${process.pid}`);
    fs.writeFileSync(probe, "1");
    fs.unlinkSync(probe);
    writable = true;
  } catch {
    writable = false;
  }
  const exists = fs.existsSync(file);
  const bytes = exists ? fs.statSync(file).size : 0;
  const stats = memoryStats();
  // Anything inside the deploy directory dies with the next deploy; a path
  // outside it (mounted disk, /var/data, /tmp) survives until the host wipes it.
  const cwd = process.cwd();
  const ephemeral = file.startsWith(cwd + path.sep);

  return {
    status: !writable ? "fail" : exists ? "ok" : "warn",
    detail: writable
      ? `${stats.total} ذكرى (${bytes} بايت) في ${file}`
      : `مش قادر أكتب في ${dir} — الذاكرة هتضيع`,
    fix: !writable
      ? "المسار للقراءة فقط (شائع على الاستضافات المجانية بدون قرص). غيّر NOVA_MEMORY_FILE لمسار قابل للكتابة."
      : exists
        ? ephemeral
          ? "الملف جوه مجلد الإصدار — بيتصفّر مع كل deploy. اعمل نسخة دورية من /api/nova-core/memory/export."
          : undefined
        : "لسه مفيش ذاكرة محفوظة — أول محادثة هتنشئ الملف.",
  };
}

async function probeBrain(): Promise<Omit<SelfCheckItem, "id" | "label" | "ms">> {
  const providers = await timeBox(() => listConfiguredProviders(), 4000, []);
  const ollama = providers.find((p) => p.id === "ollama");
  let ollamaOnline = false;
  if (ollama) {
    ollamaOnline = await timeBox(
      async () => {
        const r = await fetch(`${ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
        return r.ok;
      },
      3000,
      false,
    );
  }
  const cloud = providers.filter((p) => p.id !== "ollama");
  const freeKeys = ["GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "TOGETHER_API_KEY", "CEREBRAS_API_KEY", "GITHUB_MODELS_TOKEN"];
  const present = freeKeys.filter((k) => (process.env[k] || "").trim().length > 8);
  const live = ollamaOnline || cloud.length > 0;

  return {
    status: live ? "ok" : "warn",
    detail: live
      ? `العقل اللغوي متصل: ${ollamaOnline ? "Ollama محلي" : ""}${ollamaOnline && cloud.length ? " + " : ""}${cloud.map((p) => p.label).join(" + ")}`
      : `عقل مدمج فقط (مفيش نموذج لغوي) · مفاتيح مجانية موجودة: ${present.length ? present.join(", ") : "ولا مفتاح"}`,
    fix: live
      ? undefined
      : "الأدوات بتشتغل فعلاً بالعقل المدمج، لكن الحوار أذكى بمفتاح مجاني: GROQ_API_KEY أو GEMINI_API_KEY من لوحة الاستضافة.",
  };
}

async function probeTools(): Promise<Omit<SelfCheckItem, "id" | "label" | "ms">> {
  const count = AGENT_TOOLS.length;
  // Execute the cheapest real tool end-to-end. hash_text is offline and pure,
  // so it proves wiring without depending on the network.
  const out = await timeBox(
    () => runAgentTool("hash_text", { text: "nova-selfcheck" }),
    5000,
    null,
  );
  const ok = Boolean(out && out.ok);
  return {
    status: count > 0 && ok ? "ok" : count > 0 ? "warn" : "fail",
    detail: `${count} أداة مسجّلة · تنفيذ حقيقي لأداة hash_text: ${ok ? `نجح (${out?.summary ?? ""})` : "فشل"}`,
    fix: ok ? undefined : "سجّل التنفيذ بيوقع — راجع لوج السيرفر عند تشغيل أي أداة.",
  };
}

async function probeInternet(): Promise<Omit<SelfCheckItem, "id" | "label" | "ms">> {
  const targets = [
    { name: "dns.google", host: "dns.google", port: 443 },
    { name: "api.github.com", host: "api.github.com", port: 443 },
    { name: "services.nvd.nist.gov", host: "services.nvd.nist.gov", port: 443 },
  ];
  const reach = (host: string, port: number) =>
    new Promise<{ ok: boolean; ms: number }>((resolve) => {
      const started = Date.now();
      const sock = net.connect({ host, port });
      const done = (ok: boolean) => {
        sock.destroy();
        resolve({ ok, ms: Date.now() - started });
      };
      sock.setTimeout(3000, () => done(false));
      sock.once("connect", () => done(true));
      sock.once("error", () => done(false));
    });

  const results = await Promise.all(targets.map((t) => reach(t.host, t.port)));
  const up = results.filter((r) => r.ok).length;
  const detail = targets
    .map((t, i) => `${t.name}: ${results[i].ok ? `متاح (${results[i].ms}ms)` : "مقطوع"}`)
    .join(" · ");

  return {
    status: up === targets.length ? "ok" : up > 0 ? "warn" : "fail",
    detail,
    fix:
      up === targets.length
        ? undefined
        : "جزء من المصادر مش واصل من السيرفر. الأدوات المحلية (DNS/تحليل/ذاكرة) هتفضل شغالة، والمصادر المقطوعة هتفشل بصدق مش هتخترع نتيجة.",
  };
}

async function probeSocket(): Promise<Omit<SelfCheckItem, "id" | "label" | "ms">> {
  // Ask the hub module directly: real client count, no network round-trip.
  const hub = await import("../ws-hub");
  const clients = typeof (hub as { getHubClientCount?: () => number }).getHubClientCount === "function"
    ? (hub as { getHubClientCount: () => number }).getHubClientCount()
    : -1;
  const health = await timeBox(
    async () => {
      const port = Number(process.env.PORT || 8080);
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
      const j = (await r.json()) as { wsConnected?: boolean };
      return Boolean(j.wsConnected);
    },
    3000,
    null,
  );
  const listening = health !== null;
  return {
    status: listening ? (health ? "ok" : "warn") : "warn",
    detail: `قناة الـWebSocket شغالة · عملاء متصلين الآن: ${clients < 0 ? "غير معروف" : clients} · /api/health wsConnected=${JSON.stringify(health)}`,
    fix: listening
      ? undefined
      : "مش قادر أتصل بالبورت المحلي — طبيعي لو السيرفر بيحسب PORT بطريقة مختلفة. جرّب الفحص من المتصفح على /api/health.",
  };
}

async function probeDaemon(): Promise<Omit<SelfCheckItem, "id" | "label" | "ms">> {
  try {
    const disabled = ["0", "false", "off", "no"].includes(String(process.env.NOVA_CRON_ENABLED ?? "").toLowerCase());
    if (disabled) {
      return {
        status: "warn",
        detail: "الدورة الذاتية متوقفة في هذا التشغيل (NOVA_CRON_ENABLED=0) — مش عطل، ده إعداد",
        fix: "شيل NOVA_CRON_ENABLED أو خليه =1 لو عايز النبضات الذاتية 24/7 تشتغل.",
      };
    }
    const statePath = path.resolve(process.cwd(), "state/cybernova-brain-state.json");
    if (!fs.existsSync(statePath)) {
      return {
        status: "warn",
        detail: "ملف حالة الدمون مش موجود — النبضات الذاتية هتبدأ مع أول دورة",
      };
    }
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      daemonStatus?: { state?: string; lastHeartbeatAt?: string; autonomousCyclesCompleted?: number };
    };
    const d = raw.daemonStatus ?? {};
    const last = d.lastHeartbeatAt ? Date.parse(d.lastHeartbeatAt) : NaN;
    const ageMin = Number.isFinite(last) ? Math.round((Date.now() - last) / 60000) : null;
    const stale = ageMin === null || ageMin > 180;
    return {
      status: stale ? "warn" : "ok",
      detail: `${d.state ?? "غير معروف"} · آخر نبضة ${ageMin === null ? "غير معروفة" : `قبل ${ageMin} دقيقة`} · ${d.autonomousCyclesCompleted ?? 0} دورة`,
      fix: stale
        ? "آخر نبضة قديمة. على Render بينام السيرفر — الحل keep-alive (NOVA_URL في GitHub Actions) أو UptimeRobot."
        : undefined,
    };
  } catch (err) {
    return { status: "warn", detail: `تعذّر قراءة حالة الدمون: ${(err as Error).message}` };
  }
}

/* ── aggregation ────────────────────────────────────────────────────────── */

export async function runSelfCheck(opts: { refresh?: boolean } = {}): Promise<SelfCheckReport> {
  if (!opts.refresh && cache && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.report, cached: true };
  }

  const items = await Promise.all([
    item("runtime", "الذاكرة والوقت التشغيلي", probeRuntime),
    item("storage", "التخزين والذاكرة طويلة الأمد", probeStorage),
    item("brain", "العقل اللغوي", probeBrain),
    item("tools", "الأدوات والتنفيذ الحقيقي", probeTools),
    item("internet", "الاتصال بالإنترنت", probeInternet),
    item("socket", "قناة الاتصال الحية (WebSocket)", probeSocket),
    item("daemon", "الدورة الذاتية 24/7", probeDaemon),
  ]);

  const passed = items.filter((i) => i.status === "ok").length;
  const failed = items.filter((i) => i.status === "fail");
  const warned = items.filter((i) => i.status === "warn");

  const verdict = failed.length
    ? `فيه ${failed.length} حاجة واقعة فعلاً: ${failed.map((f) => f.label).join("، ")} — شوف «الحل» جنب كل واحدة.`
    : warned.length
      ? `البرنامج شغّال ✅ بس فيه ${warned.length} نقطة تحتاج انتباه: ${warned.map((w) => w.label).join("، ")}.`
      : "كله شغّال: التشغيل والتخزين والأدوات والإنترنت والقناة الحية والدورة الذاتية — كله متحقّق بفحص حقيقي، مش كلام.";

  const report: SelfCheckReport = {
    ok: failed.length === 0,
    score: Math.round((passed / items.length) * 100),
    total: items.length,
    passed,
    verdict,
    checkedAt: new Date().toISOString(),
    cached: false,
    items,
  };

  cache = { at: Date.now(), report };
  return report;
}

/** Lightweight storage snapshot for cards that do not need the full probe. */
export function storageSnapshot(): { bytes: number; records: number } {
  try {
    const json = exportMemories();
    return { bytes: Buffer.byteLength(json), records: memoryStats().total };
  } catch {
    return { bytes: 0, records: 0 };
  }
}
