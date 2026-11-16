/**
 * Ops · HTTP hardening — the three headers/limits the server was missing
 * ─────────────────────────────────────────────────────────────────────────────
 * Measured on 2026-11-15, before this file existed:
 *
 *   • `app.use(cors())` with no options. That is `Access-Control-Allow-Origin: *`
 *     on every response, including the ops endpoints. It does not by itself
 *     grant access (the gate still runs), but it removes the browser's own
 *     same-origin protection from the picture: any page on the internet could
 *     read the JSON of any GET endpoint, and could send credentialed requests
 *     if a cookie ever became SameSite=None. The gate's `sameOriginOk()` is the
 *     only thing left standing, and it is explicitly documented as "a speed
 *     bump, NOT auth". Closing CORS restores the layer underneath it.
 *
 *   • No `helmet`. So: no `X-Content-Type-Options: nosniff` (a browser may
 *     sniff a JSON error page as HTML and run it), no `X-Frame-Options` (the
 *     panel could be framed and clickjacked — and the panel has buttons that
 *     run commands), no HSTS, and `X-Powered-By: Express` advertised the stack.
 *
 *   • No rate limiting anywhere. `/api/panel/login` accepted unlimited password
 *     guesses, and every ops endpoint accepted unlimited requests.
 *
 * WHAT THIS FILE DOES NOT DO
 *   It does not change the gate, the auth model, or any route's behaviour. It
 *   only adds the transport-level defaults that were absent. Every value is
 *   overridable by env so a deployment can adapt without a code change.
 *
 * WHY CORS IS NOT SIMPLY "OFF"
 *   The panel is served by this same server (see the static block in app.ts),
 *   so same-origin requests need no CORS headers at all. But the operator also
 *   drives the API from scripts and from the Waifly host, so an explicit
 *   allowlist is kept — defaulting to same-origin only, extendable with
 *   NOVA_ALLOWED_ORIGINS. A request with no Origin (curl, server-to-server) is
 *   always allowed through, because CORS is a browser mechanism and blocking
 *   non-browser clients here would break the CLI for no security gain.
 */
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

