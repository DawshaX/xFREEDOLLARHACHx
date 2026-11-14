/**
 * TEST9 — مركز التطبيقات المتصلة: اللايف أجينت بياخد كل التطبيقات في إيده.
 *
 * طلب المالك: «ربط التطبيقات المتصلة باللايف أجينت — Dropbox/GitHub/Gmail/
 * Google Calendar/Docs/Drive/Sheets/Slides/Linear/Notion/Supabase/Vercel —
 * كل حاجة وأكتر».
 *
 * العقد المقاس:
 *  - مفيش ادّعاء اتصال: `status()` بيقول متصل **بس** لو فيه توكن حقيقي (ملف
 *    المالك أو متغير بيئة). الباقي «محتاج ربط» بخطوات واضحة بالعربي.
 *  - كل عملية بتمشي على API الرسمي بتاع التطبيق، وبتنتهي بإشعار حي (`link`)
 *    يودّي المالك لمكانها، وبتسجّل نشاط لحظي لمركز التحكم.
 *  - التوكنات بتتخزن في `state/integrations_v1.json` (0600) — توكن واحد لكل
 *    تطبيق (Bearer / API key) — والبيئات (env) بتحتل المكان الأول لو موجودة.
 */
import fs from "node:fs";
import path from "node:path";

export interface IntegrationApp {
  id: string;
  name: string;
  nameAr: string;
  icon: string;
  /** طلب المصادقة: Bearer توكن أو مفتاح API في الهيدر. */
  auth: "bearer" | "api_key_header" | "query_token" | "none";
  /** اسم هيدر المصادقة لو auth != bearer. */
  headerName?: string;
  /** أسماء متغيرات البيئة اللي بنجرب فيها قبل ملف المالك. */
  envKeys: string[];
  /** العمليات المدعومة فعليًا (كل واحدة دالة حقيقية في OPS). */
  ops: Array<{ id: string; label: string; args?: string[] }>;
  /** مسار اللوحة اللي الإشعار بيودّي له (deep link). */
  panelLink: string;
  setupAr: string;
}

