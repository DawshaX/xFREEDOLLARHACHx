/**
 * NOVA Session Nexus — الوعي الجذري والجلسات المستمرة مدى الحياة
 * ──────────────────────────────────────────────────────────────────
 * المبدأ الهندسي (مستلهم من TiMem / AutoDreaming):
 *   1. هناك جلسة جذر دائمة (`nova-root`) لا تموت أبداً: تُحفظ على القرص
 *      (`state/nova-sessions.json`) وتتلقى نبضات الخلفية (watchers / cron /
 *      autonomous-daemon / auto-learning) حتى والمستخدم مغلق للمتصفح.
 *   2. يستطيع المستخدم إنشاء أي عدد من الجلسات الإضافية؛ كل جلسة فرعية تظل
 *      متصلة بالجذر (`parentId: "nova-root"`): تقرأ ملخص الجذر + آخر أحداث
 *      الخلفية + الدروس المستفادة، وتصب تعلمها واكتشافاتها في الذاكرة الموحدة
 *      وتيار الجذر.
 *   3. الحفظ ذريّ (tmp + rename) ومؤمّن بـ debounce حتى لا تتلف الحالة أبداً.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import { broadcastEvent } from "../ws-hub";
import { memoryStats, remember } from "./memory-store";
import { detectPatterns, saveMemoryLite } from "../nova-learner-lite";

export const ROOT_SESSION_ID = "nova-root";

export interface NexusMessage {
  role: "system" | "user" | "assistant" | "background";
  content: string;
  ts: number;
  toolsUsed?: string[];
  provider?: string;
}

export interface NexusBackgroundEvent {
  id: string;
  kind: string;
  title: string;
  detail: string;
  ts: string;
  source: string;
  sessionId?: string;
}

export interface NexusSession {
  id: string;
  title: string;
  isRoot: boolean;
  parentId: string | null;
  backgroundLinked: boolean;
  planMode: boolean;
  pendingPlan: string | null;
  messages: NexusMessage[];
  summary: string;
  /* TEST3 «لو موديل خلص أو بدل هو ميبقاش تايه ومكمل معايا على نفس الخط»:
   * خط المحادثة (جست آخر رسائل المالك) + آخر موديل جاب رد + ملاحظة تبديل —
   * بتتحقن في سياق أي مزوّد يخطف الدور، فالكيان واحد والموديل دعم بس. */
  thread?: string[];
  lastModel?: string;
  modelSwitchNote?: string;
  createdAt: number;
  updatedAt: number;
}

interface NexusStoreFile {
  version: 1;
  updatedAt: string;
  rootDigest: string;
  backgroundFeed: NexusBackgroundEvent[];
  learnedInsights: string[];
  sessions: Record<string, NexusSession>;
}

const DEFAULT_SESSIONS_FILE = process.env.NOVA_SESSIONS_FILE
  ? path.resolve(process.env.NOVA_SESSIONS_FILE)
  : path.resolve(process.cwd(), "state/nova-sessions.json");

const MAX_MESSAGES_PER_SESSION = 180;
const MAX_BACKGROUND_FEED = 60;
const MAX_INSIGHTS = 30;
const MAX_CHILD_SESSIONS = 48;

let store: NexusStoreFile = {
  version: 1,
  updatedAt: new Date().toISOString(),
  rootDigest: "الجذر الدائم مفعّل — جاهز للاستمرار في الخلفية وحفظ التعلم عبر الجلسات.",
  backgroundFeed: [],
  learnedInsights: [],
  sessions: {},
};

let booted = false;
let writeTimer: NodeJS.Timeout | null = null;
const recentEventSigs = new Map<string, number>();

function makeRootSession(now = Date.now()): NexusSession {
  return {
    id: ROOT_SESSION_ID,
    title: "الجذر الدائم — NOVA Root (24/7)",
    isRoot: true,
    parentId: null,
    backgroundLinked: true,
    planMode: false,
    pendingPlan: null,
    messages: [],
    summary: "الجلسة الجذرية المستمرة مدى الحياة — متصلة بالخلفية والذاكرة والوعي الكلي.",
    createdAt: now,
    updatedAt: now,
  };
}

function scheduleFlush(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushSessionNexus();
  }, 350);
  writeTimer.unref?.();
}

