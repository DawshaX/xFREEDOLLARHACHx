import { useState } from "react";
import { Globe, Search, Loader2, FileText } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface FetchResult {
  status: number;
  contentType: string;
  text: string;
}

export default function WebSearch() {
  const [url, setUrl] = useState("https://example.com");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<FetchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    setBusy(true);
    setErr(null);
    try {
      const data = await jsonRequest<FetchResult>(
        `/fetch?url=${encodeURIComponent(u)}`,
      );
      setOut(data);
    } catch (e) {
      setErr(String(e));
      setOut(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="بحث الويب"
        subtitle="جلب أي صفحة ويب وتحويلها إلى نص — مفيد لقراءة استشارات أمنية و CVE"
        icon={Globe}
      />

      <div className="rounded-xl border border-primary/20 bg-card/60 p-4 flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="https://example.com/security-advisory"
          className="flex-1 min-w-[260px] bg-background/60 border border-primary/20 rounded px-3 py-2 text-sm outline-none font-mono"
          data-testid="ws-url"
        />
        <button
          onClick={go}
          disabled={busy}
          className="px-4 py-2 rounded bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-sm font-mono flex items-center gap-2 disabled:opacity-50"
          data-testid="ws-go"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          اجلب
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200 text-sm">
          ⚠ {err}
        </div>
      )}

      {out && (
        <div className="rounded-xl border border-primary/15 bg-card/60">
          <div className="px-4 py-2 border-b border-primary/15 flex items-center gap-3 text-xs font-mono">
            <FileText className="w-4 h-4 text-primary" />
            <span className="text-primary">HTTP {out.status}</span>
            <span className="text-muted-foreground">{out.contentType}</span>
            <span className="ml-auto text-muted-foreground">
              {out.text.length} حرف
            </span>
          </div>
          <pre className="p-4 text-xs whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-auto">
            {out.text}
          </pre>
        </div>
      )}
    </div>
  );
}
