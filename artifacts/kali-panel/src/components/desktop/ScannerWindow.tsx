import { useEffect, useState } from "react";
import { jsonRequest } from "@/lib/sse";
import { ScanLine, ShieldAlert, ShieldCheck } from "lucide-react";

interface ScanResult {
  target: string;
  dns?: Record<string, string[]>;
  ports?: Array<{ port: number; open: boolean }>;
  ssl?: Record<string, unknown>;
  headers?: { present?: string[]; missing?: string[]; raw?: Record<string, string> };
  subdomains?: Array<{ subdomain: string; ips: string[] }>;
  directories?: Array<{ path: string; status: number }>;
  cve_hint?: string[];
}

export function ScannerWindow({ initialTarget }: { initialTarget?: string }) {
  const [target, setTarget] = useState(initialTarget ?? "example.com");
  const [opts, setOpts] = useState({
    dns: true,
    ports: true,
    ssl: true,
    headers: true,
    cve: true,
    subdomains: false,
    directories: false,
  });
  const [phase, setPhase] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const ranInitial = useState({ done: false })[0];

  async function start() {
    if (!target.trim() || busy) return;
    setBusy(true);
    setResult(null);
    setPhase("scanning…");
    try {
      const r = await jsonRequest<ScanResult>("/scan/full", {
        method: "POST",
        body: JSON.stringify({ target: target.trim(), options: opts }),
      });
      setResult(r);
      setPhase("done");
    } catch (e) {
      setPhase(`failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialTarget && !ranInitial.done) {
      ranInitial.done = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTarget]);

  const openPorts = (result?.ports ?? []).filter((p) => p.open);
  const missingHdr = result?.headers?.missing ?? [];

  return (
    <div className="p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="example.com or 1.2.3.4"
          className="flex-1 bg-background/60 border border-primary/20 rounded px-3 py-1.5 outline-none font-mono text-xs"
          data-testid="scanner-target"
        />
        <button
          onClick={start}
          disabled={busy}
          className="px-4 py-1.5 rounded bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-xs font-mono disabled:opacity-50"
          data-testid="scanner-start"
        >
          {busy ? "…" : "Start scan"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] font-mono">
        {(Object.keys(opts) as Array<keyof typeof opts>).map((k) => (
          <label
            key={k}
            className={`px-2 py-0.5 rounded border cursor-pointer ${
              opts[k]
                ? "bg-primary/20 border-primary/40 text-primary"
                : "border-border/40 text-muted-foreground"
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={opts[k]}
              onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })}
            />
            {k}
          </label>
        ))}
      </div>
      {phase && (
        <div className="text-[11px] font-mono text-primary/70">{phase}</div>
      )}
      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat
              label="open ports"
              value={String(openPorts.length)}
              ok={openPorts.length < 4}
            />
            <Stat
              label="missing hdrs"
              value={String(missingHdr.length)}
              ok={missingHdr.length === 0}
            />
            <Stat
              label="subdomains"
              value={String((result.subdomains ?? []).length)}
              ok
            />
            <Stat
              label="cve hints"
              value={String((result.cve_hint ?? []).length)}
              ok={(result.cve_hint ?? []).length === 0}
            />
          </div>
          {openPorts.length > 0 && (
            <Section title="Open ports">
              {openPorts.map((p) => (
                <div key={p.port} className="font-mono text-xs text-emerald-300">
                  • {p.port}/tcp
                </div>
              ))}
            </Section>
          )}
          {missingHdr.length > 0 && (
            <Section title="Missing security headers">
              {missingHdr.map((h) => (
                <div key={h} className="font-mono text-xs text-amber-300">
                  • {h}
                </div>
              ))}
            </Section>
          )}
          {result.dns && (
            <Section title="DNS">
              <pre className="text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(result.dns, null, 2)}
              </pre>
            </Section>
          )}
          {result.ssl && (
            <Section title="SSL/TLS">
              <pre className="text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(result.ssl, null, 2)}
              </pre>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <div className="rounded-lg border border-primary/20 bg-card/50 p-2 flex items-center gap-2">
      <Icon className={`w-4 h-4 ${ok ? "text-emerald-400" : "text-amber-400"}`} />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="font-mono text-base">{value}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-primary/15 bg-card/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-primary/80 mb-2 flex items-center gap-2">
        <ScanLine className="w-3 h-3" />
        {title}
      </div>
      {children}
    </div>
  );
}
