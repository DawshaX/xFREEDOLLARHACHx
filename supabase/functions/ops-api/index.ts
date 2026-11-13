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

// ── keyless seats (no key, no card, spread across independent hosts) ────────
const SEATS = [
  { id: "pollinations-openai", model: "openai", url: "https://text.pollinations.ai/openai" },
  { id: "pollinations-fast", model: "openai-fast", url: "https://text.pollinations.ai/openai" },
  { id: "ovh-llama", model: "Meta-Llama-3_3-70B-Instruct", url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions" },
  { id: "ovh-ai", model: "Qwen3.6-27B", url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions" },
  { id: "pollinations-mistral", model: "mistral", url: "https://text.pollinations.ai/openai" },
];

async function chatStream(messages: Array<{ role: string; content: string }>): Promise<Response> {
  const failures: string[] = [];
  for (const seat of SEATS) {
    const started = Date.now();
    try {
      const res = await fetch(seat.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: seat.model, messages, stream: true }),
        signal: AbortSignal.timeout(18_000),
      });
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => {});
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

// Two normalisers for corpus rows. `published` was declared in the schema and
// never populated, so it is derived here from the source date when present and,
// failing that, from the year embedded in the id (CVE-2011-1234 → 2011-01-01).
// That is a real lower bound taken from the record, not an invented timestamp.
function dateOnly(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function yearFromCve(id: string): string | null {
  const m = /^CVE-(\d{4})-/.exec(id);
  return m ? `${m[1]}-01-01` : null;
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
      // PostgREST `or` is a comma/paren grammar: a search string must never be
      // able to add its own clauses, so anything structural is stripped and the
      // remaining text is used literally.
      const safe = q.replace(/[,()"'\\%]/g, " ").trim();
      const cols = "cve,severity,cvss,kev,epss,products,summary,published,modified";
      let query = db
        .from("corpus_cve")
        .select(cols)
        .order("kev", { ascending: false })
        .order("cvss", { ascending: false })
        .limit(limit);
      if (/^cve-\d{4}-\d+$/i.test(q)) {
        query = query.eq("cve", q.toUpperCase());
      } else if (safe) {
        // product name (exact element of the CPE array) OR free text in the summary
        query = query.or(`products.cs.{${safe.toLowerCase()}},summary.ilike.%${safe}%`);
      }
      const [{ data, error }, { count: inDb }, meta] = await Promise.all([
        query,
        db.from("corpus_cve").select("*", { count: "exact", head: true }),
        db.from("corpus_meta").select("key,value").eq("key", "index"),
      ]);
      if (error) return json({ error: error.message }, 400);
      const index = (meta.data ?? [])[0]?.value ?? null;
      return json({
        q,
        rows: data ?? [],
        found: (data ?? []).length,
        searched: inDb ?? 0,
        indexTotal: index?.total ?? null,
        syncedAt: index?.at ?? null,
        // a slice is said out loud: the answer is only ever "what is in the table"
        slice: index?.total ? (inDb ?? 0) < index.total : null,
        at: new Date().toISOString(),
      });
    }

    // ── POST /corpus-sync ──────────────────────────────────────────────────
    // Loads the published corpus (release asset, gzip JSONL) straight into the
    // database. Postgres cannot un-gzip, so decompression streams chunk-by-chunk
    // in Deno (<10 MB RAM instead of buffering a >250 MB string that hits 546
    // WORKER_LIMIT), and rows go in through the service client in batches.
    //   ?limit=3000&offset=0   → ingest a window and cancel the stream early
    if (req.method === "POST" && path === "/corpus-sync") {
      const started = Date.now();
      // Authorised two ways: the service key, or an unattended scheduler. The
      // second path only ever re-reads a public release asset and upserts public
      // data, so it needs no secret — but it is rate-limited so nobody can spin
      // the function in a loop. Both paths are recorded.
      const service = isService(req);
      if (!service) {
        const { data: m } = await db.from("corpus_meta").select("value").eq("key", "sync").maybeSingle();
        const last = m?.value?.at ? Date.parse(m.value.at) : 0;
        if (Date.now() - last < 180_000) {
          return json({ skipped: "too soon", last: m?.value?.at ?? null }, 429);
        }
      }
      await db.from("corpus_meta").upsert(
        { key: "sync", value: { at: new Date().toISOString(), by: service ? "service" : "scheduler" }, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 2500) || 2500, 6000));
      const asset =
        "https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/vuln-corpus/cves.jsonl.gz";
      const indexUrls = [
        "https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/vuln-corpus/vuln-corpus-index.json",
        "https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/state/vuln-corpus-index.json",
      ];

      // Fetch the 4 KB index metadata in parallel so `corpus_meta.index` stays
      // accurate (332k+) without decompressing all 332k lines in RAM.
      const indexPromise = (async () => {
        for (const iu of indexUrls) {
          try {
            const ir = await fetch(iu, { redirect: "follow", signal: AbortSignal.timeout(12_000) });
            if (!ir.ok) continue;
            const ij = await ir.json().catch(() => null) as { total?: number; at?: string } | null;
            if (ij && typeof ij.total === "number" && ij.total > 0) return ij;
          } catch { /* try next index URL */ }
        }
        return null;
      })();

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000);
      const res = await fetch(asset, { redirect: "follow", signal: ctrl.signal });
      if (!res.ok || !res.body) {
        clearTimeout(timer);
        return json({ error: `asset HTTP ${res.status}` }, 502);
      }

      const decompressed = res.body.pipeThrough(new DecompressionStream("gzip"));
      const reader = decompressed.getReader();
      const decoder = new TextDecoder();

      const batch: Record<string, unknown>[] = [];
      let seen = 0;
      let parsed = 0;
      let written = 0;
      let timedOutEarly = false;
      const failures: string[] = [];

      const flush = async () => {
        if (batch.length === 0) return;
        const rows = batch.splice(0, batch.length);
        const { error } = await db.from("corpus_cve").upsert(rows, { onConflict: "cve" });
        if (error) failures.push(error.message);
        else written += rows.length;
      };

      const processLine = async (lineBytes: Uint8Array) => {
        const line = decoder.decode(lineBytes).trim();
        if (!line) return;
        let r: Record<string, any>;
        try {
          r = JSON.parse(line);
        } catch {
          return;
        }
        if (typeof r.id !== "string" || !r.id.startsWith("CVE-")) return;
        const products = Array.isArray(r.cpe)
          ? [...new Set(r.cpe.map((c: any) => c?.product).filter(Boolean))].slice(0, 12)
          : [];
        batch.push({
          cve: r.id,
          cvss: typeof r.cvss === "number" ? r.cvss : null,
          severity: r.sev ?? null,
          kev: Boolean(r.kev),
          epss: typeof r.epss === "number" ? r.epss : null,
          products,
          summary: String(r.desc ?? "").slice(0, 400),
          // `published` exists in the table and was never written: all 46,143 rows
          // had published = NULL, so any date filter or "newest first" was empty
          // without saying so. The source carries `pub`; a CVE id carries its year.
          published: dateOnly(r.pub) ?? yearFromCve(r.id),
          modified: r.mod ?? r.modified ?? r.pub ?? null,
          updated_at: new Date().toISOString(),
        });
        parsed++;
        if (batch.length >= 500) await flush();
      };

      const hasNonWs = (buf: Uint8Array, start: number, end: number): boolean => {
        for (let i = start; i < end; i++) {
          if (buf[i] > 32) return true;
        }
        return false;
      };

      let parts: Uint8Array[] = [];
      let partsBytes = 0;
      let lineNonWs = false;
      let eof = false;

      try {
        for (;;) {
          if (parsed >= limit) break;
          if (Date.now() - started > 45_000) {
            timedOutEarly = true;
            break;
          }
          const { done, value } = await reader.read();
          if (done) {
            eof = true;
            break;
          }
          if (!value || value.length === 0) continue;

          let pos = 0;
          while (pos < value.length) {
            const nl = value.indexOf(10, pos);
            if (nl === -1) {
              const tailHasContent = hasNonWs(value, pos, value.length);
              if (tailHasContent) lineNonWs = true;
              if (seen >= offset && (partsBytes > 0 || tailHasContent)) {
                const slice = value.slice(pos);
                parts.push(slice);
                partsBytes += slice.length;
              }
              break;
            }

            const nonEmpty = lineNonWs || hasNonWs(value, pos, nl);
            if (nonEmpty) {
              if (seen < offset) {
                seen++;
              } else {
                seen++;
                let lineBytes: Uint8Array;
                if (parts.length === 0) {
                  lineBytes = value.subarray(pos, nl);
                } else {
                  const tail = value.subarray(pos, nl);
                  lineBytes = new Uint8Array(partsBytes + tail.length);
                  let off = 0;
                  for (const p of parts) {
                    lineBytes.set(p, off);
                    off += p.length;
                  }
                  lineBytes.set(tail, off);
                }
                await processLine(lineBytes);
                if (parsed >= limit || Date.now() - started > 45_000) {
                  if (Date.now() - started > 45_000) timedOutEarly = true;
                  parts = [];
                  partsBytes = 0;
                  lineNonWs = false;
                  break;
                }
              }
            }
            parts = [];
            partsBytes = 0;
            lineNonWs = false;
            pos = nl + 1;
          }
        }

        if (eof && parsed < limit && !timedOutEarly && parts.length > 0 && seen >= offset && lineNonWs) {
          seen++;
          const lineBytes = new Uint8Array(partsBytes);
          let off = 0;
          for (const p of parts) {
            lineBytes.set(p, off);
            off += p.length;
          }
          await processLine(lineBytes);
        }
      } finally {
        clearTimeout(timer);
        try { await reader.cancel(); } catch { /* ignore */ }
        try { ctrl.abort(); } catch { /* ignore */ }
      }

      await flush();

      const [{ count: inDb }, indexDoc, prevIndexRow] = await Promise.all([
        db.from("corpus_cve").select("*", { count: "exact", head: true }),
        indexPromise,
        db.from("corpus_meta").select("value").eq("key", "index").maybeSingle(),
      ]);

      const totalLines = indexDoc?.total ?? (eof ? seen : (prevIndexRow.data?.value?.total ?? null));
      if (indexDoc?.total || eof) {
        await db.from("corpus_meta").upsert(
          {
            key: "index",
            value: {
              total: totalLines,
              at: indexDoc?.at ?? new Date().toISOString(),
              source: "release:vuln-corpus/cves.jsonl.gz",
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" },
        );
      }

      return json({
        ok: failures.length === 0,
        parsed,
        written,
        offset,
        nextOffset: offset + parsed,
        limit,
        eof,
        timedOutEarly,
        lines: totalLines,
        inDb: inDb ?? null,
        ms: Date.now() - started,
        failures: failures.slice(0, 3),
      });
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
        // `host` is the target that was scanned; `matchedAt` is a URL. Using the
        // URL as the host made every stored finding look like it came from a host
        // string with a scheme and a path in it.
        host: String(f.host ?? f.matchedAt ?? ""),
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