export const INTEGRATION_APPS: IntegrationApp[] = [
  {
    id: "github", name: "GitHub", nameAr: "جيت هاب", icon: "🐙", auth: "bearer", envKeys: ["GITHUB_TOKEN", "GH_TOKEN"],
    ops: [
      { id: "list_repos", label: "المستودعات" },
      { id: "list_issues", label: "قائمة الـIssues", args: ["repo"] },
      { id: "create_issue", label: "فتح Issue", args: ["repo", "title", "body"] },
    ],
    panelLink: "/integrations",
    setupAr: "اعمل PAT من GitHub → Settings → Developer settings → Tokens (classic) والصقه هنا.",
  },
  {
    id: "gmail", name: "Gmail", nameAr: "جيميل", icon: "✉️", auth: "bearer", envKeys: ["GMAIL_ACCESS_TOKEN", "GMAIL_TOKEN"],
    ops: [
      { id: "list_messages", label: "آخر الرسائل", args: ["max", "q"] },
      { id: "send_message", label: "إرسال رسالة", args: ["to", "subject", "body"] },
    ],
    panelLink: "/integrations",
    setupAr: "OAuth2 access token بنطاق gmail.readonly + gmail.send (من OAuth Playground أو تطبيقك).",
  },
  {
    id: "google_calendar", name: "Google Calendar", nameAr: "تقويم جوجل", icon: "📅", auth: "bearer", envKeys: ["GCAL_ACCESS_TOKEN", "GOOGLE_CALENDAR_TOKEN"],
    ops: [
      { id: "list_events", label: "المواعيد القادمة", args: ["max"] },
      { id: "create_event", label: "حجز موعد", args: ["summary", "start", "end"] },
    ],
    panelLink: "/integrations",
    setupAr: "OAuth2 access token بنطاق calendar.events.",
  },
  {
    id: "google_drive", name: "Google Drive", nameAr: "جوجل درايف", icon: "🗄️", auth: "bearer", envKeys: ["GDRIVE_ACCESS_TOKEN", "GOOGLE_DRIVE_TOKEN"],
    ops: [
      { id: "list_files", label: "الملفات", args: ["max"] },
      { id: "upload_text", label: "رفع ملف نصي", args: ["name", "content"] },
    ],
    panelLink: "/integrations",
    setupAr: "OAuth2 access token بنطاق drive.file.",
  },
  {
    id: "google_docs", name: "Google Docs", nameAr: "جوجل دوكس", icon: "📄", auth: "bearer", envKeys: ["GDOCS_ACCESS_TOKEN", "GOOGLE_DOCS_TOKEN"],
    ops: [
      { id: "create_doc", label: "إنشاء مستند", args: ["title", "content"] },
      { id: "append_text", label: "إضافة نص لمستند", args: ["documentId", "content"] },
    ],
    panelLink: "/integrations",
    setupAr: "OAuth2 access token بنطاق documents.",
  },
  {
    id: "google_sheets", name: "Google Sheets", nameAr: "جوجل شيتس", icon: "📊", auth: "bearer", envKeys: ["GSHEETS_ACCESS_TOKEN", "GOOGLE_SHEETS_TOKEN"],
    ops: [
      { id: "create_sheet", label: "إنشاء شيت", args: ["title"] },
      { id: "append_row", label: "إضافة صف", args: ["spreadsheetId", "range", "values"] },
      { id: "read_range", label: "قراءة نطاق", args: ["spreadsheetId", "range"] },
    ],
    panelLink: "/integrations",
    setupAr: "OAuth2 access token بنطاق spreadsheets.",
  },
  {
    id: "google_slides", name: "Google Slides", nameAr: "جوجل سلايدز", icon: "🖼️", auth: "bearer", envKeys: ["GSLIDES_ACCESS_TOKEN", "GOOGLE_SLIDES_TOKEN"],
    ops: [
      { id: "create_presentation", label: "إنشاء عرض", args: ["title"] },
    ],
    panelLink: "/integrations",
    setupAr: "OAuth2 access token بنطاق presentations.",
  },
  {
    id: "notion", name: "Notion", nameAr: "نوشن", icon: "📓", auth: "bearer", envKeys: ["NOTION_TOKEN", "NOTION_API_TOKEN"],
    ops: [
      { id: "search", label: "بحث في الصفحات", args: ["query"] },
      { id: "create_page", label: "إنشاء صفحة", args: ["parentPageId", "title", "content"] },
      { id: "append_blocks", label: "إضافة نص لصفحة", args: ["pageId", "content"] },
    ],
    panelLink: "/integrations",
    setupAr: "Integration token من notion.so/my-integrations وفعّله على الصفحات.",
  },
  {
    id: "linear", name: "Linear", nameAr: "لينير", icon: "📐", auth: "bearer", envKeys: ["LINEAR_TOKEN", "LINEAR_API_KEY"],
    ops: [
      { id: "list_issues", label: "التاسكات", args: ["limit"] },
      { id: "create_issue", label: "إنشاء تاسك", args: ["teamId", "title", "description"] },
    ],
    panelLink: "/integrations",
    setupAr: "API key من Linear → Settings → API.",
  },
  {
    id: "supabase", name: "Supabase", nameAr: "سوپا بيس", icon: "⚡", auth: "api_key_header", headerName: "apikey", envKeys: ["SUPABASE_SERVICE_KEY", "SUPABASE_KEY"],
    ops: [
      { id: "select", label: "قراءة جدول", args: ["table", "limit"] },
      { id: "insert", label: "إضافة صف", args: ["table", "row"] },
    ],
    panelLink: "/integrations",
    setupAr: "Project URL (SUPABASE_URL في البيئة) + service_role key من Supabase → Settings → API.",
  },
  {
    id: "vercel", name: "Vercel", nameAr: "ڤرسل", icon: "▲", auth: "bearer", envKeys: ["VERCEL_TOKEN", "VERCEL_API_TOKEN"],
    ops: [
      { id: "list_projects", label: "المشاريع" },
      { id: "list_deployments", label: "النشرات", args: ["limit"] },
    ],
    panelLink: "/integrations",
    setupAr: "Token من vercel.com/account/tokens.",
  },
  {
    id: "dropbox", name: "Dropbox", nameAr: "دروب بوكس", icon: "📦", auth: "bearer", envKeys: ["DROPBOX_TOKEN", "DROPBOX_ACCESS_TOKEN"],
    ops: [
      { id: "list_folder", label: "محتويات مجلد", args: ["path"] },
      { id: "upload_text", label: "رفع ملف نصي", args: ["path", "content"] },
    ],
    panelLink: "/integrations",
    setupAr: "Access token من dropbox.com/developers/apps (scoped app, files.content.write).",
  },
];

export function integrationsFile(): string {
  return path.resolve(process.cwd(), "state", "integrations_v1.json");
}

