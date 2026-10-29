import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Folder, FileText, CornerLeftUp, Trash2, Plus, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Textarea } from "@/components/ui/textarea";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  permissions: string;
}

export default function FilesPage() {
  const [currentPath, setCurrentPath] = useState("/");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [isCreatingDir, setIsCreatingDir] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { toast } = useToast();

  const loadFiles = useCallback(() => {
    setIsLoading(true);
    void fetch("/api/files/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPath }),
    })
      .then(r => r.json())
      .then((d: FileEntry[] | { files?: FileEntry[] }) => {
        setFiles(Array.isArray(d) ? d : (d.files ?? []));
      })
      .catch(() => setFiles([]))
      .finally(() => setIsLoading(false));
  }, [currentPath]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.type === "directory") {
      setCurrentPath(entry.path);
      setSelectedFile(null);
    } else {
      setSelectedFile(entry.path);
      setIsReadingFile(true);
      void fetch("/api/files/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: entry.path }),
      })
        .then(r => r.json())
        .then((d: { content?: string }) => {
          setFileContent(d.content ?? "");
          setIsEditing(false);
        })
        .catch(() => toast({ variant: "destructive", title: "Read Error", description: "Could not read file." }))
        .finally(() => setIsReadingFile(false));
    }
  };

  const handleUpDir = () => {
    if (currentPath === "/") return;
    const parts = currentPath.replace(/\/$/, "").split("/");
    parts.pop();
    const up = parts.join("/") || "/";
    setCurrentPath(up);
    setSelectedFile(null);
  };

  const handleSave = () => {
    if (!selectedFile) return;
    setIsSaving(true);
    void fetch("/api/files/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selectedFile, content: fileContent }),
    })
      .then(() => {
        toast({ title: "Saved", description: `File ${selectedFile} saved successfully.` });
        setIsEditing(false);
        loadFiles();
      })
      .catch(() => toast({ variant: "destructive", title: "Save Error", description: "Could not save file." }))
      .finally(() => setIsSaving(false));
  };

  const handleDelete = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete ${path}?`)) return;
    void fetch("/api/files/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then(() => {
        toast({ title: "Deleted", description: `${path} deleted.` });
        if (selectedFile === path) setSelectedFile(null);
        loadFiles();
      })
      .catch(() => toast({ variant: "destructive", title: "Delete Error", description: "Could not delete file." }));
  };

  const handleCreateDir = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDirName.trim()) return;
    const path = `${currentPath === "/" ? "" : currentPath}/${newDirName}`;
    void fetch("/api/files/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then(() => {
        setNewDirName("");
        setIsCreatingDir(false);
        loadFiles();
      })
      .catch(() => toast({ variant: "destructive", title: "Error", description: "Could not create directory." }));
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center gap-2 text-xl font-bold uppercase text-primary tracking-widest">
        <Folder className="w-6 h-6" /> Filesystem
      </div>

      <div className="flex items-center gap-2 p-2 bg-card border border-border rounded-md">
        <Button variant="ghost" size="icon" onClick={handleUpDir} disabled={currentPath === "/"} className="h-8 w-8 text-primary">
          <CornerLeftUp className="w-4 h-4" />
        </Button>
        <Input
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadFiles()}
          className="flex-1 bg-transparent border-none focus-visible:ring-0 font-mono h-8"
        />
        <Button variant="outline" size="sm" onClick={() => setIsCreatingDir(!isCreatingDir)} className="border-primary/30 text-primary">
          <Plus className="w-4 h-4 mr-2" /> Mkdir
        </Button>
      </div>

      {isCreatingDir && (
        <form onSubmit={handleCreateDir} className="flex gap-2">
          <Input
            autoFocus
            placeholder="Directory name..."
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            className="w-64 bg-card"
          />
          <Button type="submit">Create</Button>
        </form>
      )}

      <ResizablePanelGroup direction="horizontal" className="flex-1 rounded-lg border border-border overflow-hidden">
        <ResizablePanel defaultSize={selectedFile ? 50 : 100} minSize={30}>
          <div className="h-full bg-card/50 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-primary w-[300px]">Name</TableHead>
                  <TableHead className="text-primary">Size</TableHead>
                  <TableHead className="text-primary">Perms</TableHead>
                  <TableHead className="text-primary text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Scanning directory...</TableCell></TableRow>
                )}
                {files.map(file => (
                  <TableRow
                    key={file.path}
                    className={`cursor-pointer border-border/50 hover:bg-primary/10 ${selectedFile === file.path ? "bg-primary/20" : ""}`}
                    onClick={() => handleNavigate(file)}
                  >
                    <TableCell className="font-mono flex items-center gap-2">
                      {file.type === "directory" ? <Folder className="w-4 h-4 text-blue-400" /> : <FileText className="w-4 h-4 text-muted-foreground" />}
                      <span className="truncate max-w-[200px]">{file.name}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{file.type === "file" ? (file.size / 1024).toFixed(1) + " KB" : "--"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{file.permissions}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={(e) => handleDelete(file.path, e)} className="h-6 w-6 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ResizablePanel>

        {selectedFile && (
          <>
            <ResizableHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
            <ResizablePanel defaultSize={50}>
              <div className="h-full flex flex-col bg-sidebar border-l border-border">
                <div className="p-2 border-b border-border flex items-center justify-between bg-card">
                  <span className="font-mono text-sm truncate px-2 text-primary">{selectedFile.split("/").pop()}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setIsEditing(!isEditing)} className="h-8">
                      {isEditing ? "Cancel" : "Edit"}
                    </Button>
                    {isEditing && (
                      <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-8 bg-primary text-black">
                        <Save className="w-4 h-4 mr-2" /> Save
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex-1 p-0 overflow-hidden relative">
                  {isReadingFile ? (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground font-mono">Reading file...</div>
                  ) : (
                    <Textarea
                      value={fileContent}
                      onChange={(e) => setFileContent(e.target.value)}
                      readOnly={!isEditing}
                      className="w-full h-full resize-none bg-black text-muted-foreground font-mono p-4 border-0 focus-visible:ring-0 rounded-none custom-scrollbar"
                    />
                  )}
                </div>
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
