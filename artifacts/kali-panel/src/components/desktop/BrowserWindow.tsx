import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Globe, ExternalLink } from "lucide-react";

const API_BASE = "/api";

export function BrowserWindow({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [input, setInput] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [hidx, setHidx] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (initialUrl !== url) {
      navigate(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const proxied = (u: string) =>
    `${API_BASE}/proxy?url=${encodeURIComponent(u)}`;

  function navigate(target: string) {
    let t = target.trim();
    if (!t) return;
    if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
    setUrl(t);
    setInput(t);
    setHistory((h) => [...h.slice(0, hidx + 1), t]);
    setHidx((i) => i + 1);
  }

  function back() {
    if (hidx <= 0) return;
    const i = hidx - 1;
    setHidx(i);
    setUrl(history[i]);
    setInput(history[i]);
  }
  function forward() {
    if (hidx >= history.length - 1) return;
    const i = hidx + 1;
    setHidx(i);
    setUrl(history[i]);
    setInput(history[i]);
  }
  function reload() {
    if (iframeRef.current) iframeRef.current.src = proxied(url);
  }

  return (
    <div className="flex flex-col h-full" dir="ltr">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-primary/15 bg-card/60">
        <button
          onClick={back}
          disabled={hidx <= 0}
          className="w-7 h-7 grid place-items-center rounded hover:bg-primary/10 disabled:opacity-30"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={forward}
          disabled={hidx >= history.length - 1}
          className="w-7 h-7 grid place-items-center rounded hover:bg-primary/10 disabled:opacity-30"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={reload}
          className="w-7 h-7 grid place-items-center rounded hover:bg-primary/10"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center gap-2 flex-1 px-3 h-7 rounded-md bg-background/60 border border-primary/15 text-xs font-mono">
          <Globe className="w-3.5 h-3.5 text-primary" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate(input)}
            className="flex-1 bg-transparent outline-none"
            placeholder="https://example.com"
            data-testid="browser-url"
          />
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="w-7 h-7 grid place-items-center rounded hover:bg-primary/10"
          title="Open in real tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <iframe
        ref={iframeRef}
        src={proxied(url)}
        title="In-app browser"
        sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals"
        className="flex-1 w-full bg-white"
      />
    </div>
  );
}
