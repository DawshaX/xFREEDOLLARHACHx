/**
 * The browsing brain: answers with measured data, not vibes.
 * ─────────────────────────────────────────────────────────
 * Before this file the chat was a language model with no access to anything the
 * platform knew. Ask it "كام ثغرة عندك؟" and it would invent a number; ask
 * "CVE-2024-3094 عندي؟" and it would hallucinate a description.
 *
 * This is a small, deterministic tool layer in front of the model:
 *
 *   user text → intent (CVE id / product / status question / how-to)
 *             → real lookups against the corpus + hunt + Actions snapshot
 *             → a context block the model is *told* to answer from
 *
 * The model still writes the sentence, but the facts are ours. If a lookup finds
 * nothing the context says "no rows" and the model is instructed to say so —
 * that is what stops a confident fabrication.
 */
import { refreshSystem, systemSnapshot, knownPages } from "./system-bus";
import type { CorpusRow } from "./corpus-live";

export interface AgentTool {
  id: string;
  labelAr: string;
  run: (arg: string) => Promise<string>;
}

export interface AgentContext {
  /** the block injected into the system prompt */
  context: string;
  /** which tools ran — shown in the UI so the answer is auditable */
  used: Array<{ tool: string; arg: string; rows: number }>;
  /** facts extracted for the deterministic fallback (no model needed) */
  facts: string[];
}

const CVE_RX = /\bCVE-\d{4}-\d{4,}\b/i;
const PRODUCT_HINT = /(?:ثغر|ثغرات|cve|cvss|منتج|product|kev|epss|exploit|اختراق|باونتي)/i;

function rowLine(r: CorpusRow): string {
  const bits = [
    r.id,
    r.cvss != null ? `CVSS ${r.cvss}` : "CVSS ?",
    r.kev ? "KEV=نعم (مستغلّة فعلياً)" : "KEV=لا",
    r.epss != null ? `EPSS ${(r.epss * 100).toFixed(1)}%` : null,
    r.cwe?.length ? r.cwe.join("/") : null,
  ].filter(Boolean);
  return `- ${bits.join(" · ")} — ${r.desc.slice(0, 220)}`;
}

