/**
 * Toolbox — every tool the brain has, and where it really runs.
 *
 * The catalogue comes from `/api/nova-core/tools` (the same 33 tools the server
 * exposes; the static engine answers with the identical shape). Each row says
 * honestly whether the browser can run it now or whether it needs a server.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, Server, Terminal, Wrench } from "lucide-react";

interface ToolRow {
  name: string;
  title?: string;
  description?: string;
  category?: string;
  requiresServer?: boolean;
}

const LOCAL = new Set([
  "memory_search", "memory_list", "memory_save", "memory_stats", "knowledge_search", "cve_lookup",
  "corpus_stats", "platform_status", "mission_status", "dns_lookup", "github_search", "exploit_search",
  "web_fetch", "subdomain_enum", "nvd_search", "hash_text", "vuln_search", "kali_toolbox",
]);

export function NovaToolbox({ onUse }: { onUse?: (prompt: string) => void }) {
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/nova-core/tools")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const list = Array.isArray(j) ? j : (j?.tools ?? []);
        setTools(
          (list as Array<Record<string, unknown>>).map((t) => ({
            name: String(t.name ?? ""),
            title: t.title ? String(t.title) : undefined,
            description: t.description ? String(t.description) : undefined,
            category: t.category ? String(t.category) : undefined,
            requiresServer: Boolean(t.requiresServer),
          })),
        );
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter((t) => `${t.name} ${t.title ?? ""} ${t.description ?? ""} ${t.category ?? ""}`.toLowerCase().includes(needle));
  }, [tools, q]);

  const localCount = tools.filter((t) => !t.requiresServer && LOCAL.has(t.name)).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Wrench className="h-4 w-4 text-cyan-300" />
        <span className="text-[11px] font-black text-white/85">الأدوات</span>
        <span className="text-[8px] px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
          {localCount} شغّالة في المتصفح
        </span>
        <span className="text-[8px] px-1.5 py-0.5 rounded border border-white/15 bg-white/5 text-white/50">
          {Math.max(tools.length - localCount, 0)} محتاجة سيرفر
        </span>
        <div className="ms-auto relative">
          <Search className="h-3 w-3 absolute start-2 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث في الأدوات…"
            className="bg-black/60 border border-white/10 rounded-lg ps-7 pe-2 py-1 text-[9px] text-cyan-100 outline-none placeholder:text-white/25 w-40"
          />
        </div>
      </div>

      {err && <div className="text-[8.5px] text-red-300">تعذر تحميل الأدوات: {err}</div>}
      {!err && tools.length === 0 && <div className="text-[8.5px] text-white/40">بيحمّل الكتالوج…</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {filtered.map((t) => {
          const local = LOCAL.has(t.name) && !t.requiresServer;
          return (
            <div key={t.name} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-2.5 w-2.5 text-cyan-300/70" />
                <span className="text-[8.5px] font-mono text-white/80 truncate">{t.name}</span>
                <span
                  className={`ms-auto text-[6.5px] px-1 py-0.5 rounded border shrink-0 ${
                    local ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {local ? "متصفح" : <span className="inline-flex items-center gap-0.5"><Server className="h-2 w-2" /> سيرفر</span>}
                </span>
              </div>
              {t.title && <div className="text-[8px] text-white/60 mt-0.5">{t.title}</div>}
              {t.description && <div className="text-[7px] text-white/30 leading-snug mt-0.5 line-clamp-2">{t.description}</div>}
              {local && onUse && (
                <button
                  onClick={() => onUse(`استخدم ${t.name}: `)}
                  className="mt-1 text-[7px] px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
                >
                  جرّبها
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
