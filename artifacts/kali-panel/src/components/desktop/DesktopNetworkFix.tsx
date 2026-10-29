import { useState, useEffect } from "react";
import { Wifi, WifiOff, CheckCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react";

interface ConnectionStatus {
  apiConnected: boolean;
  ollamaConnected: boolean;
  lastChecked: string;
  errors: string[];
}

export default function DesktopNetworkFix() {
  const [status, setStatus] = useState<ConnectionStatus>({
    apiConnected: false,
    ollamaConnected: false,
    lastChecked: new Date().toISOString(),
    errors: [],
  });

  const [isFixing, setIsFixing] = useState(false);

  const checkConnections = async () => {
    const errors: string[] = [];
    let apiConnected = false;
    let ollamaConnected = false;

    // Check API with multiple methods
    try {
      const response = await fetch("/api/health", { 
        signal: AbortSignal.timeout(3000) 
      });
      if (response.ok) {
        apiConnected = true;
      } else {
        errors.push("API health check failed");
      }
    } catch (error) {
      errors.push("API unreachable");
      
      // Try direct connection to localhost
      try {
        const directResponse = await fetch("http://localhost:3000/api/health", { 
          signal: AbortSignal.timeout(3000) 
        });
        if (directResponse.ok) {
          apiConnected = true;
          errors.push("API reachable via localhost");
        }
      } catch (directError) {
        errors.push("API not reachable via localhost either");
      }
    }

    // Check Ollama
    try {
      const response = await fetch("http://127.0.0.1:11434/api/tags", { 
        signal: AbortSignal.timeout(3000) 
      });
      if (response.ok) {
        ollamaConnected = true;
      } else {
        errors.push("Ollama not responding");
      }
    } catch (error) {
      errors.push("Ollama unreachable");
    }

    setStatus({
      apiConnected,
      ollamaConnected,
      lastChecked: new Date().toISOString(),
      errors,
    });
  };

  const fixNetworkIssues = async () => {
    setIsFixing(true);
    
    try {
      // Wait a bit and retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if we can establish connections
      await checkConnections();
      
      // If still issues, try to fix by reloading the API client configuration
      if (!status.apiConnected) {
        // Reset API client configuration
        try {
          const response = await fetch("/api/settings");
          if (response.ok) {
            console.log("API settings accessible");
          }
        } catch (error) {
          console.error("API settings not accessible");
        }
      }
      
    } catch (error) {
      console.error("Fix attempt failed:", error);
    } finally {
      setIsFixing(false);
    }
  };

  useEffect(() => {
    checkConnections();
    const interval = setInterval(checkConnections, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const allConnected = status.apiConnected && status.ollamaConnected;
  const hasIssues = !status.apiConnected || !status.ollamaConnected;

  return (
    <div className="fixed bottom-4 left-4 z-50 bg-card/95 backdrop-blur-md border border-primary/30 rounded-lg p-3 shadow-lg max-w-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {allConnected ? (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          ) : hasIssues ? (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-xs font-bold text-primary">Network Status</span>
        </div>
        
        {hasIssues && (
          <button
            onClick={fixNetworkIssues}
            disabled={isFixing}
            className="flex items-center gap-1 px-2 py-1 bg-primary/20 hover:bg-primary/30 rounded text-xs transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isFixing ? 'animate-spin' : ''}`} />
            {isFixing ? "Fixing..." : "Fix"}
          </button>
        )}
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          <span>API: {status.apiConnected ? "Connected" : "Disconnected"}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          <span>Ollama: {status.ollamaConnected ? "Connected" : "Disconnected"}</span>
        </div>

        {status.errors.length > 0 && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-400">
            <div className="font-mono">Issues:</div>
            {status.errors.map((error, index) => (
              <div key={index} className="truncate">• {error}</div>
            ))}
          </div>
        )}

        <div className="text-[9px] text-muted-foreground">
          Last: {new Date(status.lastChecked).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