export async function buildAgentContext(userText: string): Promise<AgentContext> {
  const used: AgentContext["used"] = [];
  const facts: string[] = [];
  const blocks: string[] = [];
  const snap = (await refreshSystem()) ?? systemSnapshot();
  const corpus = snap?.corpus;

  /* ── tool 1 · corpus state ─────────────────────────────────────────────── */
  if (corpus) {
    const sev = Object.entries(corpus.bySeverity ?? {}).map(([k, v]) => `${k}:${v}`).join(" · ") || "—";
    blocks.push(
      `[corpus] measured=${corpus.measured} total=${corpus.total} kev=${corpus.kev} epss_scored=${corpus.epssScored} products=${corpus.products} at=${corpus.at ?? "?"} severity=${sev}`,
    );
    used.push({ tool: "corpus.status", arg: "*", rows: corpus.measured ? 1 : 0 });
    if (corpus.measured) facts.push(`الكوربوس فيه ${corpus.total.toLocaleString("en-US")} ثغرة حقيقية (KEV ${corpus.kev})`);
  }

  /* ── tool 2 · exact CVE lookup ─────────────────────────────────────────── */
  const cveMatch = userText.match(CVE_RX)?.[0];
  if (cveMatch && corpus?.measured) {
    const rows = corpus.rows.filter((r) => r.id.toUpperCase() === cveMatch.toUpperCase());
    blocks.push(`[corpus.cve id=${cveMatch}] rows=${rows.length}${rows.length ? `\n${rows.map(rowLine).join("\n")}` : " (not in the loaded slice)"}`);
    used.push({ tool: "corpus.cve", arg: cveMatch, rows: rows.length });
    facts.push(rows.length ? `CVE ${cveMatch} موجود في الكوربوس (${rows[0].sev}${rows[0].cvss ? ` · CVSS ${rows[0].cvss}` : ""})` : `CVE ${cveMatch} مش في الشريحة المحمّلة من الكوربوس`);
  }

  /* ── tool 3 · product search ───────────────────────────────────────────── */
  if (corpus?.measured && !cveMatch && PRODUCT_HINT.test(userText)) {
    const words = userText
      .toLowerCase()
      .match(/[a-z][a-z0-9_.-]{2,}/g)
      ?.filter((w) => !["the", "and", "for", "you", "can", "cve", "cvss", "kev", "epss", "product"].includes(w));
    const needle = words?.[0];
    if (needle) {
      const rows = corpus.rows.filter((r) => r.products.some((p) => p.toLowerCase().includes(needle))).slice(0, 8);
      blocks.push(`[corpus.product q=${needle}] rows=${rows.length}${rows.length ? `\n${rows.map(rowLine).join("\n")}` : " (no product match in the slice)"}`);
      used.push({ tool: "corpus.product", arg: needle, rows: rows.length });
      if (rows.length) facts.push(`${rows.length} ثغرة مرتبطة بـ«${needle}» في الكوربوس، أعلاها ${rows[0].id} (CVSS ${rows[0].cvss ?? "?"})`);
    }
  }

  /* ── tool 4 · what is running right now ────────────────────────────────── */
  if (snap) {
    const running = snap.runs.filter((r) => r.status !== "completed");
    blocks.push(
      `[actions] running=${running.length}${running.length ? ` (${running.map((r) => r.name).join(", ")})` : ""} last=${snap.runs[0] ? `${snap.runs[0].name} ${snap.runs[0].conclusion ?? snap.runs[0].status}` : "—"} error=${snap.runsError ?? "none"}`,
    );
    used.push({ tool: "actions.status", arg: "*", rows: snap.runs.length });
    if (running.length) facts.push(`في ${running.length} workflow شغّال دلوقتي على GitHub Actions`);
  }

  /* ── tool 5 · last hunt ────────────────────────────────────────────────── */
  if (snap?.hunt) {
    const h = snap.hunt;
    blocks.push(
      `[hunt] at=${h.at} targets=${h.totals.targets} findings=${h.totals.findings} high_critical=${h.totals.rated} severity=${JSON.stringify(h.totals.bySeverity)}${
        h.findings.length ? `\n${h.findings.slice(0, 6).map((f) => `- [${f.severity}] ${f.template} @ ${f.matchedAt} (verified=false)`).join("\n")}` : ""
      }`,
    );
    used.push({ tool: "hunt.latest", arg: "*", rows: h.findings.length });
    facts.push(`آخر صيد: ${h.totals.findings} مطابقة على ${h.totals.targets} هدف`);
  }

  /* ── tool 6 · organ map (answers "إيه اللي شغال؟") ─────────────────────── */
  if (snap && /(شغال|متصل|حالة|status|connected|running|إيه اللي)/i.test(userText)) {
    blocks.push(
      `[organs]\n${snap.organs.map((o) => `- ${o.id}: ${o.status} — ${o.detail}`).join("\n")}`,
    );
    used.push({ tool: "system.organs", arg: "*", rows: snap.organs.length });
    facts.push(snap.saysAr);
  }

  /* ── tool 7 · pages the brain can point at ─────────────────────────────── */
  if (/(صفحة|page|فين|where)/i.test(userText)) {
    blocks.push(`[pages] ${knownPages().map((p) => `${p.label}=${p.path}`).join(" · ")}`);
    used.push({ tool: "pages.list", arg: "*", rows: knownPages().length });
  }

  const rules = [
    "أنت NOVA — مخ واعي داخل منصة CyberNova.",
    "استخدم الأرقام والحقول الموجودة في [context] فقط. ممنوع تخترع رقم أو CVE أو حالة.",
    "لو حاجة مش موجودة في السياق، قول بصراحة: «مش مقاس عندي دلوقتي» واشرح إزاي تتقاس.",
    "أي مطابقة صيد = «خيط» لازم يتأكد يدوي قبل أي تقرير (verified=false).",
    "كن مختصر، عملي، وبالعربي إلا لو المستخدم كتب بالإنجليزي.",
  ].join("\n");

  return {
    context: `${rules}\n\n[context]\n${blocks.join("\n")}`,
    used,
    facts,
  };
}

/**
 * The model-free path: if the answer is a pure measurement ("كام ثغرة", "إيه
 * شغال", "CVE-x موجود؟") return it directly. Used as a fallback when every
 * keyless seat is down — the assistant still answers with real numbers.
 */
export function deterministicAnswer(ctx: AgentContext): string | null {
  if (ctx.facts.length === 0) return null;
  return `${ctx.facts.join("\n")}\n\n(الرد ده من القياس المباشر — مفيش موديل اشتغل، والأرقام من نفس المصادر)`;
}
