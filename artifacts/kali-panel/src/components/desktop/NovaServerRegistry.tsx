/**
 * «ماكينات نوفا» — the machines the program runs on, in one card.
 *
 * The fleet page used to show only machines with a WebSocket agent attached, so
 * the Codespace, the Render service and the Waifly slot — the three real hosts —
 * were nowhere on it. This card is where they are added, probed and chosen.
 *
 * Everything it claims is measured: 「شغّال」 means `/api/health` answered just
 * now, 「واقف」 carries the reason, and a server that was never probed is 「متقاسش」.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plug, PlugZap, RefreshCw, Server, Trash2, Plus, Terminal } from "lucide-react";
import {
  SERVER_PRESETS,
  activateServer,
  activeServerId,
  addServer,
  codespaceBase,
  listServers,
  mirrorToEngine,
  probeKnownServers,
  removeServer,
  type KnownServer,
  type ServerStatus,
} from "@/lib/servers";

const KIND_LABEL: Record<string, string> = {
  codespace: "Codespace",
  render: "Render",
  waifly: "Waifly",
  local: "محلي",
  custom: "مخصص",
};

export function NovaServerRegistry() {
  const [servers, setServers] = useState<KnownServer[]>(() => listServers());
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<string>("codespace");
  const [message, setMessage] = useState<string | null>(null);
  const active = activeServerId();

  const presetDef = useMemo(() => SERVER_PRESETS.find((p) => p.kind === preset) ?? SERVER_PRESETS[0], [preset]);

  const refresh = useCallback(async (list = servers) => {
    if (list.length === 0) {
      setStatuses({});
      return;
    }
    setBusy(true);
    try {
      setStatuses(await probeKnownServers(list));
    } finally {
      setBusy(false);
    }
  }, [servers]);

  useEffect(() => {
    void refresh(servers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.length]);

  useEffect(() => {
    void mirrorToEngine(servers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.length]);

  const add = () => {
    const raw = preset === "codespace" ? codespaceBase(input || name) : input;
    if (!raw) {
      setMessage("اكتب اسم الكودسبيس أو رابط السيرفر الأول");
      return;
    }
    const next = addServer({ name: name || (preset === "codespace" ? input : ""), base: raw, kind: preset as KnownServer["kind"] });
    if (next.length === servers.length) {
      setMessage("الرابط مش صالح — لازم يبدأ بـhost أو https://");
      return;
    }
    setServers(next);
    setInput("");
    setName("");
    setMessage(`اتضاف: ${next[0]?.base ?? ""} — باقي تضغط «استخدمه»`);
  };

  const drop = (id: string) => {
    setServers(removeServer(id));
    setMessage("اتشال من القايمة");
  };

  const use = (server: KnownServer) => {
    activateServer(server);
    setMessage(`المنصة بقت بتكلم ${server.base} — اعمل تحديث للصفحة لو حاجة لسه بتقول مفيش سيرفر`);
  };

  return (
    <div dir="rtl" className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.04] p-3 space-y-2.5" data-testid="server-registry">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-cyan-400/10 border border-cyan-400/40 flex items-center justify-center">
          <Server className="h-3.5 w-3.5 text-cyan-300" />
        </div>
        <div className="flex-1">
          <div className="text-[12px] font-black text-white/90">ماكينات نوفا ({servers.length})</div>
          <div className="text-[9px] text-white/45">
            Codespace · Render · Waifly — كل واحدة بتتقاس بـ<code className="text-cyan-200/80">/api/health</code> قبل ما تقول شغّالة
          </div>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={busy}
          className="text-[10px] px-2 py-1 rounded-md border border-white/15 text-white/70 hover:bg-white/5 disabled:opacity-40 flex items-center gap-1"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> قياس
        </button>
      </div>

      {/* add form */}
      <div className="grid gap-1.5 sm:grid-cols-[130px_1fr_120px_auto]">
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="bg-black/40 border border-white/15 rounded-md px-2 py-1.5 text-[11px] text-white/85"
          data-testid="server-preset"
        >
          {SERVER_PRESETS.map((p) => (
            <option key={p.kind} value={p.kind}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={presetDef.placeholder}
          className="bg-black/40 border border-white/15 rounded-md px-2 py-1.5 text-[11px] text-white/85 font-mono"
          data-testid="server-input"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم (اختياري)"
          className="bg-black/40 border border-white/15 rounded-md px-2 py-1.5 text-[11px] text-white/85"
        />
        <button
          onClick={add}
          className="text-[11px] px-3 py-1.5 rounded-md bg-cyan-400/15 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-400/25 flex items-center justify-center gap-1"
          data-testid="server-add"
        >
          <Plus className="h-3 w-3" /> ضيف
        </button>
      </div>
      <div className="text-[9px] text-white/40 flex items-center gap-1">
        <Terminal className="h-3 w-3" /> {presetDef.hint}
      </div>

      {message && <div className="text-[10px] text-amber-200/90 bg-amber-400/10 border border-amber-400/30 rounded-md px-2 py-1">{message}</div>}

      {/* list */}
      <div className="space-y-1.5">
        {servers.length === 0 && (
          <div className="text-[10px] text-white/50 border border-dashed border-white/15 rounded-md px-2 py-3 text-center">
            مفيش ماكينات مسجّلة. ابدأ بالكودسبيس: الصق اسمه فوق واضغط «ضيف».
          </div>
        )}
        {servers.map((s) => {
          const st = statuses[s.id];
          const dot =
            st?.state === "up" ? "text-emerald-300 border-emerald-400/40 bg-emerald-400/10"
            : st?.state === "down" ? "text-rose-300 border-rose-400/40 bg-rose-400/10"
            : "text-white/50 border-white/20 bg-white/5";
          const isActive = active === s.id;
          return (
            <div key={s.id} className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {isActive ? <PlugZap className="h-3.5 w-3.5 text-cyan-300" /> : <Plug className="h-3.5 w-3.5 text-white/40" />}
                <span className="text-[11px] font-bold text-white/85">{s.name}</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded border border-white/15 text-white/60">{KIND_LABEL[s.kind] ?? s.kind}</span>
                <span className={`text-[8px] px-1.5 py-0.5 rounded border ${dot}`}>
                  {st ? (st.state === "up" ? "شغّال" : st.state === "down" ? "واقف" : "متقاسش") : "متقاسش"}
                  {st?.ms !== null && st?.ms !== undefined ? ` · ${st.ms}ms` : ""}
                </span>
                {isActive && <span className="text-[8px] px-1.5 py-0.5 rounded border border-cyan-400/40 bg-cyan-400/10 text-cyan-200">المحرك الحالي</span>}
                <div className="flex-1" />
                <button
                  onClick={() => use(s)}
                  className="text-[10px] px-2 py-0.5 rounded border border-cyan-400/35 text-cyan-100 hover:bg-cyan-400/15"
                >
                  استخدمه
                </button>
                <button onClick={() => drop(s.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-white/15 text-white/50 hover:bg-rose-400/10">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="text-[9px] text-white/45 font-mono mt-0.5 truncate" dir="ltr">{s.base}</div>
              {st?.says && <div className="text-[9px] text-white/55 mt-0.5">{st.says}</div>}
              {s.note && <div className="text-[9px] text-white/35 mt-0.5">{s.note}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default NovaServerRegistry;
