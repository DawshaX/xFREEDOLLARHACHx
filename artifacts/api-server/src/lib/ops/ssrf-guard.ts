/**
 * Ops · SSRF guard — refuse to fetch the platform's own network
 * ────────────────────────────────────────────────────────────────────────────────
 * `/api/proxy?url=` and `/api/fetch?url=` both took a caller-supplied URL and
 * fetched it from the server. The only check was "starts with http(s)://", so
 *
 *     /api/proxy?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/
 *
 * returned the cloud instance's IAM credentials, and
 * `http://127.0.0.1:8080/api/keys` reached the platform's own admin API from
 * inside the trust boundary. That is CWE-918 (SSRF), and on a cloud host it is
 * usually the shortest path to full account takeover.
 *
 * The guard resolves the hostname and rejects any address in a private,
 * loopback, link-local, CGNAT, multicast or reserved range — including the
 * IPv4-mapped IPv6 forms that trivially bypass a naive string check.
 *
 * It is applied at the *resolved address*, not the hostname, because
 * `http://127.0.0.1.nip.io/` and a DNS record pointing at 10.0.0.1 both look
 * like ordinary public names.
 */
import dns from "node:dns/promises";
import net from "node:net";

export interface SsrfVerdict {
  ok: boolean;
  reason?: string;
  /** The addresses that were checked, for the log line. */
  addresses?: string[];
}

/** True when an IP literal is in a range we must never fetch. */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return true; // not an IP at all → refuse

  if (family === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // 10/8 private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:127.0.0.1) — unwrap and re-check as IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  return false;
}

/**
 * Validate a URL for outbound fetching. Resolves DNS and checks every address
 * the name points at (a name with both a public and a private record is
 * refused — that is the classic rebinding trick).
 */
export async function assertFetchableUrl(raw: string): Promise<SsrfVerdict> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `protocol ${u.protocol} is not allowed` };
  }

  // A bare IP literal: check it directly, no DNS.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    return isBlockedAddress(host)
      ? { ok: false, reason: `address ${host} is in a blocked range`, addresses: [host] }
      : { ok: true, addresses: [host] };
  }

  // Refuse obvious local names before spending a DNS query.
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) {
    return { ok: false, reason: `hostname ${host} is local-only` };
  }

  let addresses: string[] = [];
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch (e) {
    return { ok: false, reason: `DNS lookup failed for ${host}: ${(e as Error).message}` };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `no addresses for ${host}` };
  }

  const blocked = addresses.filter(isBlockedAddress);
  if (blocked.length > 0) {
    return {
      ok: false,
      reason: `${host} resolves to a blocked address (${blocked.join(", ")})`,
      addresses,
    };
  }

  return { ok: true, addresses };
}

/** Convenience wrapper for route handlers: returns an error string or null. */
export async function ssrfError(raw: string): Promise<string | null> {
  const v = await assertFetchableUrl(raw);
  return v.ok ? null : v.reason ?? "blocked";
}
