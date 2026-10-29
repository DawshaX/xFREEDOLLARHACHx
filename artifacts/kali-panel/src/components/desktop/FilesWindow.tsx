import { useEffect, useState } from "react";
import { jsonRequest } from "@/lib/sse";
import { File as FileIcon, Upload, Trash2, Download } from "lucide-react";

interface StoredFile {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export function FilesWindow() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const list = await jsonRequest<StoredFile[]>("/files");
      setFiles(list);
    } catch {
      /* noop */
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function upload(f: File) {
    setBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const b64 = btoa(bin);
      await jsonRequest("/files", {
        method: "POST",
        body: JSON.stringify({
          name: f.name,
          mimeType: f.type || "application/octet-stream",
          contentBase64: b64,
        }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await jsonRequest(`/files/${id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="p-4 text-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-mono text-primary/70">
          {files.length} ملف مخزن
        </div>
        <label className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-primary/15 border border-primary/30 text-primary cursor-pointer hover:bg-primary/25">
          <Upload className="w-3.5 h-3.5" />
          رفع ملف
          <input
            type="file"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="space-y-1">
        {files.length === 0 && (
          <div className="text-center text-muted-foreground py-10 text-xs">
            لا توجد ملفات بعد
          </div>
        )}
        {files.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-2 px-3 py-2 rounded border border-primary/10 bg-card/50 hover:bg-card/80"
          >
            <FileIcon className="w-4 h-4 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate">{f.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {f.mimeType} · {Math.ceil(f.size / 1024)} KB
              </div>
            </div>
            <a
              href={`/api/files/${f.id}/download`}
              className="w-7 h-7 grid place-items-center rounded hover:bg-primary/10"
              title="download"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
            <button
              onClick={() => remove(f.id)}
              className="w-7 h-7 grid place-items-center rounded hover:bg-red-500/15 text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
