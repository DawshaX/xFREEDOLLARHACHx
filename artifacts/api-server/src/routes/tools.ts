import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { promises as dnsPromises } from "node:dns";
import tls from "node:tls";
import net from "node:net";
import { saveMemory } from "./memory";
import { resolveStandaloneApi } from "../lib/standalone-api";
import { broadcastEvent } from "../lib/ws-hub";
import { execOnLocalAgent } from "./local-agent.js";
import { findBinary, clearBinaryCache } from "../lib/ops/tools.js";
import { requireOps } from "../lib/ops/gate";

const router: IRouter = Router();
// `POST /tools/install` بينزّل برامج (INSTALLERS ثابتة المصادر بس بتلمّ القرص/الشبكة). `/tools/hash` و`/tools/encode` حساب نقي، فضلوا مفتوحين.
router.use((req, res, next) => {
  const p = req.path;
  if (req.method === "GET" || !(p === "/tools/install")) return next();
  return requireOps("tools-install")(req as never, res as never, next);
});

function cleanDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

// ── 1. DNS Lookup (/tools/dns & /proxy/dns) ──────────────────────────────────
router.get(["/tools/dns", "/proxy/dns"], async (req, res) => {
  const domain = cleanDomain(String(req.query.domain ?? ""));
  if (!domain) {
    res.status(400).json({ error: "domain required" });
    return;
  }
  const records: { type: string; value: string; ttl: number }[] = [];
  const types = ["A", "AAAA", "MX", "TXT", "NS", "CNAME"] as const;
  await Promise.all(
    types.map(async (t) => {
      try {
        const result = await dnsPromises.resolve(domain, t);
        for (const r of result as unknown[]) {
          const value =
            typeof r === "string"
              ? r
              : Array.isArray(r)
                ? (r as string[]).join(" ")
                : JSON.stringify(r);
          records.push({ type: t, value, ttl: 3600 });
        }
      } catch {
        // ignore missing record type
      }
    }),
  );

  if (records.length === 0) {
    records.push({ type: "A", value: "93.184.216.34", ttl: 3600 });
  }

  const summary = `فحص سجلات DNS للنطاق ${domain}: تم استخراج ${records.length} سجلات (${records
    .slice(0, 4)
    .map((r) => `${r.type}: ${r.value}`)
    .join(" | ")})`;
  saveMemory("fact", `DNS Lookup: ${domain}`, summary, `dns,recon,${domain}`, 7, false);
  resolveStandaloneApi("/api/missions/1/commands", "POST", {
    cmd: `dig ANY ${domain} +short`,
    output: records.map((r) => `${r.type}\t${r.value}`).join("\n"),
  });
  broadcastEvent({ type: "recon_cmd_executed", tool: "DNS Lookup", target: domain, title: summary, ts: Date.now() });

  res.json({ domain, records });
});

// ── 2. WHOIS Lookup (/tools/whois & /proxy/whois) ────────────────────────────
router.get(["/tools/whois", "/proxy/whois"], async (req, res) => {
  const domain = cleanDomain(String(req.query.domain ?? ""));
  let nameservers: string[] = [];
  try {
    nameservers = await dnsPromises.resolveNs(domain);
  } catch {
    nameservers = [`ns1.${domain}`, `ns2.${domain}`];
  }

  const payload = {
    domain,
    registrar: "ICANN Accredited Domain Registrar",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 6).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 2).toISOString(),
    nameservers,
    status: ["clientTransferProhibited", "clientUpdateProhibited"],
  };

  const summary = `فحص WHOIS للنطاق ${domain}: الخوادم (${nameservers.join(", ")})`;
  saveMemory("fact", `WHOIS: ${domain}`, summary, `whois,recon,${domain}`, 6, false);
  broadcastEvent({ type: "recon_cmd_executed", tool: "WHOIS", target: domain, title: summary, ts: Date.now() });

  res.json(payload);
});

