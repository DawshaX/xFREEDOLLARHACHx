import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface WindowState {
  id: string; title: string; icon?: ReactNode;
  x: number; y: number; w: number; h: number; z: number;
  minimized: boolean; maximized: boolean;
  snapped?: "left"|"right"|"top"|"bottom-left"|"bottom-right"|"top-left"|"top-right"|null;
}

interface SpringState { pos: number; vel: number; target: number; }
function stepSpring(s: SpringState, dt: number, k = 200, d = 26): SpringState {
  const x = s.pos - s.target;
  const force = -k * x - d * s.vel;
  const vel = s.vel + force * dt;
  return { pos: s.pos + vel * dt, vel, target: s.target };
}

type SnapZone = "left"|"right"|"top"|"bottom-left"|"bottom-right"|"top-left"|"top-right"|null;
// Snap zones: only corners + top-maximise (NO left/right side snapping)
const T = 24;
function getSnapZone(cx: number, cy: number, _winW: number): SnapZone {
  const W = window.innerWidth, H = window.innerHeight;
  if (cx < T && cy < T)           return "top-left";
  if (cx > W - T && cy < T)       return "top-right";
  if (cx < T && cy > H - T)       return "bottom-left";
  if (cx > W - T && cy > H - T)   return "bottom-right";
  // left/right side snap DISABLED — user doesn't want forced half-screen
  // if (cx < T)                  return "left";
  // if (cx > W - T)              return "right";
  if (cy < T)                     return "top";
  return null;
}
function getSnapPos(zone: SnapZone) {
  const SW = window.innerWidth / 2, SH = window.innerHeight / 2;
  const W = window.innerWidth,      H  = window.innerHeight;
  switch (zone) {
    case "left":         return { x: 0,    y: 0,    w: SW, h: H  };
    case "right":        return { x: SW,   y: 0,    w: SW, h: H  };
    case "top":          return { x: 0,    y: 0,    w: W,  h: SH };
    case "top-left":     return { x: 0,    y: 0,    w: SW, h: SH };
    case "top-right":    return { x: SW,   y: 0,    w: SW, h: SH };
    case "bottom-left":  return { x: 0,    y: SH,   w: SW, h: SH };
    case "bottom-right": return { x: SW,   y: SH,   w: SW, h: SH };
    default:             return null;
  }
}

