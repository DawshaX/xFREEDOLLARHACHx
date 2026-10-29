import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Cpu, Search, Skull, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Process {
  pid: number;
  name: string;
  command: string;
  user: string;
  cpu: number;
  memory: number;
}

export default function ProcessesPage() {
  const [search, setSearch] = useState("");
  const [processes, setProcesses] = useState<Process[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const refetch = useCallback(() => {
    setIsLoading(true);
    void fetch("/api/monitor/processes")
      .then(r => r.json())
      .then((d: Process[] | { processes?: Process[] }) => {
        setProcesses(Array.isArray(d) ? d : (d.processes ?? []));
      })
      .catch(() => setProcesses([]))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 5000);
    return () => clearInterval(interval);
  }, [refetch]);

  const handleKill = (pid: number) => {
    if (!confirm(`Send SIGKILL to PID ${pid}?`)) return;
    void fetch(`/api/monitor/processes/${pid}/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: "SIGKILL" }),
    })
      .then(() => {
        toast({ title: "Signal Sent", description: `SIGKILL sent to ${pid}` });
        refetch();
      })
      .catch(() => toast({ variant: "destructive", title: "Error", description: `Failed to kill ${pid}` }));
  };

  const filtered = processes.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.pid.toString().includes(search) ||
    p.user.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold uppercase text-primary tracking-widest flex items-center gap-2">
          <Cpu className="w-6 h-6" /> Process Manager
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={refetch} className="h-8 w-8 border-primary/30">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search processes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 bg-card border-primary/20"
            />
          </div>
        </div>
      </div>

      <Card className="flex-1 border-primary/20 bg-card/80 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto custom-scrollbar">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-primary w-24">PID</TableHead>
                <TableHead className="text-primary">User</TableHead>
                <TableHead className="text-primary">Command</TableHead>
                <TableHead className="text-primary text-right">CPU %</TableHead>
                <TableHead className="text-primary text-right">RAM %</TableHead>
                <TableHead className="text-primary text-right w-24">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Scanning process table...</TableCell></TableRow>}
              {filtered.map(p => (
                <TableRow key={p.pid} className="border-border/50 hover:bg-primary/5 font-mono text-sm">
                  <TableCell className="text-muted-foreground">{p.pid}</TableCell>
                  <TableCell>{p.user}</TableCell>
                  <TableCell className="truncate max-w-[300px]" title={p.command}>{p.name}</TableCell>
                  <TableCell className={`text-right ${p.cpu > 10 ? "text-destructive" : "text-green-500"}`}>{p.cpu.toFixed(1)}</TableCell>
                  <TableCell className={`text-right ${p.memory > 10 ? "text-destructive" : "text-blue-500"}`}>{p.memory.toFixed(1)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleKill(p.pid)} className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <Skull className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No matching processes found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
