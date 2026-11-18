/**
 * KaliContext — القلب الموحّد لنظام كالي في كل البرنامج
 * ───────────────────────────────────────────────────────
 * المشكلة: كل صفحة كانت تقيس كالي لوحدها (3 أماكن مختلفة بتسأل /api/ops/kali
 * و /api/kali-env/health و /api/ops/kali/nodes) — كل واحدة poll لوحدها،
 * والحالة مختلفة بينهم، والطرفية في صفحة مش شايفة اللي بيحصل في التانية.
 *
 * الحل: مصدر واحد للحقيقة — Context يقرأ كل شيء مرة واحدة ويبثه لكل الصفحات
 * عبر WebSocket + BroadcastChannel + localStorage. أي تنفيذ كالي في أي مكان
 * (kali-env, agent-pro, kali-terminal, live-agent) يظهر حيًا في كل الصفحات.
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { novaAuthHeaders } from "@/lib/ops-client";

// ─── Types ───────────────────────────────────────────────────────────────

export interface KaliStatus {
  present: boolean;
  prettyName?: string;
  packages?: number;
  executables?: number;
  builtAt?: string;
  root?: string | null;
  probe?: { ok: boolean; version?: string; detail?: string };
  desktop?: { running: boolean; vncPort: boolean; novncPort: boolean; desired: boolean };
  tools?: Record<string, { present: boolean; version?: string }>;
}

export interface KaliNode {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
  kali: boolean;
  mode: string;
  probed: boolean;
}

export interface KaliLiveExec {
  id: string;
  cmd: string;
  plane: string;
  running: boolean;
  startedAt: number;
  chunks: number;
  exitCode: number | null;
  durationMs: number | null;
  output: string[];
  source: string; // من أنهي صفحة/أداة اتنفذ
}

export interface KaliEnvHealth {
  ok: boolean;
  ready: boolean;
  prootBin: string | null;
  rootfs: string | null;
  guestShell: boolean;
  detail: string;
  fleet?: { connected: number; kaliReady: number };
  readyAnywhere?: boolean;
}

export interface KaliToolsGroups {
  ok: boolean;
  ready: boolean;
  groups: Record<string, { present: string[]; missing: string[] }>;
  total: number;
  present: number;
  measuredAt?: string;
  measuredOn?: string;
}

export interface KaliFileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "link";
  size: number;
  perms: string;
  modified: string;
}

export interface KaliProcess {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

export interface KaliNetworkConn {
  proto: string;
  local: string;
  remote: string;
  state: string;
  pid?: number;
}

interface KaliContextValue {
  // الحالة
  kaliStatus: KaliStatus | null;
  kaliHealth: KaliEnvHealth | null;
  kaliTools: KaliToolsGroups | null;
  nodes: KaliNode[];
  hubKali: { kali: boolean; packages: number } | null;
  liveExec: KaliLiveExec | null;
  execHistory: KaliLiveExec[];
  files: KaliFileEntry[];
  processes: KaliProcess[];
  network: KaliNetworkConn[];
  desktopUrl: string | null;
  isConnected: boolean;
  isLoading: boolean;
  lastUpdate: string | null;

  // الأفعال
  refresh: () => Promise<void>;
  exec: (cmd: string, opts?: { plane?: "auto" | "proot" | "node"; source?: string }) => Promise<{ exitCode: number | null; output: string }>;
  openDesktop: () => Promise<void>;
  closeDesktop: () => Promise<void>;
  browseFiles: (path: string) => Promise<void>;
  killProcess: (pid: number) => Promise<void>;
  installPackage: (pkg: string) => Promise<void>;
  clearHistory: () => void;
}

const KaliContext = createContext<KaliContextValue>({
  kaliStatus: null,
  kaliHealth: null,
  kaliTools: null,
  nodes: [],
  hubKali: null,
  liveExec: null,
  execHistory: [],
  files: [],
  processes: [],
  network: [],
  desktopUrl: null,
  isConnected: false,
  isLoading: true,
  lastUpdate: null,
  refresh: async () => {},
  exec: async () => ({ exitCode: null, output: "" }),
  openDesktop: async () => {},
  closeDesktop: async () => {},
  browseFiles: async () => {},
  killProcess: async () => {},
  installPackage: async () => {},
  clearHistory: () => {},
});

// ─── localStorage sync for cross-tab awareness ───────────────────────────
const LS_KALI_EXEC = "nova:kali:live-exec";
const LS_KALI_HISTORY = "nova:kali:history";

function saveLiveExec(exec: KaliLiveExec | null) {
  try {
    if (exec) localStorage.setItem(LS_KALI_EXEC, JSON.stringify(exec));
    else localStorage.removeItem(LS_KALI_EXEC);
  } catch {}
}

function saveHistory(history: KaliLiveExec[]) {
  try {
    localStorage.setItem(LS_KALI_HISTORY, JSON.stringify(history.slice(0, 50)));
  } catch {}
}

function loadHistory(): KaliLiveExec[] {
  try {
    const raw = localStorage.getItem(LS_KALI_HISTORY);
    if (raw) return JSON.parse(raw) as KaliLiveExec[];
  } catch {}
  return [];
}

// ─── Provider ────────────────────────────────────────────────────────────

export function KaliProvider({ children }: { children: ReactNode }) {
  const [kaliStatus, setKaliStatus] = useState<KaliStatus | null>(null);
  const [kaliHealth, setKaliHealth] = useState<KaliEnvHealth | null>(null);
  const [kaliTools, setKaliTools] = useState<KaliToolsGroups | null>(null);
  const [nodes, setNodes] = useState<KaliNode[]>([]);
  const [hubKali, setHubKali] = useState<{ kali: boolean; packages: number } | null>(null);
  const [liveExec, setLiveExec] = useState<KaliLiveExec | null>(null);
  const [execHistory, setExecHistory] = useState<KaliLiveExec[]>(() => loadHistory());
  const [files, setFiles] = useState<KaliFileEntry[]>([]);
  const [processes, setProcesses] = useState<KaliProcess[]>([]);
  const [network, setNetwork] = useState<KaliNetworkConn[]>([]);
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const isConnected = (hubKali?.kali === true) || (kaliHealth?.readyAnywhere === true) || nodes.some(n => n.kali);

  // ─── Refresh all Kali state ──────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      // Parallel fetch all Kali endpoints
      const [statusRes, healthRes, nodesRes] = await Promise.allSettled([
        fetch("/api/ops/kali", { headers: novaAuthHeaders() }),
        fetch("/api/kali-env/health", { headers: novaAuthHeaders(), signal: AbortSignal.timeout(10000) }),
        fetch("/api/ops/kali/nodes", { headers: novaAuthHeaders() }),
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value.ok) {
        const d = await statusRes.value.json() as { status: KaliStatus; desktopUrl?: string | null };
        setKaliStatus(d.status);
        setDesktopUrl(d.desktopUrl ?? null);
      }

      if (healthRes.status === "fulfilled" && healthRes.value.ok) {
        const h = await healthRes.value.json() as KaliEnvHealth;
        setKaliHealth(h);
      }

      if (nodesRes.status === "fulfilled" && nodesRes.value.ok) {
        const n = await nodesRes.value.json() as { nodes: KaliNode[]; hub: { kali: boolean; packages: number } };
        setNodes(n.nodes ?? []);
        setHubKali(n.hub ?? null);
      }

      setLastUpdate(new Date().toISOString());
    } catch {
      // offline - keep last known state
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─── Exec with live broadcast ────────────────────────────────────────
  const exec = useCallback(async (cmd: string, opts?: { plane?: "auto" | "proot" | "node"; source?: string }): Promise<{ exitCode: number | null; output: string }> => {
    if (!cmd.trim()) return { exitCode: null, output: "" };

    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startExec: KaliLiveExec = {
      id: execId,
      cmd: cmd.trim(),
      plane: opts?.plane ?? "auto",
      running: true,
      startedAt: Date.now(),
      chunks: 0,
      exitCode: null,
      durationMs: null,
      output: [`$ ${cmd}`],
      source: opts?.source ?? "kali-context",
    };

    setLiveExec(startExec);
    saveLiveExec(startExec);

    // Broadcast start to all tabs via BroadcastChannel
    try {
      const bc = new BroadcastChannel("nova:kali:exec");
      bc.postMessage({ type: "kali:exec:start", exec: startExec });
      bc.close();
    } catch {}

    // Broadcast via WebSocket hub
    try {
      window.dispatchEvent(new CustomEvent("nova:kali:exec:start", { detail: startExec }));
    } catch {}

    return new Promise((resolve) => {
      let fullOutput = "";
      const plane = opts?.plane ?? "auto";

      // Choose execution path
      const useNode = plane === "node" || (plane === "auto" && kaliHealth?.ready !== true);
      const url = useNode
        ? `/api/ops/kali/exec-stream?command=${encodeURIComponent(cmd)}&timeout=120000`
        : `/api/kali-env/exec`;

      if (useNode) {
        // SSE via EventSource for node execution
        const es = new EventSource(url);
        let exitCode: number | null = null;

        es.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data) as { type: string; text?: string; exitCode?: number | null; durationMs?: number; plane?: string };
            if (d.type === "stdout" && d.text) {
              fullOutput += d.text + "\n";
              setLiveExec(prev => prev ? { ...prev, output: [...prev.output, d.text as string], chunks: prev.chunks + 1 } : prev);
            } else if (d.type === "stderr" && d.text) {
              fullOutput += d.text + "\n";
              setLiveExec(prev => prev ? { ...prev, output: [...prev.output, d.text as string], chunks: prev.chunks + 1 } : prev);
            } else if (d.type === "done") {
              exitCode = d.exitCode ?? 0;
              const durationMs = d.durationMs ?? Date.now() - startExec.startedAt;
              const final: KaliLiveExec = {
                ...startExec,
                plane: d.plane ?? startExec.plane,
                running: false,
                exitCode,
                durationMs,
                output: [...startExec.output, fullOutput],
              };
              setLiveExec(final);
              setExecHistory(prev => {
                const next = [final, ...prev].slice(0, 50);
                saveHistory(next);
                return next;
              });
              saveLiveExec(null);
              try {
                const bc = new BroadcastChannel("nova:kali:exec");
                bc.postMessage({ type: "kali:exec:done", exec: final });
                bc.close();
              } catch {}
              window.dispatchEvent(new CustomEvent("nova:kali:exec:done", { detail: final }));
              es.close();
              resolve({ exitCode, output: fullOutput });
            }
          } catch {}
        };
        es.onerror = () => {
          es.close();
          const final: KaliLiveExec = { ...startExec, running: false, exitCode: null, durationMs: Date.now() - startExec.startedAt };
          setLiveExec(final);
          saveLiveExec(null);
          resolve({ exitCode: null, output: fullOutput || "فشل الاتصال بالسيرفر" });
        };
      } else {
        // POST to /api/kali-env/exec with SSE response
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
          body: JSON.stringify({ command: cmd, timeoutMs: 120000 }),
        }).then(async (r) => {
          if (!r.ok || !r.body) {
            const t = await r.text().catch(() => "");
            const final: KaliLiveExec = { ...startExec, running: false, exitCode: null, output: [...startExec.output, `⚠ ${r.status}: ${t.slice(0, 200)}`] };
            setLiveExec(final);
            resolve({ exitCode: null, output: t });
            return;
          }
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          let exitCode: number | null = null;
          let durationMs: number | null = null;

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const frames = buf.split("\n\n");
            buf = frames.pop() ?? "";
            for (const f of frames) {
              const line = f.split("\n").find(l => l.startsWith("data: "));
              if (!line) continue;
              const raw = line.slice(6);
              if (raw === "[DONE]") continue;
              try {
                const d = JSON.parse(raw) as { type?: string; text?: string; exitCode?: number | null; durationMs?: number };
                if ((d.type === "stdout" || d.type === "stderr") && d.text) {
                  fullOutput += d.text + "\n";
                  setLiveExec(prev => prev ? { ...prev, output: [...prev.output, d.text as string], chunks: prev.chunks + 1 } : prev);
                } else if (d.type === "done") {
                  exitCode = d.exitCode ?? 0;
                  durationMs = d.durationMs ?? Date.now() - startExec.startedAt;
                }
              } catch {}
            }
          }
          const final: KaliLiveExec = {
            ...startExec,
            running: false,
            exitCode,
            durationMs: durationMs ?? Date.now() - startExec.startedAt,
            output: [...startExec.output, fullOutput],
          };
          setLiveExec(final);
          setExecHistory(prev => {
            const next = [final, ...prev].slice(0, 50);
            saveHistory(next);
            return next;
          });
          saveLiveExec(null);
          try {
            const bc = new BroadcastChannel("nova:kali:exec");
            bc.postMessage({ type: "kali:exec:done", exec: final });
            bc.close();
          } catch {}
          window.dispatchEvent(new CustomEvent("nova:kali:exec:done", { detail: final }));
          resolve({ exitCode, output: fullOutput });
        }).catch((e) => {
          const final: KaliLiveExec = { ...startExec, running: false, exitCode: null, output: [...startExec.output, String(e)] };
          setLiveExec(final);
          resolve({ exitCode: null, output: String(e) });
        });
      }
    });
  }, [kaliHealth]);

  const openDesktop = useCallback(async () => {
    const r = await fetch("/api/ops/kali/desktop", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
      body: JSON.stringify({ action: "start" }),
    });
    await refresh();

  }, [refresh]);

  const closeDesktop = useCallback(async () => {
    const r = await fetch("/api/ops/kali/desktop", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
      body: JSON.stringify({ action: "stop" }),
    });
    await refresh();


}, [refresh]);

  const browseFiles = useCallback(async (path: string) => {
    try {
      const r = await fetch(`/api/ops/kali/files?path=${encodeURIComponent(path)}`, { headers: novaAuthHeaders() });
      if (r.ok) {
        const d = await r.json() as { files: KaliFileEntry[] };
        setFiles(d.files);
      }
    } catch {}
  }, []);

  const killProcess = useCallback(async (pid: number) => {
    await exec(`kill -9 ${pid}`, { source: "process-killer" });
    // Refresh processes after kill
    try {
      const r = await fetch("/api/ops/kali/processes", { headers: novaAuthHeaders() });
      if (r.ok) {
        const d = await r.json() as { processes: KaliProcess[] };
        setProcesses(d.processes);
      }
    } catch {}
  }, [exec]);

  const installPackage = useCallback(async (pkg: string) => {
    await exec(`apt update && apt install -y ${pkg}`, { source: "package-installer" });
  }, [exec]);

  const clearHistory = useCallback(() => {
    setExecHistory([]);
    saveHistory([]);
    try { localStorage.removeItem(LS_KALI_HISTORY); } catch {}
  }, []);

  // ─── Initial load + polling ────────────────────────────────────────
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 15000);
    return () => clearInterval(iv);
  }, [refresh]);

  // ─── Cross-tab sync via BroadcastChannel ───────────────────────────
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("nova:kali:exec");
      bc.onmessage = (ev) => {
        const d = ev.data as { type: string; exec: KaliLiveExec };
        if (d.type === "kali:exec:start") {
          setLiveExec(d.exec);
        } else if (d.type === "kali:exec:done") {
          setLiveExec(d.exec);
          setExecHistory(prev => {
            if (prev.some(p => p.id === d.exec.id)) return prev;
            const next = [d.exec, ...prev].slice(0, 50);
            saveHistory(next);
            return next;
          });
        }
      };
    } catch {}
    return () => { try { bc?.close(); } catch {} };
  }, []);

  // ─── WebSocket events ──────────────────────────────────────────────
  useEffect(() => {
    const onKaliEvent = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as KaliLiveExec;
      if (detail?.id) {
        if (detail.running) setLiveExec(detail);
        else {
          setLiveExec(detail);
          setExecHistory(prev => {
            if (prev.some(p => p.id === detail.id)) return prev;
            const next = [detail, ...prev].slice(0, 50);
            saveHistory(next);
            return next;
          });
        }
      }
    };
    window.addEventListener("nova:kali:exec:start", onKaliEvent as EventListener);
    window.addEventListener("nova:kali:exec:done", onKaliEvent as EventListener);

    // Listen to any kali execution from anywhere (via ws-hub broadcast)
    const onWsMessage = (ev: Event) => {
      const d = (ev as CustomEvent).detail as { type?: string; [k: string]: unknown };
      if (d?.type === "kali_exec_start" || d?.type === "kali:exec:start") {
        const exec = d as unknown as KaliLiveExec;
        if (exec.cmd) setLiveExec(exec);
      } else if (d?.type === "kali_exec_done" || d?.type === "kali:exec:done") {
        const exec = d as unknown as KaliLiveExec;
        if (exec.cmd) {
          setLiveExec(exec);
          setExecHistory(prev => {
            if (prev.some(p => p.id === exec.id)) return prev;
            const next = [exec, ...prev].slice(0, 50);
            saveHistory(next);
            return next;
          });
        }
      }
    };
    window.addEventListener("nova:ws:message", onWsMessage as EventListener);

    return () => {
      window.removeEventListener("nova:kali:exec:start", onKaliEvent as EventListener);
      window.removeEventListener("nova:kali:exec:done", onKaliEvent as EventListener);
      window.removeEventListener("nova:ws:message", onWsMessage as EventListener);
    };
  }, []);

  return (
    <KaliContext.Provider value={{
      kaliStatus, kaliHealth, kaliTools, nodes, hubKali, liveExec, execHistory,
      files, processes, network, desktopUrl, isConnected, isLoading, lastUpdate,
      refresh, exec, openDesktop, closeDesktop, browseFiles, killProcess, installPackage, clearHistory,
    }}>
      {children}
    </KaliContext.Provider>
  );
}

export function useKali() {
  return useContext(KaliContext);
}

export function useKaliExec() {
  const { liveExec, execHistory, exec, isConnected } = useContext(KaliContext);
  return { liveExec, execHistory, exec, isConnected };
}
