// CyberNova ops API — the backend the panel was missing.
// ───────────────────────────────────────────────────────────
// Runs on Supabase Edge (Deno, free, always on). One router, one database, no
// secrets in the browser: the publishable key may only read, and every write is
// checked against the service role.
//
//   GET  /health                     → liveness + row counts
//   GET  /organs                     → measured organ states
//   GET  /hunt                       → last run + its findings (verified flags)
//   GET  /corpus?q=nginx&limit=20    → CVE search by id or product
//   POST /organ    {id,status,…}     → upsert one organ            (service)
//   POST /hunt     {…hunt-latest}    → store a run + findings      (service)
//   POST /chat     {messages:[…]}    → keyless LLM, streamed back  (public)
//   POST /chatlog  {conversationId,…}→ persist a turn               (public, sanitised)

import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

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

/** Writes require the service role key in the Authorization header. */
function isService(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token.length > 20 && token === SERVICE;
}

// ── keyless seats (no key, no card) ────────────────────────────────────────
const SEATS = [
  { id: "pollinations-openai", model: "openai" },
  { id: "pollinations-mistral", model: "mistral" },
  { id: "pollinations-llama", model: "llama" },
];

async function chatStream(messages: Array<{ role: string; content: string }>): Promise<Response> {
  const failures: string[] = [];
  for (const seat of SEATS) {
    const started = Date.now();
    try {
      const res = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: seat.model, messages, stream: true }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok || !res.body) {
        failures.push(`${seat.id}: HTTP ${res.status}`);
        continue;
      }
      const headers = {
        ...CORS,
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-nova-seat": seat.id,
        "x-nova-latency-ms": String(Date.now() - started),
      };
      return new Response(res.body, { headers });
    } catch (err) {
      failures.push(`${seat.id}: ${(err as Error).message}`);
    }
  }
  return json({ error: "no seat answered", failures }, 503);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/ops-api/, "").replace(/\/+$/, "") || "/";

  try {
    /* ── public reads ─────────────────────────────────────────────────────── */
    if (req.method === "GET" && path === "/health") {
      const [{ count: cves }, { count: runs }, { count: findings }] = await Promise.all([
        db.from("corpus_cve").select("*", { count: "exact", head: true }),
        db.from("hunt_runs").select("*", { count: "exact", head: true }),
        db.from("hunt_findings").select("*", { count: "exact", head: true }),
      ]);
      return json({
        ok: true,
        at: new Date().toISOString(),
        project: URL_.replace("https://", "").split(".")[0],
        counts: { cves: cves ?? 0, huntRuns: runs ?? 0, findings: findings ?? 0 },
      });
    }

    if (req.method === "GET" && path === "/organs") {
      const { data } = await db.from("organs").select("*").order("id");
      return json({ organs: data ?? [], at: new Date().toISOString() });
    }

    if (req.method === "GET" && path === "/hunt") {
      const { data: run } = await db.from("hunt_runs").select("*").order("at", { ascending: false }).limit(1).maybeSingle();
      if (!run) return json({ run: null, findings: [], says: "لسه مفيش صيد متخزّن" });
      const { data: findings } = await db
        .from("hunt_findings")
        .select("*")
        .eq("run_id", run.id)
        .order("severity");
      return json({ run, findings: findings ?? [] });
    }

    if (req.method === "GET" && path === "/corpus") {
      const q = (url.searchParams.get("q") ?? "").trim();
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
      let query = db
        .from("corpus_cve")
        .select("cve,severity,cvss,kev,epss,products,summary,modified")
        .order("kev", { ascending: false })
        .order("cvss", { ascending: false })
        .limit(limit);
      if (/^cve-\d{4}-\d+/i.test(q)) query = query.eq("cve", q.toUpperCase());
      else if (q) query = query.contains("products", [q.toLowerCase()]);
      const { data, error } = await query;
      if (error) return json({ error: error.message }, 400);
      return json({ q, rows: data ?? [], at: new Date().toISOString() });
    }

    /* ── writes (service role only) ───────────────────────────────────────── */
    if (req.method === "POST" && path === "/organ") {
      if (!isService(req)) return json({ error: "service role required" }, 401);
      const body = await req.json();
      const { error } = await db.from("organs").upsert(
        {
          id: body.id,
          label_ar: body.labelAr ?? null,
          status: body.status,
          detail: body.detail ?? null,
          source: body.source ?? null,
          at: body.at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) return json({ error: error.message }, 400);
      await db.from("organ_events").insert({ organ: body.id, status: body.status, detail: body.detail ?? null });
      return json({ ok: true, id: body.id });
    }

    if (req.method === "POST" && path === "/hunt") {
      if (!isService(req)) return json({ error: "service role required" }, 401);
      const doc = await req.json();
      const { data: run, error } = await db
        .from("hunt_runs")
        .insert({
          at: doc.at ?? new Date().toISOString(),
          tools: doc.tools ?? {},
          totals: doc.totals ?? {},
          says_ar: doc.says_ar ?? null,
          targets: doc.targets ?? [],
          raw: doc,
        })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 400);
      const rows = (doc.findings ?? []).map((f: Record<string, unknown>) => ({
        run_id: run.id,
        host: String(f.matchedAt ?? ""),
        template: String(f.template ?? ""),
        template_id: (f.templateId as string) ?? null,
        severity: (f.severity as string) ?? null,
        matched_at: (f.matchedAt as string) ?? null,
        cve: (f.cve as string[]) ?? null,
        cwe: (f.cwe as string[]) ?? null,
        evidence: f.evidence ?? null,
        verified: false,
      }));
      if (rows.length) {
        const ins = await db.from("hunt_findings").insert(rows);
        if (ins.error) return json({ error: ins.error.message }, 400);
      }
      return json({ ok: true, runId: run.id, findings: rows.length });
    }

    if (req.method === "POST" && path === "/chat") {
      const body = await req.json();
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (messages.length === 0) return json({ error: "messages[] required" }, 400);
      return await chatStream(messages);
    }

    if (req.method === "POST" && path === "/chatlog") {
      const body = await req.json();
      const role = body.role === "user" ? "user" : "assistant";
      if (typeof body.content !== "string" || body.content.length === 0) return json({ error: "content required" }, 400);
      const { data, error } = await db
        .from("chat_messages")
        .insert({
          conversation_id: body.conversationId ?? null,
          role,
          content: body.content.slice(0, 20_000),
          seat: body.seat ?? null,
          tools: body.tools ?? null,
        })
        .select("id,created_at")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, ...data });
    }

    return json({ error: "not found", path }, 404);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