// ── Traffic Light Button ──────────────────────────────────────────────────────
function TrafficBtn({
  bg, shadow, hoverBg, symbol, onClick, title
}: {
  bg: string; shadow: string; hoverBg: string; symbol: string;
  onClick: () => void; title: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 14, height: 14, borderRadius: "50%", border: "none",
        background: hov ? hoverBg : bg, cursor: "pointer",
        boxShadow: hov ? `0 0 12px ${shadow}, 0 0 4px ${shadow}` : `0 0 6px ${shadow}60`,
        transition: "all 0.12s", display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}
    >
      {hov && (
        <span style={{
          fontSize: 9, fontWeight: 900, lineHeight: 1, color: "rgba(0,0,0,0.7)",
          position: "absolute", userSelect: "none", pointerEvents: "none",
        }}>{symbol}</span>
      )}
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function DraggableWindow({
  state, children, onClose, onFocus, onMinimize, onMaximize, onMove, onResize,
}: {
  state: WindowState; children: ReactNode;
  onClose:()=>void; onFocus:()=>void; onMinimize:()=>void; onMaximize:()=>void;
  onMove:(x:number,y:number)=>void; onResize:(w:number,h:number)=>void;
}) {
  const wrapRef       = useRef<HTMLDivElement>(null);
  const snapRef       = useRef<SnapZone>(null);
  const overlayRef    = useRef<HTMLDivElement>(null);
  const springX       = useRef<SpringState>({ pos: state.x, vel: 0, target: state.x });
  const springY       = useRef<SpringState>({ pos: state.y, vel: 0, target: state.y });
  const animRef       = useRef(0);
  const drag          = useRef({ active:false, sx:0,sy:0,ox:0,oy:0, vx:0,vy:0, lx:0,ly:0 });

  const applyXY = useCallback((x: number, y: number) => {
    if (!wrapRef.current) return;
    wrapRef.current.style.transform = state.maximized
      ? "translate3d(0,0,0)"
      : `translate3d(${x}px,${y}px,0)`;
  }, [state.maximized]);

  const runSpring = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    const tick = () => {
      springX.current = stepSpring(springX.current, 1/60);
      springY.current = stepSpring(springY.current, 1/60);
      applyXY(springX.current.pos, springY.current.pos);
      const rx = Math.abs(springX.current.pos - springX.current.target) < 0.3 && Math.abs(springX.current.vel) < 0.3;
      const ry = Math.abs(springY.current.pos - springY.current.target) < 0.3 && Math.abs(springY.current.vel) < 0.3;
      if (!rx || !ry) animRef.current = requestAnimationFrame(tick);
      else onMove(Math.round(springX.current.target), Math.round(springY.current.target));
    };
    animRef.current = requestAnimationFrame(tick);
  }, [applyXY, onMove]);

  useLayoutEffect(() => {
    applyXY(state.x, state.y);
    springX.current = { pos: state.x, vel: 0, target: state.x };
    springY.current = { pos: state.y, vel: 0, target: state.y };
  }, [state.x, state.y, state.maximized, applyXY]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const onHdrDown = useCallback((e: React.PointerEvent) => {
    if (state.maximized || e.button !== 0) return;
    // Don't intercept traffic-light button clicks
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = drag.current;
    d.active = true; d.sx = e.clientX; d.sy = e.clientY;
    d.ox = state.x;  d.oy = state.y;
    d.vx = 0; d.vy = 0; d.lx = e.clientX; d.ly = e.clientY;
    onFocus();
  }, [state.maximized, state.x, state.y, onFocus]);

  const onHdrMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    d.vx = e.clientX - d.lx; d.vy = e.clientY - d.ly;
    d.lx = e.clientX; d.ly = e.clientY;
    const nx = d.ox + (e.clientX - d.sx);
    const ny = Math.max(0, d.oy + (e.clientY - d.sy));
    applyXY(nx, ny);
    springX.current = { pos: nx, vel: d.vx * 60, target: nx };
    springY.current = { pos: ny, vel: d.vy * 60, target: ny };
    const zone = getSnapZone(e.clientX, e.clientY, state.w);
    snapRef.current = zone;
    if (overlayRef.current) {
      const p = zone ? getSnapPos(zone) : null;
      if (p) {
        Object.assign(overlayRef.current.style, {
          display: "block", left: p.x + "px", top: p.y + "px",
          width: p.w + "px", height: p.h + "px",
        });
      } else { overlayRef.current.style.display = "none"; }
    }
  }, [applyXY, state.w]);

  const onHdrUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (overlayRef.current) overlayRef.current.style.display = "none";
    const zone = snapRef.current; snapRef.current = null;
    const nx = d.ox + (e.clientX - d.sx);
    const ny = Math.max(0, d.oy + (e.clientY - d.sy));
    if (zone) {
      const p = getSnapPos(zone);
      if (p) { onMove(p.x, p.y); onResize(p.w, p.h); return; }
    }
    const ovX = nx + d.vx * 5, ovY = ny + d.vy * 5;
    springX.current = { pos: nx, vel: d.vx * 60, target: ovX };
    springY.current = { pos: ny, vel: d.vy * 60, target: ovY };
    setTimeout(() => { springX.current.target = nx; springY.current.target = ny; }, 120);
    runSpring(); onMove(nx, ny);
  }, [onMove, onResize, runSpring]);

  const onRzDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, sw = state.w, sh = state.h;
    const onM = (ev: PointerEvent) => onResize(Math.max(80, sw + ev.clientX - sx), Math.max(60, sh + ev.clientY - sy));
    const onU = () => { window.removeEventListener("pointermove", onM); window.removeEventListener("pointerup", onU); };
    window.addEventListener("pointermove", onM); window.addEventListener("pointerup", onU);
  }, [state.w, state.h, onResize]);

  if (state.minimized) return null;

  const gpuStyle: React.CSSProperties = state.maximized
    ? { position:"absolute", left:0, top:0, width:"100%", height:"100%", zIndex: state.z }
    : {
        position: "absolute", left: 0, top: 0,
        width: state.w, height: state.h, zIndex: state.z,
        willChange: "transform",
        transform: `translate3d(${state.x}px,${state.y}px,0)`,
        backfaceVisibility: "hidden",
      };

  const isFocused = true;

  return (
    <>
      {/* Snap preview overlay */}
      <div ref={overlayRef} style={{
        display:"none", position:"fixed", zIndex:9998, pointerEvents:"none",
        background:"rgba(0,255,180,0.03)",
        border:"2px solid rgba(0,255,180,0.4)",
        borderRadius:24, backdropFilter:"blur(8px)",
        boxShadow:"inset 0 0 80px rgba(0,255,180,0.06), 0 0 40px rgba(0,255,180,0.12)",
        transition:"all 0.1s ease",
      }} />

      <div ref={wrapRef} onPointerDown={onFocus} style={gpuStyle}>
        {/* Outer glow ring */}
        <div style={{
          width:"100%", height:"100%", borderRadius:16, overflow:"hidden",
          border:`1px solid ${isFocused ? "rgba(0,255,180,0.22)" : "rgba(255,255,255,0.07)"}`,
          background:"rgba(4,5,16,0.97)",
          backdropFilter:"blur(32px) saturate(180%)",
          boxShadow: isFocused
            ? "0 0 0 1px rgba(0,255,180,0.06), 0 0 60px rgba(0,255,180,0.04), 0 28px 90px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.04)"
            : "0 16px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.02)",
          display:"flex", flexDirection:"column",
          transition:"border-color 0.2s, box-shadow 0.2s",
        }}>

          {/* ── Title Bar ────────────────────────────────────────────────── */}
          <div
            style={{
              height: 44, padding: "0 12px",
              display: "flex", alignItems: "center", gap: 10,
              background: "linear-gradient(90deg, rgba(0,255,180,0.06) 0%, rgba(0,255,180,0.02) 40%, transparent 100%)",
              borderBottom: "1px solid rgba(0,255,180,0.1)",
              cursor: state.maximized ? "default" : "grab",
              userSelect: "none", touchAction: "none", flexShrink: 0,
              position: "relative",
            }}
            onPointerDown={onHdrDown}
            onPointerMove={onHdrMove}
            onPointerUp={onHdrUp}
            onPointerCancel={onHdrUp}
            onDoubleClick={onMaximize}
          >
            {/* Accent line at top of title bar */}
            <div style={{
              position:"absolute", top:0, left:0, right:0, height:1,
              background:"linear-gradient(90deg, transparent, rgba(0,255,180,0.4) 30%, rgba(0,255,180,0.6) 50%, rgba(0,255,180,0.4) 70%, transparent)",
            }} />

            {/* ── Traffic Lights ── */}
            <div style={{ display:"flex", gap:7, alignItems:"center", flexShrink:0 }}>
              <TrafficBtn bg="#ff3b30" shadow="#ff3b30" hoverBg="#ff3b30" symbol="✕" onClick={onClose}    title="إغلاق النافذة" />
              <TrafficBtn bg="#ffcc00" shadow="#ffcc00" hoverBg="#ffcc00" symbol="─" onClick={onMinimize} title="تصغير إلى الشريط" />
              <TrafficBtn bg="#28c840" shadow="#28c840" hoverBg="#28c840" symbol="⊞" onClick={onMaximize} title="تكبير / استعادة" />
            </div>

            {/* ── Title + Icon ── */}
            <div style={{
              flex: 1, display:"flex", alignItems:"center", justifyContent:"center",
              gap: 6, pointerEvents:"none", overflow:"hidden",
            }}>
              {state.icon && (
                <span style={{
                  display:"flex", alignItems:"center",
                  color:"rgba(0,255,180,0.7)",
                  filter:"drop-shadow(0 0 4px rgba(0,255,180,0.5))",
                }}>{state.icon}</span>
              )}
              <span style={{
                fontSize: 11, fontFamily: "monospace",
                color: "rgba(0,255,180,0.75)", fontWeight: 800,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                letterSpacing:"0.06em", textShadow:"0 0 12px rgba(0,255,180,0.4)",
              }}>{state.title}</span>
            </div>

            {/* ── Window Size (right) ── */}
            {!state.maximized && (
              <div style={{
                fontSize:9, fontFamily:"monospace",
                color:"rgba(0,255,180,0.25)", flexShrink:0,
                letterSpacing:"0.04em",
              }}>{state.w}×{state.h}</div>
            )}

            {/* ── Maximize badge ── */}
            {state.maximized && (
              <div style={{
                fontSize:9, fontFamily:"monospace", color:"rgba(0,255,180,0.4)",
                background:"rgba(0,255,180,0.08)", border:"1px solid rgba(0,255,180,0.2)",
                borderRadius:4, padding:"1px 6px", flexShrink:0,
              }}>FULL</div>
            )}
          </div>

          {/* ── Content ────────────────────────────────────────────────────── */}
          <div style={{
            flex:1, overflow:"auto", background:"rgba(3,4,14,0.5)", position:"relative",
          }}>
            {children}
          </div>

          {/* ── Status bar ─────────────────────────────────────────────────── */}
          <div style={{
            height:18, display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"0 10px", background:"rgba(0,0,0,0.3)",
            borderTop:"1px solid rgba(0,255,180,0.06)", flexShrink:0,
          }}>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:"#00ffb4", boxShadow:"0 0 4px #00ffb4" }} />
              <span style={{ fontSize:8, fontFamily:"monospace", color:"rgba(0,255,180,0.35)", letterSpacing:"0.08em" }}>
                CYBERNOVA · {state.title.toUpperCase()}
              </span>
            </div>
            <span style={{ fontSize:8, fontFamily:"monospace", color:"rgba(255,255,255,0.15)" }}>
              {state.maximized ? "MAXIMIZED" : `${state.w}×${state.h}`}
            </span>
          </div>

          {/* ── Resize handle ──────────────────────────────────────────────── */}
          {!state.maximized && (
            <div onPointerDown={onRzDown}
              style={{
                position:"absolute", bottom:0, right:0,
                width:24, height:24, cursor:"se-resize",
                display:"flex", alignItems:"flex-end", justifyContent:"flex-end",
                padding:5, zIndex:1,
              }}>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M1 11L11 1M5 11L11 5M9 11L11 9" stroke="rgba(0,255,180,0.35)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
