/**
 * Visitor intel · عين على الزيارات — كل زائر بيتبلّغ على تليجرام مع استخبارات سلبية وفحص شامل
 * ─────────────────────────────────────────────────────────────────────────────
 * لما حد يفتح الواجهة (طلب HTML مش /api ولا أصول ثابتة):
 *   1) بنلقط الـIP + المتصفح + الجهاز/النظام + اسم المضيف العكسي (rDNS) + الصفحة + الوقت.
 *   2) إثراء سلبي شامل: GeoIP من ip-api.com (بلا مفتاح) + PTR عكسي + سجل Shodan عن الـIP
 *      (SHODAN_API_KEY).
 *   3) رسالة تليجرام فورية لكل زائر (TTL 6 ساعات افتراضي) + حفظ في سجل رادار الزوار الحي
 *      لعرضه في لوحة كالي 2099 وإمكانية الفحص العميق وإعادة الإرسال للتليجرام بضغطة زر.
 *
 * التحكم: NOVA_VISITOR_ALERTS=0 يطفي كل حاجة · NOVA_VISITOR_INTEL=0 يبعت من غير
 * إثراء · NOVA_VISITOR_IGNORE_IPS="1.2.3.4,5.6.7.8" يستثني IP صاحبك.
 * للاختبار: NOVA_GEOIP_BASE / NOVA_SHODAN_BASE يبدلوا القواعد.
 */
import type { NextFunction, Request, Response } from "express";
import * as dns from "node:dns";
import { logger } from "../logger";
import { esc, notifyTelegram, telegramConfigured } from "./telegram";

const GEO_BASE = (process.env.NOVA_GEOIP_BASE || "http://ip-api.com/json").replace(/\/+$/, "");
const SHODAN_BASE = (process.env.NOVA_SHODAN_BASE || "https://api.shodan.io/shodan/host").replace(/\/+$/, "");
const DEDUP_TTL_MS = Number(process.env.NOVA_VISITOR_DEDUP_MS) || 6 * 60 * 60 * 1000;
const SEEN_CAP = 10_000;
const LOG_CAP = 150;

export interface VisitorIntelRecord {
  id: string;
  timestamp: string;
  ip: string;
  reverseHost: string;
  city: string;
  country: string;
  isp: string;
  org: string;
  userAgent: string;
  deviceSummary: string;
  path: string;
  ports: number[];
  vulns: string[];
  verdict: string;
  telegramSent: boolean;
}

const seen = new Map<string, number>();
const visitorLog: VisitorIntelRecord[] = [];
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

export function parseVisitorDevice(uaRaw: string): string {
  const ua = String(uaRaw || "");
  if (!ua) return "غير معروف";
  const os =
    /Windows NT 10/i.test(ua) ? "Windows 10/11" :
    /Windows/i.test(ua) ? "Windows" :
    /Android/i.test(ua) ? "Android" :
    /iPhone|iPad|iOS/i.test(ua) ? "iOS / iPhone" :
    /Mac OS X|Macintosh/i.test(ua) ? "macOS" :
    /Kali/i.test(ua) ? "Kali Linux" :
    /Linux/i.test(ua) ? "Linux" : "OS غير محدد";
  const browser =
    /Edg\//i.test(ua) ? "Edge" :
    /OPR\/|Opera/i.test(ua) ? "Opera" :
    /Chrome\//i.test(ua) ? "Chrome" :
    /Firefox\//i.test(ua) ? "Firefox" :
    /Safari\//i.test(ua) && !/Chrome/i.test(ua) ? "Safari" :
    /curl|wget|python|scanner|nuclei|nmap|sqlmap|nikto/i.test(ua) ? "أداة فحص / CLI Bot" : "متصفح ويب";
  const devType = /Mobile|Android|iPhone/i.test(ua) ? "هاتف محمول" : /Tablet|iPad/i.test(ua) ? "جهاز لوحي" : "حاسوب مكتبي / خادم";
  return `${devType} · ${os} · ${browser}`;
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

async function resolvePtrSafe(ip: string): Promise<string> {
  if (!ip || isPrivateIp(ip) || process.env.NOVA_GEOIP_BASE) return "";
  try {
    const names = await Promise.race([
      dns.promises.reverse(ip),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 2_000)),
    ]);
    return Array.isArray(names) && names[0] ? String(names[0]) : "";
  } catch {
    return "";
  }
}

