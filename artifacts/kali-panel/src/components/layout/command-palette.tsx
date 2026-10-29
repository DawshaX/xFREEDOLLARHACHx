import { useState, useEffect } from "react";
import { Command } from "cmdk";
import { useLocation } from "wouter";
import { Search, ShieldAlert, Terminal, BrainCircuit, Globe, Settings, FileText, Database } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 border-primary/20 shadow-[0_0_30px_rgba(var(--primary),0.1)] bg-card/90 backdrop-blur-xl overflow-hidden max-w-2xl">
        <Command className="[&_[cmdk-root]]:min-h-[300px] [&_[cmdk-input]]:h-14 [&_[cmdk-item]]:px-4 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:w-5 [&_[cmdk-item]_svg]:h-5">
          <div className="flex items-center border-b border-border/50 px-4">
            <Search className="w-5 h-5 text-primary" />
            <Command.Input 
              placeholder="ابحث عن أداة، صفحة، أو أمر..." 
              className="flex-1 bg-transparent border-0 outline-none ring-0 h-14 px-4 font-mono text-lg placeholder:text-muted-foreground"
            />
          </div>
          
          <Command.List className="max-h-[400px] overflow-y-auto p-2 custom-scrollbar">
            <Command.Empty className="p-6 text-center text-muted-foreground font-mono">لم يتم العثور على نتائج.</Command.Empty>
            
            <Command.Group heading="الصفحات الرئيسية" className="text-xs text-muted-foreground font-mono px-2 py-1">
              <Command.Item onSelect={() => runCommand(() => setLocation("/"))} className="flex items-center gap-3 rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary text-foreground">
                <Terminal /> <span>نظرة عامة (Dashboard)</span>
              </Command.Item>
              <Command.Item onSelect={() => runCommand(() => setLocation("/agent"))} className="flex items-center gap-3 rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary text-foreground">
                <BrainCircuit /> <span>Live Agent</span>
              </Command.Item>
              <Command.Item onSelect={() => runCommand(() => setLocation("/cves"))} className="flex items-center gap-3 rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary text-foreground">
                <ShieldAlert /> <span>بحث CVEs</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="أدوات الفحص" className="text-xs text-muted-foreground font-mono px-2 py-1 mt-4">
              <Command.Item onSelect={() => runCommand(() => setLocation("/shodan"))} className="flex items-center gap-3 rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary text-foreground">
                <Globe /> <span>Shodan Search</span>
              </Command.Item>
              <Command.Item onSelect={() => runCommand(() => setLocation("/tools/portscan"))} className="flex items-center gap-3 rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary text-foreground">
                <Terminal /> <span>Port Scanner</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="أخرى" className="text-xs text-muted-foreground font-mono px-2 py-1 mt-4">
              <Command.Item onSelect={() => runCommand(() => setLocation("/files"))} className="flex items-center gap-3 rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary text-foreground">
                <FileText /> <span>Knowledge Files</span>
              </Command.Item>
              <Command.Item onSelect={() => runCommand(() => setLocation("/settings"))} className="flex items-center gap-3 rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary text-foreground">
                <Settings /> <span>الإعدادات</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