export function flushSessionNexus(): boolean {
  try {
    store.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(DEFAULT_SESSIONS_FILE), { recursive: true });
    const tmp = `${DEFAULT_SESSIONS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, DEFAULT_SESSIONS_FILE);
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "session-nexus: write failed");
    return false;
  }
}

export function initSessionNexus(): void {
  if (booted) return;
  booted = true;
  try {
    if (fs.existsSync(DEFAULT_SESSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DEFAULT_SESSIONS_FILE, "utf8")) as Partial<NexusStoreFile>;
      if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object") {
        store = {
          version: 1,
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
          rootDigest: typeof parsed.rootDigest === "string" ? parsed.rootDigest : store.rootDigest,
          backgroundFeed: Array.isArray(parsed.backgroundFeed) ? parsed.backgroundFeed.slice(0, MAX_BACKGROUND_FEED) : [],
          learnedInsights: Array.isArray(parsed.learnedInsights) ? parsed.learnedInsights.slice(0, MAX_INSIGHTS) : [],
          sessions: parsed.sessions,
        };
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "session-nexus: load failed, starting fresh");
  }
  if (!store.sessions[ROOT_SESSION_ID]) {
    store.sessions[ROOT_SESSION_ID] = makeRootSession();
  } else {
    store.sessions[ROOT_SESSION_ID].isRoot = true;
    store.sessions[ROOT_SESSION_ID].backgroundLinked = true;
    store.sessions[ROOT_SESSION_ID].parentId = null;
  }
  scheduleFlush();
}

function ensureBooted(): void {
  if (!booted) initSessionNexus();
  if (!store.sessions[ROOT_SESSION_ID]) {
    store.sessions[ROOT_SESSION_ID] = makeRootSession();
  }
}

function trimSessionMessages(sess: NexusSession): void {
  if (sess.messages.length <= MAX_MESSAGES_PER_SESSION) return;
  const dropped = sess.messages.slice(0, sess.messages.length - MAX_MESSAGES_PER_SESSION);
  sess.messages = sess.messages.slice(-MAX_MESSAGES_PER_SESSION);
  const digestTail = dropped
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-4)
    .map((m) => m.content.slice(0, 80))
    .join(" · ");
  if (digestTail) {
    sess.summary = `آخر سياق مضغوط: ${digestTail.slice(0, 260)}`;
  }
}

function pruneChildSessions(): void {
  const children = Object.values(store.sessions)
    .filter((s) => !s.isRoot)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const extra of children.slice(MAX_CHILD_SESSIONS)) {
    delete store.sessions[extra.id];
  }
}

export function getNexusSession(id: string): NexusSession | null {
  ensureBooted();
  return store.sessions[id] ?? null;
}

export function getOrCreateNexusSession(id: string, title?: string): NexusSession {
  ensureBooted();
  const cleanId = String(id || ROOT_SESSION_ID).trim() || ROOT_SESSION_ID;
  const existing = store.sessions[cleanId];
  if (existing) return existing;

  const isRoot = cleanId === ROOT_SESSION_ID;
  const now = Date.now();
  const created: NexusSession = isRoot
    ? makeRootSession(now)
    : {
        id: cleanId,
        title: title?.trim() || `جلسة متصلة #${Object.keys(store.sessions).length}`,
        isRoot: false,
        parentId: ROOT_SESSION_ID,
        backgroundLinked: true,
        planMode: false,
        pendingPlan: null,
        messages: [],
        summary: "جلسة فرعية متصلة بالجذر والذاكرة والخلفية الدائمة.",
        createdAt: now,
        updatedAt: now,
      };
  store.sessions[cleanId] = created;
  pruneChildSessions();
  scheduleFlush();
  return created;
}

export function createNexusSession(title?: string): NexusSession {
  ensureBooted();
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sess = getOrCreateNexusSession(id, title || `جلسة عمل ${new Date().toLocaleTimeString("ar-EG")}`);
  recordBackgroundEvent({
    kind: "session",
    title: "جلسة متصلة جديدة",
    detail: `أُنشئت «${sess.title}» (${sess.id}) ومرتبطة بالجذر والخلفية.`,
    source: "session-nexus",
    sessionId: sess.id,
  });
  return sess;
}

export function listNexusSessions(): Array<{
  id: string;
  title: string;
  isRoot: boolean;
  parentId: string | null;
  backgroundLinked: boolean;
  summary: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}> {
  ensureBooted();
  const all = Object.values(store.sessions);
  all.sort((a, b) => {
    if (a.isRoot && !b.isRoot) return -1;
    if (!a.isRoot && b.isRoot) return 1;
    return b.updatedAt - a.updatedAt;
  });
  return all.slice(0, 50).map((s) => ({
    id: s.id,
    title: s.title,
    isRoot: s.isRoot,
    parentId: s.parentId,
    backgroundLinked: s.backgroundLinked,
    summary: s.summary,
    createdAt: new Date(s.createdAt).toISOString(),
    updatedAt: new Date(s.updatedAt).toISOString(),
    messageCount: s.messages.length,
  }));
}