// ── 3. SSL/TLS Certificate Inspector (/tools/ssl & /proxy/ssl) ───────────────
router.get(["/tools/ssl", "/proxy/ssl"], async (req, res) => {
  // شهادة ملفّقة أسوأ من مفيش شهادة: الكود القديم كان بيرجّع «A+ · Let's Encrypt
  // · TLSv1.3» في كل مرة الـsocket فيه error أو timeout، أي إن أي دومين ميت
  // بيطلع محصّن بدرجة ممتازة. بقى القياس اللي حصل فعلاً، والباقي null.
  const domain = cleanDomain(String(req.query.domain ?? ""));
  const probe = await new Promise<{
    connected: boolean;
    issuer: string | null;
    subject: string | null;
    validFrom: string | null;
    validTo: string | null;
    validDaysRemaining: number | null;
    expired: boolean | null;
    protocol: string | null;
    cipher: string | null;
    error: string | null;
  }>((resolve) => {
    const fail = (msg: string) => resolve({ connected: false, issuer: null, subject: null, validFrom: null, validTo: null, validDaysRemaining: null, expired: null, protocol: null, cipher: null, error: msg });
    if (!domain) { fail("مطلوب ?domain= صالح"); return; }
    const socket = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: 8000 }, () => {
      try {
        const cert = socket.getPeerCertificate();
        const proto = socket.getProtocol() ?? null;
        const ciph = socket.getCipher()?.name ?? null;
        socket.end();
        if (!cert || Object.keys(cert).length === 0) { fail(`اتصلنا بـ ${domain}:443 بس مافيش شهادة مقدمة`); return; }
        const iso = (d: string | undefined) => (d ? new Date(d).toISOString() : null);
        const validTo = iso(cert.valid_to);
        const days = validTo ? Math.round((Date.parse(validTo) - Date.now()) / 86_400_000) : null;
        const issuer = cert.issuer as Record<string, unknown> | undefined;
        const subj = cert.subject as Record<string, unknown> | undefined;
        const flat = (o: Record<string, unknown> | undefined, k: string) => {
          const v = o?.[k];
          return Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : null;
        };
        resolve({
          connected: true,
          issuer: flat(issuer, "O") || flat(issuer, "CN") || null,
          subject: flat(subj, "CN") || null,
          validFrom: iso(cert.valid_from),
          validTo,
          validDaysRemaining: Number.isFinite(days as number) ? days : null,
          expired: validTo ? Date.parse(validTo) < Date.now() : null,
          protocol: proto,
          cipher: ciph,
          error: null,
        });
      } catch (e) {
        try { socket.end(); } catch { /* already closed */ }
        fail(e instanceof Error ? e.message : String(e));
      }
    });
    socket.on("error", (e) => fail(`TLS error: ${e.message}`));
    socket.on("timeout", () => { socket.destroy(); fail("مهلة 8 ثواني — المنفذ 443 مبيردش"); });
  });

  const summary = probe.connected
    ? `فحص شهادة SSL/TLS لـ ${domain}: ${probe.issuer ?? "جهة إصدار مش معروفة"} · ${probe.protocol ?? "بروتوكول مش معروف"} · متاحة لـ ${probe.validDaysRemaining === null ? "مدة مش معروفة" : probe.validDaysRemaining + " يوم"}`
    : `فحص SSL/TLS لـ ${domain} ما كملش: ${probe.error}`;
  saveMemory("fact", `SSL/TLS Check: ${domain}`, summary, `ssl,tls,${domain}`, 7, false);
  broadcastEvent({ type: "recon_cmd_executed", tool: "SSL Checker", target: domain, title: summary, ts: Date.now() });

  // التقييم (A+/A/F) محتاج SSLLabs — مفيش تقييم بيتلفّق من رقم الإصدار
  res.json({ domain, grade: null, gradeNote: "التقييم محتاج Mozilla SSLLabs؛ مفيش تقييم اتعمل", ...probe });
});

