import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Play, Plus, RefreshCw, Trash2, FileText, Copy, Check, Terminal } from "lucide-react";
import { novaAuthHeaders } from "@/lib/ops-client";

/**
 * مكان الشغل في كالي — Workspaces
 * ───────────────────────────────────────────────────────────────────────────────
 * «اعملي مكان للشغل في كالي» — اللي كان موجود: طرفية أمر واحد بينتهي، ومافيش
 * مكان يفضل فيه شغل. الكومبوننت ده بيعرض المساحات الحقيقية اللي الـAPI بيرجّعها
 * من على الدسك جوه كالي (`/root/nova-workspaces/<slug>`)، وبيخلي المستخدم:
 *
 *   • يعمل مساحة باسم (بتتولد slug آمن — مافيش مسارات بتتكوّن من نص المستخدم)
 *   • يشغّل أوامر **جوه** المساحة، فمخرجات nmap/nuclei/ffuf بتنزل فيها وبتفضل
 *   • يفتح أي ملف نتيجة ويقراه جوه البرنامج
 *   • ياخد أمر جاهز يفتح نفس المساحة في طرفية على جهازه
 *
 * كل رقم/ملف هنا جاي من GET /api/kali-env/workspaces — مافيش ادعاء. لو المساحة
 * اتمسحت من برّه، الليستة بتقول كده في أول تحديث. والـ«حديث» بيحصل تلقائي بعد
 * كل أمر بينجح، مش بوعود.
 */

type WsFile = { name: string; rel: string; bytes: number; mtime: string; kind: "dir" | "file" };
type Ws = {
  slug: string;
  name: string;
  guestPath: string;
  createdAt: string;
  updatedAt: string;
  files: WsFile[];
  fileCount: number;
  dirBytes: number;
  history: { cmd: string; at: string; exitCode: number | null; ms: number }[];
};
type RunResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  newFiles: string[];
  workspace: Ws | null;
  error?: string;
};

const API = "/api";