async function enrich(ip: string): Promise<{ geo: GeoInfo | null; shodan: ShodanInfo | null; shodanTried: boolean }> {
  if (process.env.NOVA_VISITOR_INTEL === "0") return { geo: null, shodan: null, shodanTried: false };
  const geoRaw = await fetchJson(`${GEO_BASE}/${encodeURIComponent(ip)}?fields=status,city,country,isp,org,reverse`, 6_000);
  let reverseHost = geoRaw && geoRaw.status === "success" ? String(geoRaw.reverse ?? "") : "";
  if (!reverseHost) {
    reverseHost = await resolvePtrSafe(ip);
  }
  const geo: GeoInfo | null = geoRaw && geoRaw.status === "success"
    ? {
        city: String(geoRaw.city ?? ""),
        country: String(geoRaw.country ?? ""),
        isp: String(geoRaw.isp ?? ""),
        org: String(geoRaw.org ?? ""),
        reverse: reverseHost,
      }
    : reverseHost
      ? { city: "", country: "", isp: "", org: "", reverse: reverseHost }
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

function computeVisitorVerdict(ua: string, ports: number[], vulns: string[]): string {
  if (vulns.length > 0) return `⚠️ رصد ${vulns.length} ثغرات CVE مسجلة على IP الزائر`;
  if (/scanner|nuclei|sqlmap|nikto|nmap|masscan|zgrab|dirbuster/i.test(ua)) return "🚨 أداة فحص أمني / ماسح آلي";
  if (ports.length >= 4) return `🔍 خادم نشط (${ports.length} منافذ مفتوحة)`;
  return "✅ زائر قياسي تم فحصه وتوثيقه";
}

function recordVisitorEntry(entry: VisitorIntelRecord): void {
  const existingIdx = visitorLog.findIndex((v) => v.ip === entry.ip);
  if (existingIdx !== -1) {
    visitorLog.splice(existingIdx, 1);
  }
  visitorLog.unshift(entry);
  if (visitorLog.length > LOG_CAP) {
    visitorLog.length = LOG_CAP;
  }
}

export function getVisitorIntelLog(): VisitorIntelRecord[] {
  return [...visitorLog];
}

export async function inspectVisitorNow(
  ip: string,
  meta: { userAgent?: string; path?: string; forceTelegram?: boolean } = {},
): Promise<VisitorIntelRecord> {
  const cleanIp = String(ip || "").trim() || "0.0.0.0";
  const ua = String(meta.userAgent || "Mozilla/5.0");
  const reqPath = String(meta.path || "/");
  const deviceSummary = parseVisitorDevice(ua);
  const { geo, shodan, shodanTried } = await enrich(cleanIp);
  const ports = shodan?.ports ?? [];
  const vulns = shodan?.vulns ?? [];
  const verdict = computeVisitorVerdict(ua, ports, vulns);

  const lines = [
    `🕌 بسم الله الرحمن الرحيم — لا إله إلا الله · الله أكبر ولله الحمد`,
    `👁 زيارة جديدة لعقدة NOVA (رادار حراس الكون 2099)`,
    `IP: ${esc(cleanIp, 45)}`,
    geo ? `المكان: ${esc(geo.city || "؟", 60)}، ${esc(geo.country || "؟", 60)} — ${esc(geo.isp || geo.org || "؟", 80)}` : "المكان: غير معروف (ip-api ماردّش)",
    geo?.reverse ? `rDNS: ${esc(geo.reverse, 90)}` : null,
    `الجهاز والنظام: ${esc(deviceSummary, 100)}`,
    `المتصفح: ${esc(ua || "؟", 140)}`,
    `الصفحة: ${esc(reqPath, 120)}`,
    `الفحص الأمني التلقائي: ${esc(verdict, 100)}`,
    `الوقت: ${new Date().toISOString()}`,
    shodanTried
      ? shodan
        ? `شودان (سجل سلبي): بورتات [${ports.slice(0, 12).join(", ") || "لا شيء"}] · org=${esc(shodan.org || "؟", 60)} · CVEs (${vulns.length}): ${vulns.slice(0, 6).map((v) => esc(v, 20)).join(", ") || "لا شيء"}`
        : "شودان (سجل سلبي): مفيش سجل للـIP ده"
      : null,
  ].filter(Boolean).join("\n");

  const sent = await notifyTelegram(
    `visit:${cleanIp}`,
    lines,
    meta.forceTelegram ? { bypassThrottle: true } : { minIntervalMs: DEDUP_TTL_MS },
  );

  const rec: VisitorIntelRecord = {
    id: `vis-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ip: cleanIp,
    reverseHost: geo?.reverse || "بدون سجل PTR عكسي",
    city: geo?.city || "غير محدد",
    country: geo?.country || "غير محدد",
    isp: geo?.isp || "غير محدد",
    org: geo?.org || shodan?.org || "غير محدد",
    userAgent: ua,
    deviceSummary,
    path: reqPath,
    ports,
    vulns,
    verdict,
    telegramSent: sent,
  };
  recordVisitorEntry(rec);
  return rec;
}

async function reportVisit(ip: string, req: Request): Promise<void> {
  activeEnrichments += 1;
  try {
    const rec = await inspectVisitorNow(ip, {
      userAgent: String(req.headers["user-agent"] || "؟"),
      path: String(req.originalUrl || req.path || "/"),
    });
    logger.info({ ip, telegramSent: rec.telegramSent }, "visitor reported");
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
  visitorLog.length = 0;
  return { seenSize: s };
}
export function _visitorSeenSize(): number { return seen.size; }
