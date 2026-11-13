// NOVA brain on the edge — thinks even when GitHub's cron does not.
// Measured 2026-11-04: the Actions crons for the repo stopped firing for over an
// hour while a push-triggered run worked instantly. This runs on Supabase Edge
// (free, always on, no card) and is driven by the `nova-brain-tick` pg_cron job.
//
//   GET  /nova-brain            → the last thought (public)
//   POST /nova-brain            → think once (self-throttled)
//   POST /nova-brain?force=...  → think now (scheduler / service role)
//
// Order of operations, learned the hard way in one evening:
//   1. act first  — the database looks the thing up before anyone speaks
//   2. speak with the evidence in the prompt
//   3. verify     — every CVE id must exist, every number must be measured
//   4. if the model still invents, a deterministic template answers instead
// Step 4 is why this cannot go quiet: no model, no quota, no key, and the user
// still gets an answer built only from rows that exist.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** Keyless seats spread across independent endpoints so one IP throttle (402)
 *  cannot silence Round 2 right after Round 1 succeeds on the same host. */
export interface Seat {
  id: string;
  model: string;
  url: string;
  host: string;
  kind: "openai" | "pollinations";
}

export const SEATS: Seat[] = [
  { id: "pollinations-fast", model: "openai-fast", url: "https://text.pollinations.ai/openai", host: "text.pollinations.ai", kind: "pollinations" },
  { id: "ovh-llama", model: "Meta-Llama-3_3-70B-Instruct", url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions", host: "oai.endpoints.kepler.ai.cloud.ovh.net", kind: "openai" },
  { id: "ovh-ai", model: "Qwen3.6-27B", url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions", host: "oai.endpoints.kepler.ai.cloud.ovh.net", kind: "openai" },
  { id: "openai", model: "openai", url: "https://text.pollinations.ai/openai", host: "text.pollinations.ai", kind: "pollinations" },
  { id: "mistral", model: "mistral", url: "https://text.pollinations.ai/openai", host: "text.pollinations.ai", kind: "pollinations" },
];

/** Prefer seats on a different host for Round 2 so a per-IP cooldown (such as
 *  Pollinations 45s 402 after Round 1) is sidestepped cleanly. */
export function orderSeatsForRound2(round1Host: string | null, seats: Seat[] = SEATS): Seat[] {
  if (!round1Host) return [...seats];
  return [
    ...seats.filter((s) => s.host !== round1Host),
    ...seats.filter((s) => s.host === round1Host),
  ];
}

const MIN_GAP_MS = 5 * 60_000;
const ALLOWED = new Set(["none", "corpus_search", "cve_lookup"]);

function isService(req: Request): boolean {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return token.length > 20 && token === SERVICE;
}

/* ── senses: read from the tables, never from hope ──────────────────────── */
interface Sensed {
  corpus: {
    publishedTotal: number | null;
    publishedAt: string | null;
    rowsInDb: number;
    partial: boolean | null;
    criticalInDb: number;
  };
  hunt: { runs: number; findings: number; lastAt: string | null; lastScanned: number | null };
}

async function senses(): Promise<Sensed> {
  const [{ data: meta }, { count: cves }, { count: runs }, { count: findings }, { count: critical }] =
    await Promise.all([
      db.from("corpus_meta").select("key,value").eq("key", "index").maybeSingle(),
      db.from("corpus_cve").select("*", { count: "exact", head: true }),
      db.from("hunt_runs").select("*", { count: "exact", head: true }),
      db.from("hunt_findings").select("*", { count: "exact", head: true }),
      db.from("corpus_cve").select("*", { count: "exact", head: true }).eq("severity", "critical"),
    ]);
  const index = (meta?.value ?? null) as { total?: number; at?: string } | null;
  const { data: lastHunt } = await db
    .from("hunt_runs")
    .select("at,totals")
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    corpus: {
      publishedTotal: index?.total ?? null,
      publishedAt: index?.at ?? null,
      rowsInDb: cves ?? 0,
      partial: index?.total ? (cves ?? 0) < index.total : null,
      criticalInDb: critical ?? 0,
    },
    hunt: {
      runs: runs ?? 0,
      findings: findings ?? 0,
      lastAt: lastHunt?.at ?? null,
      lastScanned: (lastHunt?.totals as Record<string, unknown> | null)?.scanned ?? null,
    },
  };
}

/* ── memory: the newest question nobody answered yet ────────────────────── */
async function pending() {
  const { data: lastUser } = await db
    .from("chat_messages")
    .select("id,content,created_at")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastUser) return null;
  const { data: answered } = await db
    .from("chat_messages")
    .select("id")
    .eq("role", "assistant")
    .gte("created_at", lastUser.created_at)
    .limit(1);
  return (answered ?? []).length > 0 ? null : lastUser;
}

