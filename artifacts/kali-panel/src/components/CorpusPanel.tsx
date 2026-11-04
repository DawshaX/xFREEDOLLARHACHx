/**
 * CorpusPanel — the vulnerability centre's real data, on any page.
 * ──────────────────────────────────────────────────────────────
 * One component, one source: the system bus. It shows the measured corpus and the
 * last hunt (with evidence hashes), and it lets you search the corpus you actually
 * have — in the browser, no server, no key.
 *
 * Search is honest: it filters the rows shipped in `vuln-corpus-live.json`
 * (currently the top slice, ordered KEV → CVSS → EPSS) and says so in the footer,
 * instead of implying it queried all of NVD.
 */
import { useEffect, useMemo, useState } from "react";
import { Database, Search, ShieldAlert, RefreshCw } from "lucide-react";
import { refreshSystem, systemSnapshot, onSystemChange, type SystemSnapshot } from "@/lib/system-bus";
import { backendCorpus, type BackendCve } from "@/lib/backend";

const CARD = { background: "rgba(8,0,18,0.9)", border: "1px solid rgba(0,255,255,0.15)", borderRadius: 14 };

export default function CorpusPanel({ compact = false }: { compact?: boolean }) {
  const [snap, setSnap] = useState<SystemSnapshot | null>(systemSnapshot());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  // rows served by Postgres (the real database) when the backend answers
  const [dbRows, setDbRows] = useState<BackendCve[] | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    const off = onSystemChange(setSnap);
    void refreshSystem();
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const res = await backendCorpus(q.trim(), compact ? 8 : 25);
      if (!alive) return;
      if (res.ok) {
        setDbRows(res.data.rows);
        setDbError(null);
      } else {
        setDbRows(null);
        setDbError(res.error);
      }
    }, q ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, compact]);

  const rows = useMemo(() => {
    if (dbRows) {
      return dbRows.map((r) => ({
        id: r.cve,
        sev: r.severity ?? "unknown",
        cvss: r.cvss,
        kev: r.kev,
        epss: r.epss,
        products: r.products ?? [],
        desc: r.summary ?? "",
      }));
    }
    const all = snap?.corpus.rows ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, compact ? 6 : 25);
    return all
      .filter((r) => r.id.toLowerCase().includes(needle) || r.products.some((p) => p.toLowerCase().includes(needle)))
      .slice(0, compact ? 6 : 25);
  }, [snap, q, compact]);

  const corpus = snap?.corpus;
  const hunt = snap?.hunt;

  return (
    <div style={CARD} className="p-3 space-y-2" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-black text-cyan-200 flex items-center gap-2">
          <Database className="h-3.5 w-3.5" /> كوربوس الثغرات الحقيقي
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            await refreshSystem(true);
            setBusy(false);
          }}
          className="text-[10px] text-white/40 flex items-center gap-1"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> تحديث
        </button>
      </div>

      {!corpus?.measured ? (
        <div className="text-[10px] text-amber-300/90">
          {corpus?.saysAr ?? "الكوربوس مش مقاس"} — الأرقام بتظهر أول ما الـworkflow يكتب الفهرس.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 text-center font-mono">
            {[
              ["إجمالي", corpus.total.toLocaleString("en-US"), "#66ffff"],
              ["KEV", String(corpus.kev), "#ff6666"],
              ["EPSS", String(corpus.epssScored), "#ffcc44"],
              ["منتجات", String(corpus.products), "#88ff88"],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-lg py-1" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="text-[9px] text-white/40">{label}</div>
                <div className="text-[12px] font-black" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            <Search className="h-3 w-3 text-white/30" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث CVE أو منتج (nginx، lodash…)"
              className="flex-1 bg-transparent border border-white/10 rounded px-2 py-1 font-mono text-white/80 outline-none"
            />
          </div>

          <div className="font-mono text-[10px] space-y-0.5 max-h-[220px] overflow-auto">
            {rows.length === 0 && <div className="text-white/35">مفيش صف مطابق في الشريحة المحمّلة.</div>}
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate" style={{ color: r.sev === "critical" ? "#ff5555" : r.sev === "high" ? "#ff9944" : "#8fb8ff" }}>
                  {r.id}
                </span>
                <span className="text-white/35">{r.products[0] ?? "—"}</span>
                <span className="text-white/45">{r.cvss ?? "?"}</span>
                {r.kev && <span className="text-red-400">KEV</span>}
              </div>
            ))}
          </div>
          <div className="text-[9px] text-white/30">
            {dbRows ? (
              <>المصدر: <span className="text-cyan-300">Postgres الحي</span> · {dbRows.length} صف مطابق</>
            ) : (
              <>مصدر احتياطي: الملف الثابت{dbError ? ` (الباك إند: ${dbError})` : ""}</>
            )}
            {" · "}
            معروض من {corpus.rows.length} صف محمّل (مرتب KEV → CVSS → EPSS) من أصل {corpus.total.toLocaleString("en-US")} · مزامنة{" "}
            {corpus.at ? new Date(corpus.at).toLocaleString("ar-EG") : "—"}
          </div>
        </>
      )}

      <div className="pt-2 border-t border-white/10">
        <div className="text-[11px] font-black text-fuchsia-200 flex items-center gap-2 mb-1">
          <ShieldAlert className="h-3.5 w-3.5" /> آخر صيد (verified=false — خيط مش ثغرة)
        </div>
        {!hunt ? (
          <div className="text-[10px] text-white/35">لسه مفيش نتيجة منشورة من «hunt live».</div>
        ) : hunt.findings.length === 0 ? (
          <div className="text-[10px] text-white/45">{hunt.saysAr}</div>
        ) : (
          <div className="font-mono text-[10px] space-y-0.5">
            {hunt.findings.slice(0, compact ? 4 : 10).map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2">
                <span style={{ color: f.severity === "critical" ? "#ff5555" : "#ff9944" }}>
                  [{f.severity}] {f.template}
                </span>
                <span className="text-white/35 truncate max-w-[50%]">{f.matchedAt}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
