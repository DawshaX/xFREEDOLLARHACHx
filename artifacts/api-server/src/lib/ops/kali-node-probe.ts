/**
 * TEST30 — قياس كالي على العقد + الترتيب prewarm-first (إصلاح شكوى المالك):
 *  1) canExecuteOnNode كانت بتكدب: agents.length > 0 مش بيفرق كالي من Ubuntu.
 *     الحل: كل عقدة لينكس بتتقاس فعليًا بـKALI_NODE_PROBE (مقاس، مش معلنة).
 *  2) 79% من التنفيذات كانت بتاخد 5-8 دقايق لأن الترتيب كان بتسلسل الاتصال —
 *     العقد الجاهزة (marker .kali-node-installed) بتتجرب الأول.
 *  3) فشل التثبيت على عقدة مكنش بيكمّل — kali_run بيرجع فشل فورًا (اتصلح في tools.ts).
 *
 * الكاش على state/kali_node_probes_v1.json (runtime state) — TTL 3 دقايق:
 * self-report بيقرا الكاش بدون قياس جديد لو لسه طازة، والراوتات بتقيس حي وتحدّثه.
 */
import fs from "node:fs";
import path from "node:path";
import { execOnLocalAgent, getConnectedAgentList } from "../../routes/local-agent";
import { KALI_NODE_PROBE } from "./kali-node-installer";

export interface KaliProbeRow {
  id: string;
  hostname: string;
  mode: "" | "MODE_BARE" | "MODE_PROOT";
  kali: boolean;
  at: string;
}

const CACHE_FILE = path.join(process.cwd(), "state", "kali_node_probes_v1.json");
const PROBE_TIMEOUT_MS = 10_000;

function readCache(): { rows: KaliProbeRow[]; at: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as { rows: KaliProbeRow[]; at: number };
    return Array.isArray(raw.rows) ? raw : null;
  } catch {
    return null;
  }
}

function writeCache(rows: KaliProbeRow[]): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ rows, at: Date.now() }, null, 1));
  } catch {
    /* الكاش مش شرط نجاح */
  }
}

/** عقدة أسطول حقيقية — لينكس ومش الهَب نفسه (self-node مش عقدة سحابية).
 *  نفس شرط isLinuxFleetNode في kali-anywhere — متعرّف هنا عشان مافيش دورة استيراد. */
export function isFleetNode(a: { platform: string; capabilities?: string[] }): boolean {
  return a.platform === "linux" && !(a.capabilities ?? []).includes("self-node");
}

/** قياس حي لكل عقدة لينكس متصلة (بالتوازي) — بيكتب الكاش. */
export async function probeAllKaliNodes(): Promise<KaliProbeRow[]> {
  const agents = getConnectedAgentList().filter(isFleetNode);
  const rows = await Promise.all(
    agents.map(async (a): Promise<KaliProbeRow> => {
      try {
        const p = await execOnLocalAgent(KALI_NODE_PROBE, a.id, PROBE_TIMEOUT_MS);
        const mode = p ? (String(p.stdout).trim() as KaliProbeRow["mode"]) : "";
        return {
          id: a.id,
          hostname: a.hostname ?? a.id,
          mode: mode === "MODE_BARE" || mode === "MODE_PROOT" ? mode : "",
          kali: mode === "MODE_BARE" || mode === "MODE_PROOT",
          at: new Date().toISOString(),
        };
      } catch {
        return { id: a.id, hostname: a.hostname ?? a.id, mode: "", kali: false, at: new Date().toISOString() };
      }
    }),
  );
  writeCache(rows);
  return rows;
}

/** الكاش لو طازة (TTL) — null لو احتاج قياس جديد. */
export function readProbeCache(maxAgeMs = 180_000): { rows: KaliProbeRow[]; fresh: boolean; ageMs: number } {
  const c = readCache();
  const ageMs = c ? Date.now() - c.at : Number.POSITIVE_INFINITY;
  return { rows: c?.rows ?? [], fresh: ageMs < maxAgeMs, ageMs: Number.isFinite(ageMs) ? ageMs : -1 };
}

/** العقد الجاهزة (كالي مقاسة) الأول — ترتيب prewarm-first، والأصل محفوظ جوه كل مجموعة. */
export function orderPrewarmedFirst(rows: KaliProbeRow[]): KaliProbeRow[] {
  const ready = rows.filter((r) => r.kali);
  const rest = rows.filter((r) => !r.kali);
  return [...ready, ...rest];
}
