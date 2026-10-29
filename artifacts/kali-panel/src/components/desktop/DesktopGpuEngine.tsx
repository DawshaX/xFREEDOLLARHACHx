/**
 * CYBERNOVA DESKTOP GPU ENGINE
 * Extracted from cybernova_desktop_engine v2.0
 * Provides: WebGL particle canvas, spring physics, FPS governor, performance monitor
 */
import { useCallback, useEffect, useRef, useState } from "react";

// ── Frame rate governor ───────────────────────────────────────────────────────
class FrameGovernor {
  private samples: number[] = [];
  private last = 0;
  private _fps = 60;
  private _budget = 16.67;
  tick(now: number) {
    if (this.last) {
      const dt = now - this.last;
      this.samples.push(dt);
      if (this.samples.length > 30) this.samples.shift();
      const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
      this._fps = Math.round(1000 / avg);
      this._budget = avg;
    }
    this.last = now;
  }
  get fps() { return this._fps; }
  get frameTime() { return this._budget; }
  get isThrottled() { return this._fps < 45; }
  get qualityScale() {
    if (this._fps >= 58) return 1;
    if (this._fps >= 45) return 0.75;
    if (this._fps >= 30) return 0.5;
    return 0.3;
  }
}
export const governor = new FrameGovernor();

// ── GPU tier detection ────────────────────────────────────────────────────────
export function detectGpuTier(): "high" | "mid" | "low" {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "low";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "mid";
    const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).toLowerCase() as string;
    if (r.includes("nvidia")||r.includes("radeon")||r.includes("apple m")||r.includes("geforce")||r.includes("rtx")) return "high";
    if (r.includes("intel")||r.includes("adreno")||r.includes("mali")) return "mid";
    return "low";
  } catch { return "mid"; }
}

// ── Spring physics hook ───────────────────────────────────────────────────────
interface SpringState { pos: number; vel: number; target: number; }
function stepSpring(s: SpringState, dt: number, k=200, d=22): SpringState {
  const x = s.pos - s.target;
  const vel = s.vel + (-k*x - d*s.vel)*dt;
  return { pos: s.pos + vel*dt, vel, target: s.target };
}
export function useSpringValue(initial: number, k=200, d=22): [number, (t:number)=>void] {
  const stateRef = useRef<SpringState>({ pos:initial, vel:0, target:initial });
  const [value, setValue] = useState(initial);
  const rafRef = useRef(0);
  const animate = useCallback(() => {
    const now = performance.now(); governor.tick(now);
    const dt = Math.min(governor.frameTime/1000, 0.05);
    const next = stepSpring(stateRef.current, dt, k, d);
    stateRef.current = next; setValue(next.pos);
    if (Math.abs(next.pos-next.target)>0.1||Math.abs(next.vel)>0.1)
      rafRef.current = requestAnimationFrame(animate);
  }, [k, d]);
  const setTarget = useCallback((t:number)=>{
    stateRef.current = {...stateRef.current, target:t};
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);
  useEffect(()=>()=>cancelAnimationFrame(rafRef.current), []);
  return [value, setTarget];
}

// ── WebGL Shaders ─────────────────────────────────────────────────────────────
const VERT = `attribute vec2 a_pos;attribute float a_size;attribute vec4 a_color;varying vec4 v_color;void main(){gl_Position=vec4(a_pos,0.,1.);gl_PointSize=a_size;v_color=a_color;}`;
const FRAG = `precision mediump float;varying vec4 v_color;void main(){float d=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.2,d);gl_FragColor=vec4(v_color.rgb,v_color.a*a);}`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader|null {
  const s = gl.createShader(type); if (!s) return null;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
  return s;
}
function mkProgram(gl: WebGLRenderingContext): WebGLProgram|null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs||!fs) return null;
  const p = gl.createProgram(); if (!p) return null;
  gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p);
  return gl.getProgramParameter(p,gl.LINK_STATUS) ? p : null;
}

