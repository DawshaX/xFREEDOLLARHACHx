import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-mono dark selection:bg-primary/30">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Subtle grid background to enhance hacker feel */}
        <div className="absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(rgba(0,255,65,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,65,0.1)_1px,transparent_1px)] bg-[size:40px_40px]" />
        
        <div className="flex-1 overflow-auto relative z-10 p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
