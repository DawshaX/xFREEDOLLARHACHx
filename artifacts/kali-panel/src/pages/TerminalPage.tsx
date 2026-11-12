import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, Trash2, Loader2, ServerOff } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { opsFetch } from "@/lib/ops-client";

/**
 * Live Terminal — كونسول الأسطول الحقيقي.
 * قبل: أوامر معلبة بترد من الذاكرة (whoami/ls وهمية — LOCAL-LOGIC في الإحصاء).
 * دلوقتي: كل أمر بيتنفّذ فعليًا على العقدة المختارة من الأسطول المتصل
 * (POST /api/local-agent/exec — بوابة ops). الاستثناء الوحيد: help/clear محليين.
 */

interface TerminalLine {
  id: string; type: "input" | "output" | "error" | "meta"; content: string; timestamp: string;
}

interface AgentInfo { id: string; hostname: string; platform: string; cpus?: number; totalMemory?: number; }

interface ExecResult { stdout?: string; stderr?: string; exitCode?: number; durationMs?: number; error?: string; }

const now = () => new Date().toLocaleTimeString("ar-EG", { hour12: false });

export default function TerminalPage() {
  const [lines, setLines] = useState<TerminalLine[]>([{
    id: "welcome", type: "meta", timestamp: now(),
    content: "NOVA Fleet Terminal — تنفيذ حقيقي على العقد المختارة. اكتب `help` للمساعدة. انتبه: أوامرك بتترجم لشل فعلي.",
  }]);
  const [input, setInput] = useState("");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false;
    opsFetch<{ agents?: AgentInfo[] }>("/local-agent/agents").then((r) => {
      if (dead) return;
      if (r.ok && r.data?.agents) {
        setAgents(r.data.agents);
        // الافتراضي: self-node لو موجودة (الهب نفسه)، غير كده أول عقدة
        const def = r.data.agents.find((a) => a.id === "self-node") ?? r.data.agents[0];
        if (def) setAgentId(def.id);
      } else {
        setAgentsError(r.denial || r.error || "فشل جلب قائمة العقد");
      }
    });
    return () => { dead = true; };
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  const push = useCallback((type: TerminalLine["type"], content: string) => {
    setLines((ls) => [...ls.slice(-400), { id: `${Date.now()}-${Math.random()}`, type, content, timestamp: now() }]);
  }, []);

  const run = useCallback(async (rawCmd: string) => {
    const cmd = rawCmd.trim();
    if (!cmd || running) return;
    push("input", `$ ${cmd}`);
    setHist((h) => [cmd, ...h.slice(0, 60)]);
    setHistIdx(-1);
    setInput("");

    if (cmd === "clear") { setLines([]); return; }
    if (cmd === "help") {
      push("meta", "كل أمر بيتنفّذ على العقدة المختارة فوق (شل حقيقي). المحلي بس: help · clear · agents");
      return;
    }
    if (cmd === "agents") {
      push("meta", agents.length ? agents.map((a) => `· ${a.id} — ${a.hostname} (${a.platform}${a.cpus ? `, ${a.cpus} CPU` : ""})`).join("\n") : "مفيش عقد متصلة");
      return;
    }
    if (!agentId) { push("error", "مفيش عقدة مختارة — الأسطول فاضي أو لسه بيحمّل."); return; }

    setRunning(true);
    const t0 = Date.now();
    try {
      const r = await opsFetch<ExecResult>("/local-agent/exec", {
        method: "POST",
        body: { command: cmd, agentId, timeout: 60_000 },
      });
      const ms = Date.now() - t0;
      if (!r.ok) {
        push("error", `✗ رُفض (${r.status}): ${r.denial || r.error || "تعذّر التنفيذ"}`);
        return;
      }
      const d = r.data ?? {};
      const out = (d.stdout ?? "").replace(/\s+$/, "");
      const err = (d.stderr ?? "").replace(/\s+$/, "");
      if (out) push("output", out.slice(0, 20000));
      if (err) push("error", err.slice(0, 8000));
      if (!out && !err) push("meta", "(بدون مخرجات)");
      push("meta", `exit ${d.exitCode ?? "?"} · ${d.durationMs ?? ms}ms · ${agentId}`);
    } catch (e) {
      push("error", `✗ خطأ شبكة: ${String((e as Error).message || e)}`);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }, [agentId, agents, push, running]);

  return (
    <div style={{ padding: 18, direction: "rtl" }} onClick={() => inputRef.current?.focus()}>
      <PageHeader
        title="Live Terminal — كونسول الأسطول"
        subtitle="تنفيذ حقيقي عبر /api/local-agent/exec على أي عقدة متصلة"
        icon={Terminal}
      />

      {/* شريط العقد */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>العقدة:</span>
        {agents.map((a) => (
          <button key={a.id} onClick={(e) => { e.stopPropagation(); setAgentId(a.id); }}
            style={{ cursor: "pointer", fontFamily: "monospace", fontSize: 12, padding: "5px 12px", borderRadius: 999,
              border: agentId === a.id ? "1px solid #4ade80" : "1px solid rgba(255,255,255,0.14)",
              background: agentId === a.id ? "rgba(74,222,128,0.14)" : "rgba(255,255,255,0.03)",
              color: agentId === a.id ? "#4ade80" : "rgba(255,255,255,0.7)" }}>
            {a.id === "self-node" ? "🏠 " : ""}{a.id}
          </button>
        ))}
        {agents.length === 0 && (
          <span style={{ fontSize: 12, color: "#fca5a5", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ServerOff size={14} /> {agentsError ?? "مفيش عقد متصلة"}
          </span>
        )}
      </div>

      {/* الشاشة */}
      <div style={{ background: "#050607", border: "1px solid rgba(74,222,128,0.16)", borderRadius: 14, padding: 14, minHeight: 420, maxHeight: "58vh", overflowY: "auto", fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5, lineHeight: 1.65, direction: "ltr", textAlign: "left" }}>
        {lines.map((l) => (
          <div key={l.id} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word",
            color: l.type === "input" ? "#4ade80" : l.type === "error" ? "#f87171" : l.type === "meta" ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.82)" }}>
            {l.content}
          </div>
        ))}
        {running && <div style={{ color: "rgba(255,255,255,0.4)" }}><Loader2 size={13} className="animate-spin" style={{ display: "inline", verticalAlign: "-2px" }} /> بيتنفّذ…</div>}
        <div ref={bottomRef} />
      </div>

      {/* الإدخال */}
      <form
        style={{ display: "flex", gap: 8, marginTop: 10 }}
        onSubmit={(e) => { e.preventDefault(); run(input); }}
      >
        <span style={{ alignSelf: "center", color: "#4ade80", fontFamily: "monospace", fontWeight: 800 }}>$</span>
        <input
          ref={inputRef}
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") { e.preventDefault(); const i = Math.min(histIdx + 1, hist.length - 1); if (hist[i]) { setHistIdx(i); setInput(hist[i]); } }
            if (e.key === "ArrowDown") { e.preventDefault(); const i = histIdx - 1; if (i >= 0 && hist[i]) { setHistIdx(i); setInput(hist[i]); } else { setHistIdx(-1); setInput(""); } }
          }}
          placeholder={agentId ? `نفّذ على ${agentId}… (↑ للتاريخ)` : "استنى اتصال العقد…"}
          style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#e6ffe6", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "10px 12px", outline: "none", direction: "ltr" }}
          autoFocus
        />
        <button type="button" onClick={() => setLines([])} title="مسح الشاشة"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "0 14px", cursor: "pointer", color: "rgba(255,255,255,0.6)" }}>
          <Trash2 size={15} />
        </button>
      </form>
    </div>
  );
}