/* ── the hands: one real query, against the real table ──────────────────── */
interface Action {
  kind: "none" | "corpus_search" | "cve_lookup";
  arg: string;
}

interface ActionResult {
  kind: string;
  arg: string;
  ok: boolean;
  hits?: number;
  examples?: Array<{ cve: string; severity: string | null; cvss: number | null; kev: boolean | null }>;
  error?: string;
}

async function act(action: Action): Promise<ActionResult | null> {
  if (!action || action.kind === "none" || !action.arg) return null;
  // Any arg that names a CVE id is treated as an id lookup, whatever separator
  // the model used (cve:2021-44228, CVE_2008_7261 …).
  const asId = cveIdsIn(action.arg)[0] ?? null;
  const q = action.arg.replace(/[,()"'\\%:]/g, " ").trim();
  if (!q && !asId) return { kind: action.kind, arg: action.arg, ok: false, error: "empty after sanitising" };
  let query = db.from("corpus_cve").select("cve,severity,cvss,kev").limit(5);
  query = asId
    ? query.eq("cve", asId)
    : query.or(`products.cs.{${q.toLowerCase()}},summary.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return { kind: action.kind, arg: action.arg, ok: false, error: error.message };
  return {
    kind: action.kind,
    arg: action.arg,
    ok: true,
    hits: (data ?? []).length,
    examples: (data ?? []).slice(0, 3).map((r: Record<string, unknown>) => ({
      cve: String(r.cve),
      severity: (r.severity ?? null) as string | null,
      cvss: (r.cvss ?? null) as number | null,
      kev: (r.kev ?? null) as boolean | null,
    })),
  };
}

/* ── the reflex: search even when no model is willing ─────────────────────
 * Measured 2026-11-04 23:45Z: the keyless gateway started answering HTTP 402 for
 * every seat, so "the model was down" became the normal case, not the edge case.
 * A brain that only searches when a model says so stops working exactly when it
 * is needed, so the question is now read directly:
 *
 *   1. a CVE id in the text  → look that id up
 *   2. otherwise the latin-script words of the question (log4j, nginx, chrome…)
 *      are tried against corpus_cve and the first one that matches wins
 *
 * This is a lookup, not an interpretation: it can only find rows that exist.
 */
const NOISE = new Set([
  "the", "and", "for", "with", "what", "how", "many", "cve", "cves", "nova", "test", "http",
  "https", "api", "json", "row", "rows", "log", "you", "are", "can", "please", "show", "find",
  "latest", "status", "report", "today", "summary", "current", "platform", "check", "recent",
  "new", "critical", "high", "low", "medium", "info", "count", "total", "percentage", "percent",
  "about", "help", "tell", "give", "list", "which", "there", "have", "has", "need", "score",
  "alert", "update", "scan", "hunt",
]);

export function candidatesFrom(question: string): string[] {
  const ids = cveIdsIn(question);
  const words = [...question.matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,}/g)]
    .map((m) => m[0].toLowerCase())
    .filter((w) => !NOISE.has(w) && !w.startsWith("cve"));
  return [...ids, ...new Set(words)];
}

/** Every candidate tried, with what came back — so a turn that finds nothing can
 *  say *why* instead of going silent. */
export interface Attempt {
  arg: string;
  kind: string;
  ok: boolean;
  hits: number | null;
  error?: string;
}

export async function autoAct(question: string, attempts: Attempt[] = []): Promise<ActionResult | null> {
  for (const candidate of candidatesFrom(question).slice(0, 4)) {
    const isCve = /^cve-[0-9]{4}-[0-9]{4,7}$/i.test(candidate);
    const action: Action = { kind: isCve ? "cve_lookup" : "corpus_search", arg: candidate };
    const result = await act(action);
    attempts.push({
      arg: candidate,
      kind: action.kind,
      ok: Boolean(result?.ok),
      hits: result?.hits ?? null,
      error: result?.error,
    });
    if (result?.ok && (result.hits ?? 0) > 0) return result;
    if (isCve) return result; // a named id is answered even when it is missing
  }
  return null;
}

/* ── the mouth: one keyless model, evidence in hand ─────────────────────── */
function systemPrompt(state: unknown, evidence: ActionResult | null): string {
  return [
    "أنت نوفا (NOVA): عقل منصة أمن سيبراني. بترد بالعربي المصري، وبتقول الحقيقة حتى لو مش مريحة.",
    "1) كل رقم أو معرّف CVE تقوله لازم يكون من «الحالة» أو «الدليل» اللي تحت. ممنوع أي رقم من دماغك.",
    "1-ب) القاعدة فيها شريحة من الكوربوس مش كل تاريخ CVEs. لو حاجة مش موجودة قول «مش موجود في الشريحة اللي عندي».",
    "2) ممنوع تخطط لهجوم على هدف مش مصرّح به — الشغل على برامج باج باونتي مسجّلة أو نطاقاتك بس.",
    "3) ردودك ٣-٦ سطور، بلا حشو، عربي سليم.",
    'ردّك JSON بالحرف: {"reply":"...","action":{"kind":"none|corpus_search|cve_lookup","arg":"..."},"why":"..."}',
    "الحالة المقيسة الآن:",
    JSON.stringify(state),
    "الدليل من القاعدة (نتيجة الاستعلام الفعلي):",
    JSON.stringify(evidence),
  ].join("\n");
}

/** Strip model reasoning fences and stray IPA/token glitches next to Arabic text. */
export function cleanReplyText(raw: string): string {
  return String(raw ?? "")
    .replace(/<(?:think|thought|reasoning)>[\s\S]*?<\/(?:think|thought|reasoning)>/gi, " ")
    // Some quantized OSS models occasionally inject a stray IPA character inside Arabic words (e.g. ʀ).
    .replace(/[\u0250-\u02AF]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function seatCall(seat: Seat, messages: unknown[], failures: string[]) {
  try {
    const body =
      seat.kind === "pollinations"
        ? { model: seat.model, messages, private: true, referrer: "cybernova" }
        : { model: seat.model, messages, temperature: 0.35, max_tokens: 900 };
    const res = await fetch(seat.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      failures.push(`${seat.id}: HTTP ${res.status}`);
      return null;
    }
    const payload = await res.json();
    const rawText: string = cleanReplyText(payload?.choices?.[0]?.message?.content ?? "");
    const a = rawText.indexOf("{");
    const b = rawText.lastIndexOf("}");
    if (a < 0 || b <= a) {
      failures.push(`${seat.id}: no JSON in reply`);
      return null;
    }
    const raw = JSON.parse(rawText.slice(a, b + 1));
    const kind = ALLOWED.has(raw?.action?.kind) ? raw.action.kind : "none";
    const reply = cleanReplyText(String(raw?.reply ?? "")).slice(0, 2000);
    return {
      reply,
      why: cleanReplyText(String(raw?.why ?? "")).slice(0, 240),
      action: { kind, arg: kind === "none" ? "" : String(raw?.action?.arg ?? "").trim().slice(0, 120) } as Action,
    };
  } catch (err) {
    failures.push(`${seat.id}: ${(err as Error).message}`);
    return null;
  }
}

/* ── honesty, enforced instead of requested ───────────────────────────────
 * The first live turn answered "CVE-2021-44228, CVSS 10.0" from a corpus that
 * stops at 2020 — the model invented the famous CVE because it is famous. A
 * prompt rule is not a guarantee, so every claim is checked against the rows:
 *
 *   • each CVE id in the reply must exist in corpus_cve, or be in the evidence
 *   • each number ≥ 10 must appear in the measured state or the evidence
 */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[0-9]+(?:[.,][0-9]+)?/g)) out.add(m[0].replace(",", ""));
  return out;
}

/**
 * Every CVE id in a text, normalised to `CVE-YYYY-NNNN`.
 *
 * Measured 2026-11-04 23:45Z: a model planned the lookup with the arg
 * `cve:2021-44228`, the id check rejected it, the code fell through to a product
 * search, and the honest answer to a CVE question became "صفر نتيجة". The id was
 * there, the parser was too literal — so separators are normalised here.
 */
export function cveIdsIn(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/cve[\s:_-]*([0-9]{4})[\s:_-]+([0-9]{4,7})/gi)].map(
        (m) => `CVE-${m[1]}-${m[2]}`,
      ),
    ),
  ];
}

export async function verifyClaims(reply: string, measured: unknown): Promise<{ ok: boolean; invented: string[] }> {
  const invented: string[] = [];
  const allowed = numbersIn(JSON.stringify(measured));

  // CVE ids carry their own numbers (CVE-2008-7261); those are checked as ids
  // below, so strip them here — otherwise a verified id could fail the number pass.
  const narrative = reply.replace(/cve[\s:_-]*[0-9]{4}[\s:_-]+[0-9]{4,7}/gi, " ");
  for (const m of narrative.matchAll(/[0-9]+(?:[.,][0-9]+)?/g)) {
    const raw = m[0];
    const plain = raw.replace(",", "");
    if (Math.abs(Number(plain)) < 10 || !Number.isFinite(Number(plain))) continue;
    if (allowed.has(plain) || allowed.has(raw)) continue;
    invented.push(`رقم ${raw}`);
  }

  const ids = cveIdsIn(reply);
  if (ids.length) {
    const { data, error } = await db.from("corpus_cve").select("cve").in("cve", ids);
    if (error) return { ok: false, invented: [...invented, `تعذر التحقق: ${error.message}`] };
    const found = new Set((data ?? []).map((r: { cve: string }) => r.cve.toUpperCase()));
    for (const id of ids) {
      if (!found.has(id) && !JSON.stringify(measured).toUpperCase().includes(id)) invented.push(`${id} مش في القاعدة`);
    }
  }

  return { ok: invented.length === 0, invented: [...new Set(invented)] };
}

/* ── the floor: an answer with no model in it at all ──────────────────────
 * Everything interpolated here is a value that was just read from Postgres, so
 * this text cannot invent a CVE — the worst it can do is be blunt.
 */
export function templateAnswer(state: Sensed, question: { content: string } | null, evidence: ActionResult | null) {
  const rows = state.corpus.rowsInDb;
  const parts: string[] = [`القاعدة فيها ${rows} صف دلوقتي (آخر نشر للفهرس: ${state.corpus.publishedAt?.slice(0, 16) ?? "مش مقيس"}Z، منها ${state.corpus.criticalInDb} خطيرة).`];

  if (evidence && evidence.kind !== "none") {
    if (!evidence.ok) {
      parts.push(`دورت على «${evidence.arg}» والاستعلام فشل: ${evidence.error}.`);
    } else if ((evidence.hits ?? 0) === 0) {
      parts.push(`دورت على «${evidence.arg}» في القاعدة: صفر نتيجة — يعني الحاجة دي (أو السنة دي) لسه مش في الشريحة اللي عندي، ومش هخترع رقم بدالها.`);
    } else {
      const shown = (evidence.examples ?? []).slice(0, 3).map((e) => `${e.cve} (${e.severity ?? "?"}${e.cvss ? ` · ${e.cvss}` : ""}${e.kev ? " · KEV" : ""})`);
      parts.push(`دورت على «${evidence.arg}» ولقيت ${evidence.hits} نتيجة، أهمها: ${shown.join(" · ")}.`);
    }
  } else if (question) {
    parts.push("سؤالك مفيهوش اسم منتج أو معرّف CVE أقدر أدور بيه، فمش هألف إجابة — ابعتلي اسم برنامج (nginx, chrome, wordpress…) أو CVE-XXXX-YYYY وأنا أدور في القاعدة.");
  } else {
    parts.push(`آخر عملية صيد كانت ${state.hunt.lastAt?.slice(0, 16) ?? "مش مقيس"}Z على ${state.hunt.lastScanned ?? 0} هدف، والنتائج ${state.hunt.findings}.`);
  }

  parts.push("ده كلام مبني على صفوف موجودة فعلًا، من غير أي موديل لغوي.");
  return parts.join(" ");
}

/* ── one turn ───────────────────────────────────────────────────────────── */
async function tick(force: boolean) {
  const started = Date.now();
  const { data: row } = await db.from("nova_brain").select("doc,at").eq("id", "main").maybeSingle();
  const lastAt = row?.at ? Date.parse(row.at) : 0;
  if (!force && Date.now() - lastAt < MIN_GAP_MS) {
    return json({ skipped: "too soon", lastAt: row?.at ?? null, waitMs: MIN_GAP_MS - (Date.now() - lastAt) });
  }

  const [state, question] = await Promise.all([senses(), pending()]);
  const failures: string[] = [];

  const ask = question
    ? `رسالة الإنسان: ${String(question.content).slice(0, 2000)}`
    : "مفيش رسالة جديدة. اكتب سطر حالة واحد عن أهم حاجة في المنصة، والأكشن اللي شايفه أهم خطوة جاية.";

  /* round 1 — plan, then act, so the answer can be built on a real row */
  let round1Seat: Seat | null = null;
  let seat: string | null = null;
  let plan: { reply: string; why: string; action: Action } | null = null;
  for (const s of SEATS) {
    const got = await seatCall(s, [
      { role: "system", content: systemPrompt(state, null) },
      { role: "user", content: ask },
    ], failures);
    if (got) {
      round1Seat = s;
      seat = s.id;
      plan = got;
      break;
    }
  }

  let action = plan ? await act(plan.action) : null;
  const attempts: Attempt[] = [];
  // The model's plan is not trusted with the lookup either: if it planned nothing,
  // or planned something that came back empty, the question itself is read.
  if (question && (!action || (action.ok && (action.hits ?? 0) === 0))) {
    const better = await autoAct(String(question.content), attempts);
    if (better) action = better;
    if (action && (action.hits ?? 0) > 0) failures.push(`دورت مباشرة على «${action.arg}»: ${action.hits} نتيجة`);
    for (const a of attempts) {
      if (!a.ok || !a.hits) failures.push(`بحث «${a.arg}»: ${a.ok ? `${a.hits} نتيجة` : `فشل ${a.error}`}`);
    }
  }

  /* round 2 — speak again ONLY when an action returned new evidence (or Round 1
   * itself needs a grounded rewrite). When action === null and Round 1 already
   * passed verifyClaims, calling the model a second time in the same second just
   * trips the 45s per-IP 402 cooldown for zero new information. */
  let finalPlan = plan;
  let spokeWithEvidence = plan === null;
  let needsRound2 = action !== null || !plan?.reply;
  if (!needsRound2 && plan?.reply) {
    const check1 = await verifyClaims(plan.reply, { state, action: null });
    if (!check1.ok) {
      failures.push(`${seat} (رد أولي): ادّعى ${check1.invented.slice(0, 4).join(" · ")}`);
      needsRound2 = true;
      finalPlan = null;
    } else {
      spokeWithEvidence = true;
    }
  }
  if (needsRound2 && (seat || action !== null)) {
    const evidenceNote = action
      ? `الدليل اللي رجع من القاعدة: ${JSON.stringify(action)}. اكتب الرد النهائي مبنيًا عليه.`
      : "مفيش أكشن اتنفّذ. اكتب الرد النهائي من الحالة بس.";
    for (const s of orderSeatsForRound2(round1Seat?.host ?? null)) {
      const got = await seatCall(s, [
        { role: "system", content: systemPrompt(state, action) },
        { role: "user", content: `${ask}\n\n${evidenceNote}` },
      ], failures);
      if (!got?.reply) continue;
      const check = await verifyClaims(got.reply, { state, action });
      if (!check.ok) {
        failures.push(`${s.id} (رد نهائي): ادّعى ${check.invented.slice(0, 4).join(" · ")}`);
        continue;
      }
      seat = s.id;
      finalPlan = got;
      spokeWithEvidence = true;
      break;
    }
    if (finalPlan && finalPlan !== plan) {
      const check = await verifyClaims(finalPlan.reply, { state, action });
      if (!check.ok) finalPlan = null;
    }
  }

  /* round 3 — the floor */
  const usedTemplate = !finalPlan?.reply || (action !== null && !spokeWithEvidence);
  const reply = usedTemplate ? templateAnswer(state, question, action) : finalPlan!.reply;
  const why = usedTemplate ? "إجابة قالبية مبنية على صفوف القاعدة (الموديل اخترع أو مش متاح)" : (finalPlan!.why || "");

  const doc = {
    at: new Date().toISOString(),
    seat: usedTemplate ? null : seat,
    thinking: { reply, why, action: plan?.action ?? action ?? { kind: "none", arg: "" } },
    action,
    answered: question ? { question: String(question.content).slice(0, 500) } : null,
    attempts,
    senses: state,
    failures,
    ms: Date.now() - started,
    source: "supabase-edge",
    grounded: !usedTemplate,
    says_ar: `${usedTemplate ? "قالب" : seat} · ${reply.split("\n")[0].slice(0, 180)}`,
  };

  await db.from("nova_brain").upsert({ id: "main", doc, at: doc.at }, { onConflict: "id" });

  if (question) {
    const content = action
      ? `${reply}\n\n— دليل من الكوربوس (${action.kind} «${action.arg}»): ${
          action.ok ? `${action.hits ?? 0} نتيجة` : `فشل: ${action.error}`
        }`
      : reply;
    await db.from("chat_messages").insert({
      role: "assistant",
      content,
      seat: usedTemplate ? null : seat,
      tools: action ? [action] : null,
    });
  }

  return json({ ok: true, doc }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const { data } = await db.from("nova_brain").select("doc,at").eq("id", "main").maybeSingle();
      if (!data?.doc) return json({ doc: null, says_ar: "المخ لسه ما فكّرش ولا مرة على الحافة" });
      const ageMin = Math.round((Date.now() - Date.parse(data.at)) / 60_000);
      return json({ doc: data.doc, at: data.at, ageMin, stale: ageMin > 20 });
    }

    if (req.method === "GET" && url.searchParams.get("probe") === "1" && isService(req)) {
      // Measure every configured keyless seat instead of guessing why NOVA went quiet.
      const results = [];
      for (const s of SEATS) {
        const t0 = Date.now();
        try {
          const body =
            s.kind === "pollinations"
              ? { model: s.model, messages: [{ role: "user", content: "قل كلمة واحدة: تمام" }], private: true, referrer: "cybernova" }
              : { model: s.model, messages: [{ role: "user", content: "قل كلمة واحدة: تمام" }], max_tokens: 32 };
          const res = await fetch(s.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
          });
          results.push({ id: s.id, model: s.model, host: s.host, status: res.status, ms: Date.now() - t0 });
        } catch (err) {
          results.push({ id: s.id, model: s.model, host: s.host, status: 0, error: (err as Error).message, ms: Date.now() - t0 });
        }
      }
      return json({ seats: results });
    }

    if (req.method === "GET" && url.searchParams.get("try") && isService(req)) {
      // Run one real lookup and show exactly what the database said.
      const term = String(url.searchParams.get("try")).slice(0, 120);
      const isCve = /^cve-[0-9]{4}-[0-9]{4,7}$/i.test(term);
      const out = await act({ kind: isCve ? "cve_lookup" : "corpus_search", arg: term });
      return json({ term, action: out });
    }

    if (req.method === "POST") {
      const force = isService(req) || url.searchParams.get("force") === "scheduled";
      return await tick(force);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
