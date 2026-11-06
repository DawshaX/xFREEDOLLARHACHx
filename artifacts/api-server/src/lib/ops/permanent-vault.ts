/**
 * خزنة الدائم (Permanent Vault) — القارئ بتاع أغلى حاجة في المستودع
 * ─────────────────────────────────────────────────────────────────
 * `state/discovered-vulnerabilities-vault.json` فيه الاكتشافات البشرية المزوّدة
 * بمسارات البراهين، وملاحظاتها المعمارية، ومسودات الإفصاح، وسجل قواعد التعلم —
 * وكل ده كان بيُعرض في صفحة ومكتوب في الدوكسات، بس **مفيش أداة في الأجنت بتقرأه**.
 * يعني نوفا كانت بتقول «49 أداة» وهي ما تعرفش إنها شايلة 11 ثغرة موثقة.
 *
 * الملف ده ما بيخترعش حاجة: بيقرأ JSON زي ما هو، واللي مش موجود يفضل مش موجود.
 * `NOVA_PERMANENT_VAULT` يغيّر المسار (نفس عادة الخزنة التانية).
 */
import fs from "node:fs";
import path from "node:path";

export interface PermanentVaultRecord {
  id: string;
  titleEn: string;
  titleAr: string;
  severity: string;
  status: string;
  program: string;
  platform: string;
  cwe: string | null;
  evidencePath: string | null;
  proofOfConceptPath: string | null;
  reportMarkdownPath: string | null;
  evidenceOnDisk: boolean;
  pocOnDisk: boolean;
  learnedHeuristic: string | null;
  severityBasis: string | null;
}

export interface PermanentVaultDoc {
  present: boolean;
  path: string;
  updatedAt: string | null;
  schemaVersion: string | null;
  titleAr: string | null;
  counts: { vulnerabilities: number; notes: number; reports: number; rules: number };
  vulnerabilities: PermanentVaultRecord[];
  notes: Array<{ id: string; title: string; summary: string }>;
  rules: Array<{ id: string; category: string; titleAr: string }>;
  /** عدد السجلات اللي عرضناها فعلاً (الحد مش رقم في الرد) */
  limit: number;
}

const EMPTY: PermanentVaultDoc = {
  present: false,
  path: "",
  updatedAt: null,
  schemaVersion: null,
  titleAr: null,
  counts: { vulnerabilities: 0, notes: 0, reports: 0, rules: 0 },
  vulnerabilities: [],
  notes: [],
  rules: [],
  limit: 0,
};

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function exists(rel: string): boolean {
  if (!rel) return false;
  try {
    return fs.existsSync(path.resolve(process.cwd(), rel));
  } catch {
    return false;
  }
}

export function permanentVaultPath(): string {
  const env = process.env.NOVA_PERMANENT_VAULT;
  if (env) return path.resolve(env);
  const candidates = [
    path.resolve(process.cwd(), "state/discovered-vulnerabilities-vault.json"),
    path.resolve(import.meta.dirname, "../../../../state/discovered-vulnerabilities-vault.json"),
    path.resolve(import.meta.dirname, "../../../state/discovered-vulnerabilities-vault.json"),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return candidates[0]!;
}

export function readPermanentVault(limit = 5): PermanentVaultDoc {
  const file = permanentVaultPath();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return { ...EMPTY, path: file };
  }
  if (!raw || typeof raw !== "object") return { ...EMPTY, path: file };
  const cap = Math.max(1, Math.min(50, Math.trunc(Number.isFinite(limit) ? limit : 5)));
  const list = <T>(k: string): T[] => (Array.isArray(raw[k]) ? (raw[k] as T[]) : []);
  const vulns = list<Record<string, unknown>>("discoveredVulnerabilities").map((r) => {
    const evidencePath = asString(r.evidencePath) || null;
    const poc = asString(r.proofOfConceptPath) || null;
    return {
      id: asString(r.id, "؟"),
      titleEn: asString(r.titleEn),
      titleAr: asString(r.titleAr),
      severity: asString(r.severity, "غير مصنف"),
      status: asString(r.status, "غير محدد"),
      program: asString(r.program),
      platform: asString(r.platform),
      cwe: asString(r.cwe) || null,
      evidencePath,
      proofOfConceptPath: poc,
      reportMarkdownPath: asString(r.reportMarkdownPath) || null,
      evidenceOnDisk: exists(evidencePath ?? ""),
      pocOnDisk: exists(poc ?? ""),
      learnedHeuristic: asString(r.learnedHeuristic) || null,
      severityBasis: asString(r.severityBasis) || null,
    } satisfies PermanentVaultRecord;
  });
  const declared = (k: string): number | null => (typeof raw[k] === "number" ? (raw[k] as number) : null);
  return {
    present: true,
    path: path.relative(process.cwd(), file) || file,
    updatedAt: asString(raw.updatedAt) || null,
    schemaVersion: asString(raw.schemaVersion) || null,
    titleAr: asString(raw.vaultTitleAr) || null,
    counts: {
      vulnerabilities: declared("totalDiscoveredVulnerabilities") ?? vulns.length,
      notes: declared("totalArchitecturalNotes") ?? list("architecturalNotes").length,
      reports: declared("totalSavedDisclosureReports") ?? 0,
      rules: declared("totalLifelongLearningRules") ?? list("lifelongLearningLedger").length,
    },
    vulnerabilities: vulns.slice(0, cap),
    notes: list<{ id: string; title: string; summary: string }>("architecturalNotes").slice(0, cap),
    rules: list<{ id: string; category: string; titleAr: string }>("lifelongLearningLedger").slice(0, cap),
    limit: cap,
  };
}

/** للعرض المختصر: هل الرقم المكتوب في الملف سايق عن عدد المصفوفة؟ (بيحصل فعلًا) */
export function permanentVaultDrift(doc: PermanentVaultDoc = readPermanentVault(50)): { countMismatch: boolean; detail: string } {
  const file = (() => {
    try {
      return JSON.parse(fs.readFileSync(doc.path, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  const listed = Array.isArray(file?.discoveredVulnerabilities) ? (file!.discoveredVulnerabilities as unknown[]).length : -1;
  const declared = doc.counts.vulnerabilities;
  return {
    countMismatch: listed >= 0 && declared !== listed,
    detail: listed < 0 ? "الملف مقروء بس مصفوفة السجلات مش موجودة" : `المكتوب في الملف: ${declared} · الموجود في المصفوفة: ${listed}`,
  };
}
