/**
 * Panel auth · بوابة الدخول على الواجهة كلها — مفيش غريب يستكشف
 * ─────────────────────────────────────────────────────────────────────────────
 * قبل الملف ده: أي حد يعرف الرابط يفتح اللوحة ويتفرّج على الأدوات والأسطول
 * والسجلات. بوابة الـops كانت بتحمي «الأفعال» بس (exec/auto-update…) — لكن
 * صفحات HTML وقراءات كتير كانت مفتوحة. الملف ده بيقفل الموقع كله بصفحة دخول:
 *
 *   • زائر من غير جلسة → صفحة دخول (HTML) أو {login_required} للـAPI.
 *   • الآلات (الوكلاء، المونيتورز) مش بتعامل بكوكيز — طريقهم زي ما هو:
 *     هيدر `x-nova-token` أو `?token=` بقيمة NOVA_EXEC_TOKEN.
 *   • بعد الدخول: كل حركة (صفحة/نداء API) بتتسجّل في state/auth-log.jsonl:
 *     مين، من IP إيه، بمتصفح إيه، عمل إيه، وامتى — والمحاولات الفاشلة كمان
 *     (دي اللي بتكشف الغرباء اللي بيجربوا).
 *
 * الإعداد (اختياري كله — صفر خطوات يدوية على waifly):
 *   NOVA_PANEL_USER   اليوزر (default: "admin")
 *   NOVA_PANEL_PASS   الباسورد (default: قيمة NOVA_EXEC_TOKEN — موجودة أصلًا)
 *   NOVA_PANEL_SECRET مفتاح توقيع الكوكي (default: NOVA_EXEC_TOKEN)
 *   NOVA_SESSION_HOURS مدة الجلسة بالساعات (default: 12، سقف 168)
 *   NOVA_PANEL_AUTH=0 يطفي البوابة تمامًا (معاملات محلية)
 *
 * الجلسة = كوكي HMAC موقّعة (مش محفوظة سيرفر-سايد) ⇒ بتنجو من الريستارت،
 * ومفيش تسريب جلسات من state/. SameSite=Strict + HttpOnly ⇒ CSRF وسرقة
 * سكربت مش واردين في النموذج ده.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

const COOKIE_NAME = "nova_sess";
const MAX_LOG_BYTES = 256 * 1024; // سقف الملف قبل القص — نفس منطق لوج التحديث الذاتي
const KEEP_LINES = 900; // بعد القص نحتفظ بآخر كام سطر
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;

function panelGateEnabled(): boolean {
  if (String(process.env.NOVA_PANEL_AUTH ?? "") === "0") return false;
  // البوابة محتاجة سرّ توقيع على الأقل: التوكن الحالي بيغطي (مضبوط على waifly).
  return Boolean(sessionSecret());
}

function panelUser(): string {
  return (process.env.NOVA_PANEL_USER || "admin").trim() || "admin";
}

function panelPass(): string {
  return (process.env.NOVA_PANEL_PASS || process.env.NOVA_EXEC_TOKEN || "").trim();
}

function sessionSecret(): string {
  return (process.env.NOVA_PANEL_SECRET || process.env.NOVA_EXEC_TOKEN || "").trim();
}

function sessionTtlMs(): number {
  const h = Number(process.env.NOVA_SESSION_HOURS || 12);
  return (Number.isFinite(h) && h > 0 ? Math.min(h, 168) : 12) * 3_600_000;
}

function stateDir(): string {
  return process.env.NOVA_STATE_DIR || path.join(process.cwd(), "state");
}

function logFile(): string {
  return path.join(stateDir(), "auth-log.jsonl");
}

/* ─── توقيع الجلسة (HMAC-SHA256) ─────────────────────────────────────────── */

function sign(value: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function issueSession(user: string): string {
  const payload = Buffer.from(`${user}|${Date.now() + sessionTtlMs()}`, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** يرجع اسم المستخدم لو الكوكي سليم وفي المدة، وإلا null */
export function verifySession(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!safeEq(mac, sign(payload))) return null;
  try {
    const [user, exp] = Buffer.from(payload, "base64url").toString("utf8").split("|");
    if (!user || !Number.isFinite(Number(exp))) return null;
    if (Number(exp) < Date.now()) return null;
    return user;
  } catch {
    return null;
  }
}

/** يقرأ كوكي الجلسة من هيدر Cookie الخام — نقيّة عشان تتنده من index.ts والبوابة */
export function userFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) {
      return verifySession(decodeURIComponent(part.slice(eq + 1).trim()));
    }
  }
  return null;
}

/* ─── سجل «مين دخل وعمل إيه» ─────────────────────────────────────────────── */

