import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Radio,
  Search,
  Bug,
  Github,
  Globe,
  BookOpen,
  ShieldAlert,
  ScanLine,
  Terminal,
  Monitor,
  Bot,
  ListChecks,
  FileText,
  Activity,
  Settings,
  MessageSquare,
  Files as FilesIcon,
  Shield,
  Skull,
  Sparkles,
  Folder,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const items: NavItem[] = [
  { href: "/", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/cve-live", label: "بث الثغرات الحي", icon: Radio, badge: "LIVE" },
  { href: "/cve-search", label: "بحث CVE", icon: Search },
  { href: "/exploit-db", label: "Exploit-DB", icon: Bug },
  { href: "/github-search", label: "GitHub Search", icon: Github },
  { href: "/web-search", label: "بحث الويب", icon: Globe },
  { href: "/knowledge", label: "قاعدة المعرفة", icon: BookOpen },
  { href: "/perms", label: "فحص الصلاحيات", icon: ShieldAlert },
  { href: "/scanner", label: "فاحص المواقع", icon: ScanLine },
  { href: "/terminal", label: "Terminal", icon: Terminal },
  { href: "/desktop", label: "سطح المكتب", icon: Monitor },
  { href: "/live-agent", label: "Live Agent", icon: Sparkles, badge: "LIVE" },
  { href: "/agent", label: "AI Agent v3", icon: Bot, badge: "NEW" },
  { href: "/kaligpt", label: "KaliGPT", icon: Skull },
  { href: "/chat", label: "محادثة AI", icon: MessageSquare },
  { href: "/files", label: "الملفات", icon: FilesIcon },
  { href: "/playbooks", label: "Playbooks", icon: ListChecks },
  { href: "/reports", label: "مولّد التقارير", icon: FileText },
  { href: "/monitor", label: "مراقبة مباشرة", icon: Activity },
  { href: "/installer", label: "Tool Installer", icon: Shield },
  { href: "/module-center", label: "Module Center", icon: Shield },
  { href: "/workspaces", label: "Workspaces", icon: Folder },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar/80 backdrop-blur-md">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative">
            <Shield className="w-8 h-8 text-primary neon-text" strokeWidth={2.5} />
            <div className="absolute inset-0 blur-md bg-primary/40 rounded-full" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-tight neon-text">
              CyberNova
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-mono">
              Ultimate v3
            </span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5" data-testid="sidebar-nav">
        {items.map((item) => {
          const isActive =
            location === item.href ||
            (item.href !== "/" && location.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`link-${item.href.slice(1) || "home"}`}
              className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all relative ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground neon-text"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
              }`}
            >
              {isActive && (
                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-l bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
              )}
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate font-medium">{item.label}</span>
              {item.badge && (
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                    item.badge === "LIVE"
                      ? "bg-destructive/30 text-red-300 animate-pulse"
                      : "bg-primary/20 text-primary"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-sidebar-border text-[11px] font-mono text-muted-foreground space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
          <span>SYSTEM ONLINE</span>
        </div>
        <div className="text-primary/60">v3.0.0 · Replit</div>
      </div>
    </aside>
  );
}
