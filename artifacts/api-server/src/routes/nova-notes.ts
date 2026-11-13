/**
 * nova-notes — دفاتر نوفا الستمرّة (صاحب المطلوب: «الأجينت معاه دفاتر وملاحظات
 * ويتعلم مدى الحياة»). تخزين ملف حقيقي state/nova-notes.json — بيشتغل
 * standalone وكامل-قاعدة بنفس الكود، ومتصل بالخلفية (أي تعديل يبعث حدث للـnexus).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { recordBackgroundEvent } from "../lib/agent/session-nexus";

export interface NovaNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedat: string;
}

const router: IRouter = Router();

function notesPath(): string {
  return path.resolve(process.env.NOVA_NOTES_FILE || path.join(process.cwd(), "state", "nova-notes.json"));
}

function readNotes(): NovaNote[] {
  try {
    const raw = fs.readFileSync(notesPath(), "utf8");
    const j = JSON.parse(raw) as { notes?: NovaNote[] } | NovaNote[];
    const arr = Array.isArray(j) ? j : Array.isArray(j.notes) ? j.notes : [];
    return arr.filter((n): n is NovaNote => !!n && typeof n.id === "string");
  } catch {
    return [];
  }
}

function writeNotes(notes: NovaNote[]): boolean {
  try {
    const p = notesPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ schema: "nova.notes/1", updatedAt: new Date().toISOString(), notes }, null, 2));
    fs.renameSync(tmp, p);
    return true;
  } catch {
    return false;
  }
}

const stamp = () => new Date().toISOString();
const mkId = () => `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

router.get("/nova/notes", (_req: Request, res: Response) => {
  const notes = readNotes().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedat.localeCompare(a.updatedat));
  res.json({ ok: true, count: notes.length, notes });
});

router.post("/nova/notes", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: string; body?: string; pinned?: boolean };
  const title = String(body.title ?? "").trim() || "ملاحظة بدون عنوان";
  const text = String(body.body ?? "").trim();
  if (!text) { res.status(400).json({ ok: false, error: "body required — الدفتر مش بيحفظ فراغ" }); return; }
  const note: NovaNote = { id: mkId(), title, body: text, pinned: !!body.pinned, createdAt: stamp(), updatedat: stamp() };
  const notes = [note, ...readNotes()];
  if (!writeNotes(notes)) { res.status(500).json({ ok: false, error: "write failed" }); return; }
  recordBackgroundEvent({ kind: "note", title: "دفتر جديد", detail: `«${note.title}» (${note.body.length} حرف)`, source: "nova-notes", persistMemory: true });
  res.json({ ok: true, note });
});

router.patch("/nova/notes/:id", (req: Request, res: Response) => {
  const notes = readNotes();
  const idx = notes.findIndex((n) => n.id === req.params.id);
  if (idx < 0) { res.status(404).json({ ok: false, error: "note not found" }); return; }
  const body = (req.body ?? {}) as Partial<NovaNote>;
  const cur = notes[idx];
  notes[idx] = {
    ...cur,
    title: typeof body.title === "string" ? body.title : cur.title,
    body: typeof body.body === "string" ? body.body : cur.body,
    pinned: typeof body.pinned === "boolean" ? body.pinned : cur.pinned,
    updatedat: stamp(),
  };
  if (!writeNotes(notes)) { res.status(500).json({ ok: false, error: "write failed" }); return; }
  res.json({ ok: true, note: notes[idx] });
});

router.delete("/nova/notes/:id", (req: Request, res: Response) => {
  const notes = readNotes();
  const next = notes.filter((n) => n.id !== req.params.id);
  if (next.length === notes.length) { res.status(404).json({ ok: false, error: "note not found" }); return; }
  if (!writeNotes(next)) { res.status(500).json({ ok: false, error: "write failed" }); return; }
  res.json({ ok: true, deleted: req.params.id, remaining: next.length });
});

export default router;