export interface AuthLogEntry {
  ts: string;
  kind: "login_ok" | "login_fail" | "logout" | "action" | "token" | "blocked";
  user?: string;
  ip?: string;
  ua?: string;
  method?: string;
  path?: string;
  status?: number;
  detail?: string;
}

export function authLog(entry: Omit<AuthLogEntry, "ts">): void {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.appendFileSync(logFile(), JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n");
    // قصّ دوري: الملف لو عدّى السقف نحتفظ بآخر KEEP_LINES سطر (الأقدم يترمي).
    const st = fs.statSync(logFile());
    if (st.size > MAX_LOG_BYTES) {
      const lines = fs.readFileSync(logFile(), "utf8").split("\n");
      fs.writeFileSync(logFile(), lines.slice(-KEEP_LINES).join("\n"));
    }
  } catch {
    /* نظام ملفات read-only ميكسرش الطلب أبدًا */
  }
}

export function readAuthLog(limit: number): AuthLogEntry[] {
  const n = Math.max(1, Math.min(Number(limit) || 100, 500));
  try {
    const lines = fs.readFileSync(logFile(), "utf8").split("\n").filter(Boolean);
    const out: AuthLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < n; i -= 1) {
      try { out.push(JSON.parse(lines[i]) as AuthLogEntry); } catch { /* سطر مكسور يتخطّى */ }
    }
    return out;
  } catch {
    return [];
  }
}

/* ─── حد المحاولات الفاشلة (5/10 دقائق لكل IP) ───────────────────────────── */

const fails = new Map<string, { n: number; resetAt: number }>();

function failCount(ip: string): number {
  const f = fails.get(ip);
  if (!f || f.resetAt < Date.now()) return 0;
  return f.n;
}