/** Origins the browser is allowed to read responses from. */
function allowedOrigins(): string[] {
  const raw = (process.env.NOVA_ALLOWED_ORIGINS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * CORS with an explicit allowlist.
 *
 * `origin: true` would reflect whatever the caller sent — that is the same as
 * `*` for our purposes and is exactly what we are removing. So: no Origin →
 * allow (non-browser client); Origin in the allowlist → allow; anything else →
 * no CORS headers, which makes the browser block the read. The request still
 * reaches the server and the gate still decides — CORS is not the auth layer,
 * it is the layer that stops a foreign page from *reading* our answers.
 */
export function corsMiddleware() {
  const list = allowedOrigins();
  return cors({
    origin(origin, cb) {
      // No Origin header: curl, a server, a same-origin navigation. Not a
      // browser cross-origin request, so CORS does not apply.
      if (!origin) return cb(null, true);
      if (list.includes(origin)) return cb(null, true);
      // Same-origin requests from the panel: the browser sends the Origin of
      // the page, which is this server's own host. Compare host-to-host so a
      // port or scheme difference on the same host still counts as same-origin.
      try {
        const o = new URL(origin);
        const selfHost = (process.env.NOVA_PUBLIC_HOST || "").trim();
        if (selfHost && o.host === selfHost) return cb(null, true);
      } catch {
        /* malformed Origin — fall through to deny */
      }
      // Deny by omitting the header (not by throwing): the request is still
      // served, the browser just refuses to hand the body to the page.
      logger.warn({ origin }, "cors: origin not in allowlist — no CORS headers");
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-nova-token", "x-requested-with"],
    maxAge: 600,
  });
}

/**
 * Security headers.
 *
 * `contentSecurityPolicy` is deliberately left at helmet's default rather than
 * disabled: the panel is a Vite SPA that loads its own bundle and talks to the
 * same origin, which the default policy permits. If a deployment needs inline
 * scripts it can set NOVA_CSP_OFF=1 — but the default is the safe one.
 *
 * `crossOriginEmbedderPolicy` is off because the panel embeds noVNC and remote
 * images; turning it on would break those without adding protection here.
 */
export function securityHeaders() {
  const cspOff = process.env.NOVA_CSP_OFF === "1";
  return helmet({
    contentSecurityPolicy: cspOff
      ? false
      : {
          directives: {
            /* الافتراضي فيه script-src أصلاً — بنشيله الأول عشان ميبانش duplicate
             * (helmet بيرمي على التكرار — قِيس 02:58Z: السيرفر ماقبلش يقعد)
             * وبنرجّعه بالقيمة الجديدة تحت مع connect-src. */
            ...(() => {
              const d = { ...helmet.contentSecurityPolicy.getDefaultDirectives() };
              delete d["script-src"];
              return d;
            })(),
            // TEST34 — قِيس على البناء المحلي (2026-11-15T12:34Z): CSP الافتراضي
            // مافيهوش connect-src → بيرجع لـdefault-src 'self' → المتصفح بيسدّ
            // فetch raw.githubusercontent.com اللي بطاقة «حالة النشر» على ‎/kali-env
            // بتعمله كل 30د (المرآة الحية من الrunner). من غير السطر ده الميزة
            // بتسقط بصمت على النسخة المخبّأة جوّه الباندل. img-src سبنا 'self' data:
            // زي ما هو — الصور كلها أصول محلية مقيسة.
            connectSrc: ["'self'", "https://raw.githubusercontent.com"],
            // TEST40 — قِيس حي (2026-11-16T02:56Z): صفحة الدخول بتاعتها <script>
            // inline (panel-auth LOGIN_PAGE) وCSP الافتراضي script-src 'self'
            // بيمنعها في المتصفح → زر «دخول» بييدوس وماتحصلش حاجة (شكوى
            // المالك المقاسة). 'unsafe-inline' للسكريبتات المدمجة في الصفحات
            // الداخلية (login · auth-log) — والباقي زي ما هو (object-src none
            // · frame-ancestors self · nosniff). سكريبتات اللوحة نفسها خارجية
            // من نفس الأصل فمابتتأثرش.
            scriptSrc: ["'self'", "'unsafe-inline'"],
          },
        },
    crossOriginEmbedderPolicy: false,
    // The panel is served from this origin and is not meant to be framed.
    frameguard: { action: "sameorigin" },
    referrerPolicy: { policy: "same-origin" },
    hsts: process.env.NOVA_HSTS_OFF === "1" ? false : { maxAge: 15552000, includeSubDomains: true },
  });
}

/** Strip the framework banner. Cheap, and it removes a fingerprinting signal. */
export function hidePoweredBy(_req: Request, res: Response, next: NextFunction) {
  res.removeHeader("X-Powered-By");
  next();
}

/**
 * Rate limiters.
 *
 * Two tiers, because the two surfaces have different threat models:
 *   • `authLimiter` — login and token endpoints. Tight, and keyed on IP+path.
 *     A password guess is expensive for the attacker only if we make it so.
 *   • `apiLimiter`  — everything else. Generous enough that the panel's 12s
 *     polling and SSE reconnects never trip it, tight enough that a flood is
 *     slowed. SSE streams are exempted (they are long-lived by design).
 *
 * Both are in-memory. That is correct for a single-process deployment (which
 * this is — the panel and the API share one process). A multi-replica
 * deployment would need a shared store; the comment says so rather than
 * pretending the limit is global.
 */
export function authLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.NOVA_AUTH_RATE_LIMIT || 20),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Do not count successful logins against the budget — only failures.
    skipSuccessfulRequests: true,
    message: { ok: false, error: "too_many_attempts", says_ar: "محاولات كتير — استنى شوية وحاول تاني." },
  });
}

export function apiLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.NOVA_API_RATE_LIMIT || 600),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // SSE and long-poll endpoints must not be counted: one connection is one
    // request that stays open, and reconnects are normal.
    skip: (req) => {
      const p = req.path || "";
      return p.endsWith("/stream") || p.includes("/stream/") || p.endsWith("/events");
    },
    message: { ok: false, error: "rate_limited", says_ar: "طلبات كتير في وقت قصير — استنى لحظة." },
  });
}
