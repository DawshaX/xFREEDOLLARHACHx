import { lazy, Suspense, Component, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Bug, FileText, Github, Globe, ShieldAlert, Terminal, Shield,
  Activity, Target, Eye, CheckCircle, AlertCircle, Search,
  Database, Settings as SettingsIcon, Play, Trash2, Download,
  RefreshCw, Usb, HardDrive, Zap, Cpu,
} from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/AppShell";

import Dashboard from "@/pages/Dashboard";
import Desktop from "@/pages/Desktop";
import HomeDashboard from "@/pages/HomeDashboard";
import BugBountyStudio from "@/pages/BugBountyStudio";
const CveLive = lazy(() => import("@/pages/CveLive"));
const CveSearch = lazy(() => import("@/pages/CveSearch"));
const VulnCenter = lazy(() => import("@/pages/VulnCenter"));
const Scanner = lazy(() => import("@/pages/Scanner"));
const Agent = lazy(() => import("@/pages/Agent"));
const LiveAgent = lazy(() => import("@/pages/LiveAgent"));
const KaliGpt = lazy(() => import("@/pages/KaliGpt"));
const Chat = lazy(() => import("@/pages/Chat"));
const Files = lazy(() => import("@/pages/Files"));
const ExploitDb = lazy(() => import("@/pages/ExploitDb"));
const GithubSearch = lazy(() => import("@/pages/GithubSearch"));
const WebSearch = lazy(() => import("@/pages/WebSearch"));
const Playbooks = lazy(() => import("@/pages/Playbooks"));
const Reports = lazy(() => import("@/pages/Reports"));
const MonitorPage = lazy(() => import("@/pages/Monitor"));
const Installer = lazy(() => import("@/pages/Installer"));
const ModuleCenter = lazy(() => import("@/pages/ModuleCenter"));
const Workspaces = lazy(() => import("@/pages/Workspaces"));
const Settings = lazy(() => import("@/pages/Settings"));
const Knowledge = lazy(() => import("@/pages/Knowledge"));
const TerminalPage = lazy(() => import("@/pages/TerminalPage"));
const NovaAgent = lazy(() => import("@/pages/NovaAgent"));
const NovaIntelligence = lazy(() => import("@/pages/NovaIntelligence"));
const SystemMonitor = lazy(() => import("@/pages/SystemMonitor"));
const NovaAgentV3 = lazy(() => import("@/pages/NovaAgentV3"));
const NovaModules = lazy(() => import("@/pages/NovaModules"));
const NovaAgentV6 = lazy(() => import("@/pages/NovaAgentV6"));
const NovaAgentChat = lazy(() => import("@/pages/NovaAgentChat"));
const NovaCore = lazy(() => import("@/pages/NovaCore"));
const NovaMemory = lazy(() => import("@/pages/NovaMemory"));
const SelfCheckPage = lazy(() => import("@/pages/SelfCheckPage"));
const NovaFleetUnified = lazy(() => import("@/pages/NovaFleetUnified"));
const NovaAgentPage = lazy(() => import("@/pages/NovaAgentPage"));
const Shodan = lazy(() => import("@/pages/shodan"));
const Mitre = lazy(() => import("@/pages/mitre"));
const Cwe = lazy(() => import("@/pages/cwe"));
const Cron = lazy(() => import("@/pages/cron"));
const Webhooks = lazy(() => import("@/pages/webhooks"));
const Audit = lazy(() => import("@/pages/audit"));
const Bookmarks = lazy(() => import("@/pages/bookmarks"));
const Jobs = lazy(() => import("@/pages/jobs"));
const Memory = lazy(() => import("@/pages/memory"));
const Status = lazy(() => import("@/pages/status"));
const NovaSentinel = lazy(() => import("@/pages/nova-sentinel"));
const DnsLookup = lazy(() => import("@/pages/tools/dns"));
const SslChecker = lazy(() => import("@/pages/tools/ssl"));
const WhoisLookup = lazy(() => import("@/pages/tools/whois"));
const HashCalculator = lazy(() => import("@/pages/tools/hash"));
const EncryptionTool = lazy(() => import("@/pages/tools/encode"));
const PortScan = lazy(() => import("@/pages/tools/portscan"));
const Subdomains = lazy(() => import("@/pages/tools/subdomains"));
const RiskCenter = lazy(() => import("@/pages/RiskCenter"));
const Assets = lazy(() => import("@/pages/Assets"));
const EvidenceDashboard = lazy(() => import("@/pages/EvidenceDashboard"));
const ActiveScanner = lazy(() => import("@/pages/ActiveScanner"));
const IocTracker = lazy(() => import("@/pages/IocTracker"));
const ThreatIntelligence = lazy(() => import("@/pages/ThreatIntelligence"));
const ThreatDetectionDashboard = lazy(() => import("@/pages/ThreatDetectionDashboard"));
const AttackSurface = lazy(() => import("@/pages/AttackSurface"));
const Timeline = lazy(() => import("@/pages/Timeline"));
const NucleiEngine = lazy(() => import("@/pages/NucleiEngine"));
const AutoExplorer = lazy(() => import("@/pages/AutoExplorer"));
const AIPage = lazy(() => import("@/pages/AIPage"));
const CyberControlHub = lazy(() => import("@/pages/CyberControlHub"));
const KaliCommandCenter = lazy(() => import("@/pages/KaliCommandCenter"));
const KaliTerminalPage = lazy(() => import("@/pages/KaliTerminalPage"));
const NovaCommander = lazy(() => import("@/pages/NovaCommander"));
const FilesPage = lazy(() => import("@/pages/FilesPage"));
const NetworkPage = lazy(() => import("@/pages/NetworkPage"));
const ProcessesPage = lazy(() => import("@/pages/ProcessesPage"));
const VulnsPage = lazy(() => import("@/pages/VulnsPage"));
const MissionTrackerPage = lazy(() => import("@/pages/MissionTracker"));
const LocalDeviceControl = lazy(() => import("@/pages/LocalDeviceControl"));
const NovaKnowledge = lazy(() => import("@/pages/nova-knowledge"));
const AgentV3 = lazy(() => import("@/pages/agent-v3"));
import { Placeholder } from "@/pages/Placeholder";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

class PageErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; resetKey?: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    try {
      const msg = String(error?.message || "");
      if (
        (msg.includes("is not defined") ||
          msg.includes("Failed to fetch dynamically imported module") ||
          msg.includes("Importing a module script failed") ||
          msg.includes("Loading chunk")) &&
        !sessionStorage.getItem("cybernova_boundary_reload_v15")
      ) {
        sessionStorage.setItem("cybernova_boundary_reload_v15", "1");
        const u = new URL(window.location.href);
        u.searchParams.set("_v", String(Date.now()));
        window.location.replace(u.toString());
      }
    } catch {
      // ignore
    }
  }
  componentDidUpdate(prevProps: { resetKey?: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4" dir="rtl">
          <div className="p-4 rounded-2xl border border-red-500/30 bg-red-950/20 max-w-lg space-y-3">
            <ShieldAlert className="w-8 h-8 text-red-400 mx-auto" />
            <div className="text-sm font-black text-red-300">تم التقاط خطأ تشغيلي وعزل الصفحة تلقائياً</div>
            <div className="text-xs font-mono text-slate-400 break-all">
              {this.state.error?.message || "Unexpected Render Error"}
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => {
                  const msg = String(this.state.error?.message || "");
                  if (msg.includes("is not defined") || msg.includes("Failed to fetch")) {
                    const u = new URL(window.location.href);
                    u.searchParams.set("_v", String(Date.now()));
                    window.location.replace(u.toString());
                    return;
                  }
                  this.setState({ hasError: false, error: null });
                }}
                className="px-4 py-2 rounded-xl text-xs font-mono font-bold bg-purple-600/30 border border-purple-500/40 text-purple-200 hover:bg-purple-600/50"
              >
                إعادة محاولة العرض (تحديث النسخة الحية)
              </button>
              {/*
                Local recovery. Panel state (missions, CVE counters, brain
                cache) lives in localStorage, so a stale schema from an older
                build can crash a page with a message like
                "Cannot read properties of undefined (reading 'CRITICAL')".
                This clears the saved state — never the server data — and
                reloads, which fixes the user without asking them to hunt
                through DevTools.
              */}
              <button
                onClick={() => {
                  try {
                    const doomed: string[] = [];
                    for (let i = 0; i < localStorage.length; i++) {
                      const k = localStorage.key(i);
                      if (k && k.startsWith("cybernova")) doomed.push(k);
                    }
                    for (const k of doomed) localStorage.removeItem(k);
                    sessionStorage.clear();
                  } catch {
                    /* storage blocked — the reload below is still worth trying */
                  }
                  const u = new URL(window.location.href);
                  u.searchParams.set("_v", String(Date.now()));
                  window.location.replace(u.toString());
                }}
                className="px-4 py-2 rounded-xl text-xs font-mono font-bold bg-red-600/20 border border-red-500/40 text-red-200 hover:bg-red-600/40"
                title="يمسح الحالة المحفوظة في المتصفح فقط — بيانات السيرفر ما بتتمسحش"
              >
                مسح الحالة المحلية وإعادة التحميل
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function InnerRoutes() {
  return (
    <Switch>
      {/* ── Dashboard ─────────────────────────────────────────────── */}
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/bug-bounty-studio" component={BugBountyStudio} />
      <Route path="/vuln-encyclopedia" component={BugBountyStudio} />
      <Route path="/code-auditor" component={BugBountyStudio} />

      {/* ── CVE & Vuln ────────────────────────────────────────────── */}
      <Route path="/vuln-center" component={VulnCenter} />
      <Route path="/cve-live" component={CveLive} />
      <Route path="/cve-search" component={CveSearch} />
      <Route path="/cve-db" component={CveLive} />
      <Route path="/cves" component={CveSearch} />

      {/* ── Scanners & Security ───────────────────────────────────── */}
      <Route path="/scanner" component={Scanner} />
      <Route path="/exploit-db" component={ExploitDb} />
      <Route path="/shodan" component={Shodan} />
      <Route path="/mitre" component={Mitre} />
      <Route path="/cwe" component={Cwe} />
      <Route path="/audit" component={Audit} />
      <Route path="/bookmarks" component={Bookmarks} />
      <Route path="/reports" component={Reports} />
      <Route path="/nova-sentinel" component={NovaSentinel} />
      <Route path="/nova-sentinel-v2" component={NovaSentinel} />
      <Route path="/nova-sentinel-v3" component={NovaSentinel} />

      {/* ── AI / Agents ───────────────────────────────────────────── */}
      <Route path="/live-agent" component={LiveAgent} />
      <Route path="/agent" component={Agent} />
      <Route path="/kaligpt" component={KaliGpt} />
      <Route path="/chat" component={Chat} />
      <Route path="/nova-agent" component={NovaAgent} />
      <Route path="/nova-intelligence" component={NovaIntelligence} />
      <Route path="/nova-agent-v3" component={NovaAgentV3} />
      <Route path="/nova-modules" component={NovaModules} />
      <Route path="/nova-agent-v6" component={NovaAgentV6} />
      <Route path="/nova-core" component={NovaCore} />
      <Route path="/self-check" component={SelfCheckPage} />
      <Route path="/nova-fleet" component={NovaFleetUnified} />
      <Route path="/nova-agent" component={NovaAgentPage} />
      <Route path="/nova-memory" component={NovaMemory} />
      <Route path="/nova-agent-chat" component={NovaAgentChat} />
      <Route path="/knowledge" component={Knowledge} />
      <Route path="/module-center" component={ModuleCenter} />

      {/* ── Files & System ────────────────────────────────────────── */}
      <Route path="/files" component={Files} />
      <Route path="/terminal" component={TerminalPage} />
      <Route path="/terminal-page" component={TerminalPage} />
      <Route path="/playbooks" component={Playbooks} />
      <Route path="/monitor" component={MonitorPage} />
      <Route path="/system-monitor" component={SystemMonitor} />
      <Route path="/installer" component={Installer} />
      <Route path="/workspaces" component={Workspaces} />
      <Route path="/settings" component={Settings} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/memory" component={Memory} />
      <Route path="/status" component={Status} />
      <Route path="/cron" component={Cron} />
      <Route path="/webhooks" component={Webhooks} />

      {/* ── Network Tools ─────────────────────────────────────────── */}
      <Route path="/github-search" component={GithubSearch} />
      <Route path="/github" component={GithubSearch} />
      <Route path="/web-search" component={WebSearch} />
      <Route path="/port-scanner" component={PortScan} />
      <Route path="/dns-lookup" component={DnsLookup} />
      <Route path="/ssl-checker" component={SslChecker} />
      <Route path="/whois-lookup" component={WhoisLookup} />
      <Route path="/subdomains" component={Subdomains} />

      {/* ── Crypto Tools ──────────────────────────────────────────── */}
      <Route path="/hash-calculator" component={HashCalculator} />
      <Route path="/encryption-tool" component={EncryptionTool} />
      <Route path="/tools/encode" component={EncryptionTool} />
      <Route path="/tools/hash" component={HashCalculator} />
      <Route path="/tools/dns" component={DnsLookup} />
      <Route path="/tools/ssl" component={SslChecker} />
      <Route path="/tools/whois" component={WhoisLookup} />
      <Route path="/tools/portscan" component={PortScan} />
      <Route path="/tools/subdomains" component={Subdomains} />
      <Route path="/tools/terminal" component={TerminalPage} />

      {/* ── Nova Sentinel V10 — New Pages ─────────────────────────── */}
      <Route path="/risk-center" component={RiskCenter} />
      <Route path="/risk-engine" component={RiskCenter} />
      <Route path="/assets" component={Assets} />
      <Route path="/asset-inventory" component={Assets} />
      <Route path="/evidence" component={EvidenceDashboard} />
      <Route path="/active-scanner" component={ActiveScanner} />
      <Route path="/ioc" component={IocTracker} />
      <Route path="/threat-intel" component={ThreatIntelligence} />
      <Route path="/attack-surface" component={AttackSurface} />
      <Route path="/timeline" component={Timeline} />
      <Route path="/nuclei-engine" component={NucleiEngine} />
      <Route path="/nuclei" component={NucleiEngine} />
      <Route path="/auto-explorer" component={AutoExplorer} />
      <Route path="/explorer" component={AutoExplorer} />

      {/* ── New Extended Pages ────────────────────────────────────── */}
      <Route path="/ai" component={AIPage} />
      <Route path="/ai-page" component={AIPage} />
      <Route path="/cyber-control-hub" component={CyberControlHub} />
      <Route path="/cyber-control" component={CyberControlHub} />
      <Route path="/kali-command-center" component={KaliCommandCenter} />
      <Route path="/kali-command" component={KaliCommandCenter} />
      <Route path="/kali-terminal" component={KaliTerminalPage} />
      <Route path="/nova-commander" component={NovaCommander} />
      <Route path="/files-explorer" component={FilesPage} />
      <Route path="/files-page" component={FilesPage} />
      <Route path="/network" component={NetworkPage} />
      <Route path="/network-page" component={NetworkPage} />
      <Route path="/processes" component={ProcessesPage} />
      <Route path="/processes-page" component={ProcessesPage} />
      <Route path="/vulns" component={VulnsPage} />
      <Route path="/vulns-page" component={VulnsPage} />
      <Route path="/mission-tracker" component={MissionTrackerPage} />
      <Route path="/local-control" component={LocalDeviceControl} />
      <Route path="/local-device" component={LocalDeviceControl} />
      <Route path="/scans" component={Scanner} />
      <Route path="/agent-tasks" component={Agent} />
      <Route path="/cve-browser" component={CveLive} />
      <Route path="/nova-knowledge" component={NovaKnowledge} />
      <Route path="/agent-v3" component={AgentV3} />

      {/* ── Placeholders ──────────────────────────────────────────── */}
      <Route path="/perms"><Placeholder title="فحص الصلاحيات" subtitle="تحليل صلاحيات المستخدمين" icon={ShieldAlert} /></Route>
      <Route path="/security-scanner"><Placeholder title="Security Scanner" subtitle="فحص أمني شامل" icon={Shield} /></Route>
      <Route path="/vulnerability-checker"><Placeholder title="Vulnerability Checker" subtitle="كشف الثغرات" icon={Bug} /></Route>
      <Route path="/network-analyzer"><Placeholder title="Network Analyzer" subtitle="تحليل الشبكة" icon={Globe} /></Route>
      <Route path="/threat-detector" component={ThreatDetectionDashboard} />
      <Route path="/file-analyzer"><Placeholder title="File Analyzer" subtitle="تحليل الملفات" icon={FileText} /></Route>
      <Route path="/crypto-tool"><Placeholder title="Crypto Tool" subtitle="أدوات التشفير" icon={Shield} /></Route>
      <Route path="/steganography"><Placeholder title="Steganography" subtitle="إخفاء البيانات" icon={Eye} /></Route>
      <Route path="/malware-scanner"><Placeholder title="Malware Scanner" subtitle="فحص البرمجيات الخبيثة" icon={Bug} /></Route>
      <Route path="/firewall-config"><Placeholder title="Firewall Config" subtitle="إعداد جدار الحماية" icon={Shield} /></Route>
      <Route path="/intrusion-detection"><Placeholder title="Intrusion Detection" subtitle="كشف التسلل" icon={ShieldAlert} /></Route>
      <Route path="/security-audit"><Placeholder title="Security Audit" subtitle="مراجعة أمنية" icon={Shield} /></Route>
      <Route path="/compliance-checker"><Placeholder title="Compliance Checker" subtitle="فحص الامتثال" icon={CheckCircle} /></Route>
      <Route path="/risk-assessment" component={RiskCenter} />
      <Route path="/incident-response"><Placeholder title="Incident Response" subtitle="استجابة الحوادث" icon={AlertCircle} /></Route>
      <Route path="/header-analyzer"><Placeholder title="Header Analyzer" subtitle="تحليل رؤوس HTTP" icon={Terminal} /></Route>
      <Route path="/ip-tracker"><Placeholder title="IP Tracker" subtitle="تتبع عناوين IP" icon={Target} /></Route>
      <Route path="/bandwidth-tester"><Placeholder title="Bandwidth Tester" subtitle="اختبار سرعة الشبكة" icon={Activity} /></Route>
      <Route path="/wifi-analyzer"><Placeholder title="WiFi Analyzer" subtitle="تحليل الشبكات اللاسلكية" icon={Globe} /></Route>
      <Route path="/bluetooth-scanner"><Placeholder title="Bluetooth Scanner" subtitle="فحص Bluetooth" icon={Target} /></Route>
      <Route path="/forensics-tool"><Placeholder title="Forensics Tool" subtitle="أدوات الطب الشرعي" icon={Search} /></Route>
      <Route path="/evidence-collector"><Placeholder title="Evidence Collector" subtitle="جمع الأدلة" icon={Database} /></Route>
      <Route path="/registry-editor"><Placeholder title="Registry Editor" subtitle="محرر السجل" icon={SettingsIcon} /></Route>
      <Route path="/service-manager"><Placeholder title="Service Manager" subtitle="إدارة الخدمات" icon={SettingsIcon} /></Route>
      <Route path="/startup-manager"><Placeholder title="Startup Manager" subtitle="إدارة بدء التشغيل" icon={Play} /></Route>
      <Route path="/system-cleaner"><Placeholder title="System Cleaner" subtitle="تنظيف النظام" icon={Trash2} /></Route>
      <Route path="/driver-updater"><Placeholder title="Driver Updater" subtitle="تحديث التعريفات" icon={Download} /></Route>
      <Route path="/patch-manager"><Placeholder title="Patch Manager" subtitle="إدارة التحديثات" icon={Shield} /></Route>
      <Route path="/update-checker"><Placeholder title="Update Checker" subtitle="فحص التحديثات" icon={RefreshCw} /></Route>
      <Route path="/usb-monitor"><Placeholder title="USB Monitor" subtitle="مراقبة USB" icon={Usb} /></Route>
      <Route path="/data-recovery"><Placeholder title="Data Recovery" subtitle="استعادة البيانات" icon={Database} /></Route>
      <Route path="/file-shredder"><Placeholder title="File Shredder" subtitle="تدمير الملفات" icon={Trash2} /></Route>
      <Route path="/process-monitor"><Placeholder title="Process Monitor" subtitle="مراقبة العمليات" icon={Activity} /></Route>
      <Route path="/disk-analyzer"><Placeholder title="Disk Analyzer" subtitle="تحليل القرص" icon={HardDrive} /></Route>
      <Route path="/memory-optimizer"><Placeholder title="Memory Optimizer" subtitle="تحسين الذاكرة" icon={Zap} /></Route>
      <Route path="/process-hunter"><Placeholder title="Process Hunter" subtitle="صيد العمليات" icon={Target} /></Route>
      <Route path="/thread-analyzer"><Placeholder title="Thread Analyzer" subtitle="تحليل الخيوط" icon={Activity} /></Route>
      <Route path="/kernel-monitor"><Placeholder title="Kernel Monitor" subtitle="مراقبة النواة" icon={Cpu} /></Route>
      <Route path="/gpu-monitor"><Placeholder title="GPU Monitor" subtitle="مراقبة GPU" icon={Activity} /></Route>
      <Route path="/process-manager"><Placeholder title="Process Manager" subtitle="إدارة العمليات" icon={Activity} /></Route>
      <Route path="/network-monitor"><Placeholder title="Network Monitor" subtitle="مراقبة الشبكة" icon={Globe} /></Route>
      <Route path="/security-center"><Placeholder title="Security Center" subtitle="مركز الأمان" icon={Shield} /></Route>
      <Route path="/data-center"><Placeholder title="Data Center" subtitle="مركز البيانات" icon={Database} /></Route>
      <Route path="/log-analyzer"><Placeholder title="Log Analyzer" subtitle="تحليل السجلات" icon={FileText} /></Route>
      <Route path="/backup-manager"><Placeholder title="Backup Manager" subtitle="إدارة النسخ الاحتياطية" icon={Database} /></Route>

      {/* ── Legacy aliases ────────────────────────────────────────── */}
      <Route path="/report-legacy"><Placeholder title="مولّد التقارير" subtitle="تقارير أمنية" icon={FileText} /></Route>
      <Route path="/exploit-db-legacy"><Placeholder title="Exploit-DB" subtitle="قاعدة البيانات" icon={Bug} /></Route>
      <Route path="/web-search-legacy"><Placeholder title="بحث الويب" subtitle="بحث ذكي" icon={Globe} /></Route>
      <Route path="/github-legacy"><Placeholder title="GitHub Search" subtitle="بحث في GitHub" icon={Github} /></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

const PageFallback = () => (
  <div className="flex items-center justify-center h-full w-full min-h-[200px]">
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

function AppRouter() {
  const [location] = useLocation();
  const isDesktop = location === "/desktop" || location === "/desktop-enhanced" || location === "/desktop-fixed" || location === "/desktop-advanced" || location === "/desktop-enhanced-plus";
  const isHome = location === "/";

  if (isDesktop) {
    return (
      <PageErrorBoundary resetKey={location}>
        <Suspense fallback={<PageFallback />}><Desktop /></Suspense>
      </PageErrorBoundary>
    );
  }
  if (isHome) {
    return (
      <PageErrorBoundary resetKey={location}>
        <Suspense fallback={<PageFallback />}><HomeDashboard /></Suspense>
      </PageErrorBoundary>
    );
  }

  return (
    <AppShell>
      <PageErrorBoundary resetKey={location}>
        <Suspense fallback={<PageFallback />}>
          <InnerRoutes />
        </Suspense>
      </PageErrorBoundary>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
