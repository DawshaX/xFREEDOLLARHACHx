/**
 * قائمة المسارات اللي بتتوزّع مع الحزمة — مش أوفر.
 * ────────────────────────────────────────────────────────────────────────────
 * `ffuf` و`gobuster` أداتين بلا معنى من غير wordlist، والحاوية المجانية مافيهاش
 * SecLists ومافيش root يثبّتها. فالحد الأدنى (215 سطر مختار يدويًا: لوحات،
 * `.env`, `.git`, actuator, swagger, wp-*, نقاط health/metrics) بقى ملف جوه
 * المستودع بيتم نسخّه مع `ops/` في الحزمة المحمولة — القياس: `ops/` كله كان
 * 804KB قبل الإضافة، ودي 1.9KB.
 *
 * عايز قائمة كاملة؟ `NOVA_WORDLIST=/path/to/SecLists-...txt` بياخد الأولوية،
 * ولو مالقيناش ولا ملف بنرجّع فاضي فتقرير الأداة يقول «مفيش wordlist» بدل ما
 * يطلع صفر نتائج ويبدو كأن الموقع نضيف — وده بالظبط نوع النجاح المفبرك اللي
 * البوابات هنا مبتقبلوش.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const EMBEDDED_WORDLIST = "ops/wordlists/nova-paths.txt";
/**
 * القايمة المتوسطة والبارامترات — «كنوز» مجّلوبة من `danielmiessler/SecLists`
 * (`Discovery/Web-Content/common.txt` + `quickhits.txt` + `burp-parameter-names.txt`)
 * عبر `api.github.com` في 2026-11-07، اتلمّت وراحت التكرار بالسطر:
 * `paths-medium.txt` = 7207 سطر (78KB) و`params-burp.txt` = 6453 سطر (54KB).
 * ليه جوه المستودع مش على النت؟ المكنة ما تشوفش `api.github.com` (متقاس)، فالملف
 * اللي جوه الحزمة هو الوحيد المضمون. و`ops/` كله بقى 928KB بدل 804KB (+130KB) —
 * ده مقاس ومتحمّل: 78KB نص بيضغط مع الحزمة، مقابل إن ffuf يبقى عنده 7207 مسار
 * يشتغل بيهم بدل 215، ونقطة بداية حقيقية لصيد البارامترات.
 */
export const WORDLISTS = {
  /** السريعة: على حاوية 1-2 نواة بتخلص في ثواني، ودي الافتراضي. */
  fast: "ops/wordlists/nova-paths.txt",
  /** المتوسطة: common + quickhits من SecLists — ~7.2 ألف مسار. */
  medium: "ops/wordlists/paths-medium.txt",
  /** أسماء بارامترات (burp-parameter-names) لـ`?FUZZ=1`. */
  params: "ops/wordlists/params-burp.txt",
  /** 60 ألف مسار (common + raft + quickhits، متلمّة وِمرفوض التكرار) — لمكنة فيها وقت. */
  xl: "ops/wordlists/nova-paths-xl.txt",
  /** 7,746 مسار حسّاس (نسخ احتياطية/لوحات/إعدادات/نقاط API) — الاستطلاع السلبي ما يلاقيهومش. */
  vuln: "ops/wordlists/nova-vuln-xl.txt",
  /** 6,115 اسم بارامتر — للبحث عن البارامترات المختفية. */
  paramsXl: "ops/wordlists/nova-params-xl.txt",
  /**
   * 150 ألف اسم نطاق فرعي: **مش في الحزمة** بالقرار (1.9MB على سلوت 1024MB، متقاس).
   * بتنجلب من التخزين المجاني بطلب، و`sha256` إلزامي قبل الاستعمال — انظر `fetchList`.
   */
  subdomainsXl: "ops/wordlists/nova-subdomains-xl.txt",
} as const;
export type WordlistKind = keyof typeof WORDLISTS;

/** اختيار الحجم بالـenv: `NOVA_WORDLIST_SIZE=medium` أو ملف صريح بياخد الأولوية. */
export function resolveList(kind: WordlistKind, cwd: string = process.cwd()): string {
  const p = wordlistPathFor(WORDLISTS[kind], cwd);
  return p;
}

/** الكاش اللي نزّلناه من التخزين المجاني: `state/wordlists/<اسم الملف>`. */
export const REMOTE_CACHE_DIR = path.join("state", "wordlists");