function recordFail(ip: string): void {
  const f = fails.get(ip);
  if (!f || f.resetAt < Date.now()) fails.set(ip, { n: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  else f.n += 1;
  if (fails.size > 5000) fails.clear(); // أمان ذاكرة ضد flood
}

function clientIp(req: Request): string {
  const h = (n: string) => String(req.headers[n] ?? "");
  const raw =
    h("cf-connecting-ip") || h("x-real-ip") || (h("x-forwarded-for").split(",")[0] || "").trim() ||
    String(req.socket?.remoteAddress ?? "");
  return raw.replace(/^::ffff:/, "").trim();
}

/* ─── صفحة الدخول (HTML داخلي — مفيش أصول مطلوبة قبل الجلسة) ─────────────── */

const LOGIN_PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>NOVA · تسجيل الدخول</title>
<style>
  *{box-sizing:border-box;margin:0;font-family:system-ui,"Segoe UI",Tahoma,sans-serif}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070a12;color:#e5e9f2}
  .card{width:340px;padding:32px 28px;border:1px solid #1c2740;border-radius:16px;background:#0d1322;box-shadow:0 18px 60px #000a}
  .logo{font-size:26px;font-weight:800;letter-spacing:2px;color:#4ade80;text-align:center}
  .sub{color:#7c8aad;font-size:13px;text-align:center;margin:6px 0 22px}
  label{display:block;font-size:12px;color:#8fa3c8;margin:14px 0 6px}
  input{width:100%;padding:11px 12px;border-radius:10px;border:1px solid #243a66;background:#0a0f1c;color:#e5e9f2;font-size:15px;outline:0}
  input:focus{border-color:#4ade80}
  button{width:100%;margin-top:22px;padding:12px;border:0;border-radius:10px;background:#16a34a;color:#041b0e;font-weight:800;font-size:15px;cursor:pointer}
  button:disabled{opacity:.55;cursor:wait}
  .err{display:none;margin-top:14px;padding:10px;border-radius:8px;background:#3b0d12;color:#fca5a5;font-size:13px;text-align:center}
  .foot{margin-top:20px;text-align:center;font-size:11px;color:#4b5b7d}
</style></head><body>
<form class="card" id="f" autocomplete="off">
  <div class="logo">NOVA</div>
  <div class="sub">منطقة مقفولة — سجّل دخولك</div>
  <label for="u">اسم المستخدم</label>
  <input id="u" name="user" required autofocus>
  <label for="p">كلمة السر</label>
  <input id="p" name="pass" type="password" required>
  <button id="b" type="submit">دخول</button>
  <div class="err" id="e"></div>
  <div class="foot">كل محاولة دخول بتتسجّل بالوقت والـIP</div>
</form>
<script>
var F=document.getElementById("f"),E=document.getElementById("e"),B=document.getElementById("b");
F.addEventListener("submit",function(ev){
  ev.preventDefault();E.style.display="none";B.disabled=true;B.textContent="بيدخّل…";
  fetch("/api/panel/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({user:F.user.value,pass:F.pass.value})})
  .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
  .then(function(x){
    if(x.ok&&x.j&&x.j.ok){location.replace(String(x.j.next||"/"));return;}
    throw new Error((x.j&&x.j.error)||"بيانات غلط");
  })
  .catch(function(err){E.textContent=err.message;E.style.display="block";B.disabled=false;B.textContent="دخول";});
});
</script></body></html>`;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
}

/* ─── صفحة السجل (لصاحب اللوحة بس) ───────────────────────────────────────── */

function renderLogPage(entries: AuthLogEntry[]): string {
  const rows = entries
    .map((e) => {
      const kindAr =
        e.kind === "login_ok" ? "✅ دخول ناجح" :
        e.kind === "login_fail" ? "🚫 محاولة فاشلة" :
        e.kind === "logout" ? "🚪 خروج" :
        e.kind === "token" ? "🤖 آلة بالتوكن" :
        e.kind === "blocked" ? "⛔ اتمنع" : "⚡ حركة";
      const what = e.kind === "action" || e.kind === "token"
        ? `${esc(e.method || "")} ${esc(e.path || "")} → ${e.status ?? ""}`
        : esc(e.detail || "");
      return `<tr><td>${esc(e.ts.replace("T", " ").slice(0, 19))}Z</td><td>${kindAr}</td><td>${esc(e.user || "—")}</td><td>${esc(e.ip || "")}</td><td class="what">${what}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NOVA · سجل الدخول والحركة</title>
<style>
  *{box-sizing:border-box;margin:0;font-family:system-ui,"Segoe UI",Tahoma,monospace}
  body{background:#070a12;color:#e5e9f2;padding:22px}
  h1{font-size:19px;color:#4ade80;margin-bottom:4px}
  .sub{color:#7c8aad;font-size:12px;margin-bottom:16px}
  a{color:#93c5fd;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{color:#8fa3c8;text-align:right;padding:7px 9px;border-bottom:1px solid #1c2740;position:sticky;top:0;background:#070a12}
  td{padding:6px 9px;border-bottom:1px solid #101a2f;vertical-align:top}
  tr:hover td{background:#0d1322}
  .what{direction:ltr;text-align:left;color:#c4cfe8;word-break:break-all;font-family:ui-monospace,monospace}
</style></head><body>
<h1>سجل «مين دخل وعمل إيه»</h1>
<div class="sub">آخر ${entries.length} حدث · <a href="/">→ اللوحة</a> · <a href="/api/panel/auth-log?limit=200">JSON</a> · تحديث تلقائي كل 20 ثانية</div>
<table><thead><tr><th>الوقت</th><th>الحدث</th><th>المستخدم</th><th>IP</th><th>التفاصيل</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">مفيش أحداث لسه</td></tr>'}</tbody></table>
<script>setTimeout(function(){location.reload()},20000)</script>
</body></html>`;
}

/* ─── الاستثناءات: مسارات الآلات والمراقبة (توكن/مفتوحة عمدًا) ───────────── */

function isExempt(p: string): boolean {
  return (
    p === "/login" || p === "/logout" ||
    p === "/api/panel/login" || p === "/api/panel/logout" ||
    // مراقبة الـuptime (GitHub cron) لازم تفضل مفتوحة وإلا الهب يبان مقفول
    /^\/api\/healthz?\b/.test(p) ||
    // قناة الوكلاء: مصادق عليها بالتوكن في طبقة الـupgrade نفسها
    p.startsWith("/api/local-agent/ws") ||
    // سكربت انضمام العقد — بوتستراب عام بقصد، مفيهوش أسرار
    p === "/api/local-agent/download-nova-agent" ||
    p === "/favicon.ico" || p === "/robots.txt"
  );
}

function wantsHtml(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (!String(req.headers.accept ?? "").includes("text/html")) return false;
  const p = req.path || "/";
  if (p.startsWith("/api")) return false;
  return !/\.[a-z0-9]{2,5}$/i.test(p) || p.endsWith(".html");
}

/** المسار بتاع الضجيج اللي ميبقاش ليه قيمة في السجل (نبضات حية) */
function noisy(p: string): boolean {
  return p.startsWith("/api/push/stream") || p.startsWith("/api/live-events") || p === "/api/panel/auth-log";
}

/* ─── الميدلوير ──────────────────────────────────────────────────────────── */

export function panelAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!panelGateEnabled()) { next(); return; }
    const p = req.path || "/";
    const ip = clientIp(req);
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 160);

    /* صفحة الدخول نفسها */
    if (p === "/login") {
      if (userFromCookieHeader(String(req.headers.cookie ?? ""))) { res.redirect("/"); return; }
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(LOGIN_PAGE);
      return;
    }

    /* محاولة الدخول */
    if (p === "/api/panel/login" && req.method === "POST") {
      res.setHeader("Cache-Control", "no-store");
      if (failCount(ip) >= LOGIN_MAX_FAILS) {
        authLog({ kind: "blocked", ip, ua, detail: "rate-limited: أكتر من 5 محاولات فاشلة" });
        res.status(429).json({ ok: false, error: "محاولات كتير — استنى 10 دقائق" });
        return;
      }
      const body = (req.body ?? {}) as { user?: string; pass?: string; next?: string };
      const okUser = safeEq(String(body.user ?? ""), panelUser());
      const okPass = safeEq(String(body.pass ?? ""), panelPass());
      if (okUser && okPass) {
        const sess = issueSession(panelUser());
        res.setHeader(
          "Set-Cookie",
          `${COOKIE_NAME}=${encodeURIComponent(sess)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionTtlMs() / 1000)}`,
        );
        authLog({ kind: "login_ok", user: panelUser(), ip, ua });
        const nxt = typeof body.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//") ? body.next : "/";
        res.json({ ok: true, next: nxt });
        return;
      }
      recordFail(ip);
      // رد موحّد: مفيش «اليوزر غلط» منفصلة — الغريب ميعرفش أنهي خانة اللي غلط
      authLog({ kind: "login_fail", user: String(body.user ?? "").slice(0, 64), ip, ua });
      logger.warn({ ip, user: String(body.user ?? "").slice(0, 32) }, "panel login failed");
      res.status(401).json({ ok: false, error: "اسم المستخدم أو كلمة السر غلط" });
      return;
    }

    if (p === "/logout" || p === "/api/panel/logout") {
      const user = userFromCookieHeader(String(req.headers.cookie ?? ""));
      res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
      if (user) authLog({ kind: "logout", user, ip, ua });
      if (wantsHtml(req)) { res.redirect("/login"); return; }
      res.json({ ok: true });
      return;
    }

    /* استثناءات الآلات */
    if (isExempt(p)) { next(); return; }

    /* هوية الطلب: توكن آلة أو جلسة متصفح (الاتنين موثّقين) */
    const tok = String(req.headers["x-nova-token"] ?? "") || String(req.query?.token ?? "");
    const hasToken = Boolean(tok && process.env.NOVA_EXEC_TOKEN && safeEq(tok, process.env.NOVA_EXEC_TOKEN.trim()));
    const user = userFromCookieHeader(String(req.headers.cookie ?? ""));

    /* صفحة/واجهة السجل — لأي موثّق (صاحب اللوحة من براوزر، أو أنا عن بُعد بالتوكن) */
    if ((p === "/auth-log" || p === "/api/panel/auth-log") && req.method === "GET") {
      if (!hasToken && !user) {
        if (wantsHtml(req)) { res.type("html").send(LOGIN_PAGE); return; }
        res.status(401).json({ ok: false, error: "login_required", login: "/login" });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      if (p === "/api/panel/auth-log") {
        res.json({ ok: true, entries: readAuthLog(Number(req.query?.limit ?? 100)) });
        return;
      }
      res.type("html").send(renderLogPage(readAuthLog(150)));
      return;
    }

    /* مسار الآلة: توكن الـops (مش بنكسر أي عميل حالي) */
    if (hasToken) {
      if (!noisy(p)) {
        res.on("finish", () => {
          authLog({ kind: "token", ip, ua, method: req.method, path: p, status: res.statusCode });
        });
      }
      next();
      return;
    }

    /* الجلسة */
    if (!user) {
      if (wantsHtml(req)) {
        // ممنوع نكشف وجود الصفحات: نفس صفحة الدخول لأي مسار — الغريب ميعرفش إيه جوه
        res.setHeader("Cache-Control", "no-store");
        res.type("html").send(LOGIN_PAGE);
        return;
      }
      res.status(401).json({ ok: false, error: "login_required", login: "/login" });
      return;
    }

    /* مسجل دخوله — سجّل حركته */
    (req as Request & { panelUser?: string }).panelUser = user;
    if (!noisy(p)) {
      res.on("finish", () => {
        authLog({ kind: "action", user, ip, ua, method: req.method, path: p, status: res.statusCode });
      });
    }

    next();
  };
}

/** لـindex.ts: التحقق من جلسة الكوكي لطلبات WebSocket الخاصة بالواجهة */
export function wsSessionUser(cookieHeader: string | undefined): string | null {
  if (!panelGateEnabled()) return "gate-off";
  return userFromCookieHeader(cookieHeader ?? "");
}
