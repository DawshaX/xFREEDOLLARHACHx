import { useState, useEffect } from "react";
import { Wifi, WifiOff, Server, Globe, Activity, CheckCircle, XCircle, RefreshCw } from "lucide-react";

interface NetworkStatus {
  online: boolean;
  apiConnected: boolean;
  ollamaConnected: boolean;
  latency?: number;
  lastChecked: string;
  apiError?: string;
  ollamaError?: string;
}

export default function NetworkStatusPanelFixed() {
  const [status, setStatus] = useState<NetworkStatus>({
    online: navigator.onLine,
    apiConnected: false,
    ollamaConnected: false,
    lastChecked: new Date().toISOString(),
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkNetworkStatus = async () => {
    setIsRefreshing(true);
    const startTime = Date.now();
    
    try {
      // Check API connection - try multiple endpoints
      let apiConnected = false;
      let apiError = "";
      
      // Try health endpoint first
      try {
        const healthResponse = await fetch("/api/health", { 
          signal: AbortSignal.timeout(5000) 
        });
        if (healthResponse.ok) {
          apiConnected = true;
        } else {
          apiError = `Health: ${healthResponse.status}`;
        }
      } catch (error) {
        apiError = "Health endpoint failed";
        
        // Try alternative endpoint
        try {
          const processesResponse = await fetch("/api/processes", { 
            signal: AbortSignal.timeout(3000) 
          });
          if (processesResponse.ok) {
            apiConnected = true;
            apiError = "";
          } else {
            apiError = `Processes: ${processesResponse.status}`;
          }
        } catch (error2) {
          apiError = "All endpoints failed";
        }
      }
      
      // Check Ollama connection
      let ollamaConnected = false;
      let ollamaError = "";
      
      try {
        const ollamaResponse = await fetch("http://127.0.0.1:11434/api/tags", { 
          signal: AbortSignal.timeout(5000) 
        });
        if (ollamaResponse.ok) {
          ollamaConnected = true;
        } else {
          ollamaError = `Ollama: ${ollamaResponse.status}`;
        }
      } catch (error) {
        ollamaError = error instanceof Error ? error.message : "Connection failed";
      }
      
      const latency = Date.now() - startTime;
      
      setStatus({
        online: navigator.onLine,
        apiConnected,
        ollamaConnected,
        latency,
        lastChecked: new Date().toISOString(),
        apiError: apiConnected ? "" : apiError,
        ollamaError: ollamaConnected ? "" : ollamaError,
      });
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        online: navigator.onLine,
        apiConnected: false,
        ollamaConnected: false,
        apiError: "Network check failed",
        ollamaError: "Network check failed",
        lastChecked: new Date().toISOString(),
      }));
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    checkNetworkStatus();
    const interval = setInterval(checkNetworkStatus, 15000); // Check every 15 seconds
    
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
    if (!status.online) return { color: "text-red-400", text: "Offline", icon: WifiOff };
    if (status.apiConnected && status.ollamaConnected) return { color: "text-emerald-400", text: "Connected", icon: CheckCircle };
    if (status.apiConnected || status.ollamaConnected) return { color: "text-amber-400", text: "Partial", icon: Activity };
    return { color: "text-red-400", text: "Disconnected", icon: XCircle };
  };

  const connectionStatus = getConnectionStatus();
  const StatusIcon = connectionStatus.icon;

  return (
    <div className="absolute top-10 right-4 z-20 bg-card/95 backdrop-blur-md border border-primary/30 rounded-lg p-3 shadow-lg min-w-[200px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-primary">Network Status</span>
        </div>
        <button
          onClick={checkNetworkStatus}
          disabled={isRefreshing}
          className="p-1 hover:bg-primary/10 rounded transition disabled:opacity-50"
          title="Refresh network status"
        >
          <RefreshCw className={`w-3 h-3 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      
      <div className="space-y-2">
        {/* Overall Connection */}
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-3 h-3 ${connectionStatus.color}`} />
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
            {status.apiConnected ? "Connected" : "Failed"}
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
            {status.ollamaConnected ? "Connected" : "Failed"}
          </span>
        </div>

        {/* Latency */}
        {status.latency !== undefined && (
          <div className="text-[9px] text-muted-foreground font-mono">
            Latency: {status.latency}ms
          </div>
        )}

        {/* Errors */}
        {(status.apiError || status.ollamaError) && (
          <div className="text-[8px] text-red-400 font-mono space-y-1">
            {status.apiError && <div>API: {status.apiError}</div>}
            {status.ollamaError && <div>Ollama: {status.ollamaError}</div>}
          </div>
        )}

        {/* Last Checked */}
        <div className="text-[8px] text-muted-foreground font-mono">
          Last: {new Date(status.lastChecked).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
