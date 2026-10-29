import { useState, useCallback } from "react";
import {
  FileText, Download, Printer, ShieldAlert, Activity, Cpu,
  Globe, AlertTriangle, CheckCircle2, Clock, RefreshCw, Database,
  TrendingUp, Lock, Eye, Wifi, Server, Bug, X
} from "lucide-react";

interface ReportEntry {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  description: string;
  timestamp: string;
  status: "open" | "resolved" | "investigating";
}

const SEVERITY_CONFIG = {
  critical: { label: "حرج",        color: "#ff2244", bg: "rgba(255,34,68,0.15)",   border: "rgba(255,34,68,0.4)" },
  high:     { label: "عالي",       color: "#ff6622", bg: "rgba(255,102,34,0.12)",  border: "rgba(255,102,34,0.35)" },
  medium:   { label: "متوسط",      color: "#ffcc00", bg: "rgba(255,204,0,0.10)",   border: "rgba(255,204,0,0.30)" },
  low:      { label: "منخفض",      color: "#44eebb", bg: "rgba(68,238,187,0.08)",  border: "rgba(68,238,187,0.25)" },
  info:     { label: "معلومة",     color: "#4488ff", bg: "rgba(68,136,255,0.08)",  border: "rgba(68,136,255,0.25)" },
};

const STATUS_CONFIG = {
  open:         { label: "مفتوح",        color: "#ff5555" },
  resolved:     { label: "محلول",        color: "#44eebb" },
  investigating:{ label: "قيد التحقيق", color: "#ffcc00" },
};

const SAMPLE_ENTRIES: ReportEntry[] = [
  { id:"r1", title:"ثغرة SQL Injection في نقطة تسجيل الدخول", severity:"critical", category:"أمن التطبيقات", description:"تم اكتشاف ثغرة حقن SQL في معامل username مما يسمح بتجاوز المصادقة وسرقة البيانات.", timestamp:"2026-05-03 08:12", status:"open" },
  { id:"r2", title:"شهادة SSL منتهية الصلاحية", severity:"high", category:"بنية تحتية", description:"شهادة TLS على المنفذ 443 انتهت منذ 3 أيام — الاتصالات الآمنة غير مضمونة.", timestamp:"2026-05-03 07:45", status:"investigating" },
  { id:"r3", title:"منافذ مفتوحة غير مصرح بها", severity:"high", category:"فحص الشبكة", description:"المنافذ 8080, 3306, 27017 مكشوفة للإنترنت دون جدار حماية.", timestamp:"2026-05-02 22:30", status:"open" },
  { id:"r4", title:"كلمات مرور ضعيفة في قاعدة البيانات", severity:"medium", category:"إدارة الهوية", description:"تم اكتشاف 12 حساباً يستخدم كلمات مرور شائعة وسهلة التخمين.", timestamp:"2026-05-02 18:00", status:"investigating" },
  { id:"r5", title:"تحديثات نظام التشغيل متأخرة", severity:"medium", category:"إدارة التصحيحات", description:"يحتاج النظام إلى 47 تحديثاً أمنياً منها 8 تحديثات حرجة.", timestamp:"2026-05-02 14:20", status:"open" },
  { id:"r6", title:"نشاط مشبوه في سجلات SSH", severity:"medium", category:"مراقبة الوصول", description:"محاولات تسجيل دخول SSH فاشلة متعددة من عناوين IP مجهولة.", timestamp:"2026-05-02 10:05", status:"resolved" },
  { id:"r7", title:"إعدادات CORS غير صحيحة", severity:"low", category:"أمن الويب", description:"إعدادات CORS تسمح بطلبات من أي مصدر مما يزيد من مخاطر CSRF.", timestamp:"2026-05-01 16:40", status:"resolved" },
  { id:"r8", title:"ملفات حساسة في مجلد عام", severity:"low", category:"إدارة الملفات", description:"ملفات تكوين تحتوي على متغيرات بيئية في مجلد قابل للوصول.", timestamp:"2026-05-01 09:15", status:"resolved" },
  { id:"r9", title:"فحص دوري مكتمل — لا تهديدات", severity:"info", category:"مراقبة دورية", description:"اكتمل الفحص الدوري بنجاح. لا توجد تهديدات جديدة خارج القائمة المعروفة.", timestamp:"2026-05-01 06:00", status:"resolved" },
];