interface CredsStore {
  tokens: Record<string, string>;
  testedAt: Record<string, string>;
  lastError?: Record<string, string>;
}
let credsCache: CredsStore | null = null;

function loadCreds(): CredsStore {
  if (credsCache) return credsCache;
  try {
    const raw = JSON.parse(fs.readFileSync(integrationsFile(), "utf8")) as CredsStore;
    credsCache = { tokens: raw.tokens ?? {}, testedAt: raw.testedAt ?? {}, lastError: raw.lastError ?? {} };
  } catch {
    credsCache = { tokens: {}, testedAt: {}, lastError: {} };
  }
  return credsCache;
}

function saveCreds(): void {
  const c = loadCreds();
  try {
    fs.mkdirSync(path.dirname(integrationsFile()), { recursive: true });
    fs.writeFileSync(integrationsFile(), JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  } catch { /* the caller reports */ }
}

export function integrationToken(id: string): { token: string; source: "env" | "owner" } | null {
  const app = INTEGRATION_APPS.find((a) => a.id === id);
  if (!app) return null;
  for (const key of app.envKeys) {
    const v = process.env[key];
    if (v && v.trim().length >= 8) return { token: v.trim(), source: "env" };
  }
  const c = loadCreds();
  const t = c.tokens[id];
  if (t && t.trim().length >= 8) return { token: t.trim(), source: "owner" };
  return null;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  nameAr: string;
  icon: string;
  connected: boolean;
  source: "env" | "owner" | null;
  testedAt: string | null;
  lastError: string | null;
  ops: string[];
  setupAr: string;
  panelLink: string;
}

export function integrationsStatus(): IntegrationStatus[] {
  const c = loadCreds();
  return INTEGRATION_APPS.map((app) => {
    const tok = integrationToken(app.id);
    return {
      id: app.id,
      name: app.name,
      nameAr: app.nameAr,
      icon: app.icon,
      connected: Boolean(tok),
      source: tok?.source ?? null,
      testedAt: c.testedAt[app.id] ?? null,
      lastError: c.lastError?.[app.id] ?? null,
      ops: app.ops.map((o) => o.id),
      setupAr: app.setupAr,
      panelLink: app.panelLink,
    };
  });
}

export function setIntegrationToken(id: string, token: string): { ok: boolean; saysAr: string } {
  const app = INTEGRATION_APPS.find((a) => a.id === id);
  if (!app) return { ok: false, saysAr: `مافيش تطبيق باسم ${id}` };
  if (!token || token.trim().length < 8) return { ok: false, saysAr: "التوكن قصير جدًا — الصق التوكن الحقيقي كامل" };
  const c = loadCreds();
  c.tokens[id] = token.trim();
  saveCreds();
  return { ok: true, saysAr: `${app.nameAr}: التوكن اتحفظ — جرب اختبار حي دلوقتي` };
}

/* ── HTTP helper (measured timeouts, honest Arabic errors) ────────────────── */
async function callJson(
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<unknown> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), ...init });
  const text = await res.text();
  if (!res.ok) {
    let hint = text.slice(0, 300);
    try { hint = JSON.stringify(JSON.parse(text)).slice(0, 300); } catch { /* keep raw */ }
    throw new Error(`HTTP ${res.status} — ${hint}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

export function listIntegrationOps(id: string): Array<{ id: string; label: string }> {
  const app = INTEGRATION_APPS.find((a) => a.id === id);
  return app ? app.ops.map((o) => ({ id: o.id, label: o.label })) : [];
}

function supabaseUrl(): string | null {
  const u = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  return u && u.startsWith("http") ? u.replace(/\/$/, "") : null;
}

/* ── العمليات الحقيقية على API كل تطبيق — واحدة واحدة، بلا اختصار سطر واحد ── */
type OpFn = (token: string, a: Record<string, unknown>) => Promise<unknown>;
const OPS: Record<string, OpFn> = {};

OPS.github_list_repos = async (t) =>
  callJson("https://api.github.com/user/repos?per_page=10&sort=pushed", {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" },
  });

OPS.github_list_issues = async (t, a) =>
  callJson(`https://api.github.com/repos/${a.repo}/issues?per_page=10`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" },
  });

OPS.github_create_issue = async (t, a) =>
  callJson(`https://api.github.com/repos/${a.repo}/issues`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ title: a.title, body: a.body ?? "" }),
  });