/** المرشّحات: ملفات الحزمة أولًا، وبعدين كاش المرآة — نفس الاسم ومصدر أبطأ بس موجود. */
export function listCandidates(rel: string, cwd: string): string[] {
  const base = path.basename(rel);
  const out: string[] = [];
  for (const root of [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "../.."), path.resolve(cwd, "../../..")]) {
    out.push(path.join(root, rel));
  }
  for (const root of [cwd, path.resolve(cwd, "..")]) out.push(path.join(root, REMOTE_CACHE_DIR, base));
  return out;
}

/** أول ملف موجود من المرشّحين؛ `""` = مفيش (والأداة تقول السبب، مش تصمت). */
function wordlistPathFor(rel: string, cwd: string): string {
  for (const cand of listCandidates(rel, cwd)) {
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
      /* جرّب اللي بعده */
    }
  }
  return "";
}

/**
 * `NOVA_WORDLIST=/path` > `NOVA_WORDLIST_SIZE=fast|medium|params` > السريعة.
 * الأحجام دي مش زينة: على مكنة 208MHz/1 نواة القايمة المتوسطة تاخد دقائق، وده
 * قرار صاحب المكنة مش قرارنا — فالافتراضي يفضل السريع.
 */
export function wordlistPath(cwd: string = process.cwd()): string {
  const env = String(process.env.NOVA_WORDLIST ?? "").trim();
  if (env) {
    const abs = path.resolve(env);
    if (fs.existsSync(abs)) return abs;
  }
  const size = String(process.env.NOVA_WORDLIST_SIZE ?? "").trim().toLowerCase();
  const alias: Record<string, WordlistKind> = {
    medium: "medium",
    params: "params",
    "params-xl": "paramsXl",
    paramsxl: "paramsXl",
    xl: "xl",
    large: "xl",
    vuln: "vuln",
    subdomains: "subdomainsXl",
    "subdomains-xl": "subdomainsXl",
    subdomainsxl: "subdomainsXl",
  };
  const kind = alias[size];
  if (kind) return wordlistPathFor(WORDLISTS[kind], cwd);
  return wordlistPathFor(EMBEDDED_WORDLIST, cwd);
}

export function wordlistInfo(cwd: string = process.cwd()): { path: string | null; lines: number; bytes: number; source: string } {
  const p = wordlistPath(cwd);
  if (!p) return { path: null, lines: 0, bytes: 0, source: "مفيش قائمة مدمجة — حطّ NOVA_WORDLIST" };
  try {
    const st = fs.statSync(p);
    let lines = 0;
    for (const chunk of String(fs.readFileSync(p, "utf8")).split("\n")) if (chunk.trim()) lines += 1;
    return { path: p, lines, bytes: st.size, source: envOverride() ? "NOVA_WORDLIST" : "embedded" };
  } catch (err) {
    return { path: p, lines: 0, bytes: 0, source: `مقروءش: ${(err as Error).message}` };
  }
}

/**
 * قائمة البارامترات: الصغير (6,453) افتراضي، واللي فاعل `NOVA_WORDLIST_SIZE=xl|vuln|params-xl`
 * ياخد الكبيرة (6,115 اسم من burp + top-55 apps) — نفس الفلسفة: المشغّل بيقرر، مش إحنا.
 */
export function paramsList(cwd: string = process.cwd()): string {
  const size = String(process.env.NOVA_WORDLIST_SIZE ?? "").trim().toLowerCase();
  if (size === "params") return resolveList("params", cwd);
  if (["xl", "large", "vuln", "params-xl", "paramsxl", "subdomains", "subdomains-xl"].includes(size)) {
    const big = resolveList("paramsXl", cwd);
    if (big) return big;
  }
  return resolveList("params", cwd);
}

function envOverride(): boolean {
  return Boolean(String(process.env.NOVA_WORDLIST ?? "").trim());
}


/* ── التخزين المجاني: القرايات الكبيرة مش لازم تركب في كل حزمة ─────────────────
 * القرار وراه قياس، مش تذوق: سلوت المكنة 1024MB قرص و460MB رام (متقاس من
 * `GET /api/ops/tools → resources` 2026-11-08T01:42Z)، والحزمة نفسها بينزّلها
 * updater كل ما يتنشر بناء. فملف بـ1.9MB يبقى على جيت هاب/درايف/دروبوكس، والمكنة
 * تجيبه وقت الحاجة وخلاص.
 *
 * والقاعدة اللي بتخلي ده آمن: **المرآة ناقل، مش مصدر ثقة.** المستودع فيه
 * `ops/wordlists/free-store.json` بكل `sha256` وحجم — وأي بايت بينزّل لازم يطابقهم
 * قبل ما يُستعمل. لو المرآة اتغيّرت أو اتسممت، الملف اترفض والسبب اتقال.
 */

