#!/usr/bin/env node
/**
 * NOVA · the brain tick — one real turn of thinking, no server, no key, no card.
 * ────────────────────────────────────────────────────────────────────────────
 * `/nova-fleet` advertises itself as the brain of the whole program. A brain
 * that only renders a page is not a brain. This script is the part that actually
 * thinks, and everything it needs is free and already in the repo:
 *
 *   • a model            → text.pollinations.ai (keyless, no account, no card)
 *   • its own memory     → Supabase `chat_messages` (public read, written by
 *                          POST /chatlog; the same rows the browser chat writes)
 *   • its own senses     → state/vuln-corpus-index.json, state/hunt-latest.json,
 *                          state/advisory-cache.json, and the ops-api /corpus
 *   • its hands          → one tool call per turn, executed for real
 *
 * What it writes back:
 *   state/nova-brain-latest.json   → what it thought, what it did, what it saw
 *   a POST to /chatlog             → its answer to the human, in the chat
 *
 * Two rules this file will not break:
 *   1. It never claims a number it did not read. Every field in the output is
 *      copied from a file or an HTTP response, and `sources` names which.
 *   2. It never plans an action against a host that is not in an authorised
 *      program. The prompt says so and `SEATS`/`ACTIONS` cannot express otherwise.
 *
 * Run: node scripts/nova-brain.mjs [--dry] [--offline]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

/* ── where things live ───────────────────────────────────────────────────── */

export const SUPABASE = "https://dbaaclqycsiefjwjfavf.supabase.co";
export const BACKEND = `${SUPABASE}/functions/v1/ops-api`;
/** publishable key: read-only by design, already shipped in the browser bundle */
export const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiYWFjbHF5Y3NpZWZqd2pmYXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3OTg2MzUsImV4cCI6MjEwOTM3NDYzNX0.Xl9wkwocQctksHXZJiugpj29JD_9O1q-_ztDNfU42gA";

const readJson = (rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    return null;
  }
};

/* ── the senses: what the organism can see, from files it already publishes ─ */

export function readSenses() {
  const corpus = readJson("state/vuln-corpus-index.json");
  const hunt = readJson("state/hunt-latest.json");
  const advisory = readJson("state/advisory-cache.json");
  const senses = {};
  if (corpus) {
    senses.corpus = {
      total: corpus.total ?? null,
      at: corpus.at ?? null,
      critical: corpus.bySeverity?.critical ?? null,
      high: corpus.bySeverity?.high ?? null,
      kev: corpus.kev ?? null,
      coverage: corpus.deepen?.coverage ?? null,
      nextStartIndex: corpus.deepen?.nextStartIndex ?? null,
      newestYear: corpus.byYear ? Math.max(...Object.keys(corpus.byYear).map(Number)) : null,
    };
  }
  if (hunt) {
    senses.hunt = {
      at: hunt.at ?? null,
      scanned: hunt.totals?.scanned ?? hunt.totals?.targets ?? null,
      findings: Array.isArray(hunt.findings) ? hunt.findings.length : null,
      targets: Array.isArray(hunt.targets) ? hunt.targets.slice(0, 8) : null,
      says: hunt.says_ar ?? null,
    };
  }
  if (advisory) {
    senses.advisories = {
      total: advisory.total ?? null,
      at: advisory.at ?? null,
      critical: advisory.bySeverity?.critical ?? null,
    };
  }
  return senses;
}

/* ── the memory: chat rows the browser wrote, read with the public key ───── */

