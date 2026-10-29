import { Link, useLocation } from "wouter";
import { Terminal, HardDrive, Cpu, Wifi, MessageSquare, ShieldAlert, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/terminal", label: "Terminal", icon: Terminal },
  { href: "/files", label: "Filesystem", icon: HardDrive },
  { href: "/processes", label: "Processes", icon: Cpu },
  { href: "/network", label: "Network", icon: Wifi },
  { href: "/ai", label: "Dolphin AI", icon: MessageSquare },
  { href: "/vulns", label: "Vulnerabilities", icon: ShieldAlert },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 border-r border-border bg-sidebar flex flex-col h-full overflow-hidden">
      <div className="h-16 flex items-center px-6 border-b border-border">
        <ShieldAlert className="w-6 h-6 text-primary mr-3" />
        <h1 className="text-xl font-bold text-primary tracking-widest uppercase">NovaPWN</h1>
      </div>
      
      <div className="flex-1 py-6 overflow-y-auto">
        <nav className="space-y-1 px-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors group",
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:bg-muted hover:text-primary"
                  )}
                >
                  <Icon className={cn("w-5 h-5 mr-3 flex-shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                  {item.label}
                  {isActive && <div className="ml-auto w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
      
      <div className="p-4 border-t border-border bg-muted/50">
        <div className="flex items-center space-x-3">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
          </div>
          <span className="text-xs text-primary/80 font-mono">SYSTEM ONLINE</span>
        </div>
      </div>
    </aside>
  );
}