OPS.gmail_list_messages = async (t, a) => {
  const q = a.q ? `&q=${encodeURIComponent(String(a.q))}` : "";
  const list = (await callJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${a.max ?? 5}${q}`, {
    headers: { Authorization: `Bearer ${t}` },
  })) as { messages?: Array<{ id: string }> };
  const ids = (list.messages ?? []).slice(0, 5);
  const messages: unknown[] = [];
  for (const m of ids) {
    messages.push(
      await callJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, {
        headers: { Authorization: `Bearer ${t}` },
      }),
    );
  }
  return { count: messages.length, messages };
};

OPS.gmail_send_message = async (t, a) => {
  const raw = Buffer.from(`To: ${a.to}\r\nSubject: ${a.subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${a.body ?? ""}`).toString("base64url");
  return callJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
};

OPS.google_calendar_list_events = async (t, a) =>
  callJson(`https://www.googleapis.com/calendar/v3/primary/events?timeMin=${new Date().toISOString()}&maxResults=${a.max ?? 5}&singleEvents=true&orderBy=startTime`, {
    headers: { Authorization: `Bearer ${t}` },
  });

OPS.google_calendar_create_event = async (t, a) =>
  callJson("https://www.googleapis.com/calendar/v3/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: a.summary, start: { dateTime: a.start }, end: { dateTime: a.end ?? a.start } }),
  });

OPS.google_drive_list_files = async (t, a) =>
  callJson(`https://www.googleapis.com/drive/v3/files?pageSize=${a.max ?? 10}&orderBy=modifiedByMeTime%20desc`, {
    headers: { Authorization: `Bearer ${t}` },
  });

OPS.google_drive_upload_text = async (t, a) => {
  const meta = { name: a.name, mimeType: "text/plain" };
  const boundary = "nova" + Date.now();
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${a.content ?? ""}\r\n--${boundary}--`;
  return callJson("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
};

OPS.google_docs_create_doc = async (t, a) => {
  const doc = (await callJson("https://docs.googleapis.com/v1/documents", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: a.title }),
  })) as { documentId: string };
  if (a.content) {
    await callJson(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: String(a.content) } }] }),
    });
  }
  return doc;
};

OPS.google_docs_append_text = async (t, a) => {
  const doc = (await callJson(`https://docs.googleapis.com/v1/documents/${a.documentId}`, {
    headers: { Authorization: `Bearer ${t}` },
  })) as { body?: { content?: Array<{ endIndex?: number }> } };
  const chunks = doc.body?.content ?? [];
  const end = chunks.length ? (chunks[chunks.length - 1].endIndex ?? 1) : 1;
  return callJson(`https://docs.googleapis.com/v1/documents/${a.documentId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ insertText: { location: { index: Math.max(end - 1, 1) }, text: String(a.content) } }] }),
  });
};

OPS.google_sheets_create_sheet = async (t, a) =>
  callJson("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title: a.title } }),
  });

OPS.google_sheets_append_row = async (t, a) => {
  let values = a.values;
  if (typeof values === "string") {
    try { values = JSON.parse(values); } catch { values = [values]; }
  }
  if (!Array.isArray(values)) values = [values];
  return callJson(`https://sheets.googleapis.com/v4/spreadsheets/${a.spreadsheetId}/values/${encodeURIComponent(String(a.range ?? "A1"))}:append?valueInputOption=USER_ENTERED`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
};

OPS.google_sheets_read_range = async (t, a) =>
  callJson(`https://sheets.googleapis.com/v4/spreadsheets/${a.spreadsheetId}/values/${encodeURIComponent(String(a.range))}`, {
    headers: { Authorization: `Bearer ${t}` },
  });

OPS.google_slides_create_presentation = async (t, a) =>
  callJson("https://slides.googleapis.com/v1/presentations", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: a.title }),
  });

OPS.notion_search = async (t, a) =>
  callJson("https://api.notion.com/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify({ query: a.query ?? "", page_size: 10 }),
  });

OPS.notion_create_page = async (t, a) => {
  if (!a.parentPageId) throw new Error("محتاج parentPageId (معرّف الصفحة الأب) — اعمله Search الأول");
  return callJson("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify({
      parent: { page_id: a.parentPageId },
      properties: { title: { title: [{ text: { content: a.title } }] } },
      children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: String(a.content ?? "") } }] } }],
    }),
  });
};

