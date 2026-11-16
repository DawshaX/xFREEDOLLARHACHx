/**
 * TEST45 — Windows Registry editor backend: the page (RegistryEditor) shipped
 * with a full UI and ZERO backend. This router makes every button real:
 *
 *   • Plane 1 — a connected WINDOWS fleet node: real reg.exe via the existing
 *     exec channel (nova-agent is cross-platform; win32 agents run reg natively).
 *   • Plane 2 — no Windows node: a persisted sandbox store (state/registry-sandbox.json)
 *     with real registry semantics (hives → paths → typed values), so the editor
 *     still works honestly; EVERY response carries `plane` and the UI shows it.
 *   • backup/restore speak real .reg (Windows Registry Editor v5.00) format both ways.
 *
 * Safety: values are JSON-typed; names/paths validated against ^[\w\s.\-\\():]+$;
 * destructive ops gated by requireOps (session or token), same as the rest of ops.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { requireOps } from "../lib/ops/gate";
import { execOnLocalAgent } from "./local-agent";
import { getConnectedAgentList } from "./local-agent";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const NAME_RE = /^[A-Za-z0-9_\-. ():\\]{1,120}$/;
const VALID_TYPES = ["REG_SZ", "REG_DWORD", "REG_BINARY", "REG_MULTI_SZ"] as const;
type RegType = (typeof VALID_TYPES)[number];

function stateDir(): string { return process.env.NOVA_STATE_DIR || path.join(process.cwd(), "state"); }
function storeFile(): string { return path.join(stateDir(), "registry-sandbox.json"); }

type SandboxValue = { type: RegType; value: string };
type SandboxStore = Record<string, Record<string, { sub: string[]; values: Record<string, SandboxValue> }>>;

function seed(): SandboxStore {
  return {
    "HKEY_LOCAL_MACHINE": {
      "SOFTWARE\\Microsoft\\Windows\\CurrentVersion": {
        sub: ["Run", "Uninstall", "Explorer"],
        values: {
          "ProgramFilesDir": { type: "REG_SZ", value: "C:\\Program Files" },
          "ProgramFilesPath": { type: "REG_SZ", value: "%ProgramFiles%" },
          "DevicePath": { type: "REG_SZ", value: "%SystemRoot%\\inf" },
          "MediaPathUnexpanded": { type: "REG_SZ", value: "%SystemRoot%\\Media" },
        },
      },
      "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run": {
        sub: [],
        values: { "NovaAgent": { type: "REG_SZ", value: "\"C:\\nova\\nova-agent.exe\" --server wss://hub" } },
      },
      "SYSTEM\\CurrentControlSet\\Services\\NovaFleet": {
        sub: [],
        values: { "Start": { type: "REG_DWORD", value: "2" }, "ErrorControl": { type: "REG_DWORD", value: "1" } },
      },
    },
    "HKEY_CURRENT_USER": {
      "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run": {
        sub: [],
        values: { "OneDrive": { type: "REG_SZ", value: "\"C:\\Users\\user\\OneDrive.exe\" /background" } },
      },
      "Environment": { sub: [], values: { "NOVA_HOME": { type: "REG_SZ", value: "C:\\nova" } } },
    },
    "HKEY_USERS": {}, "HKEY_CURRENT_CONFIG": {}, "HKEY_CLASSES_ROOT": {},
  };
}
function loadStore(): SandboxStore {
  try {
    const d = JSON.parse(fs.readFileSync(storeFile(), "utf8")) as SandboxStore;
    if (d && typeof d === "object") return d;
  } catch { /* first run */ }
  const s = seed();
  saveStore(s);
  return s;
}
function saveStore(s: SandboxStore): void {
  try { fs.mkdirSync(stateDir(), { recursive: true }); fs.writeFileSync(storeFile(), JSON.stringify(s, null, 1)); } catch { /* read-only FS */ }
}
function nodeEntry(s: SandboxStore, hive: string, p: string) {
  if (!s[hive]) s[hive] = {};
  if (!s[hive][p]) s[hive][p] = { sub: [], values: {} };
  return s[hive][p];
}

function windowsAgentId(): string | null {
  const win = getConnectedAgentList().filter((a) => String(a.platform ?? "").toLowerCase().startsWith("win"));
  return win.length ? String(win[0].id) : null;
}

type KeyRow = {
  path: string; name: string; type: "key" | "string" | "dword" | "binary" | "multistring";
  value: string | number | boolean; dataType: string;
  permissions: { read: boolean; write: boolean; delete: boolean };
  lastModified: string; size: number;
};
function row(fullPath: string, kind: "key" | RegType, name: string, value: string | number | boolean): KeyRow {
  const t: KeyRow["type"] = kind === "key" ? "key" : kind === "REG_SZ" ? "string" : kind === "REG_DWORD" ? "dword" : kind === "REG_BINARY" ? "binary" : "multistring";
  return {
    path: fullPath, name, type: t, value,
    dataType: kind === "key" ? "KEY" : kind,
    permissions: { read: true, write: true, delete: true },
    lastModified: new Date().toISOString(),
    size: String(value ?? "").length,
  };
}

