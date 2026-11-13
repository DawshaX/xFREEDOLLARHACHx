/**
 * ── دفتر المالك الدائم (Owner Journal) — TEST4 ────────────────────────────────
 * «عايزه يتفكر كل حاجة… ديما مينساش ومينفعش».
 *
 * كل دورة كلام (كلمة المالك + رد نوفا + مين رد) بتتكتب سطر بسطر في ملف
 * append-only (`state/owner-journal.jsonl`) — **مايتمسحش أبدًا**: التدبير
 * اللي بيقطع الجلسات عند 180 رسالة مايلمسش الدفتر ده. فوق كده المرايا
 * (memory-store + session-nexus) بتضغط وتمسك المعنى، والدفتر ده هو
 * «سجل الحقيقة» اللي بيرجع له الوعي لو احتاج.
 *
 * منه كمان الراصد (`observeOwner`): بيقرأ الدفتر ويستنتج أنماط المالك —
 * إيقاع ساعات شغله، أكثر المواضيع تكرار، عمق السجل — ويكتبها ذاكرة
 * (`scope: observer`) عشان نوفا تلاحظ اللي المالك نفسه مش ملاحظه.
 */
import fs from "node:fs";
import path from "node:path";
import { isDurableHost } from "./durable-host";
import { remember } from "./memory-store";

export interface OwnerJournalTurn {
  ts: number;
  role: "user" | "assistant";
  text: string;
  provider?: string;
  sessionId?: string;
  topics?: string[];
}

const FILE =
  process.env.NOVA_JOURNAL_FILE ||
  path.resolve(process.cwd(), "state/owner-journal.jsonl");

/** كلمات المواضيع: أدوات/مفاهيم معروفة + CVEs + نطاقات + اقتباسات المالك. */
const TOPIC_WORDS =
  /(?:bug\s*bounty|hackerone|bugcrowd|github|nuclei|nmap|sqlmap|metasploit|burp|recon|subdomain|payload|xss|sqli|ssrf|idor|rce|lfi|csrf|jwt|oauth|cors|cve-\d{4}-\d{4,7}|telegram|ollama|corpus|كرون|جدولة|ذاكرة|مهام|تقرير|استطلاع|ثغرة|ثغرات|فحص|هجوم|دفاع|نشر|نماذج|موديل|شبكة|سيرفر|بورت|نطاق|تسلل|تخفي)/gi;

function extractTopics(text: string): string[] {
  const t = String(text ?? "");
  const out = new Set<string>();
  for (const m of t.matchAll(/CVE-\d{4}-\d{4,7}/gi)) out.add(m[0].toUpperCase());
  for (const m of t.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi)) {
    if (!/^(?:www|http)/i.test(m[0])) out.add(m[0].toLowerCase());
  }
  for (const m of t.matchAll(TOPIC_WORDS)) {
    // CVEs بتجمع من الـregex الأول (بالأحرف الكبيرة) — متكررش هنا بالصغير.
    if (/^cve-/i.test(m[0])) continue;
    out.add(m[0].toLowerCase().replace(/\s+/g, " "));
  }
  for (const m of t.matchAll(/«([^»]{3,60})»/g)) out.add(m[1].trim());
  return [...out].slice(0, 6);
}

export function appendOwnerTurn(t: {
  role: "user" | "assistant";
  text: string;
  provider?: string;
  sessionId?: string;
}): void {
  const text = String(t.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return;
  const line: OwnerJournalTurn = {
    ts: Date.now(),
    role: t.role,
    text: text.slice(0, 400),
    provider: t.provider,
    sessionId: t.sessionId,
    topics: extractTopics(text),
  };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(line) + "\n");
  } catch {
    /* الدفتر best-effort: فشل القرص مايفشّلش الكلام */
  }
}

interface JournalCache {
  mtimeMs: number;
  size: number;
  turns: OwnerJournalTurn[];
  topics: Map<string, number>;
  userTurns: number;
  firstTs: number | null;
}

const cache: JournalCache = { mtimeMs: 0, size: 0, turns: [], topics: new Map(), userTurns: 0, firstTs: null };

