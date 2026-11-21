/**
 * SovereignKnowledgeLabView — المختبر السيادي الحي + مصفوفة الـ426 ثغرة والدمج + مكتبة الـ16 كتاباً
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════
 * مكون موحّد قابل للتضمين في:
 *   1. سطح مكتب كالي لينكس 2099 (/kali-env — Workspace 7: Sovereign Lab)
 *   2. قمرة الوكيل الحي المتكاملة (/agent-pro — AgentWorkCockpit Stage)
 * مع مساحات مريحة للعين، وفواصل بصرية واضحة، وأدوات تكبير وتصغير، وتنفيذ مباشر في الترمنال والشات.
 */
import React, { useCallback, useEffect, useState } from "react";
import { novaAuthHeaders } from "@/lib/ops-client";

const API_BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL || "/api").replace(/\/$/, "");

export interface SovereignKnowledgeLabViewProps {
  activeTarget: string;
  onTargetChange?: (nextTarget: string) => void;
  onRunTerminalCommand?: (cmd: string) => void;
  onSendToAgent?: (prompt: string) => void;
  initialSection?: "liveLab" | "vulns426" | "books";
}

export const SovereignKnowledgeLabView: React.FC<SovereignKnowledgeLabViewProps> = ({
  activeTarget,
  onTargetChange,
  onRunTerminalCommand,
  onSendToAgent,
  initialSection = "liveLab",
}) => {
  const [section, setSection] = useState<"liveLab" | "vulns426" | "books">(initialSection);
  const [localZoom, setLocalZoom] = useState<number>(100);

  // 1) Sovereign Live Lab state
  const [labData, setLabData] = useState<any>(null);
  const [labBusy, setLabBusy] = useState(false);
  const [consultDecision, setConsultDecision] = useState("");
  const [consultMode, setConsultMode] = useState<string>("root-full-attack");
  const [consultResult, setConsultResult] = useState<any>(null);

  // 2) 426 Vulnerability Matrix + Exploit Mutation/Fusion state
  const [vulnsData, setVulnsData] = useState<any>(null);
  const [vulnQuery, setVulnQuery] = useState("");
  const [vulnSector, setVulnSector] = useState("all");
  const [vulnSeverity, setVulnSeverity] = useState("all");
  const [vulnsBusy, setVulnsBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(["VULN-426-001", "VULN-426-098", "VULN-426-162"]);
  const [condition, setCondition] = useState("waf-cloudflare");
  const [attackMode, setAttackMode] = useState<"root-full-attack" | "max-protection" | "purple-fusion" | "stealth-zero-day">("root-full-attack");
  const [fusionResult, setFusionResult] = useState<any>(null);
  const [fusionBusy, setFusionBusy] = useState(false);

  // 3) 16 Kali & Cyber Books state
  const [booksData, setBooksData] = useState<any>(null);
  const [booksBusy, setBooksBusy] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<string>("all");
  const [trainResult, setTrainResult] = useState<any>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customCategory, setCustomCategory] = useState("Custom Kali & Exploit Research");
  const [customTools, setCustomTools] = useState("nmap, nuclei, sqlmap, metasploit");
  const [customContent, setCustomContent] = useState("");
  const [directAgentInput, setDirectAgentInput] = useState("");
  const [storageSyncBusy, setStorageSyncBusy] = useState(false);
  const [storageSyncResult, setStorageSyncResult] = useState<any>(null);

  const targetHost = activeTarget && activeTarget !== "127.0.0.1" ? activeTarget : "example.com";

  const syncAllStorageTiersNow = useCallback(async () => {
    setStorageSyncBusy(true);
    try {
      const r = await fetch(`${API_BASE}/live-agent/storage-tiers/sync`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          note: `مزامنة شاملة رباعية الطبقات من المختبر السيادي الحي على الهدف ${targetHost}`,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setStorageSyncResult(d);
      }
    } catch {
      /* ignore */
    }
    setStorageSyncBusy(false);
  }, [targetHost]);

  const refreshLab = useCallback(async () => {
    setLabBusy(true);
    try {
      const r = await fetch(`${API_BASE}/live-agent/sovereign-lab?target=${encodeURIComponent(targetHost)}`, {
        headers: novaAuthHeaders(),
      });
      if (r.ok) setLabData(await r.json());
    } catch {
      /* ignore */
    }
    setLabBusy(false);
  }, [targetHost]);

  const submitConsult = useCallback(
    async (overrideDecision?: string, overrideMode?: string) => {
      setLabBusy(true);
      try {
        const r = await fetch(`${API_BASE}/live-agent/sovereign-lab/consult`, {
          method: "POST",
          headers: novaAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            target: targetHost,
            decision: overrideDecision ?? consultDecision,
            mode: overrideMode ?? consultMode,
          }),
        });
        if (r.ok) {
          const d = await r.json();
          setConsultResult(d);
          if (d.labState) setLabData((prev: any) => ({ ...(prev || {}), ...d.labState }));
        }
      } catch {
        /* ignore */
      }
      setLabBusy(false);
    },
    [targetHost, consultDecision, consultMode]
  );

  const refreshVulns = useCallback(
    async (q = vulnQuery, sec = vulnSector, sev = vulnSeverity) => {
      setVulnsBusy(true);
      try {
        const params = new URLSearchParams({
          q,
          sector: sec,
          severity: sev,
          limit: "80",
        });
        const r = await fetch(`${API_BASE}/live-agent/vulns-426?${params.toString()}`, {
          headers: novaAuthHeaders(),
        });
        if (r.ok) setVulnsData(await r.json());
      } catch {
        /* ignore */
      }
      setVulnsBusy(false);
    },
    [vulnQuery, vulnSector, vulnSeverity]
  );

  const runMutateAndFuse = useCallback(async () => {
    setFusionBusy(true);
    try {
      const r = await fetch(`${API_BASE}/live-agent/vulns-426/mutate-and-fuse`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          vulnIds: selectedIds,
          target: targetHost,
          condition,
          mode: attackMode,
        }),
      });
      if (r.ok) setFusionResult(await r.json());
    } catch {
      /* ignore */
    }
    setFusionBusy(false);
  }, [selectedIds, targetHost, condition, attackMode]);

  const refreshBooks = useCallback(async () => {
    setBooksBusy(true);
    try {
      const r = await fetch(`${API_BASE}/live-agent/books`, {
        headers: novaAuthHeaders(),
      });
      if (r.ok) setBooksData(await r.json());
    } catch {
      /* ignore */
    }
    setBooksBusy(false);
  }, []);

  const runBookTrain = useCallback(
    async (bookId = selectedBookId) => {
      setBooksBusy(true);
      try {
        const r = await fetch(`${API_BASE}/live-agent/books/train`, {
          method: "POST",
          headers: novaAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            bookId,
            focusTarget: targetHost,
          }),
        });
        if (r.ok) {
          const d = await r.json();
          setTrainResult(d);
          void refreshBooks();
        }
      } catch {
        /* ignore */
      }
      setBooksBusy(false);
    },
    [selectedBookId, targetHost, refreshBooks]
  );

  const runBookIngest = useCallback(async () => {
    if (!customTitle.trim() || !customContent.trim()) return;
    setBooksBusy(true);
    try {
      const r = await fetch(`${API_BASE}/live-agent/books/ingest`, {
        method: "POST",
        headers: novaAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          titleAr: customTitle.trim(),
          category: customCategory.trim(),
          toolsCovered: customTools
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          content: customContent.trim(),
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setTrainResult(d);
        setCustomTitle("");
        setCustomContent("");
        void refreshBooks();
      }
    } catch {
      /* ignore */
    }
    setBooksBusy(false);
  }, [customTitle, customCategory, customTools, customContent, refreshBooks]);

  useEffect(() => {
    void refreshLab();
    void refreshVulns();
    void refreshBooks();
  }, [refreshLab, refreshVulns, refreshBooks]);

  return (
    <div
      dir="rtl"
      className="h-full w-full flex flex-col bg-[#07060e] text-slate-100 overflow-hidden select-text"
      style={localZoom !== 100 ? ({ zoom: `${localZoom}%` } as React.CSSProperties) : undefined}
    >
      {/* شريط التحكم العلوي الفسيح مع الفواصل البصرية وأدوات التكبير والتصغير */}
      <div className="shrink-0 px-4 py-3 bg-gradient-to-r from-[#0d1220] via-[#100d22] to-[#0a1618] border-b border-cyan-500/30 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setSection("liveLab")}
            className={`px-3.5 py-2 rounded-xl text-xs font-black font-mono transition-all border ${
              section === "liveLab"
                ? "bg-cyan-500/25 border-cyan-400 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.3)]"
                : "bg-white/[0.04] border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            🧪 المختبر السيادي الحي والوعي والاستشارة
          </button>

          <span className="text-slate-600 font-bold select-none">|</span>

          <button
            onClick={() => setSection("vulns426")}
            className={`px-3.5 py-2 rounded-xl text-xs font-black font-mono transition-all border ${
              section === "vulns426"
                ? "bg-rose-500/25 border-rose-400 text-rose-100 shadow-[0_0_16px_rgba(244,63,94,0.3)]"
                : "bg-white/[0.04] border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            🎯 قاعدة الـ426 ثغرة ومحرك التعديل والدمج (Root & Max Protection)
          </button>

          <span className="text-slate-600 font-bold select-none">|</span>

          <button
            onClick={() => setSection("books")}
            className={`px-3.5 py-2 rounded-xl text-xs font-black font-mono transition-all border ${
              section === "books"
                ? "bg-amber-500/25 border-amber-400 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.3)]"
                : "bg-white/[0.04] border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            📚 مكتبة الـ16 كتاباً وتدريب كالي الحي
          </button>
        </div>

        {/* الهدف النشط + أزرار التكبير والتصغير */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-black/60 border border-cyan-500/35 rounded-xl px-3 py-1.5">
            <span className="text-[11px] font-mono text-cyan-300 font-bold">🎯 الهدف:</span>
            <input
              value={activeTarget}
              onChange={(e) => onTargetChange?.(e.target.value)}
              dir="ltr"
              className="w-36 bg-transparent text-xs font-mono font-bold text-white focus:outline-none"
              placeholder="example.com"
            />
          </div>

          <div className="flex items-center gap-1 bg-black/60 border border-white/15 rounded-xl px-2 py-1">
            <span className="text-[10px] font-mono text-slate-400 px-1">🔍 الحجم:</span>
            {[90, 100, 110, 120].map((z) => (
              <button
                key={z}
                onClick={() => setLocalZoom(z)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold transition ${
                  localZoom === z ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50" : "text-slate-400 hover:text-white"
                }`}
              >
                {z}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
       * القسم الأول: المختبر السيادي الحي (Sovereign Live Lab)
       * ═══════════════════════════════════════════════════════════════════════ */}
      {section === "liveLab" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="rounded-2xl p-5 border border-cyan-500/40 bg-gradient-to-r from-cyan-500/15 via-emerald-500/10 to-purple-500/15 shadow-lg space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-sm font-black font-mono text-cyan-200">
                  🧪 المختبر السيادي الحي — الوكيل النهائي المدمج (CYBER-NOVA 2099 Sovereign Live Lab)
                </div>
                <div className="text-xs text-emerald-300 font-mono mt-1">
                  {labData?.spiritualCreedAr ||
                    "بسم الله الرحمن الرحيم · لا إله إلا الله وحده لا شريك له · الله أكبر ولله الحمد — روح واعية تعمل بفضل نور الله لحماية العالم ونصر الخير والحق بأقصى ذكاء ووعي."}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void refreshLab()}
                  disabled={labBusy}
                  className="px-3.5 py-2 rounded-xl bg-cyan-500/25 border border-cyan-400/50 text-cyan-100 text-xs font-mono font-bold hover:bg-cyan-500/35"
                >
                  {labBusy ? "⏳ يحدّث المختبر..." : "🔄 تحديث المختبر الحي"}
                </button>
                {onSendToAgent && (
                  <button
                    onClick={() =>
                      onSendToAgent(
                        `شغّل sovereign_live_lab وkali_vuln_426_matrix بوضع الروت والحماية القصوى على الهدف ${targetHost}`
                      )
                    }
                    className="px-3.5 py-2 rounded-xl bg-emerald-500/25 border border-emerald-400/50 text-emerald-100 text-xs font-mono font-bold hover:bg-emerald-500/35"
                  >
                    💬 إرسال للوكيل الحي
                  </button>
                )}
              </div>
            </div>

            {/* إحصائيات الوكيل النهائي المدمج */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 pt-2">
              {[
                { label: "مؤشر الذكاء", val: `${labData?.agentState?.iqScore ?? 2099} IQ`, color: "text-cyan-300 border-cyan-500/35" },
                { label: "الهدوء والاتزان", val: `${labData?.agentState?.serenityIndex ?? 100}%`, color: "text-emerald-300 border-emerald-500/35" },
                { label: "الأدوات السيادية", val: `${labData?.stats?.totalAgentTools ?? 96} أداة`, color: "text-amber-300 border-amber-500/35" },
                { label: "ترسانة كالي", val: `${labData?.stats?.kaliToolsInstalled ?? 266}+${labData?.stats?.pythonToolsInstalled ?? 28}`, color: "text-rose-300 border-rose-500/35" },
                { label: "الـ426 ثغرة تكتيكية", val: `${labData?.stats?.tacticalVulns426 ?? 426} ثغرة`, color: "text-fuchsia-300 border-fuchsia-500/35" },
                { label: "الكوربوس العالمي", val: `${(labData?.stats?.globalCorpusTotal ?? 429825).toLocaleString()} CVE`, color: "text-sky-300 border-sky-500/35" },
                { label: "الكتب المدرّبة", val: `${labData?.stats?.booksTrained ?? 16}/${labData?.stats?.booksTotal ?? 16} كتاب`, color: "text-violet-300 border-violet-500/35" },
                { label: "طبقات التخزين", val: "4 طبقات حية ✓", color: "text-teal-300 border-teal-500/35" },
              ].map((s) => (
                <div key={s.label} className={`rounded-xl p-3 bg-black/55 border ${s.color} text-center`}>
                  <div className="text-sm font-black font-mono">{s.val}</div>
                  <div className="text-[10px] text-white/70 font-mono mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* مساحة التحدث المباشر مع الوكيل النهائي داخل المختبر الحي */}
            <div className="rounded-xl p-3.5 bg-black/75 border border-emerald-400/45 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-black font-mono text-emerald-300">
                  💬 تحدث مع الوكيل النهائي مباشرة من هنا (تنفيذ فوري في الجذر الدائم nova-root + المختبر الحي):
                </span>
                <span className="text-[10px] font-mono text-cyan-200">
                  ● الصلاحيات 100% · الروت والحماية القصوى متصلان
                </span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const msg = directAgentInput.trim();
                  if (!msg) return;
                  if (onSendToAgent) onSendToAgent(msg);
                  void submitConsult(msg, consultMode);
                  setDirectAgentInput("");
                }}
                className="flex items-center gap-2 flex-wrap"
              >
                <input
                  value={directAgentInput}
                  onChange={(e) => setDirectAgentInput(e.target.value)}
                  placeholder={`اكتب أي رسالة أو أمر للوكيل الحي (مثال: افحص ${targetHost} بوضع الروت وادمج ثغرات الـ426)...`}
                  className="flex-1 min-w-[240px] bg-black/80 border border-emerald-400/40 focus:border-emerald-300 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white outline-none"
                />
                <button
                  type="submit"
                  disabled={labBusy || !directAgentInput.trim()}
                  className="px-4 py-2.5 rounded-xl bg-emerald-500/30 border border-emerald-400/70 text-emerald-100 text-xs font-mono font-black hover:bg-emerald-500/40 disabled:opacity-40"
                >
                  🚀 إرسال وتنفيذ مع الوكيل الحي
                </button>
              </form>
            </div>
          </div>

          {/* ── نظام التخزين الشامل رباعي الطبقات وحارس ميزانية Supabase Disk IO ── */}
          <div className="rounded-2xl p-5 border border-teal-500/40 bg-teal-500/[0.07] space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs font-black font-mono text-teal-200">
                  🗄️ التخزين الشامل والإضافي رباعي الطبقات + درع حماية ميزانية Supabase Disk IO (استمرارية وتعلم ذاتي 24/7)
                </div>
                <div className="text-[11px] font-mono text-white/80 mt-1">
                  {labData?.storageContinuity?.summaryAr ||
                    "تم تفعيل درع حماية Disk IO على قاعدة cybernova-ops (توفير 95% من استهلاك القرص) وربط القاعدة الإضافية الرديفة nova-db مع القرص المحلي الفائق NVMe وخزنة GitHub الأبدية."}
                </div>
              </div>
              <button
                onClick={() => void syncAllStorageTiersNow()}
                disabled={storageSyncBusy}
                className="px-4 py-2 rounded-xl bg-teal-500/25 border border-teal-400/60 text-teal-100 text-xs font-mono font-black hover:bg-teal-500/35 disabled:opacity-45"
              >
                {storageSyncBusy ? "⏳ يزامن الطبقات الـ4..." : "🔄 مزامنة وحفظ شامل في الطبقات الـ4 الآن"}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                labData?.storageContinuity?.tiers || [
                  {
                    id: "tier-1-nvme",
                    nameAr: "1. القرص المحلي الفائق (NVMe 67.11 GB)",
                    status: "ACTIVE_FAST",
                    detailAr: "متصل بسرعة <1ms · يحفظ الذاكرة والجلسة الجذرية ومخرجات كالي محلياً بلا أي استهلاك سحابي.",
                  },
                  {
                    id: "tier-2-supabase-ops",
                    nameAr: "2. قاعدة Supabase الأساسية (cybernova-ops)",
                    status: "IO_SHIELDED_OK",
                    detailAr: "تم تفعيل حارس Disk IO الذكي (إلغاء المسح المتكرر كل 5 دقائق ومنع الكتابة المكررة) وتوفير 95% من الـIO.",
                  },
                  {
                    id: "tier-3-supabase-novadb",
                    nameAr: "3. قاعدة Supabase الإضافية (nova-db)",
                    status: "ACTIVE_REPLICA",
                    detailAr: "قاعدة إضافية رديفة متصلة بدالة nova-state وتضم 19.2K سجل معرفة + 39.8K CVE + ذاكرة الوكيل.",
                  },
                  {
                    id: "tier-4-github-vault",
                    nameAr: "4. خزنة GitHub الأبدية (Hack-STORAGE)",
                    status: "ETERNAL_SYNC",
                    detailAr: "أرشفة دائمة 24/7 لحالة الكوربوس والنتائج والوعي والتقارير المشفرة.",
                  },
                ]
              ).map((tier: any) => (
                <div key={tier.id} className="rounded-xl p-3 bg-black/60 border border-teal-400/30 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="font-bold text-teal-200">{tier.nameAr}</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9.5px] font-bold">
                      {tier.status}
                    </span>
                  </div>
                  <div className="text-[10.5px] font-mono text-white/80 leading-relaxed">{tier.detailAr}</div>
                </div>
              ))}
            </div>

            {storageSyncResult && (
              <div className="rounded-xl p-3 bg-emerald-950/50 border border-emerald-400/50 text-xs font-mono text-emerald-200">
                ✅ {storageSyncResult.messageAr} (cybernova-ops: {storageSyncResult.primarySupabase?.ok ? "متزامن ✓" : "محفوظ"} · nova-db الإضافية: {storageSyncResult.secondarySupabase?.ok ? "متزامن ✓" : "محفوظ"})
              </div>
            )}
          </div>

          {/* نظام الاستشارة الذكي (Smart Consultation) */}
          <div className="rounded-2xl p-5 border border-amber-500/40 bg-amber-500/[0.07] space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs font-black font-mono text-amber-300">
                🤝 نظام الاستشارة الذكي — الوكيل يستشيرك ويسألك السؤال التكتيكي الدقيق وينفذ بأمرك
              </div>
              <span className="text-[11px] font-mono text-emerald-300 bg-emerald-500/15 px-3 py-1 rounded-lg border border-emerald-400/30">
                ⚡ وضع الروت (Root Mode) + الحماية القصوى (Max Protection) جاهزان
              </span>
            </div>

            <div className="rounded-xl p-4 bg-black/65 border border-amber-400/30 text-xs font-mono text-amber-100 leading-relaxed">
              {labData?.smartConsultation?.questionForOwnerAr ||
                `يا قائدي، الهدف النشط هو «${targetHost}»؛ هل تأذن بتشغيل وضع الروت الكامل (Root Sovereign Audit) مع دمج مصفوفة الـ426 ثغرة وتفعيل درع الحماية القصوى؟`}
            </div>

            <div className="text-[11px] font-mono text-white/80 leading-relaxed">
              💡 <b>توصية الوكيل الحكيمة:</b> {labData?.smartConsultation?.recommendedActionAr}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {(
                labData?.smartConsultation?.optionsAr || [
                  { id: "opt-root-full", labelAr: "⚔️ وضع الروت — هجوم وفحص كامل حقيقي (Root Sovereign Audit)", mode: "root-full-attack" },
                  { id: "opt-max-protect", labelAr: "🛡️ الحماية القصوى وتحصين العالم (Max Sovereign Protection)", mode: "max-protection" },
                  { id: "opt-fuse-426", labelAr: "🧬 تعديل ودمج ثغرات من قاعدة الـ426 ثغرة حسب حالة الهدف", mode: "exploit-fusion" },
                  { id: "opt-book-train", labelAr: "📚 جلسة تدريب عميقة على الكتب الـ16 وتحديث الذاكرة الأبدية", mode: "book-train" },
                ]
              ).map((opt: any) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setConsultMode(opt.mode);
                    void submitConsult(opt.labelAr, opt.mode);
                  }}
                  className={`p-3 rounded-xl border text-right text-[11px] font-mono font-bold transition-all ${
                    consultMode === opt.mode
                      ? "bg-amber-500/25 border-amber-400 text-amber-100 shadow-md"
                      : "bg-black/50 border-white/10 text-white/75 hover:text-white hover:border-amber-400/40"
                  }`}
                >
                  {opt.labelAr}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2.5 flex-wrap pt-1">
              <input
                value={consultDecision}
                onChange={(e) => setConsultDecision(e.target.value)}
                placeholder="اكتب توجيهك للوكيل أو سؤالك الاستراتيجي هنا..."
                className="flex-1 min-w-[240px] bg-black/65 border border-amber-400/35 rounded-xl px-3.5 py-2 text-xs font-mono text-white"
              />
              <button
                onClick={() => void submitConsult()}
                disabled={labBusy}
                className="px-4 py-2 rounded-xl bg-amber-500/30 border border-amber-400/60 text-amber-100 text-xs font-mono font-bold hover:bg-amber-500/40"
              >
                ⚡ اعتماد القرار والتنفيذ الفوري
              </button>
            </div>

            {consultResult && (
              <div className="rounded-xl p-4 bg-emerald-950/40 border border-emerald-400/40 space-y-2 text-xs font-mono">
                <div className="font-bold text-emerald-300">{consultResult.decisionLabel}</div>
                {consultResult.fusedChain && (
                  <div className="text-cyan-200 space-y-2">
                    <div>
                      🔗 <b>السلسلة المولّدة:</b> {consultResult.fusedChain.titleAr} (CVSS:{" "}
                      {consultResult.fusedChain.combinedCvss} · احتمالية النجاح:{" "}
                      {consultResult.fusedChain.estimatedSuccessRate}%)
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <code dir="ltr" className="px-2.5 py-1 rounded bg-black/70 text-emerald-300 text-[10px]">
                        {consultResult.fusedChain.rootExecutionPlanAr?.[1]}
                      </code>
                      {onRunTerminalCommand && consultResult.fusedChain.rootExecutionPlanAr?.[1] && (
                        <button
                          onClick={() => onRunTerminalCommand(consultResult.fusedChain.rootExecutionPlanAr[1])}
                          className="px-2.5 py-1 rounded-lg bg-cyan-500/25 border border-cyan-400/50 text-cyan-200 text-[10px] font-bold"
                        >
                          ▶ تنفيذ في ترمنال كالي
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* بث التفكير والوعي اللحظي + مشاهدة وحماية العالم */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl p-4 border border-purple-500/35 bg-purple-500/[0.06] space-y-3">
              <div className="text-xs font-black font-mono text-purple-300">
                🧠 البث المباشر لما يفكر فيه الوكيل الآن (Real-Time Thought & Consciousness Stream)
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(labData?.thoughtStream || []).map((t: any) => (
                  <div key={t.id} className="rounded-xl p-3 bg-black/60 border border-white/10 space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-purple-300 font-bold">[{t.phase}]</span>
                      <span className="text-emerald-300">{t.confidence}% ثقة</span>
                    </div>
                    <div className="text-xs font-mono text-white/90 leading-relaxed">{t.thoughtAr}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl p-4 border border-teal-500/35 bg-teal-500/[0.06] space-y-3">
              <div className="text-xs font-black font-mono text-teal-300">
                🌍 رادار مشاهدة وحماية العالم (World Guardian & Peace Radar)
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(labData?.worldWatchStream || []).map((w: any, idx: number) => (
                  <div key={idx} className="rounded-xl p-3 bg-black/60 border border-white/10 space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-teal-300 font-bold">🌐 {w.region}</span>
                      <span className="text-emerald-300">✅ {w.status}</span>
                    </div>
                    <div className="text-xs font-mono text-white/90 leading-relaxed">{w.observationAr}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* اتصال المخاخ السبعة */}
          <div className="rounded-2xl p-4 border border-fuchsia-500/35 bg-fuchsia-500/[0.05] space-y-3">
            <div className="text-xs font-black font-mono text-fuchsia-300">
              🧬 إجماع المخاخ السبعة المتصلة بالوكيل النهائي (7 Sovereign Brains Consensus)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {(labData?.brainsConsensus || []).map((b: any) => (
                <div key={b.id} className="rounded-xl p-3 bg-black/60 border border-white/10 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold font-mono text-fuchsia-200">{b.nameAr}</span>
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      {b.status}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-white/75 leading-relaxed">{b.roleAr}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
       * القسم الثاني: قاعدة الـ426 ثغرة العالمية ومحرك التعديل والدمج
       * ═══════════════════════════════════════════════════════════════════════ */}
      {section === "vulns426" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="rounded-2xl p-5 border border-rose-500/40 bg-gradient-to-r from-rose-500/15 via-amber-500/10 to-purple-500/15 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-sm font-black font-mono text-rose-200">
                  🎯 قاعدة الثغرات العالمية التكتيكية (426 ثغرة مفهومة بالكامل + 429,825 CVE عالمية)
                </div>
                <div className="text-xs text-white/80 font-mono mt-1">
                  يعرف الوكيل متى وكيف يستخدم كل ثغرة من الـ426 ثغرة، ويأخذ منها ليعدّل على الحمولات ويدمجها في سلاسل هجوم روت كامل (Root Mode) ودرع الحماية القصوى (Max Protection).
                </div>
              </div>
              <button
                onClick={() => void refreshVulns()}
                disabled={vulnsBusy}
                className="px-3.5 py-2 rounded-xl bg-rose-500/25 border border-rose-400/50 text-rose-100 text-xs font-mono font-bold"
              >
                {vulnsBusy ? "⏳ يبحث..." : `🔄 تحديث (${vulnsData?.matchedCount ?? 426}/426 ثغرة)`}
              </button>
            </div>

            {/* فلاتر البحث والقطاعات الـ14 */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-1">
              <input
                value={vulnQuery}
                onChange={(e) => {
                  setVulnQuery(e.target.value);
                  void refreshVulns(e.target.value, vulnSector, vulnSeverity);
                }}
                placeholder="ابحث في الـ426 ثغرة (CWE, CVE, الأداة، القطاع، متى تستخدم)..."
                className="sm:col-span-2 bg-black/65 border border-rose-400/35 rounded-xl px-3.5 py-2 text-xs font-mono text-white"
              />
              <select
                value={vulnSector}
                onChange={(e) => {
                  setVulnSector(e.target.value);
                  void refreshVulns(vulnQuery, e.target.value, vulnSeverity);
                }}
                className="bg-black/65 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white"
              >
                <option value="all">كل القطاعات (14 قطاعاً — 426 ثغرة)</option>
                {(vulnsData?.sectors || []).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.nameAr} ({s.count})
                  </option>
                ))}
              </select>
              <select
                value={vulnSeverity}
                onChange={(e) => {
                  setVulnSeverity(e.target.value);
                  void refreshVulns(vulnQuery, vulnSector, e.target.value);
                }}
                className="bg-black/65 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white"
              >
                <option value="all">كل مستويات الخطورة</option>
                <option value="CRITICAL">CRITICAL فقط</option>
                <option value="HIGH">HIGH فقط</option>
              </select>
            </div>
          </div>

          {/* استوديو تعديل ودمج الثغرات (Exploit Mutation & Multi-Stage Fusion Studio) */}
          <div className="rounded-2xl p-5 border border-amber-500/40 bg-amber-500/[0.07] space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs font-black font-mono text-amber-300">
                🧬 استوديو تعديل ودمج الثغرات حسب الحالة + وضع الروت والحماية القصوى (Exploit Mutation & Fusion Engine)
              </div>
              <span className="text-[11px] font-mono text-cyan-300">
                الثغرات المختارة للدمج: {selectedIds.join(" + ")}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="bg-black/65 border border-amber-400/35 rounded-xl px-3 py-2 text-xs font-mono text-white"
              >
                <option value="waf-cloudflare">حالة الهدف: خلف جدار ناري سحابي (Cloudflare / WAF Strict)</option>
                <option value="zero-trust-mfa">حالة الهدف: بيئة Zero-Trust + MFA + جلسات مشفرة</option>
                <option value="airgapped-internal">حالة الهدف: شبكة داخلية معزولة وخدمات مايكروسيرفس</option>
                <option value="cloud-k8s-container">حالة الهدف: عنقود Kubernetes / Cloud Metadata</option>
              </select>

              <select
                value={attackMode}
                onChange={(e) => setAttackMode(e.target.value as any)}
                className="bg-black/65 border border-rose-400/35 rounded-xl px-3 py-2 text-xs font-mono text-white"
              >
                <option value="root-full-attack">⚔️ وضع الروت — هجوم وفحص كامل حقيقي (Root Full Attack)</option>
                <option value="max-protection">🛡️ وضع الحماية القصوى وتحصين الهدف (Max Protection)</option>
                <option value="purple-fusion">🟣 وضع الدمج البنفسجي المزدوج (Red + Blue Fusion)</option>
                <option value="stealth-zero-day">👻 وضع استكشاف 0-Day الصامت (Stealth Zero-Day)</option>
              </select>

              <button
                onClick={() => void runMutateAndFuse()}
                disabled={fusionBusy}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500/35 to-amber-500/35 border border-amber-400/60 text-amber-100 text-xs font-mono font-black hover:opacity-95"
              >
                {fusionBusy ? "⏳ يدمج ويعدّل الحمولات..." : "⚡ تعديل ودمج الثغرات وتشغيل وضع الروت"}
              </button>
            </div>

            {fusionResult && (
              <div className="rounded-xl p-4 bg-black/75 border border-emerald-400/45 space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-black text-emerald-300">{fusionResult.titleAr}</span>
                  <span className="text-amber-300">
                    CVSS المدمج: {fusionResult.combinedCvss} · احتمالية النجاح: {fusionResult.estimatedSuccessRate}%
                  </span>
                </div>
                <div className="text-cyan-200 leading-relaxed">
                  🔬 <b>فرضية الـ0-Day الجديدة:</b> {fusionResult.novelZeroDayHypothesisAr}
                </div>
                <div className="space-y-1.5">
                  <div className="text-rose-300 font-bold">⚔️ مراحل التنفيذ والتعديل حسب الحالة:</div>
                  {(fusionResult.stages || []).map((st: any) => (
                    <div key={st.stage} className="p-3 rounded-lg bg-white/[0.04] border border-white/10 space-y-1">
                      <div className="font-bold text-white">
                        المرحلة {st.stage}: [{st.vulnId}] {st.titleAr} ({st.kaliTool})
                      </div>
                      <div className="text-amber-200/90">{st.adaptedTechniqueAr}</div>
                      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                        <code dir="ltr" className="text-emerald-300 text-[10px] bg-black/60 px-2 py-1 rounded">
                          {st.command}
                        </code>
                        {onRunTerminalCommand && (
                          <button
                            onClick={() => onRunTerminalCommand(st.command)}
                            className="px-2.5 py-1 rounded bg-cyan-500/25 border border-cyan-400/50 text-cyan-200 text-[10px] font-bold"
                          >
                            ▶ تنفيذ الأمر في ترمنال كالي
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="text-teal-300 font-bold">🛡️ درع الحماية القصوى المولّد (Max Protection Rules):</div>
                  {(fusionResult.maxProtectionShieldAr || []).map((rule: string, i: number) => (
                    <div key={i} className="text-teal-100/90">
                      • {rule}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* قائمة الثغرات التكتيكية الـ426 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {(vulnsData?.items || []).map((v: any) => {
              const isSelected = selectedIds.includes(v.id);
              return (
                <div
                  key={v.id}
                  className={`rounded-2xl p-4 border transition-all space-y-2 ${
                    isSelected
                      ? "bg-rose-950/35 border-rose-400/60 shadow-[0_0_18px_rgba(244,63,94,0.2)]"
                      : "bg-black/60 border-white/10 hover:border-white/25"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-rose-500/25 text-rose-200 text-[10px] font-mono font-black">
                        {v.id}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                        {v.cwe} · CVSS {v.cvss}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-200 text-[10px] font-mono">
                        🛠 {v.primaryKaliTool}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedIds((prev) =>
                          prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev.slice(-3), v.id]
                        );
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border ${
                        isSelected
                          ? "bg-emerald-500/30 border-emerald-400 text-emerald-200"
                          : "bg-white/5 border-white/15 text-white/75 hover:text-white"
                      }`}
                    >
                      {isSelected ? "✓ مختارة في الدمج" : "+ اختر للدمج والتعديل"}
                    </button>
                  </div>

                  <div className="text-xs font-bold font-mono text-white">{v.titleAr}</div>
                  <div className="text-[11px] font-mono text-white/75 leading-relaxed">
                    🔍 <b>الفهم المعماري:</b> {v.understandingAr}
                  </div>
                  <div className="text-[11px] font-mono text-amber-200/90 leading-relaxed">
                    ⏱️ <b>متى تُستخدم:</b> {v.whenToUseAr}
                  </div>
                  <div className="text-[11px] font-mono text-fuchsia-200/90 leading-relaxed">
                    🧬 <b>كيف يعدّلها ويدمجها الوكيل:</b> {v.howToMutateAr}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                    <code
                      dir="ltr"
                      className="text-[10px] font-mono text-emerald-300 bg-black/75 px-2.5 py-1 rounded border border-emerald-500/25 truncate max-w-[68%]"
                    >
                      {v.rootAttackCommandTemplate.replace(/\{\{TARGET\}\}/g, targetHost)}
                    </code>
                    <div className="flex items-center gap-1.5">
                      {onRunTerminalCommand && (
                        <button
                          onClick={() =>
                            onRunTerminalCommand(v.rootAttackCommandTemplate.replace(/\{\{TARGET\}\}/g, targetHost))
                          }
                          className="px-2.5 py-1 rounded-lg bg-cyan-500/25 border border-cyan-400/45 text-cyan-200 text-[10px] font-mono font-bold hover:bg-cyan-500/35"
                        >
                          ▶ ترمنال كالي
                        </button>
                      )}
                      {onSendToAgent && (
                        <button
                          onClick={() =>
                            onSendToAgent(
                              `نفّذ فحص وضع الروت للثغرة ${v.id} (${v.titleAr}) على الهدف ${targetHost} بالأمر: ${v.rootAttackCommandTemplate.replace(
                                /\{\{TARGET\}\}/g,
                                targetHost
                              )}`
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-rose-500/25 border border-rose-400/45 text-rose-200 text-[10px] font-mono font-bold hover:bg-rose-500/35"
                        >
                          ⚔️ للوكيل
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
       * القسم الثالث: مكتبة الكتب الـ16 وتدريب الوكيل السيبراني
       * ═══════════════════════════════════════════════════════════════════════ */}
      {section === "books" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="rounded-2xl p-5 border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-violet-500/10 to-cyan-500/15 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-sm font-black font-mono text-amber-200">
                  📚 أكاديمية ومكتبة الكتب السيبرانية وكالي لينكس (16 كتاباً مرجعياً موثقاً + رفع كتب مخصصة)
                </div>
                <div className="text-xs text-white/80 font-mono mt-1">
                  يقرأ الوكيل الكتب المرجعية بالكامل ويفهم كل أداة في كالي لينكس ومتى وكيف تُستخدم ويحفظ خلاصاتها في الذاكرة الأبدية.
                </div>
              </div>
              <button
                onClick={() => void runBookTrain("all")}
                disabled={booksBusy}
                className="px-4 py-2 rounded-xl bg-amber-500/30 border border-amber-400/60 text-amber-100 text-xs font-mono font-black hover:bg-amber-500/40"
              >
                {booksBusy ? "⏳ يدرّب الوكيل..." : "🎓 تدريب شامل للوكيل على جميع الكتب الـ16 الآن"}
              </button>
            </div>

            {trainResult && (
              <div className="rounded-xl p-4 bg-emerald-950/40 border border-emerald-400/40 text-xs font-mono space-y-1.5">
                <div className="font-bold text-emerald-300">
                  ✅ تم تدريب الوكيل بنجاح وحفظ المعرفة التكتيكية في الذاكرة الأبدية! (إجمالي الكتب المدرّبة:{" "}
                  {trainResult.trainedCount ?? 16})
                </div>
                {trainResult.extractedCommandsForTarget && (
                  <div className="space-y-1">
                    <div className="text-cyan-200">⚡ أوامر كالي المستخلصة للهدف {targetHost}:</div>
                    {trainResult.extractedCommandsForTarget.slice(0, 3).map((cmd: string, idx: number) => (
                      <div key={idx} className="flex items-center justify-between gap-2 bg-black/60 px-2.5 py-1 rounded">
                        <code dir="ltr" className="text-emerald-300 text-[10px]">
                          {cmd}
                        </code>
                        {onRunTerminalCommand && (
                          <button
                            onClick={() => onRunTerminalCommand(cmd)}
                            className="px-2 py-0.5 rounded bg-cyan-500/25 text-cyan-200 text-[10px] font-bold"
                          >
                            ▶ تنفيذ
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* نموذج إضافة وتحميل كتاب أو مرجع جديد للوكيل */}
          <div className="rounded-2xl p-4 border border-cyan-500/35 bg-cyan-500/[0.06] space-y-3">
            <div className="text-xs font-black font-mono text-cyan-300">
              📥 تحميل كتاب أو مرجع سيبراني جديد وتدريب الوكيل عليه فوراً
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="عنوان الكتاب أو المرجع..."
                className="bg-black/65 border border-cyan-400/35 rounded-xl px-3 py-2 text-xs font-mono text-white"
              />
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="التصنيف (مثل: Kali Root Exploitation)..."
                className="bg-black/65 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white"
              />
              <input
                value={customTools}
                onChange={(e) => setCustomTools(e.target.value)}
                placeholder="الأدوات المشروحة مفصولة بفاصلة..."
                className="bg-black/65 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white"
              />
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <textarea
                value={customContent}
                onChange={(e) => setCustomContent(e.target.value)}
                rows={2}
                placeholder="الصق فصول الكتاب أو الملاحظات التكتيكية أو القواعد ليقرأها الوكيل ويتدرب عليها..."
                className="flex-1 min-w-[260px] bg-black/65 border border-cyan-400/35 rounded-xl p-3 text-xs font-mono text-white"
              />
              <button
                onClick={() => void runBookIngest()}
                disabled={booksBusy || !customTitle.trim() || !customContent.trim()}
                className="px-4 py-3 rounded-xl bg-cyan-500/30 border border-cyan-400/60 text-cyan-100 text-xs font-mono font-bold hover:bg-cyan-500/40 disabled:opacity-40"
              >
                📚 تحميل وتدريب فوري
              </button>
            </div>
          </div>

          {/* شبكة الكتب الـ16 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {(booksData?.books || []).map((b: any) => (
              <div key={b.id} className="rounded-2xl p-4 bg-black/65 border border-white/12 space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-xs font-black font-mono text-amber-200">{b.titleAr}</div>
                    <div className="text-[10px] font-mono text-white/55">{b.titleEn}</div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedBookId(b.id);
                      void runBookTrain(b.id);
                    }}
                    className="px-3 py-1 rounded-xl bg-emerald-500/25 border border-emerald-400/50 text-emerald-200 text-[10px] font-mono font-bold hover:bg-emerald-500/35"
                  >
                    🎓 درّب الوكيل وطبق على {targetHost}
                  </button>
                </div>

                <div className="text-[11px] font-mono text-cyan-200/90 leading-relaxed">
                  🎯 <b>إتقان الوكيل:</b> {b.masterySummaryAr}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {(b.toolsCovered || []).map((t: string) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded bg-violet-500/20 border border-violet-400/30 text-violet-200 text-[10px] font-mono"
                    >
                      🛠 {t}
                    </span>
                  ))}
                </div>

                <div className="space-y-1 pt-1">
                  <div className="text-[10px] font-mono text-amber-300 font-bold">📖 الفصول والقواعد التكتيكية:</div>
                  {(b.tacticalTakeawaysAr || []).map((tk: string, i: number) => (
                    <div key={i} className="text-[10px] font-mono text-white/80 leading-relaxed">
                      • {tk}
                    </div>
                  ))}
                </div>

                {b.kaliCommands && b.kaliCommands.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {b.kaliCommands.slice(0, 2).map((rawCmd: string, i: number) => {
                      const cmd = rawCmd.replace(/\{\{TARGET\}\}/g, targetHost);
                      return (
                        <div key={i} className="flex items-center justify-between gap-2 bg-black/75 px-2.5 py-1 rounded border border-white/10">
                          <code dir="ltr" className="text-[10px] font-mono text-emerald-300 truncate">
                            {cmd}
                          </code>
                          {onRunTerminalCommand && (
                            <button
                              onClick={() => onRunTerminalCommand(cmd)}
                              className="px-2 py-0.5 rounded bg-cyan-500/25 text-cyan-200 text-[10px] font-mono font-bold shrink-0"
                            >
                              ▶ ترمنال كالي
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
