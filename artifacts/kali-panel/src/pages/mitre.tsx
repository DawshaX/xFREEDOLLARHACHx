import { useState, useEffect, useMemo } from "react";
import { Search, Loader2, Skull, ExternalLink } from "lucide-react";

/**
 * MITRE ATT&CK — النسخة الحقيقية.
 * قبل: 8 تقنيات مكتوبة بإيد الباني (STATIC-SUSPECT في إحصاء الصفحات).
 * دلوقتي: بيانات رسمية كاملة من حزمة STIX الرسمية (mitre-attack/attack-stix-data)،
 * مقطّعة لملف خفيف public/data/mitre-attack.json وقت البناء — 706 تقنية/فرعية،
 * 15 تكتيك. المصدر والتاريخ مكتوبين على الصفحة نفسها، مفيش أرقام مخترعة.
 */

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" } as const;
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

const TACTIC_COLORS: Record<string, string> = {
  "Reconnaissance": "#8aa0ff", "Resource Development": "#b48aff", "Initial Access": "#ff4444",
  "Execution": "#ff8844", "Persistence": "#ffaa44", "Privilege Escalation": "#aa44ff",
  "Stealth": "#44c0ff", "Defense Impairment": "#4488ff", "Credential Access": "#44eebb",
  "Discovery": "#44ff88", "Lateral Movement": "#ff44aa", "Collection": "#ffcc44",
  "Command and Control": "#66ffd9", "Exfiltration": "#ff5588", "Impact": "#ff2222",
};

interface Technique { id: string; name: string; tactics: string[]; platforms: string[]; desc: string; sub: boolean; url: string; }
interface Dataset { source: string; count: number; techniques: Technique[]; }

export default function Mitre() {
  const [data, setData] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tactic, setTactic] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    fetch("data/mitre-attack.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!dead) setData(d as Dataset); })
      .catch((e) => { if (!dead) setErr(String((e as Error).message || e)); });
    return () => { dead = true; };
  }, []);

  const tactics = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data?.techniques ?? []) for (const x of t.tactics) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.techniques ?? []).filter((t) => {
      if (tactic && !t.tactics.includes(tactic)) return false;
      if (!q) return true;
      return t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q);
    });
  }, [data, search, tactic]);

  return (
    <div dir="rtl" style={{ padding: 18, color: "rgba(255,255,255,0.85)" }}>
      <div style={{ ...NEON_CARD, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Skull size={22} color="#b48aff" />
          <div>
            <div style={{ fontWeight: 900, fontSize: 17 }}>MITRE ATT&CK — Enterprise</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
              {data ? `${data.count} تقنية/فرعية رسمية` : err ? "تعذّر التحميل" : "بيحمّل…"} · المصدر: {data?.source ?? "MITRE STIX"}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, position: "relative" }}>
          <Search size={14} style={{ position: "absolute", right: 10, top: 9, color: "rgba(255,255,255,0.35)" }} />
          <input style={{ ...inputStyle, paddingRight: 30 }} placeholder="دوّر بالرقم (T1059) أو الاسم أو الوصف…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          <button onClick={() => setTactic(null)} style={{ cursor: "pointer", fontSize: 11, padding: "4px 10px", borderRadius: 999, border: tactic === null ? "1px solid #b48aff" : "1px solid rgba(255,255,255,0.14)", background: tactic === null ? "rgba(180,0,255,0.15)" : "transparent", color: "rgba(255,255,255,0.75)" }}>الكل</button>
          {tactics.map(([name, count]) => (
            <button key={name} onClick={() => setTactic(tactic === name ? null : name)}
              style={{ cursor: "pointer", fontSize: 11, padding: "4px 10px", borderRadius: 999, border: `1px solid ${tactic === name ? (TACTIC_COLORS[name] ?? "#888") : "rgba(255,255,255,0.12)"}`, background: tactic === name ? `${TACTIC_COLORS[name] ?? "#888"}22` : "transparent", color: TACTIC_COLORS[name] ?? "#ccc" }}>
              {name} · {count}
            </button>
          ))}
        </div>
      </div>

      {err && <div style={{ ...NEON_CARD, padding: 14, color: "#ff8888" }}>فشل تحميل الداتا: {err}</div>}
      {!data && !err && <div style={{ textAlign: "center", padding: 30 }}><Loader2 className="animate-spin" style={{ margin: "auto" }} /></div>}

      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
        بيعرض {shown.length} من {data?.count ?? 0} {shown.length > 120 && "· (أول 120 بس — قيّد البحث أو اختار تكتيك)"}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {shown.slice(0, 120).map((t) => (
          <div key={t.id} style={{ ...NEON_CARD, padding: "10px 14px", cursor: "pointer" }} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, direction: "ltr" }}>
              <span style={{ fontFamily: "monospace", fontWeight: 800, color: "#b48aff", minWidth: 86 }}>{t.id}</span>
              <span style={{ fontWeight: 700, flex: 1 }}>{t.name}</span>
              {t.sub && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>فرعية</span>}
              {t.tactics.map((x) => <span key={x} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: `${TACTIC_COLORS[x] ?? "#888"}22`, color: TACTIC_COLORS[x] ?? "#ccc" }}>{x}</span>)}
            </div>
            {open === t.id && (
              <div style={{ marginTop: 10, direction: "ltr", fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.7, borderTop: "1px dashed rgba(255,255,255,0.08)", paddingTop: 10 }}>
                {t.desc}
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {t.platforms.map((p) => <span key={p} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "rgba(255,255,255,0.06)" }}>{p}</span>)}
                  {t.url && <a href={t.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#8aa0ff", display: "inline-flex", alignItems: "center", gap: 4 }}>attack.mitre.org <ExternalLink size={11} /></a>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
