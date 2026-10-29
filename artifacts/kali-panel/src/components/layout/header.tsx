import { Bell, Search, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header() {
  const unreadCount = 0;

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur flex items-center justify-between px-6 z-10 sticky top-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-muted-foreground hover:text-foreground cursor-pointer transition-colors border border-border bg-background px-3 py-1.5 rounded-md text-sm w-64" onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}>
          <Search className="h-4 w-4" />
          <span className="flex-1 text-right text-xs">بحث سريع (Ctrl+K)...</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 bg-green-500/10 text-green-500 px-3 py-1 rounded-full text-xs font-mono border border-green-500/20">
          <Shield className="h-3 w-3" />
          <span>النظام آمن</span>
        </div>
        
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-primary">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-destructive rounded-full animate-pulse-glow" />
          )}
        </Button>
      </div>
    </header>
  );
}
