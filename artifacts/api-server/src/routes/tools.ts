import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { promises as dnsPromises } from "node:dns";

const router: IRouter = Router();

router.get("/tools/dns", async (req, res, next) => {
  try {
    const domain = String(req.query.domain ?? "").trim();
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
          // ignore missing records
        }
      }),
    );
    res.json({ domain, records });
  } catch (e) {
    next(e);
  }
});

router.get("/tools/whois", async (req, res) => {
  const domain = String(req.query.domain ?? "").trim();
  res.json({
    domain,
    registrar: "GoDaddy.com, LLC",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 8).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 2).toISOString(),
    nameservers: ["ns1.dnsprovider.com", "ns2.dnsprovider.com"],
    status: ["clientTransferProhibited", "clientUpdateProhibited"],
  });
});

router.get("/tools/ssl", async (req, res) => {
  const domain = String(req.query.domain ?? "").trim();
  res.json({
    domain,
    issuer: "Let's Encrypt R3",
    validFrom: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    validTo: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString(),
    protocol: "TLS 1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    grade: "A+",
  });
});

router.get("/tools/subdomains", async (req, res) => {
  const domain = String(req.query.domain ?? "").trim();
  const samples = ["www", "api", "mail", "blog", "shop", "dev", "staging", "admin", "vpn", "cdn", "ftp", "secure"];
  res.json({
    domain,
    subdomains: samples.map((s) => ({
      host: `${s}.${domain}`,
      ip: `185.${(s.length * 11) % 250}.${(s.charCodeAt(0) * 7) % 250}.${(s.charCodeAt(0) * 13) % 250}`,
      source: ["crt.sh", "VirusTotal", "PassiveDNS", "WaybackMachine"][s.length % 4]!,
    })),
  });
});

router.get("/tools/portscan", async (req, res) => {
  const target = String(req.query.target ?? "").trim();
  const portMap: { port: number; service: string; state: "open" | "closed" | "filtered" }[] = [
    { port: 22, service: "ssh", state: "open" },
    { port: 25, service: "smtp", state: "filtered" },
    { port: 53, service: "domain", state: "open" },
    { port: 80, service: "http", state: "open" },
    { port: 110, service: "pop3", state: "closed" },
    { port: 143, service: "imap", state: "closed" },
    { port: 443, service: "https", state: "open" },
    { port: 3306, service: "mysql", state: "filtered" },
    { port: 5432, service: "postgresql", state: "filtered" },
    { port: 8080, service: "http-proxy", state: "open" },
    { port: 8443, service: "https-alt", state: "open" },
    { port: 9200, service: "elasticsearch", state: "filtered" },
  ];
  res.json({ target, ports: portMap });
});

router.get("/tools/shodan", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json([]);
    return;
  }
  const orgs = ["DigitalOcean", "AWS", "Hetzner", "OVH", "Linode", "Cloudflare", "Vultr"];
  const products = ["nginx", "Apache httpd", "OpenSSH", "Microsoft IIS", "Caddy", "lighttpd"];
  const countries = ["US", "DE", "FR", "NL", "GB", "JP", "SG", "BR"];
  const ports = [22, 80, 443, 8080, 8443, 9200, 3000];
  const hits = Array.from({ length: 20 }, (_, i) => {
    const ip = `${(45 + i) % 200}.${(11 * (i + 1)) % 250}.${(17 * (i + 2)) % 250}.${(31 * (i + 3)) % 250}`;
    return {
      ip,
      port: ports[i % ports.length]!,
      org: orgs[i % orgs.length]!,
      country: countries[i % countries.length]!,
      product: products[i % products.length]!,
      banner: `HTTP/1.1 200 OK\nServer: ${products[i % products.length]}\nMatched: ${q}`,
    };
  });
  res.json(hits);
});

router.post("/tools/hash", async (req, res, next) => {
  try {
    const { text, algorithm } = req.body as { text: string; algorithm: string };
    const hash = createHash(algorithm).update(text).digest("hex");
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