export interface FreeStoreFile {
  kind: string;
  lines: number;
  bytes: number;
  sha256: string;
  note?: string;
  inBundle?: boolean;
  from?: string[];
}

export interface FreeStore {
  generatedAt: string;
  source?: { name?: string; ref?: string; tarball?: string; tarballSha256?: string };
  policy?: Record<string, unknown>;
  mirrors?: Record<string, unknown>;
  files: Record<string, FreeStoreFile>;
}

export interface ListSource {
  provider: "drive" | "dropbox" | "github";
  url: string;
}

export interface ListAttempt {
  provider: string;
  outcome: string;
}

export interface ListFetchResult {
  name: string;
  path: string;
  bytes: number;
  lines: number;
  sha256: string;
  /** `true` بس لما الباييت المقروء طابعت `sha256` المستودع. */
  verified: boolean;
  source: string;
  attempts: ListAttempt[];
}

const FREE_STORE_REL = "ops/wordlists/free-store.json";

export function freeStorePath(cwd: string = process.cwd()): string {
  const env = String(process.env.NOVA_FREE_STORE ?? "").trim();
  if (env && fs.existsSync(env)) return env;
  for (const cand of listCandidates(FREE_STORE_REL, cwd)) {
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
      /* جرّب اللي بعده */
    }
  }
  return "";
}

export function readFreeStore(cwd: string = process.cwd()): FreeStore | null {
  const file = freeStorePath(cwd);
  if (!file) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as FreeStore;
    return doc && doc.files ? doc : null;
  } catch (err) {
    return null;
  }
}

/** ترتيب المرآات: درايڤ (أسرع بلا تسجيل) ← دروبوكس ← raw جيت هاب. */
export function listSources(store: FreeStore | null, name: string, repo = "DawshaX/xFREEDOLLARHACHx"): ListSource[] {
  const out: ListSource[] = [];
  const m = (store?.mirrors ?? {}) as {
    drive?: { urlTemplate?: string; files?: Record<string, string> };
    dropbox?: { files?: Record<string, string> };
    github?: { rawTemplate?: string };
  };
  const drive = m.drive;
  if (drive?.urlTemplate && drive.files?.[name]) {
    out.push({ provider: "drive", url: drive.urlTemplate.replace("{id}", drive.files[name]) });
  }
  if (m.dropbox?.files?.[name] && !String(m.dropbox.files[name]).startsWith("__")) {
    out.push({ provider: "dropbox", url: m.dropbox.files[name] });
  }
  out.push({
    provider: "github",
    url: (m.github?.rawTemplate ?? `https://raw.githubusercontent.com/${repo}/main/${FREE_STORE_REL.replace("free-store.json", "")}{file}`).replace("{file}", name),
  });
  return out;
}

function countLines(buf: Buffer): number {
  let n = 0;
  for (let i = 0; i < buf.length; i += 1) if (buf[i] === 0x0a) n += 1;
  return buf.length && buf[buf.length - 1] !== 0x0a ? n + 1 : n;
}

export function remoteCachePath(name: string, cwd: string = process.cwd()): string {
  return path.join(cwd, REMOTE_CACHE_DIR, name.replace(/[^A-Za-z0-9._-]/g, "_"));
}

/**
 * نجلب ملفًا من المرآات، واحد ورا التاني، ونقف عند أول واحدة تطابق المستودع.
 * مافيش «صفر» جاهز: كل محاولة ليها سطر في `attempts` — والفاشل بيقول ليه
 * («ماردّش» مش «فاضل»). سقف الحجم والـtimeout افتراضيين ومحترمين.
 */