export async function readChat({ fetchImpl = fetch, limit = 24 } = {}) {
  const url = `${SUPABASE}/rest/v1/chat_messages?select=role,content,created_at&order=created_at.desc&limit=${limit}`;
  const res = await fetchImpl(url, {
    headers: { apikey: ANON, authorization: `Bearer ${ANON}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`chat read HTTP ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows.reverse() : [];
}

export function findPending(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return null;
  const answered = messages.some(
    (m) => m.role === "assistant" && String(m.created_at ?? "") >= String(lastUser.created_at ?? ""),
  );
  return answered ? null : lastUser;
}

/* ── the mouth: keyless model, three seats, real fallbacks ───────────────── */

const SEATS = [
  { id: "openai", model: "openai" },
  { id: "mistral", model: "mistral" },
  { id: "llama", model: "llama" },
];

export function systemPrompt(senses) {
  return [
    "أنت نوفا (NOVA): عقل منصة أمن سيبراني حقيقي. بتفكر بالعربي المصري، وبتقول الحقيقة حتى لو مش مريحة.",
    "قواعد ثابتة:",
    "1) أي رقم تقوله لازم يكون من الحالة اللي تحت. لو مش موجود، قول «مش مقيس» ومتخمّنش.",
    "2) ممنوع تخطط لهجوم على أي هدف مش مصرّح به. الشغل بس على أهداف برامج باج باونتي مسجّلة أو نطاقاتك.",
    "3) لو السؤال مش واضح، اسأل سؤال توضيحي واحد بدل ما تفترض.",
    "4) ردودك قصيرة ومحددة (٣-٦ سطور)، بدون حشو.",
    "ردّك لازم يكون JSON بالشكل ده بالحرف:",
    '{"reply":"<ردك للمستخدم>","action":{"kind":"none|corpus_search|cve_lookup","arg":"<نص>"},"why":"<سبب اختيار الأكشن في سطر>"}',
    "استخدم corpus_search لما السؤال عن منتج أو ثغرة، وcve_lookup لما يكون فيه CVE id صريح، وnone لما مفيش داعي.",
    "",
    "الحالة المقيسة الآن (JSON):",
    JSON.stringify(senses, null, 1),
  ].join("\n");
}

export function extractJson(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function sanitizePlan(raw) {
  const allowed = new Set(["none", "corpus_search", "cve_lookup"]);
  const plan = {
    reply: typeof raw?.reply === "string" ? raw.reply.trim() : "",
    action: { kind: "none", arg: "" },
    why: typeof raw?.why === "string" ? raw.why.trim().slice(0, 240) : "",
  };
  const kind = raw?.action?.kind;
  const rawArg = raw?.action?.arg;
  if (allowed.has(kind) && kind !== "none" && typeof rawArg === "string" && rawArg.trim()) {
    plan.action = { kind, arg: rawArg.trim().slice(0, 120) };
  }
  return plan;
}

export async function think({ senses, pending, fetchImpl = fetch }) {
  const messages = [
    { role: "system", content: systemPrompt(senses) },
    {
      role: "user",
      content: pending
        ? `رسالة الإنسان: ${String(pending.content).slice(0, 2000)}`
        : "مفيش رسالة جديدة من الإنسان. اكتب لنفسك سطر حالة واحد (reply) يوضح أهم حاجة في المنصة دلوقتي، والأكشن اللي شايفه أهم خطوة جاية.",
    },
  ];
  const failures = [];
  for (const seat of SEATS) {
    try {
      const res = await fetchImpl("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: seat.model, messages, private: true, referrer: "cybernova" }),
        signal: AbortSignal.timeout(75_000),
      });
      if (!res.ok) {
        failures.push(`${seat.id}: HTTP ${res.status}`);
        continue;
      }
      const body = await res.json();
      const text = body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.text ?? "";
      const plan = sanitizePlan(extractJson(text));
      if (!plan.reply) {
        failures.push(`${seat.id}: no reply in payload`);
        continue;
      }
      return { seat: seat.id, plan, failures };
    } catch (err) {
      failures.push(`${seat.id}: ${err.cause?.code ?? err.message}`);
    }
  }
  return { seat: null, plan: null, failures };
}

/* ── the hands: one real tool call, against real data ────────────────────── */

export async function runAction(action, { fetchImpl = fetch } = {}) {
  if (!action || action.kind === "none") return null;
  try {
    if (action.kind === "corpus_search") {
      const res = await fetchImpl(`${BACKEND}/corpus?q=${encodeURIComponent(action.arg)}&limit=5`, {
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) return { kind: action.kind, ok: false, error: `HTTP ${res.status}` };
      const body = await res.json();
      const rows = body.rows ?? body.cves ?? [];
      return {
        kind: action.kind,
        ok: true,
        arg: action.arg,
        hits: rows.length,
        examples: rows.slice(0, 3).map((r) => ({
          cve: r.cve ?? r.id,
          severity: r.severity ?? r.sev,
          cvss: r.cvss,
          kev: r.kev,
        })),
      };
    }
    if (action.kind === "cve_lookup") {
      const res = await fetchImpl(`${BACKEND}/corpus?q=${encodeURIComponent(action.arg)}&limit=1`, {
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) return { kind: action.kind, ok: false, error: `HTTP ${res.status}` };
      const body = await res.json();
      const row = (body.rows ?? body.cves ?? [])[0] ?? null;
      return {
        kind: action.kind,
        ok: true,
        arg: action.arg,
        found: Boolean(row),
        summary: row?.summary?.slice(0, 300) ?? null,
      };
    }
  } catch (err) {
    return { kind: action.kind, ok: false, error: err.cause?.code ?? err.message };
  }
  return null;
}

/* ── the output: one file the page reads, one message the human reads ────── */

export function brainDoc({ at, seat, plan, action, pending, senses, failures }) {
  return {
    at,
    seat,
    thinking: plan
      ? { reply: plan.reply, why: plan.why, action: plan.action }
      : { reply: null, why: "مفيش مقعد رد", action: { kind: "none", arg: "" } },
    action,
    answered: pending ? { question: String(pending.content).slice(0, 500), at: pending.created_at ?? null } : null,
    senses,
    failures: failures ?? [],
    says_ar: plan
      ? `${seat ? `فكّرت على ${seat}` : "فكّرت"} · ${plan.reply.split("\n")[0].slice(0, 180)}`
      : "المحاولة فشلت — التفاصيل في failures",
    sources: ["state/vuln-corpus-index.json", "state/hunt-latest.json", "state/advisory-cache.json", "supabase:chat_messages", "text.pollinations.ai"],
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const senses = readSenses();

  if (flag("offline")) {
    const doc = brainDoc({ at: startedAt, seat: null, plan: null, action: null, pending: null, senses, failures: ["offline mode"] });
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  let chat = [];
  let chatError = null;
  try {
    chat = await readChat();
  } catch (err) {
    chatError = err.cause?.code ?? err.message;
  }
  const pending = findPending(chat);

  const { seat, plan, failures } = await think({ senses, pending });
  if (chatError) failures.unshift(`chat read: ${chatError}`);

  const action = plan ? await runAction(plan.action) : null;
  const doc = brainDoc({ at: startedAt, seat, plan, action, pending, senses, failures });

  // Two copies, both real: `state/` is the machine's record, `public/state/` is
  // what the Pages bundle actually serves. Writing only the first is how the
  // corpus ended up committed-but-unpublished on 2026-11-04.
  const body = JSON.stringify(doc, null, 2) + "\n";
  for (const rel of ["state/nova-brain-latest.json", "artifacts/kali-panel/public/state/nova-brain-latest.json"]) {
    const out = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body);
  }
  console.log(doc.says_ar);
  if (action) console.log(`action: ${JSON.stringify(action)}`);

  if (flag("dry")) return;

  // Answer in the same chat the human is looking at. Public endpoint, sanitised
  // server-side; a failure here must not lose the thought we just wrote.
  if (plan) {
    const content = action
      ? `${plan.reply}\n\n— دليل من الكوربوس (${action.kind} «${action.arg}»): ${
          action.ok ? `${action.hits ?? 0} نتيجة` : `فشل: ${action.error}`
        }`
      : plan.reply;
    try {
      const res = await fetch(`${BACKEND}/chatlog`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "assistant", content, seat, tools: action ? [action] : null }),
        signal: AbortSignal.timeout(20_000),
      });
      console.log(`chatlog: HTTP ${res.status}`);
    } catch (err) {
      console.log(`chatlog failed: ${err.cause?.code ?? err.message}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`nova-brain crashed: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}
