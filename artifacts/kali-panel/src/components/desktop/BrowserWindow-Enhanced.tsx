import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Globe, ExternalLink, Wifi, WifiOff, AlertTriangle } from "lucide-react";

const API_BASE = "/api";

// Pre-configured sites that work well with proxy
const PRESET_SITES = [
  { name: "DuckDuckGo", url: "https://duckduckgo.com", icon: "🦆" },
  { name: "Wikipedia", url: "https://en.wikipedia.org", icon: "📚" },
  { name: "GitHub", url: "https://github.com", icon: "🐙" },
  { name: "Stack Overflow", url: "https://stackoverflow.com", icon: "💻" },
  { name: "MDN Web Docs", url: "https://developer.mozilla.org", icon: "📖" },
  { name: "Hacker News", url: "https://news.ycombinator.com", icon: "🔥" },
];

export function BrowserWindow({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [input, setInput] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [hidx, setHidx] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<"checking" | "online" | "offline">("checking");
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (initialUrl !== url) {
      navigate(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const proxied = (u: string) =>
    `${API_BASE}/proxy?url=${encodeURIComponent(u)}`;

  const checkNetworkStatus = async () => {
    setNetworkStatus("checking");
    try {
      // Test with a simple site
      const response = await fetch(`${API_BASE}/proxy?url=https://duckduckgo.com`, {
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        setNetworkStatus("online");
        setError(null);
      } else {
        setNetworkStatus("offline");
        setError("Proxy not responding");
      }
    } catch (error) {
      setNetworkStatus("offline");
      setError("Network connection failed");
    }
  };

  function navigate(target: string) {
    let t = target.trim();
    if (!t) return;
    if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
    setUrl(t);
    setInput(t);
    setHistory((h) => [...h.slice(0, hidx + 1), t]);
    setHidx((i) => i + 1);
    setIsLoading(true);
    setError(null);
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
    setIsLoading(true);
    setError(null);
    if (iframeRef.current) {
      iframeRef.current.src = proxied(url);
    }
    checkNetworkStatus();
  }

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setError("Failed to load page. Try a different site or check network connection.");
  };

  useEffect(() => {
    checkNetworkStatus();
    const interval = setInterval(checkNetworkStatus, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full" dir="ltr">
      {/* Browser Toolbar */}
      <div className="flex flex-col gap-1 border-b border-primary/15 bg-card/60">
        {/* Status Bar */}
        <div className="flex items-center justify-between px-2 py-1 bg-muted/30">
          <div className="flex items-center gap-2">
            {networkStatus === "online" ? (
              <Wifi className="w-3 h-3 text-emerald-400" />
            ) : networkStatus === "offline" ? (
              <WifiOff className="w-3 h-3 text-red-400" />
            ) : (
              <RotateCw className="w-3 h-3 text-amber-400 animate-spin" />
            )}
            <span className="text-[9px] font-mono">
              {networkStatus === "online" ? "NET OK" : networkStatus === "offline" ? "NET OFFLINE" : "CHECKING"}
            </span>
          </div>
          
          {error && (
            <div className="flex items-center gap-1 text-[9px] text-red-400">
              <AlertTriangle className="w-3 h-3" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Navigation Bar */}
        <div className="flex items-center gap-1 px-2 py-1.5">
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
            disabled={isLoading}
            className="w-7 h-7 grid place-items-center rounded hover:bg-primary/10 disabled:opacity-50"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
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

        {/* Quick Access Sites */}
        <div className="flex items-center gap-1 px-2 py-1 overflow-x-auto">
          {PRESET_SITES.map((site) => (
            <button
              key={site.name}
              onClick={() => navigate(site.url)}
              className="flex items-center gap-1 px-2 py-1 text-[9px] bg-primary/10 hover:bg-primary/20 rounded transition whitespace-nowrap"
              title={site.url}
            >
              <span>{site.icon}</span>
              <span>{site.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RotateCw className="w-4 h-4 animate-spin" />
              <span>Loading...</span>
            </div>
          </div>
        )}
        
        {error && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/90 z-10">
            <div className="text-center p-6 max-w-md">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Network Error</h3>
              <p className="text-sm text-muted-foreground mb-4">{error}</p>
              <div className="space-y-2">
                <button
                  onClick={reload}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition"
                >
                  Retry
                </button>
                <div className="text-xs text-muted-foreground">
                  Try these sites instead:
                  <div className="flex flex-wrap gap-1 mt-1">
                    {PRESET_SITES.slice(0, 3).map((site) => (
                      <button
                        key={site.name}
                        onClick={() => navigate(site.url)}
                        className="px-2 py-1 bg-muted hover:bg-muted/80 rounded text-xs"
                      >
                        {site.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <iframe
          ref={iframeRef}
          src={proxied(url)}
          title="In-app browser"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals"
          className="flex-1 w-full bg-white"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
        />
      </div>
    </div>
  );
}
