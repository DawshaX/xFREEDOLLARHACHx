import { useState } from "react";
import { Github, Search, Loader2, Star, Code2 } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface GhItem {
  id?: number;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  forks_count?: number;
  updated_at?: string;
}

export default function GithubSearch() {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"repositories" | "code">("repositories");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<GhItem[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const data = await jsonRequest<{ items?: GhItem[]; total_count?: number; message?: string }>(
        `/github/search?q=${encodeURIComponent(q)}&type=${type}&per_page=20`,
      );
      if (data.message) setErr(data.message);
      setItems(data.items || []);
      setTotal(data.total_count || 0);
    } catch (e) {
      setErr(String(e));
      setItems([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="GitHub Search"
        subtitle="بحث حقيقي في GitHub — مستودعات وكود (PoCs، أدوات، تمبليت)"
        icon={Github}
      />

      <div className="rounded-xl border border-primary/20 bg-card/60 p-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="مثال: nuclei templates CVE-2024"
          className="flex-1 min-w-[260px] bg-background/60 border border-primary/20 rounded px-3 py-2 text-sm outline-none"
          data-testid="gh-q"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "repositories" | "code")}
          className="bg-background/60 border border-primary/20 rounded px-3 py-2 text-sm outline-none"
        >
          <option value="repositories">Repositories</option>
          <option value="code">Code</option>
        </select>
        <button
          onClick={search}
          disabled={busy}
          className="px-4 py-2 rounded bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-sm font-mono flex items-center gap-2 disabled:opacity-50"
          data-testid="gh-search"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          ابحث
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200 text-sm">
          ⚠ {err}
        </div>
      )}

      {total > 0 && (
        <div className="text-xs font-mono text-muted-foreground">
          {total.toLocaleString()} نتيجة إجمالية — عرض {items.length}
        </div>
      )}

      <div className="grid gap-2">
        {items.length === 0 && !busy && (
          <div className="text-center text-muted-foreground text-sm py-12">
            اكتب أي مصطلح للبحث في GitHub
          </div>
        )}
        {items.map((r) => (
          <a
            key={r.id ?? r.full_name}
            href={r.html_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-primary/15 bg-card/60 p-3 hover:border-primary/40 transition"
          >
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-primary" />
              <div className="text-sm font-mono text-primary">{r.full_name}</div>
              <div className="ml-auto flex items-center gap-3 text-xs font-mono text-muted-foreground">
                {typeof r.stargazers_count === "number" && (
                  <span className="flex items-center gap-1">
                    <Star className="w-3 h-3 text-amber-400" />
                    {r.stargazers_count}
                  </span>
                )}
                {r.language && (
                  <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {r.language}
                  </span>
                )}
              </div>
            </div>
            {r.description && (
              <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {r.description}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
