import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, files } from "@workspace/db";
import { z } from "zod";
const UploadFileBody = z.object({
  name: z.string(),
  mimeType: z.string().default("application/octet-stream"),
  contentBase64: z.string(),
});

const router: IRouter = Router();

router.get("/files", async (_req, res) => {
  const rows = await db
    .select({
      id: files.id,
      name: files.name,
      mimeType: files.mimeType,
      size: files.size,
      createdAt: files.createdAt,
    })
    .from(files)
    .orderBy(desc(files.createdAt));
  res.json(rows);
});

router.post("/files", async (req, res) => {
  const body = UploadFileBody.parse(req.body);
  const buf = Buffer.from(body.contentBase64, "base64");
  const [row] = await db
    .insert(files)
    .values({
      name: body.name,
      mimeType: body.mimeType,
      size: buf.length,
      contentBase64: body.contentBase64,
    })
    .returning({
      id: files.id,
      name: files.name,
      mimeType: files.mimeType,
      size: files.size,
      createdAt: files.createdAt,
    });
  res.status(201).json(row);
});

router.get("/files/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(files).where(eq(files.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.get("/files/:id/download", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(files).where(eq(files.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const buf = Buffer.from(row.contentBase64, "base64");
  res.setHeader("Content-Type", row.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(row.name)}"`,
  );
  res.send(buf);
});

router.delete("/files/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(files).where(eq(files.id, id));
  res.status(204).end();
});

export default router;
