/**
 * NotificationCenter — مركز الإشعارات الذكية.
 * يتلقى إشعارات Nova وهي تعمل في الخلفية.
 */
import { useState, useEffect, useRef } from "react";
import { Bell, X, CheckCheck, BellRing, AlertCircle, CheckCircle2, Info, Zap } from "lucide-react";

const BASE = "/api";

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const KIND_CONFIG: Record<string, { color: string; icon: typeof Info }> = {
  info:    { color: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5",    icon: Info },
  success: { color: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5", icon: CheckCircle2 },
  error:   { color: "text-red-300 border-red-500/30 bg-red-500/5",       icon: AlertCircle },
  warning: { color: "text-yellow-300 border-yellow-500/30 bg-yellow-500/5", icon: Zap },
};

function getKind(k: string) {
  return KIND_CONFIG[k] ?? KIND_CONFIG["info"];
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [newPop, setNewPop] = useState<Notification | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNotifs = async () => {
    try {
      const res = await fetch(`${BASE}/push/notifications`);
      if (res.ok) {
        const data: Notification[] = await res.json();
        setNotifs(data);
        setUnread(data.filter((n) => !n.read).length);
      }
    } catch {}
  };

  useEffect(() => {
    void fetchNotifs();
    // Connect to live push SSE
    const es = new EventSource(`${BASE}/push/stream`);
    sseRef.current = es;
    es.addEventListener("push", (e) => {
      try {
        const n: Notification = JSON.parse((e as MessageEvent).data);
        setNotifs((prev) => [n, ...prev].slice(0, 50));
        setUnread((prev) => prev + 1);
        // Show popup
        setNewPop(n);
        if (popTimerRef.current) clearTimeout(popTimerRef.current);
        popTimerRef.current = setTimeout(() => setNewPop(null), 5000);
        // Browser notification if permission granted
        if (Notification.permission === "granted") {
          new Notification(n.title, { body: n.body, icon: "/favicon.ico" });
        }
      } catch {}
    });
    return () => { es.close(); };
  }, []);

  const markRead = async (id: string) => {
    await fetch(`${BASE}/push/notifications/${id}/read`, { method: "PATCH" });
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    setUnread((prev) => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    await fetch(`${BASE}/push/notifications/read-all`, { method: "POST" });
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  const requestPermission = async () => {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  };

  return (
    <>
      {/* Floating popup for new notifications */}
      {newPop && (
        <div
          className="fixed z-[9998] bottom-24 right-24 max-w-72 rounded-xl border border-fuchsia-500/30 bg-black/95 backdrop-blur-xl shadow-2xl p-3 animate-in slide-in-from-bottom-2 duration-300"
          dir="rtl"
        >
          <div className="flex items-start gap-2">
            <BellRing className="w-4 h-4 text-fuchsia-400 shrink-0 mt-0.5 animate-bounce" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white">{newPop.title}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{newPop.body}</div>
            </div>
            <button onClick={() => setNewPop(null)} className="text-slate-600 hover:text-slate-400">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Bell button */}
      <div className="relative">
        <button
          onClick={() => { setOpen(!open); if (!open) void requestPermission(); }}
          className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors"
        >
          <Bell className={`w-4 h-4 ${unread > 0 ? "text-fuchsia-400" : "text-slate-500"}`} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>

        {/* Dropdown panel */}
        {open && (
          <div
            className="absolute top-full left-0 mt-2 w-80 max-h-96 rounded-xl border border-white/10 bg-black/95 backdrop-blur-xl shadow-2xl overflow-hidden z-[9990]"
            dir="rtl"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-fuchsia-400" /> الإشعارات
              </div>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button onClick={() => void markAllRead()} className="text-[10px] text-fuchsia-400 hover:text-fuchsia-300 flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" /> قراءة الكل
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="overflow-auto" style={{ maxHeight: "320px" }}>
              {notifs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-slate-600 gap-2">
                  <Bell className="w-8 h-8 opacity-20" />
                  <span className="text-xs">لا توجد إشعارات</span>
                </div>
              )}
              {notifs.map((n) => {
                const cfg = getKind(n.kind);
                const Icon = cfg.icon;
                return (
                  <div
                    key={n.id}
                    onClick={() => !n.read && void markRead(n.id)}
                    className={`flex items-start gap-2 px-3 py-2.5 border-b border-white/5 cursor-pointer hover:bg-white/3 transition-all ${!n.read ? "bg-white/3" : ""}`}
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${n.kind === "error" ? "text-red-400" : n.kind === "success" ? "text-emerald-400" : "text-fuchsia-400"}`} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[11px] font-medium ${n.read ? "text-slate-400" : "text-white"}`}>{n.title}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{n.body}</div>
                      <div className="text-[9px] text-slate-700 mt-0.5">{new Date(n.createdAt).toLocaleString("ar-SA")}</div>
                    </div>
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500 shrink-0 mt-1.5" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
