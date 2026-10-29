import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wifi, Activity, Shield, Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type ScanType = "quick" | "full" | "os" | "service" | "vuln";

interface NetworkInterface { name: string; isUp: boolean; addresses: string[]; mac?: string; }
interface Port { port: number; protocol: string; state: string; service: string; version?: string; }
interface Host { ip: string; hostname?: string; os?: string; ports: Port[]; }
interface ScanResult { target: string; duration: number; hosts: Host[]; rawOutput: string; }

export default function NetworkPage() {
  const { toast } = useToast();
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [target, setTarget] = useState("");
  const [scanType, setScanType] = useState<ScanType>("quick");
  const [ports, setPorts] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [scanData, setScanData] = useState<ScanResult | null>(null);

  const loadInterfaces = useCallback(() => {
    void fetch("/api/network/interfaces")
      .then(r => r.json())
      .then((d: NetworkInterface[] | { interfaces?: NetworkInterface[] }) => {
        setInterfaces(Array.isArray(d) ? d : (d.interfaces ?? []));
      })
      .catch(() => {});
  }, []);

  useState(() => { loadInterfaces(); });

  const handleScan = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!target) {
      toast({ variant: "destructive", title: "Error", description: "Target required" });
      return;
    }
    setIsPending(true);
    setScanData(null);
    void fetch("/api/network/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, scanType, ports: ports || undefined }),
    })
      .then(r => r.json())
      .then((d: ScanResult) => setScanData(d))
      .catch(() => toast({ variant: "destructive", title: "Scan Error", description: "Network scan failed." }))
      .finally(() => setIsPending(false));
  };

  return (
    <div className="h-full flex flex-col space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 text-2xl font-bold uppercase text-primary tracking-widest">
        <Wifi className="w-6 h-6" /> Network Ops
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-6">
          <Card className="bg-card border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-primary uppercase flex items-center gap-2">
                <Shield className="w-4 h-4" /> Scan Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleScan} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground uppercase">Target IP / CIDR</label>
                  <Input placeholder="192.168.1.0/24" value={target} onChange={e => setTarget(e.target.value)} className="bg-black/50 font-mono" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground uppercase">Scan Profile</label>
                  <Select value={scanType} onValueChange={(v: ScanType) => setScanType(v)}>
                    <SelectTrigger className="bg-black/50"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quick">Quick Scan (-F)</SelectItem>
                      <SelectItem value="full">Full Port Scan (-p-)</SelectItem>
                      <SelectItem value="os">OS Detection (-O)</SelectItem>
                      <SelectItem value="service">Service Ver (-sV)</SelectItem>
                      <SelectItem value="vuln">Vuln Script (-sC -sV)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground uppercase">Custom Ports (Opt)</label>
                  <Input placeholder="80,443,8080" value={ports} onChange={e => setPorts(e.target.value)} className="bg-black/50 font-mono" />
                </div>
                <Button type="submit" disabled={isPending} className="w-full bg-primary text-black hover:bg-primary/90">
                  {isPending ? "Scanning..." : "Launch Scan"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="bg-card border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-primary uppercase flex items-center gap-2">
                <Activity className="w-4 h-4" /> Interfaces
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {interfaces.length === 0 && <p className="text-xs text-muted-foreground">No interfaces loaded</p>}
                {interfaces.map(iface => (
                  <div key={iface.name} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-sm text-primary">{iface.name}</span>
                      <Badge variant={iface.isUp ? "default" : "destructive"} className="text-[10px]">{iface.isUp ? "UP" : "DOWN"}</Badge>
                    </div>
                    {iface.addresses.map((addr, i) => (<div key={i} className="text-xs font-mono text-muted-foreground ml-2">{addr}</div>))}
                    {iface.mac && <div className="text-xs font-mono text-muted-foreground ml-2 mt-1 opacity-50">MAC: {iface.mac}</div>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Card className="bg-card border-primary/20 h-full flex flex-col min-h-[500px]">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-lg text-primary uppercase">Scan Results</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4">
                  {!scanData && !isPending && (
                    <div className="text-center py-20 text-muted-foreground opacity-50 flex flex-col items-center">
                      <Search className="w-16 h-16 mb-4" />
                      <p>Awaiting target designation.</p>
                    </div>
                  )}
                  {isPending && (
                    <div className="text-center py-20 text-primary flex flex-col items-center">
                      <Activity className="w-16 h-16 mb-4 animate-pulse" />
                      <p className="font-mono animate-pulse">Running {scanType} scan on {target}...</p>
                    </div>
                  )}
                  {scanData && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-4 text-xs font-mono mb-4 text-muted-foreground">
                        <span>Target: {scanData.target}</span>
                        <span>Duration: {scanData.duration.toFixed(2)}s</span>
                        <span>Hosts up: {scanData.hosts.length}</span>
                      </div>
                      <Accordion type="multiple" className="w-full space-y-2">
                        {scanData.hosts.map((host, i) => (
                          <AccordionItem key={i} value={`host-${i}`} className="border border-border bg-black/30 rounded-md px-2">
                            <AccordionTrigger className="hover:no-underline">
                              <div className="flex items-center gap-4 w-full text-left">
                                <span className="font-mono text-primary font-bold">{host.ip}</span>
                                {host.hostname && <span className="text-muted-foreground text-sm">{host.hostname}</span>}
                                {host.os && <Badge variant="outline" className="ml-auto text-[10px] border-primary/50 text-primary">{host.os}</Badge>}
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="py-2">
                                {host.ports.length === 0
                                  ? <div className="text-xs text-muted-foreground italic px-2">No open ports found.</div>
                                  : <div className="grid grid-cols-4 gap-2 font-mono text-xs text-muted-foreground mb-2 px-2 uppercase font-bold tracking-wider"><div>Port/Proto</div><div>State</div><div>Service</div><div>Version</div></div>
                                }
                                {host.ports.map((port, j) => (
                                  <div key={j} className="grid grid-cols-4 gap-2 font-mono text-sm py-1 border-t border-border/30 px-2 hover:bg-primary/5">
                                    <div className="text-primary">{port.port}/{port.protocol}</div>
                                    <div className={port.state === "open" ? "text-green-500" : "text-muted-foreground"}>{port.state}</div>
                                    <div className="text-blue-400">{port.service}</div>
                                    <div className="truncate text-muted-foreground">{port.version ?? "-"}</div>
                                  </div>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                      <div className="mt-8">
                        <h4 className="text-xs font-bold text-muted-foreground uppercase mb-2">Raw Output</h4>
                        <pre className="p-4 bg-black border border-border text-[10px] font-mono text-muted-foreground/80 overflow-x-auto rounded-md">{scanData.rawOutput}</pre>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
