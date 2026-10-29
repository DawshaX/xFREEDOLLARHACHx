/**
 * Nova Learner Lite — ذاكرة AI مستقلة + تعلم ذاتي (بدون DB)
 * يحلل الأنماط، يدمج الذاكرة، يصنف الثغرات تلقائياً
 */
import { logger } from "./logger";

interface MemoryEntry {
  id: string; type: string; key: string; content: string;
  context: string; tags: string[]; ts: string; confidence: number;
}
interface KnowledgeEntry {
  id: string; title: string; category: string; content: string; tags: string[]; ts: string;
}

const MEMORY: MemoryEntry[] = [];
const KNOWLEDGE: KnowledgeEntry[] = [];
const MAX_MEMORY = 2000;
const MAX_KNOWLEDGE = 1000;

// ── Pattern detection ─────────────────────────────────────────────────────────
const PATTERN_KW: Record<string, string[]> = {
  "rce": ["remote code execution","rce","arbitrary code","command injection"],
  "sqli": ["sql injection","sqli","database injection"],
  "xss": ["cross-site scripting","xss","stored xss"],
  "auth_bypass": ["authentication bypass","auth bypass","unauthenticated"],
  "privilege_escalation": ["privilege escalation","privesc","elevation of privilege"],
  "path_traversal": ["path traversal","directory traversal","../"],
  "ssrf": ["server-side request forgery","ssrf"],
  "deserialization": ["deserialization","deserialize"],
  "buffer_overflow": ["buffer overflow","heap overflow","use-after-free"],
  "xxe": ["xml external entity","xxe"],
};

export function detectPatterns(desc: string): string[] {
  const l = desc.toLowerCase();
  return Object.entries(PATTERN_KW).filter(([,kw]) => kw.some(k => l.includes(k))).map(([p]) => p);
}

// ── Memory API ─────────────────────────────────────────────────────────────────
export function saveMemoryLite(entry: Omit<MemoryEntry,"id"|"ts">): string {
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  if (MEMORY.length >= MAX_MEMORY) MEMORY.shift();
  MEMORY.push({ ...entry, id, ts: new Date().toISOString() });
  return id;
}

export function searchMemoryLite(query: string, limit = 10): MemoryEntry[] {
  const q = query.toLowerCase();
  return MEMORY.filter(m => m.content.toLowerCase().includes(q) || m.tags.some(t => t.includes(q))).slice(-limit).reverse();
}

export function getMemoryLite(type?: string, limit = 50): MemoryEntry[] {
  const items = type ? MEMORY.filter(m => m.type === type) : MEMORY;
  return items.slice(-limit).reverse();
}

export function getMemoryStats(): Record<string,number> {
  const stats: Record<string,number> = { total: MEMORY.length };
  for (const m of MEMORY) stats[m.type] = (stats[m.type]??0)+1;
  return stats;
}

// ── Knowledge API ──────────────────────────────────────────────────────────────
export function addKnowledge(entry: Omit<KnowledgeEntry,"id"|"ts">): string {
  const id = `kn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  if (KNOWLEDGE.length >= MAX_KNOWLEDGE) KNOWLEDGE.shift();
  KNOWLEDGE.push({ ...entry, id, ts: new Date().toISOString() });
  return id;
}

export function searchKnowledge(query: string, category?: string, limit = 20): KnowledgeEntry[] {
  const q = query.toLowerCase();
  return KNOWLEDGE
    .filter(k => (!category || k.category === category) && (k.title.toLowerCase().includes(q) || k.content.toLowerCase().includes(q) || k.tags.some(t => t.includes(q))))
    .slice(-limit).reverse();
}

export function getKnowledge(category?: string, limit = 50): KnowledgeEntry[] {
  const items = category ? KNOWLEDGE.filter(k => k.category === category) : KNOWLEDGE;
  return items.slice(-limit).reverse();
}

// ── Learning cycles ────────────────────────────────────────────────────────────
export interface LearningResult { patternsFound: number; memoriesSaved: number; insights: string[] }

export async function learnFromCves(cves: Array<{id: string; description: string; severity?: string; cvss?: number}>): Promise<LearningResult> {
  const result: LearningResult = { patternsFound: 0, memoriesSaved: 0, insights: [] };
  const patternCounts: Record<string,number> = {};
  const critical: string[] = [];
  for (const c of cves) {
    const pts = detectPatterns(c.description);
    for (const p of pts) { patternCounts[p] = (patternCounts[p]??0)+1; result.patternsFound++; }
    if ((c.cvss??0) >= 9.0) critical.push(c.id);
  }
  const topPatterns = Object.entries(patternCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([p,c])=>`${p}:${c}`).join(", ");
  saveMemoryLite({ type:"cve_pattern", key:`cve_pat_${Date.now()}`, content:`تحليل ${cves.length} ثغرة — أبرز الأنماط: ${topPatterns} — حرجة(CVSS≥9): ${critical.slice(0,10).join(",")||"لا يوجد"}`, context:"auto-learning", tags:["learning","cve","pattern","auto"], confidence:0.9 });
  result.memoriesSaved++;
  if (topPatterns) result.insights.push(`أبرز نمط هجوم: ${Object.entries(patternCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "غير محدد"}`);
  if (critical.length >= 3) result.insights.push(`⚠️ ${critical.length} ثغرة حرجة CVSS≥9 رُصدت`);
  logger.info({ cves: cves.length, patterns: result.patternsFound }, "Nova Learner: CVE learning done");
  return result;
}

export function consolidateMemoryLite(): number {
  const successes = MEMORY.filter(m => m.type === "success_pattern").slice(-20);
  if (successes.length < 3) return 0;
  saveMemoryLite({ type:"consolidated_insight", key:`consol_${Date.now()}`, content:`ملخص موحّد (${successes.length} نتيجة): ${successes.slice(0,5).map(s=>s.content.slice(0,100)).join(" | ")}`, context:"auto-consolidation", tags:["consolidation","auto"], confidence:0.85 });
  return 1;
}

// ── Background runner ─────────────────────────────────────────────────────────
export function startLearner(): void {
  // Memory consolidation every 30 min
  setInterval(() => { const n = consolidateMemoryLite(); if (n > 0) logger.info({ n }, "Nova Learner: consolidated memory"); }, 30*60_000);
  logger.info("Nova Learner Lite started — auto memory consolidation active");
}
