/**
 * TEST45 — the REAL file-manager backend (FilesPage + AdvancedFileManager
 * called /api/files/list|read|write|mkdir|delete|execute which answered 404 —
 * every button was dead on the live hub). These are true filesystem operations
 * on the hub (ops-gated): the panel is the operator's workstation console.
 * /api/files (no subpath) remains the pentest artifacts vault — untouched.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { requireOps } from "../lib/ops/gate";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const exec = promisify(execCb);

const ROOT = process.env.NOVA_FM_ROOT
  ? path.resolve(process.env.NOVA_FM_ROOT)
  : process.cwd();

function safeAbs(p: string): string | null {
  const raw = String(p ?? "").trim();
  if (!raw || raw.includes("\0") || raw.includes("\n")) return null;
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ROOT, raw);
  // البرنامج هو وحدة تحكم المشغّل: بنمنع فقط الخروج من جذر المشروع افتراضيًا
  // (متغير NOVA_FM_UNLOCKED=1 يفتح الجهاز كله للمشغّل الموثق).
  if (process.env.NOVA_FM_UNLOCKED !== "1" && !abs.startsWith(ROOT)) return null;
  return abs;
}

router.use(requireOps("files"));

router.post("/files/list", async (req: Request, res: Response) => {
  const { path: p, showHidden } = (req.body ?? {}) as { path?: string; showHidden?: boolean };
  const abs = safeAbs(p || ROOT);
  if (!abs) { res.status(400).json({ error: "مسار خارج الجذر المسموح" }); return; }
  try {
    const st = await fs.promises.stat(abs);
    if (!st.isDirectory()) { res.status(400).json({ error: "مش مجلد" }); return; }
    const dirents = await fs.promises.readdir(abs, { withFileTypes: true });
    const files = [];
    for (const d of dirents) {
      if (!showHidden && d.name.startsWith(".")) continue;
      const full = path.join(abs, d.name);
      let size = 0; let mtime = ""; let mode = "";
      try { const s = await fs.promises.stat(full); size = s.size; mtime = s.mtime.toISOString(); mode = (s.mode & 0o777).toString(8); } catch { /* race */ }
      files.push({ name: d.name, path: full, type: d.isDirectory() ? "directory" : "file", size, mtime, permissions: mode });
    }
    files.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
    let stats = { totalFiles: files.filter((f) => f.type === "file").length, totalDirs: files.filter((f) => f.type === "directory").length, totalBytes: files.reduce((a, f) => a + (f.size || 0), 0) };
    res.json({ files, stats, root: ROOT, plane: "الجهاز الحي (الهَب)" });
  } catch (e) {
    res.status(404).json({ error: `تعذّر قراءة المسار: ${(e as Error).message}` });
  }
});

router.post("/files/read", async (req: Request, res: Response) => {
  const abs = safeAbs(String((req.body ?? {}).path ?? ""));
  if (!abs) { res.status(400).json({ error: "مسار غير مسموح" }); return; }
  try {
    const st = await fs.promises.stat(abs);
    if (st.size > 2_000_000) { res.status(413).json({ error: "الملف أكبر من 2MB للعرض — استخدم التنزيل" }); return; }
    const content = await fs.promises.readFile(abs, "utf8");
    res.json({ content, path: abs, size: st.size });
  } catch (e) { res.status(404).json({ error: String((e as Error).message) }); }
});

router.post("/files/write", async (req: Request, res: Response) => {
  const { path: p, content } = (req.body ?? {}) as { path?: string; content?: string };
  const abs = safeAbs(String(p ?? ""));
  if (!abs) { res.status(400).json({ error: "مسار غير مسموح" }); return; }
  if (String(content ?? "").length > 5_000_000) { res.status(413).json({ error: "أكبر من 5MB" }); return; }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content ?? ""), "utf8");
    res.json({ ok: true, path: abs, bytes: Buffer.byteLength(String(content ?? "")) });
  } catch (e) { res.status(500).json({ error: String((e as Error).message) }); }
});

router.post("/files/mkdir", async (req: Request, res: Response) => {
  const abs = safeAbs(String((req.body ?? {}).path ?? ""));
  if (!abs) { res.status(400).json({ error: "مسار غير مسموح" }); return; }
  try { fs.mkdirSync(abs, { recursive: true }); res.json({ ok: true, path: abs }); }
  catch (e) { res.status(500).json({ error: String((e as Error).message) }); }
});

router.post("/files/delete", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { path?: string; paths?: string[] };
  const targets = body.paths ?? (body.path ? [body.path] : []);
  const absList = targets.map(String).map(safeAbs).filter(Boolean) as string[];
  if (!absList.length) { res.status(400).json({ error: "مافيش مسارات" }); return; }
  let deleted = 0;
  for (const abs of absList) {
    try { fs.rmSync(abs, { recursive: true, force: true }); deleted++; } catch { /* skip */ }
  }
  res.json({ ok: deleted === absList.length, deleted, requested: absList.length });
});

router.post("/files/execute", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const op = String(body.operation ?? "");
  try {
    if (op === "delete") {
      const list = (body.files as string[] ?? []).map(String).map(safeAbs).filter(Boolean) as string[];
      let n = 0;
      for (const a of list) { try { fs.rmSync(a, { recursive: true, force: true }); n++; } catch { /* skip */ } }
      res.json({ ok: true, deleted: n });
      return;
    }
    if (op === "mkdir" || op === "create") {
      const abs = safeAbs(String(body.path ?? body.name ?? ""));
      if (!abs) { res.status(400).json({ error: "مسار غير مسموح" }); return; }
      fs.mkdirSync(abs, { recursive: true });
      res.json({ ok: true, path: abs });
      return;
    }
    if (op === "rename" || op === "move") {
      const from = safeAbs(String(body.from ?? body.path ?? ""));
      const to = safeAbs(String(body.to ?? body.newName ?? ""));
      if (!from || !to) { res.status(400).json({ error: "مسار غير مسموح" }); return; }
      fs.renameSync(from, to);
      res.json({ ok: true });
      return;
    }
    if (op === "run" || op === "command" || op === "execute") {
      const cmd = String(body.command ?? body.cmd ?? "").trim();
      if (!cmd) { res.status(400).json({ error: "مافيش أمر" }); return; }
      const cwd = safeAbs(String(body.cwd ?? ROOT)) ?? ROOT;
      const r = await exec(cmd, { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
      res.json({ ok: true, stdout: (r.stdout ?? "").slice(0, 200_000), stderr: (r.stderr ?? "").slice(0, 50_000), plane: "الجهاز الحي (الهَب)" });
      return;
    }
    res.status(400).json({ error: `عملية غير معروفة: ${op}` });
  } catch (e) {
    logger.warn({ e }, "files/execute failed");
    res.status(500).json({ error: String((e as Error).message) });
  }
});

export default router;