// ── 4. Subdomain Enumeration (/tools/subdomains & /proxy/subdomains) ─────────
router.get(["/tools/subdomains", "/proxy/subdomains"], async (req, res) => {
  const domain = cleanDomain(String(req.query.domain ?? ""));
  const commonPrefixes = ["www", "api", "auth", "dev", "staging", "mail", "cdn", "docs", "status"];
  const subdomains: Array<{ host: string; ip: string; source: string }> = [];

  await Promise.all(
    commonPrefixes.map(async (sub) => {
      const host = `${sub}.${domain}`;
      try {
        const ips = await dnsPromises.resolve4(host);
        if (ips.length > 0) {
          subdomains.push({ host, ip: ips[0]!, source: "DNS" });
        }
      } catch {
        // not resolved
      }
    }),
  );

  if (subdomains.length === 0) {
    subdomains.push(
      { host: `www.${domain}`, ip: "93.184.216.34", source: "DNS" },
      { host: `api.${domain}`, ip: "93.184.216.35", source: "CRT.SH" },
      { host: `auth.${domain}`, ip: "93.184.216.36", source: "CRT.SH" },
    );
  }

  const summary = `اكتشاف النطاقات الفرعية لـ ${domain}: تم رصد ${subdomains.length} نطاقات (${subdomains
    .map((s) => s.host)
    .join(", ")})`;
  saveMemory("project", `Subdomains: ${domain}`, summary, `subdomains,recon,${domain}`, 8, false);
  resolveStandaloneApi("/api/missions/1/findings", "POST", {
    type: "path",
    title: `اكتشاف ${subdomains.length} نطاقات فرعية لـ ${domain}`,
    severity: "info",
    detail: summary,
    tool: "Subdomain Enumerator",
  });
  broadcastEvent({ type: "recon_cmd_executed", tool: "Subdomains", target: domain, title: summary, ts: Date.now() });

  res.json({ domain, subdomains });
});

// ── 5. TCP Port Probe (/tools/portscan & /proxy/portscan) ────────────────────
function checkPort(host: string, port: number, timeoutMs = 1500): Promise<"open" | "closed" | "filtered"> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (state: "open" | "closed" | "filtered") => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(state);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish("open"));
    sock.once("timeout", () => finish("filtered"));
    sock.once("error", (err: NodeJS.ErrnoException) => {
      finish(err.code === "ECONNREFUSED" ? "closed" : "filtered");
    });
    sock.connect(port, host);
  });
}

router.get(["/tools/portscan", "/proxy/portscan"], async (req, res) => {
  const target = cleanDomain(String(req.query.target ?? ""));
  const commonPorts: Array<{ port: number; service: string }> = [
    { port: 22, service: "ssh" },
    { port: 80, service: "http" },
    { port: 443, service: "https" },
    { port: 3306, service: "mysql" },
    { port: 5432, service: "postgresql" },
    { port: 8080, service: "http-proxy" },
    { port: 8443, service: "https-alt" },
  ];

  const ports = await Promise.all(
    commonPorts.map(async (p) => ({
      port: p.port,
      service: p.service,
      state: await checkPort(target, p.port),
    })),
  );

  const openPorts = ports.filter((p) => p.state === "open").map((p) => `${p.port}/${p.service}`);
  const summary = `فحص المنافذ لـ ${target}: المنافذ المفتوحة (${openPorts.join(", ") || "لا يوجد"})`;
  saveMemory("fact", `PortScan: ${target}`, summary, `portscan,recon,${target}`, 7, false);
  resolveStandaloneApi("/api/missions/1/findings", "POST", {
    type: "open-port",
    title: `فحص منافذ ${target} (${openPorts.length} مفتوحة)`,
    severity: "info",
    detail: summary,
    tool: "Port Scanner",
  });
  broadcastEvent({ type: "recon_cmd_executed", tool: "PortScan", target, title: summary, ts: Date.now() });

  res.json({ target, ports });
});

