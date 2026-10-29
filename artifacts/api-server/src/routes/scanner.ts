import { Router, type IRouter } from "express";
import { z } from "zod";
import { saveMemory } from "./memory";
import { resolveStandaloneApi } from "../lib/standalone-api";
import { broadcastEvent } from "../lib/ws-hub";

const ScanUrlBody = z.object({ url: z.string().min(1) });

const router: IRouter = Router();

interface SecCheck {
  name: string;
  present: boolean;
  value: string;
  recommendation: string;
}

const SECURITY_HEADERS: Array<{ name: string; recommendation: string }> = [
  {
    name: "strict-transport-security",
    recommendation: "Enforce HTTPS with a long max-age and includeSubDomains",
  },
  {
    name: "content-security-policy",
    recommendation: "Define a strict CSP to mitigate XSS",
  },
  { name: "x-frame-options", recommendation: "Set DENY or SAMEORIGIN to prevent clickjacking" },
  { name: "x-content-type-options", recommendation: "Set to nosniff" },
  { name: "referrer-policy", recommendation: "Use strict-origin-when-cross-origin" },
  { name: "permissions-policy", recommendation: "Restrict powerful browser features" },
];

router.post("/scanner/url", async (req, res) => {
  const parsed = ScanUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Valid URL or domain required" });
    return;
  }
  let url = parsed.data.url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const start = Date.now();
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "CyberNova-Scanner/1.0" },
    });
    const elapsed = Date.now() - start;
    const text = await r.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const headers: Array<{ name: string; value: string }> = [];
    r.headers.forEach((value, name) => headers.push({ name, value }));

    const checks: SecCheck[] = SECURITY_HEADERS.map((h) => {
      const v = r.headers.get(h.name);
      return {
        name: h.name,
        present: !!v,
        value: v || "",
        recommendation: h.recommendation,
      };
    });

    const present = checks.filter((c) => c.present).length;
    const score = Math.round((present / checks.length) * 100);
    const risks: string[] = [];
    if (!url.startsWith("https://")) risks.push("Missing HTTPS");
    for (const c of checks) {
      if (!c.present) risks.push(`Missing ${c.name}`);
    }
    if (r.headers.get("server")) risks.push(`Server header exposed: ${r.headers.get("server")}`);

    const summary = `فحص رؤوس الأمان لـ ${url}: الدرجة ${score}/100 (HTTP ${r.status} في ${elapsed}ms). المخاطر: ${risks.join(", ") || "لا يوجد"}`;
    saveMemory("project", `فحص أمني: ${url}`, summary, "scanner,headers", 8, false);
    resolveStandaloneApi("/api/missions/1/findings", "POST", {
      type: "misconfig",
      title: `فحص ترويسات ${url} (${score}/100)`,
      severity: score < 50 ? "medium" : "low",
      detail: summary,
      tool: "HTTP Security Scanner",
    });
    broadcastEvent({
      type: "scan_completed",
      title: `اكتمل فحص ${url} (الدرجة ${score}/100)`,
      target: url,
      score,
      risks,
      ts: Date.now(),
    });

    res.json({
      url,
      status: r.status,
      responseTimeMs: elapsed,
      server: r.headers.get("server") || "",
      contentType: r.headers.get("content-type") || "",
      title: titleMatch?.[1]?.trim() || "",
      headers,
      securityHeaders: checks,
      score,
      risks,
    });
  } catch (err) {
    // Graceful fallback if target blocks automated requests or is unreachable
    const fallback = resolveStandaloneApi("/api/scanner/url", "POST", { url });
    if (fallback) {
      res.json(fallback);
      return;
    }
    res.status(502).json({
      error: err instanceof Error ? err.message : "Scan failed",
    });
  }
});

export default router;
