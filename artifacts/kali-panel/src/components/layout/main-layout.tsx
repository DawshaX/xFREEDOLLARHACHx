import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./header";
import { CommandPalette } from "./command-palette";

export function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden selection:bg-primary/30">
      <CommandPalette />
      {/* Sidebar on the right for RTL */}
      <Sidebar />
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden mr-64">
        <Header />
        <main className="flex-1 overflow-auto relative">
          {children}
        </main>
      </div>
    </div>
  );
}
