import { useEffect, useState } from "react";
import { Webhook as WebhookIcon, Plus, Loader2, Trash2, RefreshCw, X, Skull } from "lucide-react";
import { SiDiscord, SiSlack, SiTelegram } from "react-icons/si";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

const PLATFORM_COLOR: Record<string, string> = { discord: "#5865F2", slack: "#E01E5A", telegram: "#229ED9", generic: "#aa44ff" };
const PLATFORM_RGB: Record<string, string> = { discord: "88,101,242", slack: "224,30,90", telegram: "34,158,217", generic: "170,68,255" };

interface Webhook { id: number; platform: string; url: string; event: string; active: boolean; createdAt?: string; }

export default function Webhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [platform, setPlatform] = useState("discord");
  const [url, setUrl] = useState("");
  const [event, setEvent] = useState("all");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch("/api/webhooks"); if (r.ok) setWebhooks(await r.json()); }
    catch { } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (!url) return;
    setSaving(true);
    try {
      await fetch("/api/webhooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, url, event }) });
      setShowAdd(false); setUrl(""); void load();
    } catch { } finally { setSaving(false); }
  };

  const handleToggle = async (id: number, active: boolean) => {
    setWebhooks(w => w.map(x => x.id === id ? { ...x, active } : x));
    try { await fetch(`/api/webhooks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) }); }
    catch { void load(); }
  };

  const handleDelete = async (id: number) => {
    setWebhooks(w => w.filter(x => x.id !== id));
    try { await fetch(`/api/webhooks/${id}`, { method: "DELETE" }); }
    catch { void load(); }
  };

  const getPlatformIcon = (p: string) => {
    if (p === "discord") return <SiDiscord className="w-5 h-5" style={{ color: "#5865F2" }} />;
    if (p === "slack") return <SiSlack className="w-5 h-5" style={{ color: "#E01E5A" }} />;
    if (p === "telegram") return <SiTelegram className="w-5 h-5" style={{ color: "#229ED9" }} />;
    return <WebhookIcon className="w-5 h-5" style={{ color: "#aa44ff" }} />;
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <WebhookIcon className="w-6 h-6" style={{ color: "#ff5555" }} />
          <div>
            <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>
              Webhooks التنبيهات
              <span className="text-[10px] font-mono ms-2 px-2 py-0.5 rounded" style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>{webhooks.length}</span>
            </h1>
            <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Integrations & Real-time Alerts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] font-mono transition-all"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
            <RefreshCw className="w-3 h-3" />تحديث
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] font-mono transition-all"
            style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.25)", color: "#ff5555" }}>
            <Plus className="w-3.5 h-3.5" />إضافة Webhook
          </button>
        </div>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}>
          <div className="w-full max-w-md p-5 space-y-4 rounded-2xl" style={NEON_CARD} dir="rtl">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-sm" style={{ color: "#ff5555" }}>إضافة Webhook جديد</h2>
              <button onClick={() => setShowAdd(false)} style={{ color: "rgba(255,255,255,0.3)" }}><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>المنصة</label>
              <select value={platform} onChange={e => setPlatform(e.target.value)} style={inputStyle}>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="telegram">Telegram</option>
                <option value="generic">Generic / Custom</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Webhook URL</label>
              <input placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} type="url" style={inputStyle} dir="ltr" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>نوع الحدث</label>
              <input placeholder="all / critical_cve / job_failed" value={event} onChange={e => setEvent(e.target.value)} style={inputStyle} dir="ltr" />
            </div>
            <button onClick={() => void handleCreate()} disabled={!url || saving}
              className="w-full py-2 rounded-xl font-black text-sm transition-all disabled:opacity-50"
              style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "حفظ"}
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "#ff5555" }} /></div>
      ) : !webhooks.length ? (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد Webhooks مضافة</p>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>اضغط "إضافة Webhook" للبدء</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pb-6">
          {webhooks.map(wh => {
            const color = PLATFORM_COLOR[wh.platform] ?? "#aa44ff";
            const rgb = PLATFORM_RGB[wh.platform] ?? "170,68,255";
            return (
              <div key={wh.id} className="rounded-xl p-4 space-y-3 transition-all"
                style={{ background: `rgba(${rgb},0.03)`, border: `1px solid rgba(${rgb},${wh.active ? "0.2" : "0.07"})`, borderRadius: 16, opacity: wh.active ? 1 : 0.6 }}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    {getPlatformIcon(wh.platform)}
                    <span className="font-black capitalize font-mono text-sm" style={{ color }}>{wh.platform}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Toggle */}
                    <button onClick={() => void handleToggle(wh.id, !wh.active)}
                      className="w-10 h-5 rounded-full transition-all relative"
                      style={{ background: wh.active ? `rgba(${rgb},0.3)` : "rgba(255,255,255,0.05)", border: wh.active ? `1px solid rgba(${rgb},0.5)` : "1px solid rgba(255,255,255,0.1)" }}>
                      <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                        style={{ background: wh.active ? color : "rgba(255,255,255,0.2)", right: wh.active ? 2 : "auto", left: wh.active ? "auto" : 2 }} />
                    </button>
                    <button onClick={() => void handleDelete(wh.id)} style={{ color: "rgba(255,68,68,0.5)" }} className="transition-all hover:opacity-100">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="rounded-xl p-3 space-y-2" style={DARK}>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Event</span>
                    <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded" style={{ color, background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.2)` }}>{wh.event}</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>URL</span>
                    <p className="font-mono text-[9px] truncate mt-0.5" style={{ color }}>
                      {wh.url.substring(0, 12)}...{wh.url.slice(-6)}
                    </p>
                  </div>
                </div>

                {wh.active && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#44ff88" }} />
                    <span className="text-[9px] font-black font-mono" style={{ color: "#44ff88" }}>مفعّل</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
