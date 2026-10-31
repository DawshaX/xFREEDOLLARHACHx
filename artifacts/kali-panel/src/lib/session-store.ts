/**
 * Chat sessions that survive a reload.
 *
 * The workstation used to keep the conversation in component state, so a
 * refresh (or navigating to another tab) wiped it. He asked for a chat he can
 * come back to, so every session is stored locally, keyed by id, and the UI can
 * list/restore/rename/delete them.
 *
 * Storage is `localStorage` only — no server, no account, nothing leaves the
 * browser. If storage is unavailable (private mode) everything still works, it
 * just does not persist, and `persistent()` says so.
 */

export type SessionRole = "user" | "assistant" | "tool" | "note" | "error";

export interface SessionLine {
  id: string;
  role: SessionRole;
  text: string;
  at: number;
  ok?: boolean;
  name?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lines: SessionLine[];
}

const KEY = "cybernova_chat_sessions_v1";
const ACTIVE = "cybernova_chat_active_v1";
const MAX_SESSIONS = 40;
const MAX_LINES = 400;

function store(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function persistent(): boolean {
  return store() !== null;
}

function readAll(): ChatSession[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatSession[]) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.id === "string") : [];
  } catch {
    return [];
  }
}

function writeAll(sessions: ChatSession[]): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    /* quota — keep working in memory */
  }
}

const listeners = new Set<() => void>();
export function onSessionsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(): void {
  listeners.forEach((fn) => fn());
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Title from the first user line, so the list is readable without opening it. */
function titleOf(lines: SessionLine[], fallback: string): string {
  const first = lines.find((l) => l.role === "user" && l.text.trim());
  const raw = first?.text.trim() ?? fallback;
  return raw.length > 42 ? `${raw.slice(0, 42)}…` : raw || fallback;
}

export function listSessions(): ChatSession[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): ChatSession | null {
  return readAll().find((s) => s.id === id) ?? null;
}

export function getActiveId(): string | null {
  try {
    return store()?.getItem(ACTIVE) ?? null;
  } catch {
    return null;
  }
}

export function setActiveId(id: string | null): void {
  try {
    if (id) store()?.setItem(ACTIVE, id);
    else store()?.removeItem(ACTIVE);
  } catch {
    /* ignore */
  }
}

export function createSession(): ChatSession {
  const now = Date.now();
  const session: ChatSession = { id: newSessionId(), title: "محادثة جديدة", createdAt: now, updatedAt: now, lines: [] };
  writeAll([session, ...readAll()]);
  setActiveId(session.id);
  emit();
  return session;
}

/** Append a line and persist. Creates the session on first write. */
export function appendLine(sessionId: string, line: SessionLine): void {
  const all = readAll();
  let idx = all.findIndex((s) => s.id === sessionId);
  if (idx < 0) {
    const now = Date.now();
    all.unshift({ id: sessionId, title: "محادثة جديدة", createdAt: now, updatedAt: now, lines: [] });
    idx = 0;
  }
  const session = all[idx];
  const lines = [...session.lines, line].slice(-MAX_LINES);
  all[idx] = { ...session, lines, title: titleOf(lines, session.title), updatedAt: Date.now() };
  writeAll(all);
  setActiveId(sessionId);
  emit();
}

/** Replace a line in place (streaming text grows one line, not hundreds). */
export function updateLine(sessionId: string, lineId: string, text: string): void {
  const all = readAll();
  const idx = all.findIndex((s) => s.id === sessionId);
  if (idx < 0) return;
  const lines = all[idx].lines.map((l) => (l.id === lineId ? { ...l, text } : l));
  all[idx] = { ...all[idx], lines, updatedAt: Date.now() };
  writeAll(all);
  emit();
}

/** Replace the whole transcript (cheap: called once per settled render). */
export function replaceLines(sessionId: string, lines: SessionLine[]): void {
  const all = readAll();
  let idx = all.findIndex((s) => s.id === sessionId);
  if (idx < 0) {
    const now = Date.now();
    all.unshift({ id: sessionId, title: titleOf(lines, "محادثة جديدة"), createdAt: now, updatedAt: now, lines: [] });
    idx = 0;
  }
  const trimmed = lines.slice(-MAX_LINES);
  all[idx] = {
    ...all[idx],
    lines: trimmed,
    title: titleOf(trimmed, all[idx].title),
    updatedAt: Date.now(),
  };
  writeAll(all);
  setActiveId(sessionId);
  emit();
}

export function deleteSession(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
  if (getActiveId() === id) setActiveId(null);
  emit();
}

export function renameSession(id: string, title: string): void {
  writeAll(readAll().map((s) => (s.id === id ? { ...s, title: title.slice(0, 60), updatedAt: s.updatedAt } : s)));
  emit();
}

export function clearAllSessions(): void {
  writeAll([]);
  setActiveId(null);
  emit();
}

export function exportSession(id: string): string {
  const s = getSession(id);
  if (!s) return "";
  return s.lines.map((l) => `${l.role === "user" ? "أنا" : "نوفا"}: ${l.text}`).join("\n\n");
}