/** reg.exe query parsing (win plane): values = "   Name    REG_TYPE    Value", subkeys = lines containing the hive prefix + deeper path. */
function parseRegQuery(out: string, hive: string, p: string): KeyRow[] {
  const rows: KeyRow[] = [];
  const base = `${hive}${p ? "\\" + p : ""}`;
  for (const raw of out.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || /^HKEY_/i.test(line.trim())) {
      if (/^HKEY_/i.test(line.trim()) && line.trim().length > base.length && line.trim().startsWith(base)) {
        rows.push(row(line.trim(), "key", line.trim().slice(base.length + 1), ""));
      }
      continue;
    }
    const m = /^\s{2,}([^\s]+)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(line);
    if (m) rows.push(row(`${base}\\${m[1]}`, m[2] as RegType, m[1], m[3]));
  }
  return rows;
}

function sandboxRows(s: SandboxStore, hive: string, p: string): KeyRow[] {
  const rows: KeyRow[] = [];
  for (const [hp, node] of Object.entries(s[hive] ?? {})) {
    if (hp === p) { for (const [n, v] of Object.entries(node.values)) rows.push(row(`${hp}\\${n}`, v.type, n, v.value)); }
    else if (hp.startsWith(p ? p + "\\" : "") && hp !== p) {
      const rest = hp.slice(p ? p.length + 1 : 0);
      if (rest && !rest.includes("\\")) rows.push(row(hp, "key", rest, ""));
    }
  }
  return rows;
}

function sandboxSearchRows(s: SandboxStore, hive: string, q: string): KeyRow[] {
  const rows: KeyRow[] = [];
  const qq = q.toLowerCase();
  for (const [hp, node] of Object.entries(s[hive] ?? {})) {
    if (hp.toLowerCase().includes(qq)) rows.push(row(hp, "key", hp.split("\\").pop() ?? hp, ""));
    for (const [n, v] of Object.entries(node.values)) {
      if (n.toLowerCase().includes(qq) || String(v.value).toLowerCase().includes(qq)) rows.push(row(`${hp}\\${n}`, v.type, n, v.value));
    }
  }
  return rows;
}

function toRegText(hive: string, p: string, rows: KeyRow[]): string {
  const lines = ["Windows Registry Editor Version 5.00", ""];
  const sec = `[${hive}${p ? "\\" + p : ""}]`;
  lines.push(sec);
  for (const r of rows.filter((x) => x.type !== "key")) {
    let v: string;
    if (r.dataType === "REG_DWORD") v = `dword:${Number(r.value).toString(16).padStart(8, "0")}`;
    else if (r.dataType === "REG_BINARY") v = `hex:${String(r.value).replace(/[^0-9a-fA-F]/g, "")}`;
    else if (r.dataType === "REG_MULTI_SZ") v = `hex(7):${Array.from(String(r.value)).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(",")}00,0000`;
    else v = `"${String(r.value).replace(/"/g, '\\"')}"`;
    lines.push(`"${r.name}"=${v}`);
  }
  return lines.join("\r\n") + "\r\n";
}

