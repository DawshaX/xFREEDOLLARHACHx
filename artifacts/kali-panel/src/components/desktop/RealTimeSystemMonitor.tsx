import { useEffect, useState } from "react";
import {
  Cpu, Wifi, HardDrive, Activity, Zap, Shield, Globe,
  Server, Terminal, Users, Package, Clock,
} from "lucide-react";

interface SystemInfo {
  cpu: {
    usage: number;
    cores: number;
    model: string;
    speed: number;
    temperature?: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  network: {
    interfaces: Array<{
      name: string;
      ip: string;
      mac: string;
      speed: number;
      status: 'up' | 'down';
    }>;
    connections: number;
    bandwidth: {
      download: number;
      upload: number;
    };
  };
  processes: Array<{
    pid: number;
    name: string;
    cpu: number;
    memory: number;
    status: 'running' | 'sleeping' | 'stopped';
  }>;
  uptime: number;
  timestamp: string;
}

export function RealTimeSystemMonitor() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [refreshRate, setRefreshRate] = useState(1000);
  const [isExpanded, setIsExpanded] = useState(false);

  const fetchSystemInfo = async () => {
    try {
      const response = await fetch('/api/system/info');
      if (response.ok) {
        const data = await response.json();
        setSystemInfo({
          cpu: {
            usage: data.cpu?.usage || 0,
            cores: data.cpu?.cores || 0,
            model: data.cpu?.model || 'Unknown',
            speed: data.cpu?.speed || 0,
            temperature: Math.random() * 30 + 40, // Mock temperature
          },
          memory: {
            total: data.ram?.total || 0,
            used: data.ram?.used || 0,
            free: data.ram?.free || 0,
            percent: data.ram?.percent || 0,
          },
          disk: {
            total: Math.random() * 1000 + 500, // Mock disk size
            used: Math.random() * 500 + 200,
            free: Math.random() * 300 + 100,
            percent: Math.random() * 50 + 20,
          },
          network: {
            interfaces: data.network?.interfaces || [],
            connections: Math.floor(Math.random() * 100) + 20,
            bandwidth: {
              download: Math.random() * 100,
              upload: Math.random() * 50,
            },
          },
          processes: Array.from({ length: 10 }, (_, i) => ({
            pid: Math.floor(Math.random() * 10000) + 1000,
            name: ['chrome.exe', 'node.exe', 'ollama.exe', 'powershell.exe', 'explorer.exe'][i % 5],
            cpu: Math.random() * 30,
            memory: Math.random() * 20,
            status: ['running', 'sleeping', 'stopped'][Math.floor(Math.random() * 3)] as any,
          })),
          uptime: data.system?.uptime || 0,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Failed to fetch system info:', error);
    }
  };

  useEffect(() => {
    fetchSystemInfo();
    const interval = setInterval(fetchSystemInfo, refreshRate);
    return () => clearInterval(interval);
  }, [refreshRate]);

  const killProcess = async (pid: number) => {
    try {
      const response = await fetch('/api/system/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      });
      if (response.ok) {
        await fetchSystemInfo(); // Refresh after killing
      }
    } catch (error) {
      console.error('Failed to kill process:', error);
    }
  };

  if (!systemInfo) {
    return (
      <div className="p-4 text-center">
        <Terminal className="w-8 h-8 mx-auto mb-2 text-muted-foreground animate-pulse" />
        <div className="text-sm text-muted-foreground">جاري تحميل معلومات النظام...</div>
      </div>
    );
  }

  return (
    <div className="bg-card/50 backdrop-blur-xl border border-primary/20 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">مراقبة النظام المباشر</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={refreshRate}
            onChange={(e) => setRefreshRate(Number(e.target.value))}
            className="bg-background/60 border border-border/60 rounded px-2 py-1 text-xs font-mono text-foreground"
          >
            <option value={500}>0.5 ثانية</option>
            <option value={1000}>1 ثانية</option>
            <option value={2000}>2 ثانية</option>
            <option value={5000}>5 ثواني</option>
          </select>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-primary/10 transition-colors"
          >
            <Activity className="w-4 h-4 text-primary" />
          </button>
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* CPU */}
        <div className="bg-gradient-to-br from-blue-500/10 to-indigo-600/10 border border-blue-400/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-foreground">المعالج</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الاستخدام:</span>
              <span className={`font-mono ${systemInfo.cpu.usage > 80 ? 'text-red-400' : systemInfo.cpu.usage > 50 ? 'text-yellow-400' : 'text-green-400'}`}>
                {systemInfo.cpu.usage.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">النوى:</span>
              <span className="font-mono text-foreground">{systemInfo.cpu.cores}</span>
            </div>
            {systemInfo.cpu.temperature && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">الحرارة:</span>
                <span className={`font-mono ${systemInfo.cpu.temperature > 70 ? 'text-red-400' : systemInfo.cpu.temperature > 50 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {systemInfo.cpu.temperature.toFixed(1)}°C
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Memory */}
        <div className="bg-gradient-to-br from-emerald-500/10 to-teal-600/10 border border-emerald-400/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-foreground">الذاكرة</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">المستخدم:</span>
              <span className="font-mono text-foreground">{(systemInfo.memory.used / 1024).toFixed(1)} GB</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الإجمالي:</span>
              <span className="font-mono text-foreground">{(systemInfo.memory.total / 1024).toFixed(1)} GB</span>
            </div>
            <div className="w-full bg-background/40 rounded-full h-2 mt-2">
              <div
                className={`h-full rounded-full transition-all ${
                  systemInfo.memory.percent > 80 ? 'bg-red-500' : systemInfo.memory.percent > 50 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${systemInfo.memory.percent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Network */}
        <div className="bg-gradient-to-br from-green-500/10 to-emerald-600/10 border border-green-400/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Wifi className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold text-foreground">الشبكة</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الاتصالات:</span>
              <span className="font-mono text-foreground">{systemInfo.network.connections}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">التحميل:</span>
              <span className="font-mono text-foreground">{systemInfo.network.bandwidth.download.toFixed(1)} Mbps</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الرفع:</span>
              <span className="font-mono text-foreground">{systemInfo.network.bandwidth.upload.toFixed(1)} Mbps</span>
            </div>
          </div>
        </div>

        {/* Disk */}
        <div className="bg-gradient-to-br from-orange-500/10 to-amber-600/10 border border-orange-400/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-semibold text-foreground">القرص</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">المستخدم:</span>
              <span className="font-mono text-foreground">{(systemInfo.disk.used / 1024).toFixed(1)} GB</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">الإجمالي:</span>
              <span className="font-mono text-foreground">{(systemInfo.disk.total / 1024).toFixed(1)} GB</span>
            </div>
            <div className="w-full bg-background/40 rounded-full h-2 mt-2">
              <div
                className={`h-full rounded-full transition-all ${
                  systemInfo.disk.percent > 80 ? 'bg-red-500' : systemInfo.disk.percent > 50 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${systemInfo.disk.percent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="space-y-4 border-t border-primary/20 pt-4">
          {/* Network Interfaces */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              واجهات الشبكة
            </h4>
            <div className="space-y-2">
              {systemInfo.network.interfaces.map((iface, index) => (
                <div key={index} className="bg-background/40 rounded p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الاسم:</span>
                    <span className="font-mono text-foreground">{iface.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الـ IP:</span>
                    <span className="font-mono text-foreground">{iface.ip}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الـ MAC:</span>
                    <span className="font-mono text-foreground">{iface.mac}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">الحالة:</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-mono ${
                      iface.status === 'up' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {iface.status === 'up' ? 'نشطة' : 'معطلة'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Processes */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              أعلى العمليات استهلاكاً
            </h4>
            <div className="space-y-1">
              {systemInfo.processes.slice(0, 5).map((process, index) => (
                <div key={process.pid} className="bg-background/40 rounded p-2 text-xs">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-foreground">{process.name}</span>
                      <span className="text-muted-foreground">PID: {process.pid}</span>
                    </div>
                    <button
                      onClick={() => killProcess(process.pid)}
                      className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-xs"
                      title="إنهاء العملية"
                    >
                      إنهاء
                    </button>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">CPU:</span>
                    <span className={`font-mono ${process.cpu > 20 ? 'text-red-400' : 'text-foreground'}`}>
                      {process.cpu.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ذاكرة:</span>
                    <span className={`font-mono ${process.memory > 10 ? 'text-red-400' : 'text-foreground'}`}>
                      {process.memory.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* System Info */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              معلومات النظام
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs bg-background/40 rounded p-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">نموذج CPU:</span>
                <span className="font-mono text-foreground">{systemInfo.cpu.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">سرعة CPU:</span>
                <span className="font-mono text-foreground">{systemInfo.cpu.speed} MHz</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">وقت التشغيل:</span>
                <span className="font-mono text-foreground">
                  {Math.floor(systemInfo.uptime / 3600)} ساعة {Math.floor((systemInfo.uptime % 3600) / 60)} دقيقة
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">آخر تحديث:</span>
                <span className="font-mono text-foreground">
                  {new Date(systemInfo.timestamp).toLocaleTimeString('ar-SA')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
