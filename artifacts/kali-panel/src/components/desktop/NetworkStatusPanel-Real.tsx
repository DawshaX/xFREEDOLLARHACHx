import { useState, useEffect } from "react";
import { Wifi, WifiOff, Server, Globe, Activity, CheckCircle, XCircle, RefreshCw, AlertTriangle } from "lucide-react";

interface NetworkStatus {
  online: boolean;
  apiConnected: boolean;
  ollamaConnected: boolean;
  internetConnected: boolean;
  latency?: number;
  lastChecked: string;
  errors: string[];
}

export default function NetworkStatusPanelReal() {
  const [status, setStatus] = useState<NetworkStatus>({
    online: navigator.onLine,
    apiConnected: false,
    ollamaConnected: false,
    internetConnected: false,
    lastChecked: new Date().toISOString(),
    errors: [],
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkNetworkStatus = async () => {
    setIsRefreshing(true);
    const startTime = Date.now();
    const errors: string[] = [];
    
    try {
      // Check browser's online status
      const online = navigator.onLine;
      
      // Check API connection
      let apiConnected = false;
      try {
        const apiResponse = await fetch("/api/health", { 
          signal: AbortSignal.timeout(5000) 
        });
        if (apiResponse.ok) {
          apiConnected = true;
        } else {
          errors.push("API health check failed");
        }
      } catch (error) {
        errors.push("API unreachable");
      }
      
      // Check Ollama connection
      let ollamaConnected = false;
      try {
        const ollamaResponse = await fetch("http://127.0.0.1:11434/api/tags", { 
          signal: AbortSignal.timeout(5000) 
        });
        if (ollamaResponse.ok) {
          ollamaConnected = true;
        } else {
          errors.push("Ollama not responding");
        }
      } catch (error) {
        errors.push("Ollama unreachable");
      }
      
      // Check internet connection (via proxy)
      let internetConnected = false;
      try {
        const internetResponse = await fetch("/api/proxy?url=https://duckduckgo.com", { 
          signal: AbortSignal.timeout(10000) 
        });
        if (internetResponse.ok) {
          internetConnected = true;
        } else {
          errors.push("Internet proxy failed");
        }
      } catch (error) {
        errors.push("Internet unreachable");
      }
      
      const latency = Date.now() - startTime;
      
      setStatus({
        online,
        apiConnected,
        ollamaConnected,
        internetConnected,
        latency,
        lastChecked: new Date().toISOString(),
        errors,
      });
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        online: navigator.onLine,
        apiConnected: false,
        ollamaConnected: false,
        internetConnected: false,
        errors: ["Network check failed"],
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
    if (status.internetConnected && status.apiConnected && status.ollamaConnected) {
      return { color: "text-emerald-400", text: "Online", icon: CheckCircle };
    }
    if (status.apiConnected && status.ollamaConnected) {
      return { color: "text-amber-400", text: "Local Only", icon: Activity };
    }
    return { color: "text-red-400", text: "Disconnected", icon: XCircle };
  };

  const connectionStatus = getConnectionStatus();
  const StatusIcon = connectionStatus.icon;

  return (
    <div className="absolute top-10 right-4 z-20 bg-card/95 backdrop-blur-md border border-primary/30 rounded-lg p-3 shadow-lg min-w-[220px]">
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

        {/* Individual Services */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            <span className="text-[9px] font-mono">Internet:</span>
            {status.internetConnected ? (
              <CheckCircle className="w-3 h-3 text-emerald-400" />
            ) : (
              <XCircle className="w-3 h-3 text-red-400" />
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-[9px] font-mono">API:</span>
            {status.apiConnected ? (
              <CheckCircle className="w-3 h-3 text-emerald-400" />
            ) : (
              <XCircle className="w-3 h-3 text-red-400" />
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            <span className="text-[9px] font-mono">Ollama:</span>
            {status.ollamaConnected ? (
              <CheckCircle className="w-3 h-3 text-emerald-400" />
            ) : (
              <XCircle className="w-3 h-3 text-red-400" />
            )}
          </div>
        </div>

        {/* Latency */}
        {status.latency !== undefined && (
          <div className="text-[9px] text-muted-foreground font-mono">
            Latency: {status.latency}ms
          </div>
        )}

        {/* Errors */}
        {status.errors.length > 0 && (
          <div className="text-[8px] text-red-400 font-mono space-y-1 max-h-12 overflow-y-auto">
            {status.errors.map((error, index) => (
              <div key={index} className="truncate">• {error}</div>
            ))}
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