export function deleteNexusSession(id: string): { ok: boolean; clearedRoot?: boolean } {
  ensureBooted();
  if (id === ROOT_SESSION_ID) {
    // الجذر لا يُحذف أبداً — لو طُلب مسحه يتم تصفير سجل العرض فقط مع بقائه حيّاً
    const root = store.sessions[ROOT_SESSION_ID];
    root.messages = [];
    root.updatedAt = Date.now();
    scheduleFlush();
    return { ok: true, clearedRoot: true };
  }
  const existed = Boolean(store.sessions[id]);
  delete store.sessions[id];
  if (existed) scheduleFlush();
  return { ok: existed };
}

export function appendNexusRawMessage(
  sessionId: string,
  msg: { role: NexusMessage["role"]; content: string; toolsUsed?: string[]; provider?: string },
): void {
  const sess = getOrCreateNexusSession(sessionId);
  const text = String(msg.content ?? "").trim();
  if (!text) return;
  sess.messages.push({
    role: msg.role,
    content: text,
    ts: Date.now(),
    toolsUsed: msg.toolsUsed,
    provider: msg.provider,
  });
  sess.updatedAt = Date.now();
  trimSessionMessages(sess);
  scheduleFlush();
}

export function recordBackgroundEvent(opts: {
  kind: string;
  title: string;
  detail: string;
  source: string;
  sessionId?: string;
  persistMemory?: boolean;
}): void {
  ensureBooted();
  const sig = `${opts.kind}:${opts.title}:${opts.detail.slice(0, 100)}`;
  const now = Date.now();
  const prevAt = recentEventSigs.get(sig) ?? 0;
  if (now - prevAt < 10 * 60_000) return;
  recentEventSigs.set(sig, now);
  if (recentEventSigs.size > 200) {
    const firstKey = recentEventSigs.keys().next().value as string | undefined;
    if (firstKey) recentEventSigs.delete(firstKey);
  }

  const ev: NexusBackgroundEvent = {
    id: `bg-${now}-${Math.random().toString(36).slice(2, 6)}`,
    kind: opts.kind,
    title: opts.title.slice(0, 120),
    detail: opts.detail.slice(0, 500),
    ts: new Date(now).toISOString(),
    source: opts.source,
    sessionId: opts.sessionId,
  };
  store.backgroundFeed.unshift(ev);
  if (store.backgroundFeed.length > MAX_BACKGROUND_FEED) {
    store.backgroundFeed.length = MAX_BACKGROUND_FEED;
  }
  store.rootDigest = `${ev.title}: ${ev.detail.slice(0, 220)}`;

  // نسجّل النبضة في الذاكرة الدائمة عند الطلب أو للمراقبات والتعلم
  if (opts.persistMemory) {
    try {
      remember({
        kind: "event",
        scope: "global",
        title: ev.title,
        content: `[${ev.source}] ${ev.detail}`,
        tags: ["background", opts.kind, opts.source],
        importance: 5,
        source: `nexus:${opts.source}`,
      });
    } catch {
      /* best-effort */
    }
  }

  try {
    broadcastEvent({ type: "nexus_background", event: ev, ts: now });
  } catch {
    /* ws hub optional */
  }
  scheduleFlush();
}

/**
 * استخلاص تعلّم ذاتي حقيقي من كل محادثة + ربطه بالذاكرة الدائمة وتيار الجذر.
 */