function human(b: number): string {
  if (!b) return "0";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

const SUGGESTIONS = [
  { label: "استطلاع هدف", cmd: "echo target\\ >\\ target.txt; cat target.txt", hint: "سجّل الهدف الأول" },
  { label: "فحص منافذ (nmap)", cmd: "nmap -sV -T4 --top-ports 100 -oA scans/nmap-top 127.0.0.1", hint: "بيحفظ scans/nmap-top.*" },
  { label: "فحص ويب (nuclei)", cmd: "nuclei -u https://example.com -severity critical,high -o scans/nuclei.txt", hint: "بيحفظ scans/nuclei.txt" },
  { label: "تعداد مسارات (ffuf)", cmd: "ffuf -u https://example.com/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -o scans/ffuf.json -of json", hint: "بيحفظ scans/ffuf.json" },
  { label: "اللي في المساحة", cmd: "pwd && ls -la && echo '---' && du -sh .", hint: "تشوف شغلك كله" },
];

export default function KaliWorkspacePanel() {
  const [list, setList] = useState<Ws[]>([]);
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [ws, setWs] = useState<Ws | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [run, setRun] = useState<RunResult | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [openFile, setOpenFile] = useState<{ rel: string; text: string; bytes: number; truncated: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [shellCmd, setShellCmd] = useState<string | null>(null);
  const outRef = useRef<HTMLPreElement>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-env/workspaces`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(15_000) });
      const j = await r.json();
      setList(Array.isArray(j.workspaces) ? j.workspaces : []);
      setReady(Boolean(j.ready));
      setErr(j.ok === false ? j.error ?? "فشل" : null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  const loadOne = useCallback(async (slug: string) => {
    try {
      const r = await fetch(`${API}/kali-env/workspaces/${encodeURIComponent(slug)}`, {
        headers: novaAuthHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      const j = await r.json();
      if (j.ok) setWs(j.workspace as Ws);
      else setErr(j.error ?? "مش موجودة");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (sel) void loadOne(sel);
    else setWs(null);
  }, [sel, loadOne]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API}/kali-env/workspaces`, {
        method: "POST",
        headers: { "content-type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ name: name.trim() }),
      });
      const j = await r.json();
      if (!j.ok) setErr(j.error ?? "فشل الإنشاء");
      else {
        setName("");
        await loadList();
        setSel(j.workspace.slug);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slug: string) => {
    if (!confirm(`تمسح مساحة «${slug}» وكل ملفاتها من الدسك؟`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/kali-env/workspaces/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: novaAuthHeaders(),
      });
      const j = await r.json();
      if (!j.ok) setErr(j.error ?? "فشل المسح");
      if (sel === slug) {
        setSel(null);
        setRun(null);
      }
      await loadList();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exec = async (command?: string) => {
    const c = (command ?? cmd).trim();
    if (!c || !sel || runBusy) return;
    setRunBusy(true);
    setRun(null);
    setErr(null);
    setOpenFile(null);
    try {
      const r = await fetch(`${API}/kali-env/workspaces/${encodeURIComponent(sel)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ command: c }),
        signal: AbortSignal.timeout(900_000),
      });
      const j = (await r.json()) as RunResult & { error?: string };
      setRun(j);
      if (j.workspace) setWs(j.workspace);
      else await loadOne(sel);
      await loadList();
      if (command) setCmd(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunBusy(false);
    }
  };

  const open = async (rel: string) => {
    if (!sel) return;
    try {
      const r = await fetch(`${API}/kali-env/workspaces/${encodeURIComponent(sel)}/file?path=${encodeURIComponent(rel)}`, {
        headers: novaAuthHeaders(),
        signal: AbortSignal.timeout(20_000),
      });
      const j = await r.json();
      if (!j.ok) setErr(j.error ?? "مش قادر أقرا الملف");
      else setOpenFile(j);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const shell = async () => {
    if (!sel) return;
    try {
      const r = await fetch(`${API}/kali-env/workspaces/${encodeURIComponent(sel)}/shell`, { headers: novaAuthHeaders() });
      const j = await r.json();
      if (j.ok) setShellCmd(j.commands.local as string);
      else setErr(j.error ?? "مش قادر أبني الأمر");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard محجوب — المستخدم ينسخ يدوي من العرض */
    }
  };

  const box = "rounded-lg p-2.5";
  const boxStyle = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" };

  return (
    <div className="space-y-3" dir="rtl">
      <div className={box} style={boxStyle}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[11px] font-black" style={{ color: "#ff8866" }}>
            <FolderOpen size={13} className="inline ml-1" /> مكان الشغل في كالي — مساحات حقيقية على الدسك
          </div>
          <button type="button" onClick={() => void loadList()} className="text-[9px] px-2 py-0.5 rounded"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}>
            <RefreshCw size={10} className="inline" /> تحديث
          </button>
        </div>
        <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          كل مساحة مجلد جوه كالي نفسه: <code style={{ color: "#8fd" }}>/root/nova-workspaces/&lt;اسم&gt;</code> — الملفات بتفضل بعد ما تقفل الصفحة، وبتفضل بعد إعادة تشغيل السيرفر.
          {!ready && list.length === 0 && (
            <div className="mt-1 px-2 py-1 rounded" style={{ background: "rgba(255,170,0,0.12)", color: "#fc9" }}>
              بيئة كالي لسه بتتجهّز — المساحات بتفتح أول ما الـrootfs يخلص.
            </div>
          )}
        </div>
        {err && <div className="mt-1 text-[9px] px-2 py-1 rounded" style={{ background: "rgba(255,60,60,0.14)", color: "#f99" }}>{err}</div>}

        <div className="flex gap-1.5 mt-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder="اسم مساحة جديدة (مثال: web-audit · pwn-lab · bugbounty)"
            className="flex-1 text-[10px] px-2 py-1 rounded bg-black/40 outline-none"
            style={{ border: "1px solid rgba(255,255,255,0.15)", color: "#fff" }}
          />
          <button type="button" onClick={() => void create()} disabled={busy || !name.trim()}
            className="text-[10px] font-black px-2.5 py-1 rounded disabled:opacity-40"
            style={{ background: "rgba(255,85,68,0.2)", color: "#ff8866", border: "1px solid rgba(255,85,68,0.5)" }}>
            <Plus size={11} className="inline" /> اعمل
          </button>
        </div>

        {list.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {list.map((w) => (
              <div key={w.slug} className="flex items-center gap-1 rounded px-2 py-1"
                style={{
                  background: sel === w.slug ? "rgba(255,85,68,0.18)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${sel === w.slug ? "rgba(255,85,68,0.5)" : "rgba(255,255,255,0.12)"}`,
                }}>
                <button type="button" onClick={() => setSel(w.slug)} className="text-[10px] font-bold" style={{ color: sel === w.slug ? "#ff8866" : "#ddd" }}>
                  {w.slug}
                </button>
                <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.45)" }}>{w.fileCount} ملف · {human(w.dirBytes)}</span>
                <button type="button" onClick={() => void remove(w.slug)} className="opacity-50 hover:opacity-100" title="امسح المساحة">
                  <Trash2 size={9} style={{ color: "#f77" }} />
                </button>
              </div>
            ))}
          </div>
        )}
        {list.length === 0 && ready && (
          <div className="mt-2 text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>
            مافيش مساحات لسه — اكتب اسم فوق واعمل أول مساحة. بتتجهّز فيها مجلدات scans/loot/payloads/reports/scripts/notes جاهزة.
          </div>
        )}
      </div>

      {sel && ws && (
        <>
          <div className={box} style={boxStyle}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-black" style={{ color: "#8fd" }}>
                <Terminal size={11} className="inline ml-1" /> {ws.slug} — نفّذ جوه المساحة
              </div>
              <button type="button" onClick={() => void shell()} className="text-[9px] px-2 py-0.5 rounded"
                style={{ background: "rgba(140,255,220,0.1)", color: "#8fd" }}>
                أمر طرفية لجهازي
              </button>
            </div>
            <div className="text-[8px] mb-1.5" style={{ color: "rgba(255,255,255,0.45)" }}>
              الأمر بيتنفذ في <code style={{ color: "#8fd" }}>{ws.guestPath}</code> — أي ملف بيكتبه بيظهر تحت ويفضل محفوظ.
            </div>
            <div className="flex gap-1.5">
              <input
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void exec()}
                placeholder="nmap -sV -T4 -oA scans/nmap 10.0.0.1"
                className="flex-1 text-[10px] px-2 py-1 rounded bg-black/50 outline-none font-mono"
                style={{ border: "1px solid rgba(255,255,255,0.15)", color: "#8fd" }}
                dir="ltr"
              />
              <button type="button" onClick={() => void exec()} disabled={runBusy || !cmd.trim()}
                className="text-[10px] font-black px-3 py-1 rounded disabled:opacity-40"
                style={{ background: "rgba(140,255,220,0.15)", color: "#8fd", border: "1px solid rgba(140,255,220,0.4)" }}>
                {runBusy ? <RefreshCw size={11} className="inline animate-spin" /> : <Play size={11} className="inline" />} نفّذ
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {SUGGESTIONS.map((s) => (
                <button key={s.label} type="button" onClick={() => void exec(s.cmd)} disabled={runBusy}
                  title={s.hint} className="text-[8px] px-1.5 py-0.5 rounded disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {s.label}
                </button>
              ))}
            </div>

            {shellCmd && (
              <div className="mt-2 rounded p-2" style={{ background: "rgba(140,255,220,0.06)", border: "1px solid rgba(140,255,220,0.25)" }}>
                <div className="text-[8px] mb-1" style={{ color: "#8fd" }}>الصق ده في طرفية على جهازك — بيفتح نفس المساحة:</div>
                <div className="flex gap-1 items-start">
                  <code className="flex-1 text-[8px] break-all" dir="ltr" style={{ color: "#ddd" }}>{shellCmd}</code>
                  <button type="button" onClick={() => void copy(shellCmd, "shell")} className="shrink-0">
                    {copied === "shell" ? <Check size={10} style={{ color: "#8fd" }} /> : <Copy size={10} style={{ color: "#aaa" }} />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {(run || runBusy) && (
            <div className={box} style={boxStyle}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-black" style={{ color: run?.ok ? "#8fd" : "#f99" }}>
                  {runBusy ? "بيتنفذ..." : run?.ok ? `✓ خلص في ${(run.ms / 1000).toFixed(1)}ث` : `✗ كود ${run?.exitCode ?? "?"} في ${((run?.ms ?? 0) / 1000).toFixed(1)}ث`}
                </div>
                {run && run.newFiles.length > 0 && (
                  <div className="text-[8px]" style={{ color: "#fc9" }}>{run.newFiles.length} ملف جديد نزل في المساحة</div>
                )}
              </div>
              {run?.error && <div className="text-[9px] mb-1 px-2 py-1 rounded" style={{ background: "rgba(255,60,60,0.14)", color: "#f99" }}>{run.error}</div>}
              {run && (
                <pre ref={outRef} className="text-[9px] p-2 rounded overflow-auto max-h-64 font-mono whitespace-pre-wrap"
                  dir="ltr" style={{ background: "rgba(0,0,0,0.55)", color: "#cfe", margin: 0 }}>
                  {run.stdout || "(مفيش مخرجات على stdout)"}
                  {run.stderr ? `\n[stderr]\n${run.stderr}` : ""}
                </pre>
              )}
              {run && run.newFiles.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {run.newFiles.map((f) => (
                    <button key={f} type="button" onClick={() => void open(f)} className="text-[8px] px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(255,200,100,0.12)", color: "#fc9", border: "1px solid rgba(255,200,100,0.3)" }}>
                      <FileText size={8} className="inline" /> {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {openFile && (
            <div className={box} style={boxStyle}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-black" style={{ color: "#fc9" }}><FileText size={10} className="inline ml-1" /> {openFile.rel}</div>
                <div className="text-[8px]" style={{ color: "rgba(255,255,255,0.45)" }}>
                  {human(openFile.bytes)}{openFile.truncated ? " · معروض أول 512KB" : ""}
                </div>
              </div>
              <pre className="text-[9px] p-2 rounded overflow-auto max-h-72 font-mono whitespace-pre-wrap"
                dir="ltr" style={{ background: "rgba(0,0,0,0.55)", color: "#cfe", margin: 0 }}>
                {openFile.text || "(ملف غير نصي — مش معروض)"}
              </pre>
            </div>
          )}

          <div className={box} style={boxStyle}>
            <div className="text-[10px] font-black mb-1" style={{ color: "rgba(255,255,255,0.8)" }}>
              <FolderOpen size={10} className="inline ml-1" /> ملفات المساحة ({ws.fileCount})
            </div>
            {ws.files.length === 0 && <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>فاضية — نفّذ أمر فوق يكتب فيها.</div>}
            <div className="space-y-0.5 max-h-56 overflow-auto">
              {ws.files.map((f) => (
                <div key={f.rel} className="flex items-center gap-1.5 text-[9px]" style={{ paddingRight: f.rel.split("/").length > 1 ? 8 : 0 }}>
                  {f.kind === "dir" ? (
                    <span style={{ color: "#fc9" }}>📁 {f.name}/</span>
                  ) : (
                    <button type="button" onClick={() => void open(f.rel)} className="truncate text-right" style={{ color: "#8fd" }}>
                      📄 {f.rel}
                    </button>
                  )}
                  {f.kind === "file" && <span className="shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>{human(f.bytes)}</span>}
                </div>
              ))}
            </div>
            {ws.history.length > 0 && (
              <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[9px] font-bold mb-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>آخر الأوامر (محفوظة على الدسك)</div>
                {ws.history.slice(0, 6).map((h, i) => (
                  <div key={`${h.at}-${i}`} className="text-[8px] font-mono truncate" dir="ltr"
                    style={{ color: h.exitCode === 0 ? "rgba(140,255,220,0.7)" : "rgba(255,140,140,0.7)" }}>
                    [{h.exitCode ?? "?"}] {h.cmd}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
