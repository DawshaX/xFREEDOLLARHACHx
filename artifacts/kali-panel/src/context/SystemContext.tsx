import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export interface SystemEvent {
  type: string;
  ts: number;
  data?: Record<string, unknown>;
}

export interface MemoryEvent {
  id: string;
  pinned?: boolean;
  memoryType: string;
  key: string;
  content: string;
  ts: number;
  importance?: number;
  createdAt?: string | number;
  tags?: string;
}

export interface AutonomousStatus {
  enabled: boolean;
  tasksCompleted: number;
  tasksErrored: number;
  isRunning: boolean;
}

interface SystemContextValue {
  autonomousStatus: AutonomousStatus;
  systemEvents: SystemEvent[];
  memoryEvents: MemoryEvent[];
  enableAutonomous: () => void;
  disableAutonomous: () => void;
  runAutonomousTask: (prompt: string) => Promise<void>;
  refreshAll: () => void;
}

const DEFAULT_STATUS: AutonomousStatus = { enabled: false, tasksCompleted: 0, tasksErrored: 0, isRunning: false };

/* الأسماء اللي بترجع من `/api/memory` مش مضمونة الشكْل (id رقم، ts تاريخ نصّي،
 * tags متحوّلة…) — أي حقل غلط كان بيرمي الكومبوننت كله. فكل عنصر بيتنظّف هنا
 * قبل ما يدخل الـstate، واللي مابيطلعش ذكرى صالحة بيتسقط بس. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function toMemoryEvent(value: unknown): MemoryEvent | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = record.id;
  const key = record.key ?? record.title;
  const content = record.content;
  if (id === undefined || key === undefined || typeof content !== "string") return null;
  const createdAt = record.createdAt;
  return {
    id: String(id),
    memoryType: String(record.memoryType ?? record.kind ?? "fact"),
    key: String(key),
    content,
    ts: Number(record.ts ?? (typeof createdAt === "string" ? Date.parse(createdAt) : createdAt) ?? Date.now()),
    importance: Number(record.importance ?? 0),
    pinned: typeof record.pinned === "boolean" ? record.pinned : undefined,
    createdAt: typeof createdAt === "string" || typeof createdAt === "number" ? createdAt : undefined,
    tags: typeof record.tags === "string" ? record.tags : undefined,
  };
}

async function fetchMemoryEvents(): Promise<MemoryEvent[]> {
  const response = await fetch("/api/memory?limit=50", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const record = asRecord(payload);
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.entries)
      ? (record.entries as unknown[])
      : Array.isArray(record?.memories)
        ? (record.memories as unknown[])
        : null;
  if (!values) throw new Error("شكل رد /api/memory مش قائمة ذكريات");
  return values.map(toMemoryEvent).filter((entry): entry is MemoryEvent => entry !== null);
}

const SystemContext = createContext<SystemContextValue>({
  autonomousStatus: DEFAULT_STATUS,
  systemEvents: [],
  memoryEvents: [],
  enableAutonomous: () => {},
  disableAutonomous: () => {},
  runAutonomousTask: async () => {},
  refreshAll: () => {},
});

export function SystemProvider({ children }: { children: ReactNode }) {
  const [autonomousStatus, setAutonomousStatus] = useState<AutonomousStatus>(DEFAULT_STATUS);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [memoryEvents, setMemoryEvents] = useState<MemoryEvent[]>([]);

  const addEvent = useCallback((type: string, data?: Record<string, unknown>) => {
    setSystemEvents(prev => [{ type, ts: Date.now(), data }, ...prev].slice(0, 200));
  }, []);

  const enableAutonomous = useCallback(() => {
    setAutonomousStatus(s => ({ ...s, enabled: true }));
    addEvent("autonomous_enabled");
    void fetch("/api/agent/autonomous/enable", { method: "POST" }).catch(() => {});
  }, [addEvent]);

  const disableAutonomous = useCallback(() => {
    setAutonomousStatus(s => ({ ...s, enabled: false }));
    addEvent("autonomous_disabled");
    void fetch("/api/agent/autonomous/disable", { method: "POST" }).catch(() => {});
  }, [addEvent]);

  const runAutonomousTask = useCallback(async (prompt: string) => {
    addEvent("task_started", { prompt: prompt.slice(0, 100) });
    setAutonomousStatus(s => ({ ...s, isRunning: true }));
    try {
      await fetch("/api/agent/autonomous/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setAutonomousStatus(s => ({ ...s, tasksCompleted: s.tasksCompleted + 1, isRunning: false }));
      addEvent("task_completed");
    } catch {
      setAutonomousStatus(s => ({ ...s, tasksErrored: s.tasksErrored + 1, isRunning: false }));
      addEvent("task_error");
    }
  }, [addEvent]);

  const loadMemories = useCallback(() => {
    fetchMemoryEvents()
      .then(setMemoryEvents)
      .catch((error: unknown) => addEvent("memory_refresh_failed", {
        error: error instanceof Error ? error.message : String(error),
      }));
  }, [addEvent]);

  const refreshAll = useCallback(() => {
    addEvent("refresh");
    loadMemories();
  }, [addEvent, loadMemories]);

  // الذكريات المحفوظة كانت بتبان بس بعد حدث memory_saved — يعني أول ما تفتح
  // اللوحة القائمة فاضية. التحميل بقى عند الفتح، والفشل معلن مش مبتلوع.
  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  useEffect(() => {
    const es = new EventSource("/api/agent/events");
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string) as { type?: string; [key: string]: unknown };
        addEvent(d.type ?? "event", d);
        if (d.type === "memory_saved") {
          setMemoryEvents(prev => [{
            id: String(d.id ?? Date.now()),
            memoryType: String(d.memoryType ?? "fact"),
            key: String(d.key ?? ""),
            content: String(d.content ?? ""),
            ts: Date.now(),
            importance: Number(d.importance ?? 0),
          }, ...prev].slice(0, 200));
        }
        if (d.type === "task_completed") {
          setAutonomousStatus(s => ({ ...s, tasksCompleted: s.tasksCompleted + 1 }));
        }
        if (d.type === "task_error") {
          setAutonomousStatus(s => ({ ...s, tasksErrored: s.tasksErrored + 1 }));
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [addEvent]);

  return (
    <SystemContext.Provider value={{ autonomousStatus, systemEvents, memoryEvents, enableAutonomous, disableAutonomous, runAutonomousTask, refreshAll }}>
      {children}
    </SystemContext.Provider>
  );
}

export function useSystem() {
  return useContext(SystemContext);
}