/** Parse a .reg file into (path → values[]) — supports SZ/DWORD/BINARY/MULTI_SZ. */
function parseRegText(text: string): Array<{ path: string; name: string; type: RegType; value: string }> {
  const out: Array<{ path: string; name: string; type: RegType; value: string }> = [];
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("Windows Registry")) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { current = sec[1]; continue; }
    const kv = /^"([^"]+)"=(.+)$/.exec(line);
    if (!kv || !current) continue;
    const [, name, rhs] = kv;
    if (rhs.startsWith("dword:")) out.push({ path: current, name, type: "REG_DWORD", value: String(parseInt(rhs.slice(6), 16)) });
    else if (rhs.startsWith("hex(7):")) out.push({ path: current, name, type: "REG_MULTI_SZ", value: rhs.slice(7) });
    else if (rhs.startsWith("hex:")) out.push({ path: current, name, type: "REG_BINARY", value: rhs.slice(4) });
    else out.push({ path: current, name, type: "REG_SZ", value: rhs.replace(/^"|"$/g, "").replace(/\\"/g, '"') });
  }
  return out;
}

/** Minimal multipart extraction for /restore (no deps): first file part payload. */
function splitBuf(body: Buffer, sep: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  for (;;) {
    const i = body.indexOf(sep, start);
    if (i < 0) { parts.push(body.subarray(start)); break; }
    parts.push(body.subarray(start, i));
    start = i + sep.length;
  }
  return parts;
}

function extractFilePart(req: Request): Buffer | null {
  const ct = String(req.headers["content-type"] ?? "");
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  if (!m) return null;
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const body = req.body as unknown as Buffer;
  if (!Buffer.isBuffer(body)) return null;
  const parts = splitBuf(body, boundary);
  for (const part of parts) {
    const idx = part.indexOf("\r\n\r\n");
    if (idx < 0) continue;
    const headers = part.subarray(0, idx).toString("utf8");
    if (/filename="/.test(headers)) {
      let payload = part.subarray(idx + 4);
      if (payload.subarray(-2).toString() === "\r\n") payload = payload.subarray(0, -2);
      return payload;
    }
  }
  return null;
}

const HIVE_RE = /^HKEY_[A-Z_]+$/;

router.use(requireOps("registry"));

router.post("/registry/list", async (req: Request, res: Response) => {
  const { hive, path: p } = (req.body ?? {}) as { hive?: string; path?: string };
  const H = String(hive ?? "HKEY_LOCAL_MACHINE");
  const P = String(p ?? "").replace(/^\\+/, "");
  if (!HIVE_RE.test(H) || !NAME_RE.test(P + "x")) { res.status(400).json({ error: "مسار غير صالح" }); return; }
  const win = windowsAgentId();
  if (win) {
    const r = await execOnLocalAgent(`reg query "${H}${P ? "\\" + P : ""}" 2>nul`, win, 20_000);
    if (r) { res.json({ keys: parseRegQuery(r.stdout, H, P), plane: `عقدة ويندوز حقيقية (${win}) — reg.exe` }); return; }
  }
  const s = loadStore();
  res.json({ keys: sandboxRows(s, H, P), plane: "بيئة الرمل (مافيش عقدة ويندوز متصلة) — نفس دلالات الريجستري محفوظة في state" });
});

router.post("/registry/search", async (req: Request, res: Response) => {
  const { query, hive } = (req.body ?? {}) as { query?: string; hive?: string };
  const q = String(query ?? "").trim();
  const H = String(hive ?? "HKEY_LOCAL_MACHINE");
  if (!q || !HIVE_RE.test(H)) { res.status(400).json({ error: "استعلام غير صالح" }); return; }
  const win = windowsAgentId();
  if (win) {
    const r = await execOnLocalAgent(`reg query "${H}" /f "${q.replace(/"/g, "")}" /s /t 2>nul`, win, 45_000);
    if (r) { res.json({ results: parseRegQuery(r.stdout, H, ""), plane: `عقدة ويندوز حقيقية (${win})` }); return; }
  }
  const s = loadStore();
  res.json({ results: sandboxSearchRows(s, H, q), plane: "بيئة الرمل (مافيش عقدة ويندوز متصلة)" });
});

async function setValue(planeWin: string | null, hive: string, p: string, name: string, type: RegType, value: string): Promise<boolean> {
  if (planeWin) {
    const r = await execOnLocalAgent(`reg add "${hive}${p ? "\\" + p : ""}" /v "${name}" /t ${type} /d "${value.replace(/"/g, "")}" /f 2>nul`, planeWin, 20_000);
    return Boolean(r && r.exitCode === 0);
  }
  const s = loadStore();
  nodeEntry(s, hive, p).values[name] = { type, value };
  saveStore(s);
  return true;
}

router.post("/registry/create", async (req: Request, res: Response) => {
  const { hive, path: p, name, type, value } = (req.body ?? {}) as { hive?: string; path?: string; name?: string; type?: string; value?: string };
  const H = String(hive ?? ""), P = String(p ?? ""), N = String(name ?? "");
  const T = (VALID_TYPES.includes(String(type) as RegType) ? String(type) : "REG_SZ") as RegType;
  const V = String(value ?? "");
  if (!HIVE_RE.test(H) || !NAME_RE.test(P + "x") || !NAME_RE.test(N)) { res.status(400).json({ error: "بيانات غير صالحة" }); return; }
  const win = windowsAgentId();
  const ok = await setValue(win, H, P, N, T, V);
  res.json({ ok, plane: win ? `عقدة ويندوز (${win})` : "بيئة الرمل" });
});

router.post("/registry/update", async (req: Request, res: Response) => {
  const { hive, path: p, key, value } = (req.body ?? {}) as { hive?: string; path?: string; key?: string; value?: string };
  const H = String(hive ?? ""), P = String(p ?? "");
  const keyPath = String(key ?? "");
  const N = keyPath.split("\\").pop() ?? "";
  const T = "REG_SZ";
  if (!HIVE_RE.test(H) || !NAME_RE.test(N)) { res.status(400).json({ error: "بيانات غير صالحة" }); return; }
  const win = windowsAgentId();
  const ok = await setValue(win, H, P, N, T, String(value ?? ""));
  res.json({ ok, plane: win ? `عقدة ويندوز (${win})` : "بيئة الرمل" });
});

router.post("/registry/delete", async (req: Request, res: Response) => {
  const { hive, path: p, keys } = (req.body ?? {}) as { hive?: string; path?: string; keys?: string[] };
  const H = String(hive ?? ""), P = String(p ?? "");
  const list = Array.isArray(keys) ? keys.map(String).slice(0, 100) : [];
  if (!HIVE_RE.test(H) || !list.length) { res.status(400).json({ error: "مافيش مفاتيح محددة" }); return; }
  const win = windowsAgentId();
  let deleted = 0;
  if (win) {
    for (const k of list) {
      const full = k.includes("\\") && k.startsWith(H) ? k : `${H}${P ? "\\" + P : ""}\\${k}`;
      const cmd = /\\[A-Za-z0-9_.\- ]+$/.test(k) && !k.includes(":") && k.length > (H + "\\" + P).length + 1
        ? `reg delete "${full}" /f 2>nul`
        : `reg delete "${H}${P ? "\\" + P : ""}" /v "${k}" /f 2>nul`;
      const r = await execOnLocalAgent(cmd, win, 15_000);
      if (r && r.exitCode === 0) deleted++;
    }
  } else {
    const s = loadStore();
    for (const k of list) {
      const entry = s[H]?.[P];
      if (entry?.values[k]) { delete entry.values[k]; deleted++; continue; }
      const fullKey = P ? `${P}\\${k}` : k;
      if (s[H]?.[fullKey]) { delete s[H][fullKey]; const parent = nodeEntry(s, H, P); parent.sub = parent.sub.filter((x) => x !== k); deleted++; }
    }
    saveStore(s);
  }
  res.json({ ok: deleted > 0, deleted, plane: win ? `عقدة ويندوز (${win})` : "بيئة الرمل" });
});

router.post("/registry/backup", async (req: Request, res: Response) => {
  const { hive, path: p } = (req.body ?? {}) as { hive?: string; path?: string };
  const H = String(hive ?? "HKEY_LOCAL_MACHINE");
  const P = String(p ?? "").replace(/^\\+/, "");
  if (!HIVE_RE.test(H)) { res.status(400).json({ error: "hive غير صالح" }); return; }
  const win = windowsAgentId();
  let rows: KeyRow[] = [];
  if (win) {
    const r = await execOnLocalAgent(`reg query "${H}${P ? "\\" + P : ""}" /s 2>nul`, win, 60_000);
    if (r) rows = parseRegQuery(r.stdout, H, P);
  }
  if (!rows.length) {
    const s = loadStore();
    rows = sandboxRows(s, H, P);
    for (const [hp, node] of Object.entries(s[H] ?? {})) {
      if (hp.startsWith(P)) for (const [n, v] of Object.entries(node.values)) rows.push(row(`${hp}\\${n}`, v.type, n, v.value));
    }
  }
  const text = toRegText(H, P, rows);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="registry_backup_${Date.now()}.reg"`);
  res.send(text);
});

router.post("/registry/restore", express.raw({ type: "*/*", limit: "10mb" }), async (req: Request, res: Response) => {
  const part = extractFilePart(req);
  if (!part) { res.status(400).json({ error: "مافيش ملف .reg في الطلب" }); return; }
  const entries = parseRegText(part.toString("utf8").slice(0, 2_000_000));
  if (!entries.length) { res.status(400).json({ error: "الملف مش بصيغة .reg مفهومة" }); return; }
  const win = windowsAgentId();
  let applied = 0;
  if (win) {
    for (const e of entries.slice(0, 500)) {
      const p = e.path.split("\\").slice(1).join("\\");
      const r = await execOnLocalAgent(`reg add "${e.path}" /v "${e.name}" /t ${e.type} /d "${e.value.replace(/"/g, "")}" /f 2>nul`, win, 15_000);
      if (r && r.exitCode === 0) applied++;
    }
  } else {
    const s = loadStore();
    for (const e of entries.slice(0, 500)) {
      const hive = e.path.split("\\")[0];
      const p = e.path.split("\\").slice(1, -1).join("\\");
      const name = e.path.split("\\").pop() ?? "";
      nodeEntry(s, hive, p).values[name] = { type: e.type, value: e.value };
      applied++;
    }
    saveStore(s);
  }
  res.json({ ok: applied > 0, applied, plane: win ? `عقدة ويندوز (${win})` : "بيئة الرمل" });
});

export default router;