export async function fetchList(
  name: string,
  opts: { cwd?: string; timeoutMs?: number; maxBytes?: number; repo?: string } = {},
): Promise<ListFetchResult> {
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = Math.max(2_000, Math.min(Number(opts.timeoutMs) || 45_000, 300_000));
  const maxBytes = Math.max(1_024, Math.min(Number(opts.maxBytes) || 12 * 1024 * 1024, 64 * 1024 * 1024));
  const store = readFreeStore(cwd);
  const spec = store?.files?.[name];
  const empty: ListFetchResult = { name, path: "", bytes: 0, lines: 0, sha256: "", verified: false, source: "", attempts: [] };
  if (!spec) {
    empty.attempts.push({ provider: "manifest", outcome: store ? `«${name}» مش في free-store.json — مبننزّلش ملف بلا بصمة` : "مافيش free-store.json في الحزمة" });
    return empty;
  }
  const dest = remoteCachePath(name, cwd);
  const sources = listSources(store, name, opts.repo);
  const attempts: ListAttempt[] = [];
  for (const src of sources) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const tmp = `${dest}.${process.pid}.tmp`;
    try {
      const res = await fetch(src.url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "nova-free-store/1" } });
      if (!res.ok) {
        attempts.push({ provider: src.provider, outcome: `HTTP ${res.status}` });
        continue;
      }
      const chunks: Buffer[] = [];
      let got = 0;
      const reader = res.body?.getReader?.();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          got += (value as Uint8Array).byteLength;
          if (got > maxBytes) {
            attempts.push({ provider: src.provider, outcome: `أكبر من السقف ${Math.round(maxBytes / 1024)}KB — وقّفنا القراية` });
            void reader.cancel();
            break;
          }
          chunks.push(Buffer.from(value));
        }
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        got = buf.byteLength;
        if (got > maxBytes) {
          attempts.push({ provider: src.provider, outcome: `أكبر من السقف ${Math.round(maxBytes / 1024)}KB` });
          continue;
        }
        chunks.push(buf);
      }
      if (got > maxBytes) continue;
      const body = Buffer.concat(chunks);
      const sha = crypto.createHash("sha256").update(body).digest("hex");
      if (spec.bytes && body.length !== spec.bytes) {
        attempts.push({ provider: src.provider, outcome: `الحجم ${body.length} مش ${spec.bytes} اللي في المستودع` });
        continue;
      }
      if (sha !== spec.sha256) {
        attempts.push({ provider: src.provider, outcome: `sha256 مختلف (${sha.slice(0, 12)}… ≠ ${spec.sha256.slice(0, 12)}…) — المرآة اتمسحت أو لأ` });
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, dest);
      attempts.push({ provider: src.provider, outcome: `✓ ${body.length} بايت · بصمة مطابقة` });
      return { name, path: dest, bytes: body.length, lines: countLines(body), sha256: sha, verified: true, source: src.provider, attempts };
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      attempts.push({ provider: src.provider, outcome: /abort/i.test(msg) ? `عالق: ماتردّش في ${Math.round(timeoutMs / 1000)} ثانية` : `ماردّش: ${msg.slice(0, 90)}` });
    } finally {
      clearTimeout(timer);
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* سيبها */
      }
    }
  }
  return { ...empty, attempts };
}

export interface ListRow {
  name: string;
  kind: string;
  lines: number;
  bytes: number;
  sha256: string;
  inBundle: boolean;
  resolved: string | null;
  /** القيااس الفعلي من القرص: ولا رقم هنا من كلام المنشئ. */
  onDisk: { path: string; lines: number; bytes: number; shaMatches: boolean } | null;
  mirrors: string[];
}

/** جرد القرايات: إيه المدمج، إيه المنجلب، وإيه اللي لسه ماجاش — بالحجم والسطر المحسوبين. */
export function listInventory(cwd: string = process.cwd(), repo?: string): { store: string | null; generatedAt: string | null; source: string | null; rows: ListRow[] } {
  const store = readFreeStore(cwd);
  const file = freeStorePath(cwd);
  if (!store) return { store: null, generatedAt: null, source: null, rows: [] };
  const rows: ListRow[] = Object.entries(store.files || {}).map(([name, spec]) => {
    const rel = path.join(path.dirname(FREE_STORE_REL), name);
    const resolved = wordlistPathFor(rel, cwd) || (fs.existsSync(remoteCachePath(name, cwd)) ? remoteCachePath(name, cwd) : "");
    let onDisk: ListRow["onDisk"] = null;
    if (resolved) {
      try {
        const buf = fs.readFileSync(resolved);
        onDisk = { path: resolved, lines: countLines(buf), bytes: buf.length, shaMatches: crypto.createHash("sha256").update(buf).digest("hex") === spec.sha256 };
      } catch (err) {
        onDisk = { path: resolved, lines: 0, bytes: 0, shaMatches: false };
      }
    }
    return {
      name,
      kind: spec.kind,
      lines: spec.lines,
      bytes: spec.bytes,
      sha256: spec.sha256,
      inBundle: Boolean(spec.inBundle),
      resolved: resolved || null,
      onDisk,
      mirrors: listSources(store, name, repo).map((x) => x.provider),
    };
  });
  return { store: file || null, generatedAt: store.generatedAt ?? null, source: store.source?.name ?? null, rows };
}