function ensureLoaded(): void {
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs === cache.mtimeMs && st.size === cache.size) return;
    const raw = fs.readFileSync(FILE, "utf8");
    const turns: OwnerJournalTurn[] = [];
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        turns.push(JSON.parse(s) as OwnerJournalTurn);
      } catch { /* سطر تالف من نسخة قديمة — متساب */ }
    }
    cache.turns = turns;
    cache.userTurns = turns.filter((t) => t.role === "user").length;
    cache.firstTs = turns.length ? turns[0].ts : null;
    cache.topics = new Map();
    for (const t of turns) {
      if (t.role !== "user") continue;
      for (const topic of t.topics ?? []) cache.topics.set(topic, (cache.topics.get(topic) ?? 0) + 1);
    }
    cache.mtimeMs = st.mtimeMs;
    cache.size = st.size;
  } catch {
    /* مافيش دفتر لسه — طبيعي أول يوم */
  }
}

export function journalStats(): { turns: number; userTurns: number; bytes: number; file: string; durable: boolean; since: string | null } {
  ensureLoaded();
  return {
    turns: cache.turns.length,
    userTurns: cache.userTurns,
    bytes: cache.size,
    file: path.basename(FILE),
    durable: isDurableHost(),
    since: cache.firstTs ? new Date(cache.firstTs).toISOString() : null,
  };
}

export function journalRecent(n = 40): OwnerJournalTurn[] {
  ensureLoaded();
  return cache.turns.slice(-n);
}

export function journalTopTopics(limit = 8): Array<{ topic: string; count: number }> {
  ensureLoaded();
  return [...cache.topics.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic, count]) => ({ topic, count }));
}

/**
 * الراصد — بيقرأ الدفتر ويطلع أنماط صادقة مقاسة. بيرجع عناوين الأنماط
 * الجديدة/المحدّثة (بتتخزن scope:observer بعنوان ثابت فمفيش تكدس).
 */
export function observeOwner(): string[] {
  ensureLoaded();
  if (cache.userTurns < 3) return [];
  const written: string[] = [];

  // 1) إيقاع الساعات: توزيع ساعات رسائل المالك.
  const hours = new Array<number>(24).fill(0);
  for (const t of cache.turns) if (t.role === "user") hours[new Date(t.ts).getHours()]++;
  const peak = hours
    .map((h, i) => ({ h, i }))
    .sort((a, b) => b.h - a.h)
    .slice(0, 2)
    .filter((x) => x.h > 0);
  if (peak.length && peak[0].h >= 3) {
    const label = `إيقاع شغل المالك`;
    const detail = `أكتر الساعات نشاطًا: ${peak.map((p) => `${String(p.i).padStart(2, "0")}:00 (${p.h} رسالة)`).join(" · ")} — من ${cache.userTurns} رسالة مسجلة.`;
    remember({ kind: "lesson", scope: "observer", title: label, content: detail, importance: 6, source: "owner-journal" });
    written.push(label);
  }

  // 2) المواضيع اللي بيرجع لها: تكرار ≥3 يعني اهتمام ثابت مش صدفة.
  const top = journalTopTopics(3).filter((x) => x.count >= 3);
  if (top.length) {
    const label = `مواضيع المالك الثابتة`;
    const detail = `${top.map((t) => `${t.topic} ×${t.count}`).join(" · ")} — راجع لها أكثر من مرة، فلما تناقشها كمّل من آخر تفصيل مش من الصفر.`;
    remember({ kind: "fact", scope: "observer", title: label, content: detail, importance: 7, source: "owner-journal" });
    written.push(label);
  }

  // 3) عمق السجل: من إمتى وإحنا شغالين (ثابت العنوان، بيتهوى بالأرقام الحية).
  if (cache.firstTs && cache.turns.length >= 10) {
    const days = Math.max(1, Math.round((Date.now() - cache.firstTs) / 86_400_000));
    const label = `سجل الشغل مع المالك`;
    const detail = `دفتر دايمًا ماينساش: ${cache.turns.length} دورة (${cache.userTurns} من المالك) على ${days} ${days === 1 ? "يوم" : "أيام"} — كل حاجة مكتوبة ومربوطة.`;
    remember({ kind: "fact", scope: "observer", title: label, content: detail, importance: 5, source: "owner-journal" });
    written.push(label);
  }

  return written;
}