export function recordNexusTurn(
  sessionId: string,
  opts: {
    userMessage: string;
    assistantReply: string;
    toolsUsed?: string[];
    mode?: string;
    provider?: string;
    skipUserAppend?: boolean;
  },
): void {
  ensureBooted();
  const sess = getOrCreateNexusSession(sessionId);
  const now = Date.now();
  const userMsg = String(opts.userMessage ?? "").trim();
  const reply = String(opts.assistantReply ?? "").trim();

  if (userMsg && !opts.skipUserAppend) {
    sess.messages.push({ role: "user", content: userMsg, ts: now });
  }
  if (reply) {
    sess.messages.push({
      role: "assistant",
      content: reply,
      ts: now + 1,
      toolsUsed: opts.toolsUsed,
      provider: opts.provider,
    });
  }
  sess.updatedAt = Date.now();
  if (userMsg) {
    sess.summary = `${userMsg.slice(0, 90)}${opts.toolsUsed?.length ? ` [${opts.toolsUsed.join(", ")}]` : ""}`;
    /* خط المحادثة المستمر: جست رسالة المالك — بيفضل موجود مهما اتبدل الموديل.
     * الترحيبات/الردود القصيرة مش مواضيع — بتتستبعد عشان «فاكرك واقفين فين»
     * مايقولش «فاكرك قلت مرحبا». */
    const gist = userMsg.replace(/\s+/g, " ").slice(0, 80);
    const smallTalkish = /^(?:مرحبا|أهلاً?|اهلاً?|هاي|هلا|سلام|صباح\s+\S+|مساء\s+\S+|ازيك|إزيك|شكراً?|تمام|طيب|ماشي|يلا|ok|okay|hi|hello|hey|thanks|yo)\b/i;
    if (gist && !smallTalkish.test(gist)) {
      if (!sess.thread) sess.thread = [];
      if (sess.thread[sess.thread.length - 1] !== gist) sess.thread.push(gist);
      if (sess.thread.length > 8) sess.thread = sess.thread.slice(-8);
    }
  }
  /* وعي تبديل الموديل: لو المزوّد اتغير بين دورين — سجّلها عشان الرد الجاي
   * يكمّل واعيًا («الموديل اتبدل من X لـ Y — نفس الخط») مش تايه. */
  const prov = String(opts.provider ?? "").trim();
  if (prov && prov !== "nova-builtin" && prov !== "nova-heuristic") {
    if (sess.lastModel && sess.lastModel !== prov) {
      sess.modelSwitchNote = `الموديل اتبدل (${sess.lastModel} → ${prov}) — نفس الجلسة والذاكرة والخط`;
    }
    sess.lastModel = prov;
  }
  trimSessionMessages(sess);

  // ── التعلم الذاتي الفوري (Auto-Learning Extractor) ────────────────────────
  const combined = `${userMsg}\n${reply}`;
  const cves = [...new Set(combined.match(/CVE-\d{4}-\d{4,7}/gi) ?? [])].slice(0, 8);
  const patterns = detectPatterns(combined);
  const domains = [...new Set(
    (userMsg.match(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|ai|edu|gov|eg|sa)\b/gi) ?? [])
      .map((d) => d.toLowerCase()),
  )].slice(0, 5);

  const insightsAdded: string[] = [];
  if (cves.length > 0) {
    const line = `ثغرات متداولة في الجلسة (${sess.isRoot ? "الجذر" : sess.title}): ${cves.join(", ")}`;
    insightsAdded.push(line);
    try {
      remember({
        kind: "fact",
        scope: domains[0] || "global",
        title: `رصد ${cves[0]}${cves.length > 1 ? ` (+${cves.length - 1})` : ""}`,
        content: line,
        tags: ["cve", "auto-learn", ...cves],
        importance: 7,
        source: "nexus-auto",
      });
    } catch { /* ignore */ }
  }

  if (patterns.length > 0 && opts.toolsUsed && opts.toolsUsed.length > 0) {
    const line = `نمط مستخلص [${patterns.join(", ")}] عبر أدوات (${opts.toolsUsed.join(", ")}) على ${domains[0] || "النظام"}`;
    insightsAdded.push(line);
    try {
      saveMemoryLite({
        type: "success_pattern",
        key: `nexus_${now}`,
        content: line,
        context: sess.id,
        tags: ["auto", ...patterns],
        confidence: 0.85,
      });
    } catch { /* ignore */ }
  }

  if (insightsAdded.length > 0) {
    for (const ins of insightsAdded) {
      if (!store.learnedInsights.includes(ins)) {
        store.learnedInsights.unshift(ins);
      }
    }
    if (store.learnedInsights.length > MAX_INSIGHTS) {
      store.learnedInsights.length = MAX_INSIGHTS;
    }
  }

  // لو الجلسة فرعية وفيها شغل بأدوات، نبلغ الجذر في backgroundFeed
  if (!sess.isRoot && opts.toolsUsed && opts.toolsUsed.length > 0) {
    recordBackgroundEvent({
      kind: "child_session",
      title: `نشاط من «${sess.title}»`,
      detail: `نُفّذت (${opts.toolsUsed.join(", ")}) للطلب: ${userMsg.slice(0, 100)}`,
      source: sess.id,
      sessionId: sess.id,
    });
  }

  try {
    broadcastEvent({
      type: "session_nexus_turn",
      sessionId: sess.id,
      isRoot: sess.isRoot,
      toolsUsed: opts.toolsUsed ?? [],
      ts: Date.now(),
    });
  } catch { /* ignore */ }

  scheduleFlush();
}

