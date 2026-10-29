/**
 * CyberNova Watchdog — Ollama-only health monitoring.
 * Probes Ollama every 5 minutes, posts alerts if unavailable,
 * and re-seeds the default cron jobs if the table was wiped.
 */

import { db, botCronJobs, botAlerts, settings } from "@workspace/db";
import {
  listEnabledProviders,
  markProviderExhausted,
  type ProviderId,
  type ProviderInfo,
} from "./ai-router-ollama-only";
import { logger } from "./logger";

export interface ProviderHealth {
  id: ProviderId;
  family: ProviderInfo["family"];
  source: ProviderInfo["source"];
  available: boolean;
  enabled: boolean;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  lastCheckedAt: string;
}

const lastHealth = new Map<ProviderId, ProviderHealth>();

import { getOllamaBaseUrl } from "./ollama-settings";

async function probeOne(p: ProviderInfo): Promise<ProviderHealth> {
  const base: ProviderHealth = {
    id: p.id,
    family: p.family,
    source: p.source,
    available: p.available,
    enabled: p.enabled,
    healthy: false,
    lastCheckedAt: new Date().toISOString(),
  };
  if (!p.enabled) {
    return { ...base, error: "disabled" };
  }
  const start = Date.now();
  try {
    // Use lightweight /api/tags check instead of inference to avoid blocking Ollama
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const ollamaBase = await getOllamaBaseUrl();
    const r = await fetch(`${ollamaBase}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    const ms = Date.now() - start;
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    return { ...base, healthy: true, latencyMs: ms, available: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markProviderExhausted(p.id, msg);
    return { ...base, healthy: false, available: false, error: msg.slice(0, 200) };
  }
}

export async function probeAllProviders(): Promise<ProviderHealth[]> {
  const list = await listEnabledProviders();
  const results = await Promise.all(list.map((p) => probeOne(p)));
  for (const r of results) lastHealth.set(r.id, r);
  try {
    await db
      .insert(settings)
      .values({ key: "watchdog_last_run", value: new Date().toISOString() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: new Date().toISOString(), updatedAt: new Date() },
      });
    await db
      .insert(settings)
      .values({ key: "watchdog_last_health", value: JSON.stringify(results) })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(results), updatedAt: new Date() },
      });
  } catch {
    // ignore
  }
  return results;
}

export function getCachedHealth(): ProviderHealth[] {
  return Array.from(lastHealth.values());
}

const DEFAULT_CRONS = [
  {
    name: "Ollama Health Check",
    description: "فحص اتصال Ollama كل 15 دقيقة",
    cronExpression: "*/15 * * * *",
    prompt: "تحقق من حالة Ollama على http://127.0.0.1:11434 وأرسل تقريراً بحالة الاتصال.",
  },
  {
    name: "تقرير الأمن اليومي",
    description: "يولّد تقريراً يومياً عن الوضع الأمني",
    cronExpression: "0 8 * * *",
    prompt: "اصنع تقريراً أمنياً يومياً موجزاً عن الثغرات والأنشطة الأمنية.",
  },
];

export async function ensureDefaultCrons(): Promise<{ added: number; total: number }> {
  const existing = await db.select().from(botCronJobs);
  const existingNames = new Set(existing.map((j) => j.name));
  let added = 0;
  for (const def of DEFAULT_CRONS) {
    if (existingNames.has(def.name)) continue;
    await db.insert(botCronJobs).values(def);
    added++;
  }
  const after = await db.select().from(botCronJobs);
  return { added, total: after.length };
}

export interface WatchdogReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  health: ProviderHealth[];
  healthyCount: number;
  totalAvailable: number;
  cronJobs: { added: number; total: number };
  alertSent: boolean;
}

export async function runWatchdogCycle(): Promise<WatchdogReport> {
  const startedAt = new Date();
  const start = startedAt.getTime();
  const health = await probeAllProviders();
  const totalAvailable = 1; // always 1 for Ollama
  const healthyCount = health.filter((h) => h.healthy).length;
  const cronJobs = await ensureDefaultCrons();

  let alertSent = false;
  if (healthyCount === 0) {
    try {
      await db.insert(botAlerts).values({
        severity: "critical",
        title: "Ollama غير متاح",
        message: `لا يمكن الاتصال بـ Ollama. تأكد أن الخدمة تعمل وأن OLLAMA_ORIGINS="*" مضبوط.`,
        source: "watchdog",
      });
      alertSent = true;
    } catch {
      // ignore
    }
  }

  const finishedAt = new Date();
  const report: WatchdogReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - start,
    health,
    healthyCount,
    totalAvailable,
    cronJobs,
    alertSent,
  };
  logger.info({ healthyCount, cronJobs }, "Watchdog cycle done");
  return report;
}

export function startWatchdog(): void {
  setTimeout(() => {
    void runWatchdogCycle().catch((e) => logger.warn({ err: String(e) }, "Watchdog initial run failed"));
  }, 20_000);
  setInterval(() => {
    void runWatchdogCycle().catch((e) => logger.warn({ err: String(e) }, "Watchdog cycle failed"));
  }, 5 * 60_000);
  logger.info("Watchdog started (Ollama-only, 5-min probe)");
}
