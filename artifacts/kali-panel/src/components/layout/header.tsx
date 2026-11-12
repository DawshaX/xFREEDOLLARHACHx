import { Bell, Search, Shield, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export function Header() {
  // قياس حقيقي كل 10 ثوان من /api/healthz — مش شارة مكتوبة بثبات
  const [health, setHealth] = useState<{ ok: boolean; ms: number | null; db: boolean | null }>({ ok: false, ms: null, db: null });
  const [bellOpen, setBellOpen] = useState(false);
  const unreadCount = 0;
  useEffect(() => {
    let stop = false;
    const probe = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch("/api/healthz");
        const ms = Math.round(performance.now() - t0);
        const j = (await r.json().catch(() => null)) as { status?: string; db?: { reachable?: boolean } } | null;
        if (!stop) setHealth({ ok: r.ok && j?.status === "ok", ms, db: j?.db?.reachable ?? null });
      } catch { if (!stop) setHealth({ ok: false, ms: null, db: null }); }
    };
    void probe();
    const iv = setInterval(probe, 10000);
    return () => { stop = true; clearInterval(iv); };
  }, []);

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur flex items-center justify-between px-6 z-10 sticky top-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-muted-foreground hover:text-foreground cursor-pointer transition-colors border border-border bg-background px-3 py-1.5 rounded-md text-sm w-64" onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}>
          <Search className="h-4 w-4" />
          <span className="flex-1 text-right text-xs">بحث سريع (Ctrl+K)...</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Link href="/monitor" title={health.ok ? `السيرفر واصل · healthz ${health.ms}ms${health.db === true ? " · DB واصلة" : health.db === false ? " · DB مش واصلة" : ""}` : "السيرفر مش واصل دلوقتي (مقاس لحظي)"}
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono border ${health.ok ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>
          {health.ok ? <Shield className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          <span>{health.ok ? `السيرفر واصل · ${health.ms}ms` : "السيرفر مش واصل"}</span>
        </Link>

        <div className="relative">
          <Button variant="ghost" size="icon" onClick={() => setBellOpen((v) => !v)}
            aria-expanded={bellOpen} aria-label="لوحة العمليات السريعة"
            className="relative text-muted-foreground hover:text-primary">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-destructive rounded-full animate-pulse-glow" />
            )}
          </Button>
          {bellOpen && (
            <div className="absolute left-0 top-10 w-72 rounded-xl border border-border bg-card/95 backdrop-blur p-3 shadow-xl z-50" dir="rtl">
              <div className="text-xs font-bold text-foreground mb-2">نبض المنصة الحي</div>
              <ul className="space-y-1.5 text-[11px] font-mono text-muted-foreground">
                <li>· healthz: {health.ok ? `ok في ${health.ms}ms` : "مش واصل"}</li>
                <li>· قاعدة البيانات: {health.db === null ? "⏳ يتقاس…" : health.db ? "واصلة" : "مش واصلة"}</li>
              </ul>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-center">
                <Link href="/live-agent" onClick={() => setBellOpen(false)} className="rounded-md border border-primary/30 text-primary text-[10px] font-bold py-1 hover:bg-primary/10">📡 المراقبة الحية</Link>
                <Link href="/cve-live" onClick={() => setBellOpen(false)} className="rounded-md border border-border text-muted-foreground text-[10px] font-bold py-1 hover:bg-white/5">🛰 لوحة العمليات</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
