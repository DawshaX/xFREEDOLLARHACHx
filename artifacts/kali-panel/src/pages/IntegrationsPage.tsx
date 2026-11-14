/**
 * TEST9 — صفحة التطبيقات المتصلة: حالة حقيقية + ربط + اختبار حي.
 * كل زرار هنا بيرفع إشعارًا حيًا بالـlink — والضغط على الإشعار بيرجع هنا.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { jsonRequest, pushNotify } from "@/lib/sse";

interface AppStatus {
  id: string;
  name: string;
  nameAr: string;
  icon: string;
  connected: boolean;
  source: "env" | "owner" | null;
  testedAt: string | null;
  lastError: string | null;
  ops: string[];
  setupAr: string;
  panelLink: string;
}

const QUICK_TEST: Record<string, { op: string; args?: Record<string, string> }> = {
  github: { op: "list_repos" },
  gmail: { op: "list_messages", args: { max: "3" } },
  google_calendar: { op: "list_events", args: { max: "3" } },
  google_drive: { op: "list_files", args: { max: "5" } },
  google_docs: { op: "create_doc", args: { title: "NOVA — اختبار ربط", content: "اتأنشى من اللوحة — TEST9" } },
  google_sheets: { op: "create_sheet", args: { title: "NOVA — اختبار ربط" } },
  google_slides: { op: "create_presentation", args: { title: "NOVA — اختبار ربط" } },
  notion: { op: "search", args: { query: "" } },
  linear: { op: "list_issues", args: { limit: "5" } },
  supabase: { op: "select", args: { table: "_prisma_migrations", limit: "3" } },
  vercel: { op: "list_projects" },
  dropbox: { op: "list_folder", args: { path: "" } },
};

export default function IntegrationsPage() {
  const [apps, setApps] = useState<AppStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await jsonRequest<{ ok: boolean; apps: AppStatus[] }>("/integrations");
      setApps(d.apps ?? []);
    } catch {
      pushNotify("error", "التطبيقات المتصلة", "تعذر قراءة الحالة — السيرفر الحي مطلوب لهذا القسم");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async (id: string) => {
    setBusy(`connect:${id}`);
    try {
      const d = await jsonRequest<{ ok: boolean; says_ar: string }>("/integrations/connect", {
        method: "POST",
        body: JSON.stringify({ id, token }),
      });
      pushNotify(d.ok ? "success" : "error", "ربط تطبيق", d.says_ar);
      if (d.ok) {
        setTokenFor(null);
        setToken("");
        void load();
      }
    } catch (e) {
      pushNotify("error", "ربط تطبيق", `فشل: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const test = async (id: string) => {
    const t = QUICK_TEST[id] ?? { op: "list_repos" };
    setBusy(`test:${id}`);
    try {
      const d = await jsonRequest<{ ok: boolean; says_ar: string }>("/integrations/run", {
        method: "POST",
        body: JSON.stringify({ id, op: t.op, args: t.args ?? {} }),
      });
      pushNotify(d.ok ? "success" : "error", `اختبار حي — ${id}`, d.says_ar);
      void load();
    } catch (e) {
      pushNotify("error", `اختبار حي — ${id}`, `فشل: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const connected = apps.filter((a) => a.connected).length;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4" dir="rtl">
      <div className="rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/5 p-4 space-y-1">
        <div className="flex items-center gap-2 text-sm font-black text-fuchsia-200">
          <Plug className="h-4 w-4" /> التطبيقات المتصلة باللايف أجينت
          <span className="text-[10px] font-mono text-white/40">{connected}/{apps.length}</span>
          <button onClick={() => void load()} className="ml-auto text-[10px] text-fuchsia-300 hover:text-fuchsia-200 flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> تحديث
          </button>
        </div>
        <p className="text-[11px] text-white/55 leading-relaxed break-safe">
          اللايف أجينت بيشغّل التطبيقات دي بأدوات <code className="text-fuchsia-300">app_*</code> من الشات أو المهام —
          وكل عملية بترفع إشعار يودّيك لمكانها. اربط بالتوكن، جرّب حي، والحالة هنا مقاسة مش مكتوبة.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {apps.length === 0 && (
          <div className="text-xs text-white/40 col-span-2 py-8 text-center">… بحمّل الحالة الحقيقية من السيرفر</div>
        )}
        {apps.map((a) => (
          <div key={a.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-3 space-y-2 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg">{a.icon}</span>
              <span className="text-xs font-black text-white">{a.nameAr}</span>
              {a.connected ? (
                <span className="text-[9px] font-bold text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded px-1.5 py-0.5 flex items-center gap-1">
                  <ShieldCheck className="h-2.5 w-2.5" /> متصل ({a.source === "env" ? "بيئة" : "المالك"})
                </span>
              ) : (
                <span className="text-[9px] font-bold text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded px-1.5 py-0.5">محتاج ربط</span>
              )}
              <span className="ml-auto text-[9px] font-mono text-white/35">{a.ops.length} عملية</span>
            </div>
            {a.lastError && <div className="text-[9px] text-red-300/80 break-safe">آخر خطأ: {a.lastError}</div>}
            <div className="text-[10px] text-white/50 leading-relaxed break-safe">{a.setupAr}</div>
            {a.connected && a.testedAt && (
              <div className="text-[9px] text-emerald-400/60">آخر اختبار حي: {new Date(a.testedAt).toLocaleString("ar")}</div>
            )}
            <div className="flex gap-1.5 flex-wrap">
              {!a.connected && (
                <button
                  onClick={() => { setTokenFor(tokenFor === a.id ? null : a.id); setToken(""); }}
                  className="text-[10px] font-bold px-2 py-1 rounded-md border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10 flex items-center gap-1"
                >
                  <Plug className="h-3 w-3" /> اربط بالتوكن
                </button>
              )}
              <button
                onClick={() => void test(a.id)}
                disabled={busy === `test:${a.id}`}
                className="text-[10px] font-bold px-2 py-1 rounded-md border border-fuchsia-500/40 text-fuchsia-200 hover:bg-fuchsia-500/10 disabled:opacity-40 flex items-center gap-1"
              >
                {busy === `test:${a.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} اختبار حي
              </button>
            </div>
            {tokenFor === a.id && (
              <div className="space-y-1.5 pt-1">
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="الصق التوكن هنا — بيتخزن 0600 على السيرفر بس"
                  dir="ltr"
                  className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] font-mono text-white/90 outline-none focus:border-cyan-500/50 break-safe"
                />
                <button
                  onClick={() => void connect(a.id)}
                  disabled={busy === `connect:${a.id}` || token.trim().length < 8}
                  className="w-full text-[10px] font-black py-1.5 rounded-md bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  {busy === `connect:${a.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />} احفظ واربط
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