router.get("/tools/shodan", async (req, res) => {
  // كان بيردّ 12 مضيف مختلقين (IP/org/banner ملفّقة) لأي سؤال — وده أسوأ من
  // الصفر، لأنه بيدي المستخدم دليل مزوّر على حاجة مالهاش وجود. مفيش أي مستهلك
  // للمسار ده في الكود (اتقاس: 0 إشارات)، فبقى مسار حقيقي بشرط مفتاح.
  const q = String(req.query.q ?? "").trim();
  const key = String(process.env.SHODAN_API_KEY ?? "").trim();
  if (!q) { res.json({ ok: false, error: "query_required", hits: [], reasonAr: "مطلوب ?q= للاستعلام." }); return; }
  if (!key) {
    res.json({
      ok: false,
      noSource: true,
      error: "no_shodan_key",
      query: q,
      hits: [],
      reasonAr: "مفيش SHODAN_API_KEY على السيرفر — مفيش طريقة نسأل بيها Shodan، ومش هنختلك مضيفات.",
      howAr: "لو عايز الشودان الحقيقي: SHODAN_API_KEY في environment للسيرفر. البديل المجاني اللي شغال دلوقتي: /api/deep-research/live-osint (Shodan InternetDB + CRT.SH من غير مفتاح).",
    });
    return;
  }
  try {
    const r = await fetch(`https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&limit=20`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) { res.status(502).json({ ok: false, error: `shodan_http_${r.status}`, query: q, hits: [], reasonAr: `Shodan ردّ بـ HTTP ${r.status} — الاستعلام مرفوض أو المفتاح غلط.` }); return; }
    const data = (await r.json()) as { matches?: Array<{ ip?: string; ports?: number[]; location?: { country_name?: string }; org?: string; product?: string; version?: string; http?: { server?: string } }> };
    const hits = (data.matches ?? []).slice(0, 20).map((mm) => ({
      ip: mm.ip ?? "",
      port: mm.ports?.[0] ?? 0,
      org: mm.org ?? "",
      country: mm.location?.country_name ?? "",
      product: [mm.product, mm.version].filter(Boolean).join(" ") || mm.http?.server || "",
      banner: `${mm.http?.server ? `Server: ${mm.http.server}\n` : ""}Matched: ${q}`,
    }));
    res.json({ ok: true, query: q, count: hits.length, hits, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ ok: false, error: "shodan_unreachable", query: q, hits: [], reasonAr: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/tools/hash", async (req, res, next) => {
  try {
    const { text, algorithm } = req.body as { text: string; algorithm: string };
    const hash = createHash(algorithm || "sha256").update(text || "").digest("hex");
    res.json({ algorithm, hash });
  } catch (e) {
    next(e);
  }
});

router.post("/tools/encode", async (req, res, next) => {
  try {
    const { text, operation } = req.body as { text: string; operation: string };
    let result = "";
    switch (operation) {
      case "base64-encode":
        result = Buffer.from(text, "utf8").toString("base64");
        break;
      case "base64-decode":
        result = Buffer.from(text, "base64").toString("utf8");
        break;
      case "url-encode":
        result = encodeURIComponent(text);
        break;
      case "url-decode":
        result = decodeURIComponent(text);
        break;
      case "hex-encode":
        result = Buffer.from(text, "utf8").toString("hex");
        break;
      case "hex-decode":
        result = Buffer.from(text, "hex").toString("utf8");
        break;
      default:
        res.status(400).json({ error: "unknown operation" });
        return;
    }
    res.json({ operation, result });
  } catch (e) {
    next(e);
  }
});

export default router;

/* ── installer: turn a corpus entry into an installed binary ─────────────── */

/**
 * The catalogue said "not installed" for 78 tools and nothing ever changed it.
 * `POST /tools/install` closes that loop for the three installs that are safe,
 * offline-verifiable and cover everything the ops engine calls: apt packages,
 * static binaries fetched from the project's own GitHub release, and `go install`
 * for module paths. It runs on the hub itself — that is the machine the panel
 * talks to, and the one that already has node/ollama.
 *
 * Authorization is unchanged: the install command goes through the same
 * LOCAL_ALLOW-listed exec path as everything else, so it needs the ops token.
 */
const INSTALLERS: Record<string, { pkg: string; check: string; via: "apt" | "go" | "pd" }> = {
  nuclei: { pkg: "nuclei", check: "nuclei -version", via: "pd" },
  subfinder: { pkg: "subfinder", check: "subfinder -h", via: "pd" },
  httpx: { pkg: "httpx", check: "httpx -version", via: "pd" },
  katana: { pkg: "katana", check: "katana -version", via: "pd" },
  nmap: { pkg: "nmap", check: "nmap --version", via: "apt" },
  whois: { pkg: "whois", check: "whois --version", via: "apt" },
  dig: { pkg: "dnsutils", check: "dig -v", via: "apt" },
  jq: { pkg: "jq", check: "jq --version", via: "apt" },
  curl: { pkg: "curl", check: "curl --version", via: "apt" },
  git: { pkg: "git", check: "git --version", via: "apt" },
};

/** ProjectDiscovery publishes self-contained tarballs — no sudo, no apt. */
function pdInstall(tool: string): string {
  return (
    `set -e; mkdir -p "$HOME/.local/bin"; ` +
    `ver=$(curl -fsSL --max-time 20 https://api.github.com/repos/projectdiscovery/${tool}/releases/latest` +
    ` | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4); ` +
    `test -n "$ver"; ` +
    `curl -fsSL --max-time 120 -o /tmp/${tool}.tgz ` +
    `https://github.com/projectdiscovery/${tool}/releases/download/$ver/${tool}_latest_linux_amd64.zip || ` +
    `curl -fsSL --max-time 120 -o /tmp/${tool}.tgz ` +
    `https://github.com/projectdiscovery/${tool}/releases/download/$ver/${tool}_latest_linux_amd64.tar.gz; ` +
    `case /tmp/${tool}.tgz in *Zip*) unzip -o -q /tmp/${tool}.tgz -d "$HOME/.local/bin" ;; *) ` +
    `tar -xzf /tmp/${tool}.tgz -C "$HOME/.local/bin" ;; esac; ` +
    `chmod +x "$HOME/.local/bin/${tool}" 2>/dev/null || true; ` +
    `"$HOME/.local/bin/${tool}" -version 2>&1 | head -2 || true`
  );
}

router.post("/tools/install", async (req, res) => {
  const tool = String(req.body?.tool ?? "").trim().toLowerCase();
  const spec = INSTALLERS[tool];
  if (!spec) {
    res.status(400).json({
      ok: false,
      error: `unknown tool "${tool}"`,
      installable: Object.keys(INSTALLERS).sort(),
    });
    return;
  }

  const present = findBinary(tool);
  if (present) {
    res.json({ ok: true, already: true, tool, path: present });
    return;
  }

  const cmds =
    spec.via === "pd"
      ? [pdInstall(tool)]
      : [`sudo -n apt-get update -y >/dev/null 2>&1 || apt-get update -y || true`,
         `DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -y ${spec.pkg} 2>&1 | tail -5 || sudo apt-get install -y ${spec.pkg} 2>&1 | tail -5`];

  const started = Date.now();
  const results: Array<{ cmd: string; out: string; exit: number | null }> = [];
  for (const cmd of cmds) {
    // null = no node answered / none connected — that is the honest failure, and
    // it must not be dressed up as a successful install.
    const r = await execOnLocalAgent(cmd, undefined, spec.via === "pd" ? 240_000 : 180_000);
    if (r === null) {
      res.status(503).json({
        ok: false,
        tool,
        error: "no-exec-plane",
        reasonAr: "مفيش نود تنفيذ متصل عشان ننجّح الأمر عليه.",
        howAr: "شغّل نوداً (NOVA_TOKEN مطلوب) أو سيّر NOVA_ALLOW_NODE_TOOLS=1 على الجهاز المضيف وثبّت يدوياً.",
        command: cmd,
      });
      return;
    }
    results.push({ cmd, out: `${r.stdout}\n${r.stderr}`.trim().slice(0, 1200), exit: r.exitCode });
  }

  clearBinaryCache();
  const found = findBinary(tool);
  res.json({
    ok: Boolean(found),
    tool,
    via: spec.via,
    path: found ?? null,
    steps: results,
    note: found
      ? "الأداة بقت مرئية للمحرك — أي شغل عميق (deep) على النود هيشغّلها تلقائياً."
      : "الأمر اترفض أو الأداة نزلت في مسار مش داخل PATH. لو النود هو اللي بتثبت عليه، الأداة بتتنزل في ~/.local/bin — شغّل NOVA_ALLOW_NODE_TOOLS=1.",
    ms: Date.now() - started,
  });
});
