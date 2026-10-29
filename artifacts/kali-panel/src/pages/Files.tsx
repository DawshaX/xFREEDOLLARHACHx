import { useEffect, useRef, useState } from "react";
import { Files as FilesIcon, Trash2, Upload, Download } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface FileRow {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export default function Files() {
  const [list, setList] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await jsonRequest<FileRow[]>("/files");
      setList(Array.isArray(res) ? res : []);
    } catch {
      setList([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      await jsonRequest("/files", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64: b64,
        }),
      });
      await load();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: number) => {
    await jsonRequest(`/files/${id}`, { method: "DELETE" });
    await load();
  };

  const download = async (f: FileRow) => {
    const data = await jsonRequest<FileRow & { contentBase64: string }>(
      `/files/${f.id}`,
    );
    const bytes = Uint8Array.from(atob(data.contentBase64), (c) =>
      c.charCodeAt(0),
    );
    const blob = new Blob([bytes], { type: f.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="الملفات"
        subtitle="إدارة الملفات والبيانات للتحليل بواسطة الوكيل"
        icon={FilesIcon}
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              data-testid="file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              data-testid="btn-upload"
              className="px-5 py-2 bg-primary text-primary-foreground rounded-lg flex items-center gap-2 font-bold hover:opacity-90 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploading ? "جارِ الرفع..." : "رفع ملف"}
            </button>
          </>
        }
      />

      <div className="glow-card rounded-xl">
        {list.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground font-mono">
            لا ملفات مرفوعة بعد
          </div>
        ) : (
          <table className="w-full" data-testid="files-table">
            <thead>
              <tr className="border-b border-border/50 text-xs uppercase text-muted-foreground font-mono">
                <th className="text-start p-3">الاسم</th>
                <th className="text-start p-3">النوع</th>
                <th className="text-start p-3">الحجم</th>
                <th className="text-start p-3">التاريخ</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-border/30 hover:bg-primary/5"
                >
                  <td className="p-3 text-sm font-medium truncate max-w-xs">
                    {f.name}
                  </td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">
                    {f.mimeType}
                  </td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">
                    {(f.size / 1024).toFixed(1)} KB
                  </td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">
                    {new Date(f.createdAt).toLocaleString("ar-SA-u-ca-gregory")}
                  </td>
                  <td className="p-3 text-end">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => download(f)}
                        className="text-primary hover:opacity-80"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(f.id)}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
