import { useState, useEffect } from "react";
import { Wifi, WifiOff, Server, Globe, Activity, CheckCircle, XCircle } from "lucide-react";

interface NetworkStatus {
  online: boolean;
  apiConnected: boolean;
  ollamaConnected: boolean;
  latency?: number;
  lastChecked: string;
}

export default function NetworkStatusPanel() {
  const [status, setStatus] = useState<NetworkStatus>({
    online: navigator.onLine,
    apiConnected: false,
    ollamaConnected: false,
    lastChecked: new Date().toISOString(),
  });

  useEffect(() => {
    const checkNetworkStatus = async () => {
      const startTime = Date.now();
      
      try {
        // Check API connection
        let apiConnected = false;
        try {
          const apiResponse = await fetch("/api/health", { 
            signal: AbortSignal.timeout(3000) 
          });
          apiConnected = apiResponse.ok;
        } catch {
          apiConnected = false;
        }
        
        // Check Ollama connection
        const ollamaResponse = await fetch("http://127.0.0.1:11434/api/tags", { 
          signal: AbortSignal.timeout(3000) 
        });
        const ollamaConnected = ollamaResponse.ok;
        
        const latency = Date.now() - startTime;
        
        setStatus({
          online: navigator.onLine,
          apiConnected,
          ollamaConnected,
          latency,
          lastChecked: new Date().toISOString(),
        });
      } catch (error) {
        setStatus(prev => ({
          ...prev,
          online: navigator.onLine,
          apiConnected: false,
          ollamaConnected: false,
          lastChecked: new Date().toISOString(),
        }));
      }
    };

    // Initial check
    checkNetworkStatus();
    
    // Set up interval for periodic checks
    const interval = setInterval(checkNetworkStatus, 10000); // Check every 10 seconds
    
    // Listen for online/offline events
    const handleOnline = () => {
      setStatus(prev => ({ ...prev, online: true }));
      checkNetworkStatus();
    };
    
    const handleOffline = () => {
      setStatus(prev => ({ ...prev, online: false }));
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const getConnectionStatus = () => {
    if (!status.online) return { color: "text-red-400", text: "Offline" };
    if (status.apiConnected && status.ollamaConnected) return { color: "text-emerald-400", text: "Connected" };
    if (status.apiConnected || status.ollamaConnected) return { color: "text-amber-400", text: "Partial" };
    return { color: "text-red-400", text: "Disconnected" };
  };

  const connectionStatus = getConnectionStatus();

  return (
    <div className="absolute top-10 right-4 z-20 bg-card/90 backdrop-blur-md border border-primary/30 rounded-lg p-3 shadow-lg">
      <div className="flex items-center gap-3 mb-2">
        <Globe className="w-4 h-4 text-primary" />
        <span className="text-xs font-bold text-primary">Network Status</span>
      </div>
      
      <div className="space-y-2">
        {/* Overall Connection */}
        <div className="flex items-center gap-2">
          {status.online ? (
            <Wifi className="w-3 h-3 text-emerald-400" />
          ) : (
            <WifiOff className="w-3 h-3 text-red-400" />
          )}
          <span className={`text-[10px] font-mono ${connectionStatus.color}`}>
            {connectionStatus.text}
          </span>
        </div>

        {/* API Server */}
        <div className="flex items-center gap-2">
          <Server className="w-3 h-3 text-muted-foreground" />
          <span className="text-[9px] font-mono">API:</span>
          {status.apiConnected ? (
            <CheckCircle className="w-3 h-3 text-emerald-400" />
          ) : (
            <XCircle className="w-3 h-3 text-red-400" />
          )}
          <span className="text-[9px] font-mono text-muted-foreground">
            {status.apiConnected ? "Connected" : "Disconnected"}
          </span>
        </div>

        {/* Ollama Service */}
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-muted-foreground" />
          <span className="text-[9px] font-mono">Ollama:</span>
          {status.ollamaConnected ? (
            <CheckCircle className="w-3 h-3 text-emerald-400" />
          ) : (
            <XCircle className="w-3 h-3 text-red-400" />
          )}
          <span className="text-[9px] font-mono text-muted-foreground">
            {status.ollamaConnected ? "Connected" : "Disconnected"}
          </span>
        </div>

        {/* Latency */}
        {status.latency !== undefined && (
          <div className="text-[9px] text-muted-foreground font-mono">
            Latency: {status.latency}ms
          </div>
        )}

        {/* Last Checked */}
        <div className="text-[9px] text-muted-foreground font-mono">
          Last: {new Date(status.lastChecked).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
