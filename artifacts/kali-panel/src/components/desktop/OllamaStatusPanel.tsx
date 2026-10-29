import { useState, useEffect } from "react";
import { Cpu, Wifi, WifiOff, CheckCircle, XCircle, Loader2, Zap, AlertTriangle } from "lucide-react";
import { probeOllamaViaServer, getStoredOllamaModel, type OllamaProbeResult } from "@/lib/ollama-browser";

export default function OllamaStatusPanel() {
  const [result, setResult] = useState<OllamaProbeResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const model = getStoredOllamaModel();

  useEffect(() => {
    let mounted = true;
    const probe = async () => {
      const r = await probeOllamaViaServer();
      if (!mounted) return;
      setResult(r);
      setIsLoading(false);
    };
    void probe();
    const t = setInterval(() => void probe(), 30_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const connected = result?.connected ?? false;
  const runningNoCors = result?.runningButNoCors ?? false;
  const notRunning = result?.notRunning ?? false;
  const isOnline = navigator.onLine;

  const statusColor = isLoading ? "white/20" : connected ? "emerald-400" : runningNoCors ? "yellow-400" : "red-500";
  const iconColor = connected ? "text-emerald-400" : runningNoCors ? "text-yellow-400" : "text-red-400";

  return (
    <div className="bg-card/90 backdrop-blur-md border border-primary/30 rounded-lg px-3 py-2 shadow-lg min-w-[140px]">
      <div className="flex items-center gap-2 mb-1.5">
        <Cpu className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Ollama</span>
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />
        ) : connected ? (
          <CheckCircle className="w-3 h-3 text-emerald-400 ml-auto" />
        ) : runningNoCors ? (
          <AlertTriangle className="w-3 h-3 text-yellow-400 ml-auto" />
        ) : (
          <XCircle className={`w-3 h-3 ${iconColor} ml-auto`} />
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 bg-${statusColor} ${connected ? "animate-pulse" : ""}`} />
          <span className="text-[9px] font-mono text-muted-foreground truncate">
            {isLoading
              ? "جارٍ الفحص..."
              : connected
              ? `${model} · متصل`
              : runningNoCors
              ? "شغّال — CORS مطلوب"
              : "غير شغّال"}
          </span>
        </div>

        {connected && result?.models && result.models.length > 0 && (
          <div className="flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 text-emerald-400" />
            <span className="text-[8px] font-mono text-emerald-400/70">{result.models.length} models</span>
          </div>
        )}

        {runningNoCors && (
          <div className="text-[7px] text-yellow-400/80 font-mono leading-tight" style={{ userSelect: "text" }}>
            OLLAMA_ORIGINS="*" ollama serve
          </div>
        )}

        {notRunning && !isLoading && (
          <div className="text-[7px] text-red-400/70 font-mono leading-tight">
            شغّل: ollama serve
          </div>
        )}

        <div className="flex items-center gap-1.5 pt-0.5 border-t border-primary/10">
          {isOnline ? <Wifi className="w-2.5 h-2.5 text-emerald-400" /> : <WifiOff className="w-2.5 h-2.5 text-red-400" />}
          <span className="text-[9px] font-mono text-muted-foreground">{isOnline ? "Net OK" : "No Network"}</span>
        </div>
      </div>
    </div>
  );
}
