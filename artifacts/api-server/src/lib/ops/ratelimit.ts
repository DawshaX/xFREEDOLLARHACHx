/**
 * Ops · Per-host rate limiter
 * ───────────────────────────
 * Bug-bounty platforms ban hunters for hammering an asset, not for finding bugs.
 * So the throttle is not a nicety, it is the thing that keeps the account alive.
 *
 * - one token bucket per host
 * - global in-flight cap (never more than N sockets total)
 * - automatic backoff on 429 / 403 / 5xx (exponential, max 5 min)
 * - honours the platform kill-switch
 */
import { isKilled } from "../../routes/kill-switch";

export interface ThrottleOpts {
  rps?: number;
  burst?: number;
  /** hard ceiling on how long a caller may wait for a slot */
  maxWaitMs?: number;
  signal?: AbortSignal;
}

interface Bucket {
  tokens: number;
  capacity: number;
  refillPerMs: number;
  last: number;
  backoffUntil: number;
  strikes: number;
}

const buckets = new Map<string, Bucket>();
let inFlight = 0;
const waiters: Array<() => void> = [];

function globalCap(): number {
  return Math.max(1, Math.min(16, Number(process.env.NOVA_MAX_INFLIGHT || 4)));
}

function bucketFor(host: string, rps: number, burst: number): Bucket {
  let b = buckets.get(host);
  if (!b) {
    b = {
      tokens: burst,
      capacity: burst,
      refillPerMs: rps / 1000,
      last: Date.now(),
      backoffUntil: 0,
      strikes: 0,
    };
    buckets.set(host, b);
  }
  // allow tightening/loosening live (the program config may have changed)
  b.refillPerMs = rps / 1000;
  b.capacity = burst;
  return b;
}

function refill(b: Bucket): void {
  const now = Date.now();
  b.tokens = Math.min(b.capacity, b.tokens + (now - b.last) * b.refillPerMs);
  b.last = now;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("throttle aborted"));
      },
      { once: true },
    );
  });

/** Wait until it is safe to send one request to `host`. Throws if killed. */
export async function acquire(host: string, opts: ThrottleOpts = {}): Promise<void> {
  const rps = Math.max(0.1, Math.min(20, opts.rps ?? Number(process.env.NOVA_DEFAULT_RPS || 1)));
  const burst = Math.max(1, Math.min(5, opts.burst ?? Math.ceil(rps)));
  const maxWait = opts.maxWaitMs ?? 120_000;
  const b = bucketFor(host, rps, burst);
  const deadline = Date.now() + maxWait;

  for (;;) {
    if (isKilled()) throw new Error("kill-switch مفعّل — الإيقاف الذاتي للوحة، الطلب اتلغى.");
    if (opts.signal?.aborted) throw new Error("throttle aborted");
    const now = Date.now();
    if (now < b.backoffUntil) {
      if (now + 250 > deadline) throw new Error(`حدّ الطلبات على ${host}: في backoff لـ${Math.ceil((b.backoffUntil - now) / 1000)}s`);
      await sleep(Math.min(1000, b.backoffUntil - now), opts.signal);
      continue;
    }
    refill(b);
    const room = inFlight < globalCap();
    if (b.tokens >= 1 && room) {
      b.tokens -= 1;
      inFlight += 1;
      return;
    }
    if (now + 120 > deadline) throw new Error(`حدّ الطلبات على ${host}: استنى وقت أطول من ${maxWait}ms`);
    await sleep(Math.max(40, room ? 1000 / Math.max(rps, 0.5) : 120), opts.signal);
  }
}

/** Release the in-flight slot. Must be called in a `finally`. */
export function release(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

/** Tell the limiter what the target said — it slows down automatically. */
export function noteResponse(host: string, status: number): void {
  const b = buckets.get(host);
  if (!b) return;
  if (status === 429 || status === 403 || status >= 500) {
    b.strikes += 1;
    const ms = Math.min(300_000, 2_000 * 2 ** Math.min(b.strikes, 7));
    b.backoffUntil = Date.now() + ms;
    b.tokens = 0;
  } else if (status < 400) {
    b.strikes = 0;
  }
}

export function throttleStats(): Record<
  string,
  { tokens: number; capacity: number; rps: number; backoffMsLeft: number; strikes: number }
> {
  const now = Date.now();
  const out: Record<string, { tokens: number; capacity: number; rps: number; backoffMsLeft: number; strikes: number }> = {};
  for (const [host, b] of buckets) {
    out[host] = {
      tokens: Math.round(b.tokens * 100) / 100,
      capacity: b.capacity,
      rps: Math.round(b.refillPerMs * 1000 * 100) / 100,
      backoffMsLeft: Math.max(0, b.backoffUntil - now),
      strikes: b.strikes,
    };
  }
  return out;
}

export function throttleSnapshot(): { inFlight: number; cap: number; hosts: number } {
  return { inFlight, cap: globalCap(), hosts: buckets.size };
}