const neonGlow = (color: string, px = 8) =>
  `0 0 ${px}px ${color}60, 0 0 ${px * 2}px ${color}30`;

export function PdfReportsWindow() {
  const [filter, setFilter] = useState<"all" | ReportEntry["severity"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ReportEntry["status"]>("all");
  const [generating, setGenerating] = useState(false);

  const filtered = SAMPLE_ENTRIES.filter(e =>
    (filter === "all" || e.severity === filter) &&
    (statusFilter === "all" || e.status === statusFilter)
  );

  const stats = {
    critical: SAMPLE_ENTRIES.filter(e => e.severity === "critical").length,
    high:     SAMPLE_ENTRIES.filter(e => e.severity === "high").length,
    medium:   SAMPLE_ENTRIES.filter(e => e.severity === "medium").length,
    open:     SAMPLE_ENTRIES.filter(e => e.status === "open").length,
    resolved: SAMPLE_ENTRIES.filter(e => e.status === "resolved").length,
  };

  const generatePdf = useCallback(async () => {
    setGenerating(true);
    await new Promise(r => setTimeout(r, 1200));

    const rows = SAMPLE_ENTRIES.map(e => {
      const sev = SEVERITY_CONFIG[e.severity];
      const st  = STATUS_CONFIG[e.status];
      return `
        <tr style="border-bottom:1px solid #222;">
          <td style="padding:8px 10px;color:${sev.color};font-weight:bold;">${sev.label}</td>
          <td style="padding:8px 10px;">${e.title}</td>
          <td style="padding:8px 10px;color:#aaa;">${e.category}</td>
          <td style="padding:8px 10px;color:${st.color}">${st.label}</td>
          <td style="padding:8px 10px;color:#666;font-size:11px;">${e.timestamp}</td>
        </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar">
<head><meta charset="utf-8"><title>تقرير CyberNova الأمني — ${new Date().toLocaleDateString("ar-SA")}</title>
<style>
  * { box-sizing:border-box; font-family: 'Segoe UI', Arial, sans-serif; }
  body { background:#0a0a12; color:#e0e0e0; margin:0; padding:24px; direction:rtl; }
  h1 { color:#00ffcc; text-shadow:0 0 12px #00ffcc80; font-size:24px; margin:0 0 4px; }
  .subtitle { color:#888; font-size:13px; margin-bottom:24px; }
  .stats { display:flex; gap:16px; margin-bottom:24px; flex-wrap:wrap; }
  .stat { background:#111; border:1px solid #333; border-radius:8px; padding:12px 20px; text-align:center; }
  .stat .val { font-size:28px; font-weight:bold; }
  .stat .lbl { font-size:12px; color:#888; margin-top:2px; }
  table { width:100%; border-collapse:collapse; background:#0d0d18; border-radius:8px; overflow:hidden; }
  thead tr { background:#111; }
  th { padding:10px; text-align:right; color:#888; font-size:12px; text-transform:uppercase; letter-spacing:1px; }
  tr:hover { background:#141420; }
  .footer { text-align:center; margin-top:32px; color:#333; font-size:11px; }
</style></head><body>
<h1>🛡 تقرير CyberNova الأمني</h1>
<div class="subtitle">تاريخ التقرير: ${new Date().toLocaleDateString("ar-SA", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}</div>
<div class="stats">
  <div class="stat"><div class="val" style="color:#ff2244">${stats.critical}</div><div class="lbl">حرجة</div></div>
  <div class="stat"><div class="val" style="color:#ff6622">${stats.high}</div><div class="lbl">عالية</div></div>
  <div class="stat"><div class="val" style="color:#ffcc00">${stats.medium}</div><div class="lbl">متوسطة</div></div>
  <div class="stat"><div class="val" style="color:#ff5555">${stats.open}</div><div class="lbl">مفتوحة</div></div>
  <div class="stat"><div class="val" style="color:#44eebb">${stats.resolved}</div><div class="lbl">محلولة</div></div>
</div>
<table><thead><tr><th>الخطورة</th><th>العنوان</th><th>الفئة</th><th>الحالة</th><th>التوقيت</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="footer">تم إنشاؤه بواسطة CyberNova Platform — ${new Date().toISOString()}</div>
</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const w    = window.open(url, "_blank");
    if (w) { setTimeout(() => { w.print(); URL.revokeObjectURL(url); }, 800); }
    else { const a = document.createElement("a"); a.href = url; a.download = `cybernova-report-${Date.now()}.html`; a.click(); URL.revokeObjectURL(url); }
    setGenerating(false);
  }, []);

  const primaryColor = "#44eebb";
  const panelBg = "rgba(0,8,20,0.96)";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:panelBg, color:"#e0e0e0", fontFamily:"'Segoe UI',Arial,sans-serif", direction:"rtl" }}>

      {/* ── Header ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", borderBottom:"1px solid rgba(68,238,187,0.2)", background:"rgba(0,255,180,0.03)", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <FileText style={{ color:primaryColor, filter:`drop-shadow(0 0 6px ${primaryColor})` }} />
          <span style={{ fontWeight:700, fontSize:16, color:primaryColor, textShadow:neonGlow(primaryColor) }}>مركز التقارير الأمنية</span>
          <span style={{ fontSize:11, color:"#666", background:"#111", border:"1px solid #333", borderRadius:4, padding:"2px 8px" }}>CyberNova REPORTS</span>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button
            onClick={generatePdf}
            disabled={generating}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 14px", background:`rgba(68,238,187,0.15)`, border:`1px solid rgba(68,238,187,0.5)`, borderRadius:8, color:primaryColor, fontSize:13, cursor:"pointer", transition:"all 0.2s", filter: generating ? "opacity(0.5)" : undefined, boxShadow: generating ? "none" : neonGlow(primaryColor, 4) }}
          >
            {generating ? <RefreshCw style={{ width:14, height:14, animation:"spin 1s linear infinite" }} /> : <Printer style={{ width:14, height:14 }} />}
            {generating ? "جارٍ الإنشاء..." : "طباعة / PDF"}
          </button>
          <button
            onClick={generatePdf}
            disabled={generating}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 14px", background:"rgba(68,136,255,0.12)", border:"1px solid rgba(68,136,255,0.4)", borderRadius:8, color:"#4488ff", fontSize:13, cursor:"pointer", boxShadow: neonGlow("#4488ff", 4) }}
          >
            <Download style={{ width:14, height:14 }} /> تصدير HTML
          </button>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <div style={{ display:"flex", gap:10, padding:"12px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)", flexShrink:0, flexWrap:"wrap" }}>
        {([
          { label:"حرجة",    val: stats.critical, color:"#ff2244", icon: ShieldAlert },
          { label:"عالية",   val: stats.high,     color:"#ff6622", icon: AlertTriangle },
          { label:"متوسطة",  val: stats.medium,   color:"#ffcc00", icon: Bug },
          { label:"مفتوحة",  val: stats.open,     color:"#ff5555", icon: Eye },
          { label:"محلولة",  val: stats.resolved, color:"#44eebb", icon: CheckCircle2 },
          { label:"إجمالي",  val: SAMPLE_ENTRIES.length, color:"#aaa", icon: Database },
        ] as const).map(({ label, val, color, icon: Icon }) => (
          <div key={label} style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(255,255,255,0.04)", border:`1px solid ${color}30`, borderRadius:8, padding:"6px 12px", minWidth:90 }}>
            <Icon style={{ width:14, height:14, color, filter:`drop-shadow(0 0 4px ${color})` }} />
            <div>
              <div style={{ fontSize:18, fontWeight:800, color, lineHeight:1, textShadow:neonGlow(color, 4) }}>{val}</div>
              <div style={{ fontSize:10, color:"#666", marginTop:1 }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={{ display:"flex", gap:8, padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,0.05)", flexShrink:0, alignItems:"center", flexWrap:"wrap" }}>
        <span style={{ fontSize:12, color:"#555", marginLeft:4 }}>الخطورة:</span>
        {(["all","critical","high","medium","low","info"] as const).map(s => {
          const cfg = s === "all" ? { label:"الكل", color:primaryColor } : { label: SEVERITY_CONFIG[s].label, color: SEVERITY_CONFIG[s].color };
          const active = filter === s;
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding:"3px 10px", borderRadius:6, fontSize:12, cursor:"pointer", border:`1px solid ${active ? cfg.color : "#333"}`, background: active ? `${cfg.color}20` : "transparent", color: active ? cfg.color : "#666", transition:"all 0.15s", boxShadow: active ? neonGlow(cfg.color, 3) : "none" }}>
              {cfg.label}
            </button>
          );
        })}
        <div style={{ width:1, height:18, background:"#333", margin:"0 4px" }} />
        <span style={{ fontSize:12, color:"#555" }}>الحالة:</span>
        {(["all","open","investigating","resolved"] as const).map(s => {
          const cfg = s === "all" ? { label:"الكل", color:primaryColor } : { label: STATUS_CONFIG[s].label, color: STATUS_CONFIG[s].color };
          const active = statusFilter === s;
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding:"3px 10px", borderRadius:6, fontSize:12, cursor:"pointer", border:`1px solid ${active ? cfg.color : "#333"}`, background: active ? `${cfg.color}20` : "transparent", color: active ? cfg.color : "#666", transition:"all 0.15s", boxShadow: active ? neonGlow(cfg.color, 3) : "none" }}>
              {cfg.label}
            </button>
          );
        })}
        <span style={{ marginRight:"auto", fontSize:11, color:"#555" }}>{filtered.length} من {SAMPLE_ENTRIES.length} إدخال</span>
      </div>

      {/* ── Entries ── */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
        {filtered.length === 0 && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:200, color:"#444" }}>
            <CheckCircle2 style={{ width:40, height:40, marginBottom:12 }} />
            <div style={{ fontSize:14 }}>لا توجد إدخالات مطابقة للفلتر</div>
          </div>
        )}
        {filtered.map(entry => {
          const sev = SEVERITY_CONFIG[entry.severity];
          const st  = STATUS_CONFIG[entry.status];
          return (
            <div key={entry.id} style={{
              background: sev.bg,
              border: `1px solid ${sev.border}`,
              borderRadius: 10,
              padding: "12px 14px",
              transition: "box-shadow 0.2s",
            }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = neonGlow(sev.color, 6))}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
            >
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10, marginBottom:6 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
                  <span style={{ padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:700, background:`${sev.color}25`, border:`1px solid ${sev.color}60`, color:sev.color, flexShrink:0, textShadow:neonGlow(sev.color,3) }}>{sev.label}</span>
                  <span style={{ fontWeight:600, fontSize:13, color:"#e0e0e0" }}>{entry.title}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                  <span style={{ fontSize:11, color:st.color, background:`${st.color}15`, border:`1px solid ${st.color}40`, borderRadius:4, padding:"2px 8px" }}>{st.label}</span>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                <span style={{ fontSize:12, color:"#666", flex:1 }}>{entry.description}</span>
                <div style={{ display:"flex", alignItems:"center", gap:6, color:"#555", fontSize:11, flexShrink:0 }}>
                  <span style={{ background:"#111", border:"1px solid #222", borderRadius:4, padding:"1px 6px", color:"#4488ff" }}>{entry.category}</span>
                  <Clock style={{ width:11, height:11 }} />
                  <span>{entry.timestamp}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 16px", borderTop:"1px solid rgba(255,255,255,0.06)", flexShrink:0, color:"#444", fontSize:11 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <Activity style={{ width:12, height:12, color:primaryColor }} />
          <span>آخر فحص: اليوم 09:38 — نظام CyberNova LIVE</span>
        </div>
        <div>التقرير يشمل {SAMPLE_ENTRIES.length} إدخالاً أمنياً</div>
      </div>

      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`}</style>
    </div>
  );
}