OPS.notion_append_blocks = async (t, a) =>
  callJson(`https://api.notion.com/v1/blocks/${a.pageId}/children`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${t}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify({ children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: String(a.content) } }] } }] }),
  });

OPS.linear_list_issues = async (t) =>
  callJson("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query { issues(first: 10, orderBy: updatedAt) { nodes { title state { name } url } } }" }),
  });

OPS.linear_create_issue = async (t, a) =>
  callJson("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "mutation($team: String!, $title: String!, $desc: String) { issueCreate(input: { teamId: $team, title: $title, description: $desc }) { success issue { url } } }",
      variables: { team: a.teamId, title: a.title, desc: a.description ?? "" },
    }),
  });

OPS.supabase_select = async (t, a) => {
  const url = supabaseUrl();
  if (!url) throw new Error("محتاج SUPABASE_URL في البيئة (رابط المشروع)");
  return callJson(`${url}/rest/v1/${a.table}?limit=${Number(a.limit ?? 10)}`, {
    headers: { apikey: t, Authorization: `Bearer ${t}` },
  });
};

OPS.supabase_insert = async (t, a) => {
  const url = supabaseUrl();
  if (!url) throw new Error("محتاج SUPABASE_URL في البيئة");
  let row = a.row;
  if (typeof row === "string") {
    try { row = JSON.parse(row); } catch { throw new Error("الصف لازم JSON صالح"); }
  }
  return callJson(`${url}/rest/v1/${a.table}`, {
    method: "POST",
    headers: { apikey: t, Authorization: `Bearer ${t}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
};

OPS.vercel_list_projects = async (t) =>
  callJson("https://api.vercel.com/v9/projects", { headers: { Authorization: `Bearer ${t}` } });

OPS.vercel_list_deployments = async (t, a) =>
  callJson(`https://api.vercel.com/v6/deployments?limit=${a.limit ?? 10}`, { headers: { Authorization: `Bearer ${t}` } });

OPS.dropbox_list_folder = async (t, a) =>
  callJson("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: a.path ?? "", limit: 20 }),
  });

OPS.dropbox_upload_text = async (t, a) =>
  callJson("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Dropbox-API-Arg": JSON.stringify({ path: a.path, mode: "overwrite" }),
      "Content-Type": "application/octet-stream",
    },
    body: String(a.content ?? ""),
  });

/** op id في الأداة بييجي "<app>_<op>" — بيتحل من هنا. */
export async function runIntegration(appId: string, opId: string, argsIn: Record<string, unknown> = {}): Promise<IntegrationResult> {
  const app = INTEGRATION_APPS.find((a) => a.id === appId);
  if (!app) return { ok: false, saysAr: `مافيش تطبيق باسم ${appId}`, link: "/integrations" };
  const fullOp = OPS[`${appId}_${opId}`] || OPS[opId] ? `${appId}_${opId}` in OPS ? `${appId}_${opId}` : opId : null;
  if (!fullOp || !OPS[fullOp]) {
    return { ok: false, saysAr: `عملية غير معروفة: ${opId} — المتاح: ${app.ops.map((o) => o.id).join(" · ")}`, link: app.panelLink };
  }
  const tok = integrationToken(appId);
  if (!tok) return { ok: false, saysAr: `${app.nameAr} مش متصل — ${app.setupAr}`, link: app.panelLink };
  try {
    const data = await OPS[fullOp](tok.token, argsIn);
    const c = loadCreds();
    c.testedAt[appId] = new Date().toISOString();
    delete c.lastError?.[appId];
    saveCreds();
    return { ok: true, data, saysAr: `${app.nameAr} · ${opId} ✓ — ${summarizeResult(data)}`, link: app.panelLink };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const c = loadCreds();
    c.lastError = c.lastError ?? {};
    c.lastError[appId] = msg.slice(0, 200);
    saveCreds();
    return { ok: false, saysAr: `${app.nameAr} · ${opId} فشل — ${msg}`, link: app.panelLink };
  }
}

export interface IntegrationResult { ok: boolean; data?: unknown; saysAr: string; link: string }

function summarizeResult(data: unknown): string {
  if (Array.isArray(data)) return `${data.length} عنصر`;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["items", "messages", "files", "projects", "deployments", "events", "results"]) {
      if (Array.isArray(o[key])) return `${(o[key] as unknown[]).length} عنصر`;
    }
    if (o.spreadsheetId || o.documentId || o.id || o.presentationId) return "اتأنشى بنجاح";
    return "تمت العملية";
  }
  return "تمت العملية";
}