// ── GPU Particle Canvas (WebGL + Canvas2D fallback) ───────────────────────────
export function GpuParticleCanvas({
  count, color="0,212,255", speed=0.35, connectionDist=110,
}: {
  count?:number; color?:string; speed?:number; connectionDist?:number;
}) {
  const glRef   = useRef<HTMLCanvasElement>(null);
  const c2dRef  = useRef<HTMLCanvasElement>(null);
  const rafRef  = useRef(0);

  useEffect(() => {
    const glC = glRef.current, c2C = c2dRef.current;
    if (!glC||!c2C) return;
    const tier = detectGpuTier();
    const N = count ?? (tier==="high"?140:tier==="mid"?80:45);
    const gl = glC.getContext("webgl",{alpha:true,antialias:false,powerPreference:"high-performance"}) as WebGLRenderingContext|null;
    const prog = gl ? mkProgram(gl) : null;
    let posLoc=-1,colorLoc=-1,sizeLoc=-1;
    let posB: WebGLBuffer|null=null, colorB: WebGLBuffer|null=null, sizeB: WebGLBuffer|null=null;
    if (gl&&prog) {
      gl.useProgram(prog);
      posLoc=gl.getAttribLocation(prog,"a_pos"); colorLoc=gl.getAttribLocation(prog,"a_color"); sizeLoc=gl.getAttribLocation(prog,"a_size");
      posB=gl.createBuffer(); colorB=gl.createBuffer(); sizeB=gl.createBuffer();
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    }
    const c2d = c2C.getContext("2d");
    const [r,g,b] = color.split(",").map(Number);
    type Pt = {x:number;y:number;vx:number;vy:number;r:number;a:number;hue:number};
    let pts: Pt[] = [];
    const posData=new Float32Array(N*2), colorData=new Float32Array(N*4), sizeData=new Float32Array(N);

    const resize = () => {
      const rect = glC.parentElement!.getBoundingClientRect();
      const W=rect.width, H=rect.height;
      glC.width=W; glC.height=H; c2C.width=W; c2C.height=H;
      if (gl) gl.viewport(0,0,W,H);
      pts = Array.from({length:N},()=>({
        x:Math.random()*W, y:Math.random()*H,
        vx:(Math.random()-.5)*speed, vy:(Math.random()-.5)*speed,
        r:Math.random()*2+.5, a:Math.random()*.55+.1, hue:Math.random()*30-15,
      }));
    };
    const ro = new ResizeObserver(resize); ro.observe(glC.parentElement!); resize();

    const draw = (now:number) => {
      governor.tick(now);
      const W=glC.width, H=glC.height, qs=governor.qualityScale;
      for (let i=0;i<pts.length;i++) {
        const p=pts[i]; p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=W; if(p.x>W)p.x=0; if(p.y<0)p.y=H; if(p.y>H)p.y=0;
        posData[i*2]=(p.x/W)*2-1; posData[i*2+1]=1-(p.y/H)*2;
        colorData[i*4]=(r+p.hue*.3)/255; colorData[i*4+1]=(g+p.hue*.2)/255;
        colorData[i*4+2]=(b+p.hue*.1)/255; colorData[i*4+3]=p.a*qs;
        sizeData[i]=p.r*2.8*qs;
      }
      if (gl&&prog) {
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER,posB); gl.bufferData(gl.ARRAY_BUFFER,posData,gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc,2,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,colorB!); gl.bufferData(gl.ARRAY_BUFFER,colorData,gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(colorLoc); gl.vertexAttribPointer(colorLoc,4,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,sizeB!); gl.bufferData(gl.ARRAY_BUFFER,sizeData,gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(sizeLoc); gl.vertexAttribPointer(sizeLoc,1,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.POINTS,0,pts.length);
      }
      if (c2d) {
        c2d.clearRect(0,0,W,H);
        const maxL = governor.isThrottled ? Math.floor(pts.length*.4) : pts.length;
        for (let i=0;i<maxL;i++) for (let j=i+1;j<maxL;j++) {
          const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.hypot(dx,dy);
          if (d<connectionDist) {
            c2d.beginPath(); c2d.moveTo(pts[i].x,pts[i].y); c2d.lineTo(pts[j].x,pts[j].y);
            c2d.strokeStyle=`rgba(${color},${(1-d/connectionDist)*.18*qs})`; c2d.lineWidth=.5; c2d.stroke();
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current); ro.disconnect();
      if (gl) { gl.deleteProgram(prog); gl.deleteBuffer(posB); gl.deleteBuffer(colorB); gl.deleteBuffer(sizeB); }
    };
  }, [color, connectionDist, count, speed]);

  return (
    <div style={{ position:"absolute", inset:0, pointerEvents:"none", isolation:"isolate" }}>
      <canvas ref={glRef}  style={{ position:"absolute",inset:0,width:"100%",height:"100%",opacity:.65,mixBlendMode:"screen" }} />
      <canvas ref={c2dRef} style={{ position:"absolute",inset:0,width:"100%",height:"100%",mixBlendMode:"screen" }} />
    </div>
  );
}

// ── FPS Mini Graph ────────────────────────────────────────────────────────────
function FpsGraph({ fps }: { fps: number }) {
  const hist = useRef<number[]>(Array(30).fill(60));
  hist.current.push(fps); hist.current.shift();
  const pts = hist.current.map((v,i)=>`${(i/29)*100}% ${100-(v/60)*100}%`).join(", ");
  const col = fps>=50?"#00ff88":"#ffcc00";
  return (
    <div style={{ width:"100%",height:28,background:"rgba(255,255,255,0.02)",borderRadius:6,overflow:"hidden",border:"1px solid rgba(255,255,255,0.05)",position:"relative" }}>
      <svg style={{ position:"absolute",inset:0,width:"100%",height:"100%" }} preserveAspectRatio="none">
        <defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity=".5"/><stop offset="100%" stopColor={col} stopOpacity=".02"/></linearGradient></defs>
        <polygon points={`0 100%, ${pts}, 100% 100%`} fill="url(#fg)"/>
        <polyline points={pts} fill="none" stroke={col} strokeWidth="1"/>
      </svg>
    </div>
  );
}

// ── Performance Monitor (Ctrl+Shift+P) ────────────────────────────────────────
export function PerformanceMonitor({ particleCount=0, activeWindows=0 }: { particleCount?:number; activeWindows?:number }) {
  const [stats, setStats] = useState({ fps:60, ft:16.67, tier:"mid" as "high"|"mid"|"low", qs:100 });
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const tier = detectGpuTier();
    let raf=0;
    const tick=(now:number)=>{ governor.tick(now); setStats({fps:governor.fps,ft:+governor.frameTime.toFixed(1),tier,qs:Math.round(governor.qualityScale*100)}); raf=requestAnimationFrame(tick); };
    raf=requestAnimationFrame(tick); return ()=>cancelAnimationFrame(raf);
  }, []);
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{ if(e.ctrlKey&&e.shiftKey&&e.key==="P") setVis(v=>!v); };
    window.addEventListener("keydown",h); return ()=>window.removeEventListener("keydown",h);
  },[]);
  const fCol = stats.fps>=55?"#00ff88":stats.fps>=40?"#ffcc00":"#ff4444";
  if (!vis) return (
    <button onClick={()=>setVis(true)} style={{
      position:"fixed",top:56,left:4,zIndex:9999,fontSize:9,fontFamily:"monospace",
      background:"rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.08)",
      borderRadius:6,padding:"2px 6px",color:fCol,cursor:"pointer",
    }}>{stats.fps}fps</button>
  );
  return (
    <div style={{
      position:"fixed",top:56,left:4,zIndex:9999,
      background:"rgba(4,4,12,0.92)",backdropFilter:"blur(20px)",
      border:"1px solid rgba(0,212,255,0.15)",borderRadius:14,
      padding:12,fontFamily:"monospace",fontSize:10,minWidth:160,
      boxShadow:"0 8px 40px rgba(0,0,0,0.7)",
    }}>
      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
        <span style={{ color:"rgba(0,212,255,0.8)",fontWeight:900,fontSize:11 }}>⚡ GPU ENGINE</span>
        <button onClick={()=>setVis(false)} style={{ background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:11 }}>✕</button>
      </div>
      {([
        ["FPS",`${stats.fps}`,fCol],["Frame",`${stats.ft}ms`,"rgba(255,255,255,0.7)"],
        ["GPU",stats.tier.toUpperCase(),stats.tier==="high"?"#00ff88":stats.tier==="mid"?"#ffcc00":"#ff4444"],
        ["Quality",`${stats.qs}%`,"rgba(255,255,255,0.5)"],
        ["Particles",`${particleCount}`,"#00d4ff"],["Windows",`${activeWindows}`,"#aa44ff"],
      ] as [string,string,string][]).map(([k,v,c])=>(
        <div key={k} style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
          <span style={{ color:"rgba(255,255,255,0.35)" }}>{k}</span>
          <span style={{ color:c,fontWeight:700 }}>{v}</span>
        </div>
      ))}
      <FpsGraph fps={stats.fps}/>
      <div style={{ color:"rgba(255,255,255,0.15)",fontSize:8,marginTop:6 }}>Ctrl+Shift+P to toggle</div>
    </div>
  );
}
