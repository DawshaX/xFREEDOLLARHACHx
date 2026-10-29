import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, Trash2, Skull } from "lucide-react";

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const KIND_COLOR: Record<string, string> = { cve: "#ff4444", tool: "#44ff88", technique: "#aa44ff", link: "#4488ff" };
const KIND_RGB: Record<string, string> = { cve: "255,68,68", tool: "68,255,136", technique: "170,68,255", link: "68,136,255" };

export default function Bookmarks() {
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("cve");

  useEffect(() => {
    setBookmarks([
      { id: "1", kind: "cve", title: "CVE-2024-1234", target: "NVD Details" },
      { id: "2", kind: "tool", title: "Port Scanner", target: "Internal Tool" },
      { id: "3", kind: "link", title: "Exploit-DB", target: "https://exploit-db.com" },
    ]);
  }, []);

  const getByKind = (k: string) => bookmarks.filter(b => b.kind === k);
  const kinds = ["cve", "tool", "technique", "link"];

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <Bookmark className="w-6 h-6" style={{ color: "#ff5555" }} />
        <div>
          <h1 className="font-black text-xl" style={{ color: "#ff5555", textShadow: "0 0 16px rgba(255,50,50,0.5)" }}>العلامات المرجعية</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Saved Items & Favorites</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {kinds.map(k => {
          const color = KIND_COLOR[k] ?? "#888";
          const rgb = KIND_RGB[k] ?? "136,136,136";
          const active = activeTab === k;
          return (
            <button key={k} onClick={() => setActiveTab(k)}
              className="px-3 py-1.5 rounded-xl font-black text-[10px] font-mono transition-all"
              style={active
                ? { background: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.35)`, color }
                : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
              {k.toUpperCase()} ({getByKind(k).length})
            </button>
          );
        })}
      </div>

      {/* Content */}
      {!getByKind(activeTab).length ? (
        <div className="rounded-2xl p-12 text-center space-y-3" style={NEON_CARD}>
          <Skull className="w-12 h-12 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
          <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد عناصر محفوظة في هذا القسم</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {getByKind(activeTab).map(item => {
            const color = KIND_COLOR[item.kind] ?? "#888";
            const rgb = KIND_RGB[item.kind] ?? "136,136,136";
            return (
              <div key={item.id} className="rounded-xl p-4 space-y-2 group relative transition-all"
                style={{ background: `rgba(${rgb},0.04)`, border: `1px solid rgba(${rgb},0.15)`, borderRadius: 14 }}>
                <button onClick={() => setBookmarks(p => p.filter(b => b.id !== item.id))}
                  className="absolute top-2 start-2 p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff4444" }}>
                  <Trash2 className="w-3 h-3" />
                </button>
                <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded uppercase"
                  style={{ color, background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.25)` }}>{item.kind}</span>
                <h3 className="font-black text-sm" style={{ color }}>{item.title}</h3>
                <div className="rounded-lg p-2 font-mono text-[9px] truncate"
                  style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }}>{item.target}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
