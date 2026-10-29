/**
 * CyberNova Intelligence Bus
 * ---------------------------------------------------------------------------
 * Shared in-memory store that lets every page/tool publish events and
 * subscribe to intelligence from other tools.  Enables cross-tool awareness
 * (IOC ↔ CVE, Scanner ↔ Assets, Bot ↔ Alerts, etc.)
 */

export type IntelCategory =
  | "cve"
  | "ioc"
  | "asset"
  | "scan"
  | "alert"
  | "bot"
  | "exploit"
  | "threat"
  | "network";

export interface IntelEvent {
  id: string;
  category: IntelCategory;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  detail: string;
  source: string;
  relatedIds?: string[];
  metadata?: Record<string, unknown>;
  timestamp: number;
}

type Listener = (event: IntelEvent) => void;

class IntelligenceBus {
  private events: IntelEvent[] = [];
  private listeners: Listener[] = [];
  private readonly maxEvents = 500;

  /** Publish a new intelligence event from any tool */
  publish(ev: Omit<IntelEvent, "id" | "timestamp">): IntelEvent {
    const full: IntelEvent = {
      ...ev,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    this.events.unshift(full);
    if (this.events.length > this.maxEvents) this.events.pop();
    this.listeners.forEach((l) => {
      try { l(full); } catch { /* noop */ }
    });
    return full;
  }

  /** Subscribe to all new events */
  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Get recent events, optionally filtered */
  getRecent(opts?: { category?: IntelCategory; severity?: string; limit?: number }): IntelEvent[] {
    let ev = [...this.events];
    if (opts?.category) ev = ev.filter((e) => e.category === opts.category);
    if (opts?.severity) ev = ev.filter((e) => e.severity === opts.severity);
    return ev.slice(0, opts?.limit ?? 50);
  }

  /** Get stats per category */
  getStats(): Record<IntelCategory, number> {
    const stats: Partial<Record<IntelCategory, number>> = {};
    for (const ev of this.events) {
      stats[ev.category] = (stats[ev.category] ?? 0) + 1;
    }
    return stats as Record<IntelCategory, number>;
  }

  /** Clear all events */
  clear(): void {
    this.events = [];
  }
}

/** Singleton intelligence bus — import this in any page/tool */
export const intel = new IntelligenceBus();

/** Convenience helpers for common tools */
export const publishCve = (cveId: string, severity: string, title: string, source = "CVE Sync") =>
  intel.publish({ category: "cve", severity: severity as IntelEvent["severity"], title, detail: cveId, source });

export const publishIoc = (value: string, type: string, severity: string, source = "IOC Tracker") =>
  intel.publish({ category: "ioc", severity: severity as IntelEvent["severity"], title: `IOC: ${type} — ${value}`, detail: value, source });

export const publishScan = (target: string, findings: number, severity: string, source = "Active Scanner") =>
  intel.publish({ category: "scan", severity: severity as IntelEvent["severity"], title: `Scan: ${target} — ${findings} نتيجة`, detail: target, source });

export const publishAlert = (title: string, detail: string, severity: string, source = "Monitor") =>
  intel.publish({ category: "alert", severity: severity as IntelEvent["severity"], title, detail, source });

export const publishBot = (action: string, result: string, source = "Bot") =>
  intel.publish({ category: "bot", severity: "info", title: `Bot: ${action}`, detail: result, source });