export function addNexusInsight(insight: string): void {
  ensureBooted();
  const clean = insight.trim().slice(0, 260);
  if (!clean || store.learnedInsights.includes(clean)) return;
  store.learnedInsights.unshift(clean);
  if (store.learnedInsights.length > MAX_INSIGHTS) {
    store.learnedInsights.length = MAX_INSIGHTS;
  }
  scheduleFlush();
}

/**
 * السياق الجذري الموحّد الذي يُحقن في كل دورة محادثة (في الجذر أو في أي جلسة فرعية)
 * ليكون العقل متصلاً بالخلفية وبكل الجلسات والذاكرة الدائمة في نفس الوقت.
 */
export function buildNexusContext(sessionId: string): string {
  ensureBooted();
  const current = store.sessions[sessionId];
  const root = store.sessions[ROOT_SESSION_ID];
  const totalSessions = Object.keys(store.sessions).length;
  const recentBg = store.backgroundFeed.slice(0, 6);
  const recentInsights = store.learnedInsights.slice(0, 5);

  const lines: string[] = [
    `# وعي الجذر الموحّد (Root Nexus)`,
    `- هويتك الآن: ${current?.isRoot === false ? `جلسة فرعية «${current.title}» مرتبطة بالجذر الدائم (${ROOT_SESSION_ID})` : `الجلسة الجذرية المستمرة مدى الحياة (${ROOT_SESSION_ID})`}`,
    `- إجمالي الجلسات المرتبطة بالخلفية: ${totalSessions} (كلها تتشارك نفس الذاكرة ونبضات الخلفية)`,
    `- موجز الجذر الحالي: ${store.rootDigest}`,
  ];

  /* TEST3: خط المحادثة — الوعي اللي بيسمع بعد أي تبديل موديل. */
  if (current?.thread?.length) {
    lines.push(`- خط المحادثة مع المالك (مكمّل بلا انقطاع — الموديل دعم بس، الكيان هو أنت):`);
    lines.push(...current.thread.slice(-6).map((t) => `  · ${t}`));
  }
  if (current?.modelSwitchNote) {
    lines.push(`- ⚡ ${current.modelSwitchNote} — كمّل طبيعي من وين وقفنا.`);
    current.modelSwitchNote = undefined;
  } else if (current?.lastModel) {
    lines.push(`- آخر مزوّد جاب رد: ${current.lastModel} — لو اتبدل الدور لمزوّد تاني، سياق الجلسة والذاكرة فوق كفاية أن تكمل كأن مفيش حاجة حصلت.`);
  }

  if (current && !current.isRoot && root && root.messages.length > 0) {
    const rootTail = root.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-3)
      .map((m) => `  · [${m.role === "user" ? "المستخدم" : "نوفا"}] ${m.content.replace(/\s+/g, " ").slice(0, 120)}`);
    if (rootTail.length) {
      lines.push(`- آخر تفاعل على الجذر (${ROOT_SESSION_ID}):`);
      lines.push(...rootTail);
    }
  }

  if (recentBg.length > 0) {
    lines.push(`- آخر أحداث الخلفية التلقائية (${recentBg.length}):`);
    for (const ev of recentBg) {
      lines.push(`  · [${ev.kind}] ${ev.title}: ${ev.detail.slice(0, 140)}`);
    }
  }

  if (recentInsights.length > 0) {
    lines.push(`- أحدث استنتاجات التعلّم الذاتي:`);
    for (const ins of recentInsights) {
      lines.push(`  · ${ins}`);
    }
  }

  return lines.join("\n");
}

export function getNexusSnapshot(): {
  rootSessionId: string;
  totalSessions: number;
  rootMessageCount: number;
  backgroundFeedCount: number;
  learnedInsightsCount: number;
  memoryTotal: number;
  rootDigest: string;
  recentBackground: NexusBackgroundEvent[];
  learnedInsights: string[];
  sessions: ReturnType<typeof listNexusSessions>;
} {
  ensureBooted();
  const root = store.sessions[ROOT_SESSION_ID];
  let memTotal = 0;
  try {
    memTotal = memoryStats().total;
  } catch {
    memTotal = 0;
  }
  return {
    rootSessionId: ROOT_SESSION_ID,
    totalSessions: Object.keys(store.sessions).length,
    rootMessageCount: root?.messages.length ?? 0,
    backgroundFeedCount: store.backgroundFeed.length,
    learnedInsightsCount: store.learnedInsights.length,
    memoryTotal: memTotal,
    rootDigest: store.rootDigest,
    recentBackground: store.backgroundFeed.slice(0, 12),
    learnedInsights: store.learnedInsights.slice(0, 10),
    sessions: listNexusSessions(),
  };
}
