import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full grid-bg overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 relative scanline">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  danger,
  badge,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  actions?: React.ReactNode;
  danger?: boolean;
  badge?: string;
}) {
  return (
    <div className="mb-6 relative">
      {/* Top border line */}
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: danger
            ? "linear-gradient(90deg, transparent, rgba(255,30,30,0.8) 30%, rgba(255,30,30,0.5) 70%, transparent)"
            : "linear-gradient(90deg, transparent, rgba(100,120,255,0.6) 30%, rgba(100,120,255,0.3) 70%, transparent)",
          boxShadow: danger ? "0 0 10px rgba(255,0,0,0.3)" : "0 0 8px rgba(100,120,255,0.2)",
        }} />

      <div className="flex items-start justify-between gap-4 pt-2">
        <div className="flex items-start gap-4">
          {Icon && (
            <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: danger
                  ? "linear-gradient(135deg, rgba(180,0,0,0.3), rgba(60,0,0,0.4))"
                  : "linear-gradient(135deg, rgba(40,60,160,0.3), rgba(20,40,100,0.4))",
                border: danger
                  ? "1px solid rgba(255,30,30,0.4)"
                  : "1px solid rgba(100,120,255,0.3)",
                boxShadow: danger
                  ? "0 0 20px rgba(255,0,0,0.2), inset 0 0 12px rgba(255,0,0,0.08)"
                  : "0 0 20px rgba(100,120,255,0.15), inset 0 0 10px rgba(100,120,255,0.06)",
              }}>
              <Icon style={{
                width: 22, height: 22,
                color: danger ? "#ff5555" : "#7090ff",
                filter: danger
                  ? "drop-shadow(0 0 8px rgba(255,50,50,0.9))"
                  : "drop-shadow(0 0 6px rgba(100,130,255,0.8))",
              }} />
            </div>
          )}
          <div>
            <div className="flex items-center gap-3">
              <h1
                className="text-2xl font-black"
                style={{
                  color: danger ? "#ff4444" : "#e8eeff",
                  textShadow: danger
                    ? "0 0 20px rgba(255,30,30,0.7), 0 0 40px rgba(255,0,0,0.3)"
                    : "0 0 20px rgba(100,130,255,0.5), 0 0 40px rgba(100,130,255,0.2)",
                  letterSpacing: "0.01em",
                }}
                data-testid="page-title">
                {title}
              </h1>
              {badge && (
                <span className="text-[9px] font-black px-2 py-1 rounded-lg"
                  style={{
                    color: "#ff4444",
                    background: "rgba(255,0,0,0.15)",
                    border: "1px solid rgba(255,0,0,0.35)",
                    boxShadow: "0 0 8px rgba(255,0,0,0.2)",
                    textShadow: "0 0 6px rgba(255,0,0,0.6)",
                    letterSpacing: "0.15em",
                  }}>
                  {badge}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-sm mt-1 font-medium" style={{ color: "rgba(200,210,255,0.5)" }}>{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/* ─── Neon stat card ────────────────────────────────────────────────── */
export function StatCard({
  label, value, icon: Icon, color = "red", sublabel,
}: {
  label: string; value: string | number; icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color?: "red" | "green" | "amber" | "blue" | "purple" | "cyan";
  sublabel?: string;
}) {
  const C: Record<string, { hex: string; rgb: string }> = {
    red:    { hex: "#ff4444", rgb: "255,60,60" },
    green:  { hex: "#44ff88", rgb: "60,255,120" },
    amber:  { hex: "#ffaa22", rgb: "255,170,30" },
    blue:   { hex: "#4488ff", rgb: "60,130,255" },
    purple: { hex: "#aa44ff", rgb: "170,60,255" },
    cyan:   { hex: "#22ddff", rgb: "30,220,255" },
  };
  const c = C[color] ?? C.red;

  return (
    <div className="rounded-2xl p-4 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, rgba(${c.rgb},0.08) 0%, rgba(${c.rgb},0.03) 100%)`,
        border: `1px solid rgba(${c.rgb},0.2)`,
        boxShadow: `0 0 20px rgba(${c.rgb},0.06), inset 0 0 15px rgba(${c.rgb},0.03)`,
      }}>
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, rgba(${c.rgb},0.6) 50%, transparent)` }} />
      <div className="flex items-start justify-between">
        {Icon && (
          <div className="p-2 rounded-xl"
            style={{ background: `rgba(${c.rgb},0.12)`, border: `1px solid rgba(${c.rgb},0.25)` }}>
            <Icon style={{ width: 16, height: 16, color: c.hex, filter: `drop-shadow(0 0 5px ${c.hex})` }} />
          </div>
        )}
        <div className="text-right flex-1 ml-2">
          <p className="text-2xl font-black font-mono" style={{ color: c.hex, textShadow: `0 0 15px rgba(${c.rgb},0.7)` }}>
            {value}
          </p>
          <p className="text-[10px] font-bold mt-0.5" style={{ color: `rgba(${c.rgb},0.6)` }}>{label}</p>
          {sublabel && <p className="text-[9px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{sublabel}</p>}
        </div>
      </div>
    </div>
  );
}

/* ─── Section divider ───────────────────────────────────────────────── */
export function SectionDivider({ label, color = "#ff2222" }: { label: string; color?: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}44)` }} />
      <span className="text-[9px] font-black tracking-[0.25em] px-2"
        style={{ color: `${color}99`, textShadow: `0 0 8px ${color}55` }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${color}44, transparent)` }} />
    </div>
  );
}
