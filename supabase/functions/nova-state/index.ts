// Nova state mirror — ذاكرة المكنة الطويلة في قاعدة واحدة، من غير أي سر على المكنة.
// ─────────────────────────────────────────────────────────────────────────────
// ليه دالة منفصلة: الحزمة (nova-24-7.zip) بتتنزّل من release عام على GitHub، فأي
// مفتاح service role بيتحط فيها أو في السورس بقى مقروء لأي حد. الدالة دي
// مفتاحها جوّه Supabase نفسها (Deno.env) — والمكنة بتبعت JSON لباب واحد ثابت.
//
//   GET  /nova-state          → { ok, row: { doc, updated_at } | null, at }
//   POST /nova-state {doc}    → upsert of the single 'main' row   (anti-wipe)
//
// الحراس: الجدول ثابت (nova_memory)، الصف ثابت ('main')، الحجم ≤ 6MB، ومسح
// السجلات بصفر مرفوض — لأن أسوأ سيناريو في مزامنة هو «رجّعنا نسخة فاضية
// فمسحنا التاريخ». وعايز تقفل الكتابة أكتر؟ حط NOVA_STATE_TOKEN في أسرار
// الدالة وهنطلب هيدر x-nova-token.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const ROW = "main";
const TABLE = "nova_memory";
const MAX_BYTES = 6_000_000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, x-nova-token, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (req.method === "GET") {
      const { data, error } = await db.from(TABLE).select("doc, updated_at").eq("id", ROW).maybeSingle();
      if (error) return json({ error: error.message }, 400);
      const records = Array.isArray(data?.doc?.records) ? data.doc.records.length : 0;
      return json({ ok: true, row: data ?? null, records, at: new Date().toISOString() });
    }

    if (req.method === "POST") {
      const want = Deno.env.get("NOVA_STATE_TOKEN") || "";
      if (want && (req.headers.get("x-nova-token") ?? "").trim() !== want) {
        return json({ error: "x-nova-token required", guard: "token" }, 401);
      }
      const body = await req.json().catch(() => null as { doc?: { records?: unknown[] } } | null);
      const doc = body?.doc;
      const records = Array.isArray(doc?.records) ? doc.records : null;
      if (!records) return json({ error: "doc.records[] required" }, 400);
      const raw = JSON.stringify(doc);
      if (raw.length > MAX_BYTES) return json({ error: `doc too large (${raw.length})`, guard: "size" }, 413);

      const { data: cur } = await db.from(TABLE).select("doc").eq("id", ROW).maybeSingle();
      const prev = Array.isArray(cur?.doc?.records) ? cur.doc.records.length : 0;
      if (prev > 0 && records.length === 0) {
        return json({ error: `refusing to wipe ${prev} records with an empty doc`, guard: "anti-wipe" }, 409);
      }

      const { error } = await db
        .from(TABLE)
        .upsert({ id: ROW, doc, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, records: records.length, previous: prev, bytes: raw.length, at: new Date().toISOString() });
    }

    return json({ error: "method not allowed", method: req.method }, 405);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
