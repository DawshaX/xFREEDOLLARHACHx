import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldAlert, Plus, Trash2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type VulnerabilitySeverity = "critical" | "high" | "medium" | "low" | "info";

interface Vulnerability {
  id: number;
  title: string;
  description: string;
  target: string;
  severity: VulnerabilitySeverity;
  port?: number;
  cve?: string;
  status: string;
}

export default function VulnsPage() {
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    title: "", description: "", target: "",
    severity: "medium" as VulnerabilitySeverity,
    port: "", cve: "",
  });

  const refetch = useCallback(() => {
    setIsLoading(true);
    void fetch("/api/vulns")
      .then(r => r.json())
      .then((d: Vulnerability[] | { vulns?: Vulnerability[] }) => {
        setVulns(Array.isArray(d) ? d : (d.vulns ?? []));
      })
      .catch(() => setVulns([]))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    void fetch("/api/vulns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...formData, port: formData.port ? parseInt(formData.port) : undefined }),
    })
      .then(() => {
        setOpen(false);
        refetch();
        setFormData({ title: "", description: "", target: "", severity: "medium", port: "", cve: "" });
      })
      .catch(() => toast({ variant: "destructive", title: "Error", description: "Could not add vulnerability." }))
      .finally(() => setIsAdding(false));
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete finding?")) return;
    void fetch(`/api/vulns/${id}`, { method: "DELETE" })
      .then(() => refetch())
      .catch(() => toast({ variant: "destructive", title: "Error", description: "Could not delete finding." }));
  };

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case "critical": return "bg-red-600 text-white border-red-500";
      case "high": return "bg-orange-600 text-white border-orange-500";
      case "medium": return "bg-yellow-600/80 text-white border-yellow-500";
      case "low": return "bg-blue-600/80 text-white border-blue-500";
      default: return "bg-gray-600 text-white border-gray-500";
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-2xl font-bold uppercase text-primary tracking-widest">
          <ShieldAlert className="w-6 h-6" /> Vulnerabilities Database
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={refetch} className="h-8 w-8 border-primary/30">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-black hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" /> Log Finding
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-primary/20 sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="text-primary font-mono uppercase">Log New Finding</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground uppercase">Title</label>
                    <Input required value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="bg-black/50" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground uppercase">Severity</label>
                    <Select value={formData.severity} onValueChange={v => setFormData({ ...formData, severity: v as VulnerabilitySeverity })}>
                      <SelectTrigger className="bg-black/50"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground uppercase">Target / Host</label>
                    <Input required value={formData.target} onChange={e => setFormData({ ...formData, target: e.target.value })} className="bg-black/50 font-mono" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground uppercase">Port (Optional)</label>
                    <Input type="number" value={formData.port} onChange={e => setFormData({ ...formData, port: e.target.value })} className="bg-black/50 font-mono" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground uppercase">CVE (Optional)</label>
                  <Input placeholder="CVE-2024-XXXX" value={formData.cve} onChange={e => setFormData({ ...formData, cve: e.target.value })} className="bg-black/50 font-mono" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground uppercase">Description</label>
                  <Textarea required value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="bg-black/50 min-h-[100px]" />
                </div>
                <Button type="submit" disabled={isAdding} className="w-full bg-primary text-black">Submit Finding</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="flex-1 border-primary/20 bg-card/80 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto custom-scrollbar">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-primary w-32">Severity</TableHead>
                <TableHead className="text-primary">Title</TableHead>
                <TableHead className="text-primary w-48">Target</TableHead>
                <TableHead className="text-primary w-32">CVE</TableHead>
                <TableHead className="text-primary w-24">Status</TableHead>
                <TableHead className="text-primary text-right w-24">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-20 text-muted-foreground">Loading vulnerabilities...</TableCell></TableRow>
              )}
              {!isLoading && vulns.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-20 text-muted-foreground">No vulnerabilities logged.</TableCell></TableRow>
              )}
              {vulns.map(v => (
                <TableRow key={v.id} className="border-border/50 hover:bg-primary/5 font-mono text-sm">
                  <TableCell>
                    <Badge variant="outline" className={`${getSeverityColor(v.severity)} uppercase text-[10px] px-2 py-0 border-transparent shadow-none`}>
                      {v.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-bold text-foreground max-w-[300px] truncate" title={v.title}>{v.title}</TableCell>
                  <TableCell className="text-muted-foreground">{v.target}{v.port ? `:${v.port}` : ""}</TableCell>
                  <TableCell className="text-primary">{v.cve ?? "-"}</TableCell>
                  <TableCell className="uppercase text-xs opacity-70">{v.status}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(v.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
