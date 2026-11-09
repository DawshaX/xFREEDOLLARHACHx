/**
 * Visitor intel · عين على الزيارات — كل زائر بيتبلّغ على تليجرام مع استخبارات سلبية
 * ─────────────────────────────────────────────────────────────────────────────
 * لما حد يفتح الواجهة (طلب HTML مش /api ولا أصول ثابتة):
 *   1) بنلقط الـIP + المتصفح + الصفحة + الوقت.
 *   2) إثراء **سلبي فقط**: GeoIP من ip-api.com (بلا مفتاح) + سجل Shodan عن الـIP
 *      (SHODAN_API_KEY). مفيش أي فحص نشط لجهاز الزائر — لا nmap ولا nuclei ولا
 *      حفر بورتات من عندنا: البيانات اللي بتتعرض مجموعة مسبقًا عند Shodan،
 *      وهو ده الفرق القانوني المهم (استعلام قاعدة بيانات ≠ مسح هدف).
 *   3) رسالة تليجرام واحدة لكل زائر (TTL 6 ساعات افتراضي) — من غير ما الرد يتأخر
 *      ولا مللي ثانية: كل الشغل background بعد next().
 *
 * التحكم: NOVA_VISITOR_ALERTS=0 يطفي كل حاجة · NOVA_VISITOR_INTEL=0 يبعت من غير
 * إثراء · NOVA_VISITOR_IGNORE_IPS="1.2.3.4,5.6.7.8" يستثني IP صاحبك.
 * للاختبار: NOVA_GEOIP_BASE / NOVA_SHODAN_BASE يبدلوا القواعد.
 */
import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger";
import { esc, notifyTelegram, telegramConfigured } from "./telegram";

const GEO_BASE = (process.env.NOVA_GEOIP_BASE || "http://ip-api.com/json").replace(/\/+$/, "");
const SHODAN_BASE = (process.env.NOVA_SHODAN_BASE || "https://api.shodan.io/shodan/host").replace(/\/+$/, "");
const DEDUP_TTL_MS = Number(process.env.NOVA_VISITOR_DEDUP_MS) || 6 * 60 * 60 * 1000;
const SEEN_CAP = 10_000;

const seen = new Map<string, number>();
let activeEnrichments = 0;

function isPrivateIp(ip: string): boolean {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(ip) || ip === "::" || ip === "";
}

export function clientIp(req: Request): string {
  const h = (n: string) => String(req.headers[n] ?? "");
  const raw = h("cf-connecting-ip") || h("x-real-ip") || (h("x-forwarded-for").split(",")[0] || "").trim()
    || String(req.socket?.remoteAddress ?? "");
  return raw.replace(/^::ffff:/, "").trim();
}

function wantsHtml(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (!String(req.headers.accept ?? "").includes("text/html")) return false;
  const p = req.path || "/";
  if (p.startsWith("/api") || p.startsWith("/assets") || p.startsWith("/state") || p === "/favicon.ico") return false;
  return !/\.[a-z0-9]{2,5}$/i.test(p) || p.endsWith(".html");
}

interface GeoInfo { city?: string; country?: string; isp?: string; org?: string; reverse?: string }
interface ShodanInfo { ports?: number[]; org?: string; vulns?: string[] }

async function fetchJson(url: string, ms: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch { return null; }
}

async function enrich(ip: string): Promise<{ geo: GeoInfo | null; shodan: ShodanInfo | null; shodanTried: boolean }> {
  if (process.env.NOVA_VISITOR_INTEL === "0") return { geo: null, shodan: null, shodanTried: false };
  const geoRaw = await fetchJson(`${GEO_BASE}/${encodeURIComponent(ip)}?fields=status,city,country,isp,org,reverse`, 6_000);
  const geo: GeoInfo | null = geoRaw && geoRaw.status === "success"
    ? { city: String(geoRaw.city ?? ""), country: String(geoRaw.country ?? ""), isp: String(geoRaw.isp ?? ""), org: String(geoRaw.org ?? ""), reverse: String(geoRaw.reverse ?? "") }
    : null;

  const key = (process.env.SHODAN_API_KEY || "").trim();
  let shodan: ShodanInfo | null = null;
  if (key) {
    const raw = await fetchJson(`${SHODAN_BASE}/${encodeURIComponent(ip)}?key=${key}`, 7_000);
    if (raw) {
      shodan = {
        ports: Array.isArray(raw.ports) ? raw.ports.map((p) => Number(p)).filter(Number.isFinite) : [],
        org: String(raw.org ?? ""),
        vulns: Array.isArray(raw.vulns) ? raw.vulns.map(String) : [],
      };
    }
  }
  return { geo, shodan, shodanTried: Boolean(key) };
}

async function reportVisit(ip: string, req: Request): Promise<void> {
  activeEnrichments += 1;
  try {
    const { geo, shodan, shodanTried } = await enrich(ip);
    const lines = [
      `👁 زيارة جديدة لعقدة NOVA`,
      `IP: ${esc(ip, 45)}`,
      geo ? `المكان: ${esc(geo.city || "؟", 60)}، ${esc(geo.country || "؟", 60)} — ${esc(geo.isp || geo.org || "؟", 80)}` : "المكان: غير معروف (ip-api ماردّش)",
      geo?.reverse ? `rDNS: ${esc(geo.reverse, 90)}` : null,
      `المتصفح: ${esc(req.headers["user-agent"] || "؟", 140)}`,
      `الصفحة: ${esc(req.originalUrl || req.path, 120)}`,
      `الوقت: ${new Date().toISOString()}`,
      shodanTried
        ? shodan
          ? `شودان (سجل سلبي): بورتات [${(shodan.ports ?? []).slice(0, 12).join(", ") || "لا شيء"}] · org=${esc(shodan.org || "؟", 60)} · CVEs (${(shodan.vulns ?? []).length}): ${(shodan.vulns ?? []).slice(0, 6).map((v) => esc(v, 20)).join(", ") || "لا شيء"}`
          : "شودان (سجل سلبي): مفيش سجل للـIP ده"
        : null,
    ].filter(Boolean).join("\n");
    const sent = await notifyTelegram(`visit:${ip}`, lines, { minIntervalMs: DEDUP_TTL_MS });
    logger.info({ ip, telegramSent: sent }, "visitor reported");
  } catch (e) {
    logger.warn({ err: String(e), ip }, "visitor intel failed silently");
  } finally {
    activeEnrichments -= 1;
  }
}

export function visitorIntelMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (process.env.NOVA_VISITOR_ALERTS === "0" || !telegramConfigured()) return next();
      if (!wantsHtml(req)) return next();
      const ip = clientIp(req);
      if (!ip || isPrivateIp(ip)) return next();
      const ignore = (process.env.NOVA_VISITOR_IGNORE_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (ignore.includes(ip)) return next();
      const now = Date.now();
      const last = seen.get(ip) ?? 0;
      if (now - last < DEDUP_TTL_MS) return next();
      seen.set(ip, now);
      if (seen.size > SEEN_CAP) {
        const oldest = [...seen.entries()].sort((a, b) => a[1] - b[1]);
        for (const [k] of oldest.slice(0, SEEN_CAP / 4)) seen.delete(k);
      }
      if (activeEnrichments < 4) void reportVisit(ip, req);
    } catch {
      /* عين الزيارات عمرها ما توقف الموقع */
    }
    next();
  };
}

/** للاختبارات */
export function _resetVisitorIntelForTests(): { seenSize: number } {
  const s = seen.size;
  seen.clear();
  return { seenSize: s };
}
export function _visitorSeenSize(): number { return seen.size; }
