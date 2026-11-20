/**
 * Ops · مكان الشغل الحقيقي جوه كالي — Kali Workspace
 * ────────────────────────────────────────────────────────────────────────────────
 * المشكلة اللي الملف ده بيحلها
 * ─────────────────────────────
 * المستخدم قال بالحرف: «اعملي مكان للشغل في كالي». اللي كان موجود قبل الملف ده:
 *
 *   POST /kali-env/exec   → أمر واحد، SSE، بينتهي، **مفيش حالة** — كل أمر
 *                           بيبدأ من الصفر وما بيعرفش حاجة عن اللي قبله.
 *   GET  /kali-env/sessions → بيرجّع `{sessions: [], note: "one-shot"}` — بصراحة
 *                           بس يعني مفيش مكان شغل خالص.
 *
 * يعني ماكانش فيه: مجلد مشروع، ولا ملفات بتفضل، ولا تنصيب أدوات بيتحفظ، ولا
 * مخرجات مسح بتتجمع. أي شغل حقيقي (استطلاع → فحص → استغلال → تقرير) محتاج
 * الحالة دي تفضل موجودة بين الأوامر. ده اللي الملف ده بيعمله.
 *
 * التصميم — ليه كده
 * ─────────────────
 * • **الحقيقة على الدسك**: كل مساحة شغل هي مجلد حقيقي تحت
 *   `<rootfs>/root/nova-workspaces/<slug>/`، يعني عايشة *جوه* كالي نفسها.
 *   مش جدول في الذاكرة بيدّعي وجود مشروع.
 * • **بلا shell في المسارات**: الـslug بيتولّد من الاسم بقواعد صريحة (حروف
 *   لاتينية/أرقام/شرطة) — مافيش `.` ولا `/` ولا فراغ، فمافيش طريق يهرب من
 *   المجلد. ده مهم لأن الأوامر بتتبني نصيًا للضيف.
 * • **مافيش ادعاء نجاح**: `list` بيقرأ الدسك كل مرة. لو المجلد اتمسح من برّه،
 *   الليستة بتقول كده — مش بتفضل تفترض إنه موجود.
 * • **التنفيذ جوه السياق**: كل أمر بيتنفّذ بـ`cwd` = مجلد المساحة، فالمخرجات
 *   (nmap.xml، nuclei.txt…) بتنزل فيه تلقائيًا وبتتعرض في الليستة.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { detectProotLayout, runInProot } from "./proot";

/** أنواع الملفات اللي بنعرضها — المخرجات الحقيقية للشغل الأمني. */
const INTERESTING = /\.(txt|xml|json|jsonl|md|csv|log|html|pcap|gnmap|nmap|sarif|yaml|yml|sh|py|conf)$/i;

/** حد أقصى صريح — مساحة شغل واحدة مش هتعرض 100 ألف ملف على واجهة. */
const MAX_FILES = 400;

export interface WorkspaceFile {
  name: string;
  /** مسار نسبي جوه المساحة (مش مسار النظام — مايفضحش هيكل السيرفر). */
  rel: string;
  bytes: number;
  mtime: string;
  kind: "dir" | "file";
}

export interface Workspace {
  slug: string;
  name: string;
  /** المسار جوه كالي كما بيشوفه المستخدم (مثال: /root/nova-workspaces/web-audit). */
  guestPath: string;
  createdAt: string;
  updatedAt: string;
  files: WorkspaceFile[];
  fileCount: number;
  dirBytes: number;
  /** آخر أوامر اتنفذت — محفوظة على الدسك عشان تفضل بعد إعادة التشغيل. */
  history: { cmd: string; at: string; exitCode: number | null; ms: number }[];
}

export interface WorkspaceJournalEntry {
  at: string;
  cmd: string;
  exitCode: number | null;
  ms: number;
  /** آخر أسطر من المخرجات — محفوظة كدليل مش كإعادة تشغيل. */
  tail: string;
}

/** قواعد الـslug: حروف لاتينية/أرقام/شرطة، لازم يبدأ بحرف أو رقم، ≤ 48. */
export function slugify(raw: string): string {
  const s = String(raw ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!s) throw new Error("اسم المساحة لازم يكون فيه حرف لاتيني أو رقم واحد على الأقل");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw new Error(`اسم مساحة غير صالح: ${raw}`);
  return s;
}

/** المجلد الأساسي — جوه كالي لو محلي، أو في state/nova-workspaces على الهَب (محفوظة في GitHub nova-state) لو الأسطول سحابي. */
function workspacesRoot(): string {
  const layout = detectProotLayout();
  if (layout.ready && layout.rootfs) {
    return path.join(layout.rootfs, "opt", "nova-workspaces");
  }
  const stateBase = process.env.NOVA_STATE_ROOT
    || (fs.existsSync("/home/container") ? "/home/container" : process.cwd());
  const fallback = path.join(stateBase, "state", "nova-workspaces");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function wsDir(slug: string): string {
  const root = workspacesRoot();
  const dir = path.join(root, slug);
  // تحقق أخير قبل أي لمس — حتى لو الـslug جاي من مكان تاني.
  const rel = path.relative(root, dir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("مسار مساحة غير آمن");
  return dir;
}

function journalPath(slug: string): string {
  return path.join(wsDir(slug), ".nova-journal.jsonl");
}

/* ★ مكان المساحات جوه الـguest: `/root` مملوك root:root بمودّ 700 و`ls` نفسه
 *   بيرفض هناك (Permission denied) — اتقاس 2026-11-17 مع -0 ومع غيره.
 *   `/opt/nova-workspaces` هو المكان الصح: مملوك للمستخدم، و`/opt` عُرف
 *   تقليدي لبيئات وأدوات مش من مدير الحزم. */
const GUEST_BASE = "/opt/nova-workspaces";

function readJournal(slug: string, limit = 20): WorkspaceJournalEntry[] {
  try {
    const raw = fs.readFileSync(journalPath(slug), "utf8");
    const rows = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as WorkspaceJournalEntry;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as WorkspaceJournalEntry[];
    return rows.slice(-limit).reverse();
  } catch {
    return [];
  }
}

function walk(dir: string, base: string, out: WorkspaceFile[], depth = 0): void {
  if (out.length >= MAX_FILES || depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs);
    // ملفاتنا الداخلية مش جزء من شغل المستخدم — ما نعرضهاش.
    if (e.name === ".nova-journal.jsonl" || e.name === ".nova-workspace.json") continue;
    if (e.isDirectory()) {
      out.push({ name: e.name, rel, bytes: 0, mtime: "", kind: "dir" });
      walk(abs, base, out, depth + 1);
    } else if (e.isFile()) {
      let st: fs.Stats | null = null;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      out.push({
        name: e.name,
        rel,
        bytes: st.size,
        mtime: st.mtime.toISOString(),
        kind: "file",
      });
    }
  }
}

/** يقرأ مساحة واحدة من الدسك. بيرمي لو مش موجودة — بصراحة. */
export function getWorkspace(slugRaw: string): Workspace {
  const slug = slugify(slugRaw);
  const dir = wsDir(slug);
  if (!fs.existsSync(dir)) throw new Error(`مساحة الشغل «${slug}» مش موجودة`);
  let meta: { name?: string; createdAt?: string } = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, ".nova-workspace.json"), "utf8"));
  } catch {
    /* مساحة قديمة بلا ميتاداتا — بنكمّل بالاسم من الـslug */
  }
  const files: WorkspaceFile[] = [];
  walk(dir, dir, files);
  files.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  const dirBytes = files.reduce((n, f) => n + f.bytes, 0);
  let updatedAt = meta.createdAt ?? new Date(0).toISOString();
  for (const f of files) if (f.mtime && f.mtime > updatedAt) updatedAt = f.mtime;
  const journal = readJournal(slug, 30);
  return {
    slug,
    name: meta.name ?? slug,
    guestPath: `${GUEST_BASE}/${slug}`,
    createdAt: meta.createdAt ?? updatedAt,
    updatedAt,
    files,
    fileCount: files.filter((f) => f.kind === "file").length,
    dirBytes,
    history: journal.map((j) => ({ cmd: j.cmd, at: j.at, exitCode: j.exitCode, ms: j.ms })),
  };
}

let seededDefaults = false;

/** كل المساحات الحقيقية على الدسك. مش من كاش. */
export function listWorkspaces(): Workspace[] {
  let root: string;
  try {
    root = workspacesRoot();
  } catch {
    return [];
  }
  if (!fs.existsSync(root)) return [];
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  if (names.length === 0 && !seededDefaults) {
    seededDefaults = true;
    for (const def of ["recon-lab", "web-audit", "cloud-osint"]) {
      try {
        void createWorkspace(def);
      } catch {
        /* ignore */
      }
    }
    try {
      names = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      names = [];
    }
  }
  const out: Workspace[] = [];
  for (const n of names) {
    try {
      out.push(getWorkspace(n));
    } catch {
      /* مساحة بايظة ما تكسرش الليستة كلها */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * ينشئ مساحة شغل. المجلد بيتعمل جوه كالي، وبعدها بنجهّز الهيكل اللي أي شغل
 * أمني محتاجه — عشان المستخدم يبدأ بشغل مش بmkdir.
 */
export async function createWorkspace(nameRaw: string, opts?: { template?: string }): Promise<Workspace> {
  const slug = slugify(nameRaw);
  const dir = wsDir(slug);
  if (fs.existsSync(dir)) {
    const existing = getWorkspace(slug);
    return existing; // موجودة — بنرجّعها زي ما هي بدل ما نضرب خطأ
  }
  fs.mkdirSync(dir, { recursive: true });
  const layout = detectProotLayout();
  const createdAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(dir, ".nova-workspace.json"),
    JSON.stringify({ name: String(nameRaw).slice(0, 80), slug, createdAt, template: opts?.template ?? "pentest" }, null, 2),
  );
  // هيكل عمل حقيقي: مخرجات، أدلة، حمولات، تقارير، سكربتات
  for (const sub of ["scans", "loot", "payloads", "reports", "scripts", "notes"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  /* nuclei بيدوّر على القوالب في $HOME/nuclei-templates. بما إن HOME = المساحة،
   * بنعمل link للقوالب المشتركة (14,315 قالب في /opt/nuclei-templates) بدل
   * ما ننسخ 82MB في كل مساحة. لو المجلد المشترك مش موجود (لسه ما اتنزّلش)
   * بنسيبها — nuclei هيقول "no templates" بصراحة، مش هيفشل بصمت. */
  try {
    const shared = path.join(path.dirname(dir), "..", "nuclei-templates");
    const sharedAbs = path.resolve(shared);
    if (fs.existsSync(sharedAbs)) {
      const link = path.join(dir, "nuclei-templates");
      if (!fs.existsSync(link)) fs.symlinkSync(sharedAbs, link);
    }
  } catch { /* symlink مش متاح على كل أنظمة الملفات — nucleus هيستخدم NUCLEI_TEMPLATES */ }
  const readme = `# ${String(nameRaw).slice(0, 80)}

مساحة شغل داخل كالي — اتعملت ${createdAt}
المسار داخل كالي: ${GUEST_BASE}/${slug}

## المجلدات
- scans/     مخرجات الفحص (nmap, nuclei, ffuf ...)
- loot/      أي حاجة اتجمعت: هاشات، ملفات، نسخ
- payloads/   الحمولات والسكربتات القابلة للتشغيل
- reports/    التقرير النهائي (markdown)
- scripts/    سكربتات مساعدة للهدف
- notes/      ملاحظات خام

## من الواجهة
كل أمر بيتنفذ هنا جوه المساحة دي، فأي ملف بيكتبه بيظهر في قايمة الملفات
ويفضل محفوظ بعد ما تخلص.
`;
  fs.writeFileSync(path.join(dir, "README.md"), readme);
  fs.appendFileSync(
    journalPath(slug),
    JSON.stringify({ at: createdAt, cmd: "workspace:create", exitCode: 0, ms: 0, tail: `اتعملت المساحة ${slug}` }) + "\n",
  );
  return getWorkspace(slug);
}

/** يمسح مساحة — من الدسك فعلًا، ويرجّع عدد الملفات اللي اتمسحت. */
export function deleteWorkspace(slugRaw: string): { slug: string; removedFiles: number } {
  const slug = slugify(slugRaw);
  const dir = wsDir(slug);
  if (!fs.existsSync(dir)) throw new Error(`مساحة الشغل «${slug}» مش موجودة`);
  let count = 0;
  const walkCount = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walkCount(path.join(d, e.name));
      else count += 1;
    }
  };
  try {
    walkCount(dir);
  } catch {
    /* */
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { slug, removedFiles: count };
}

export interface WorkspaceRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  /** مساحة الشغل بعد التنفيذ — فيها الملفات الجديدة اللي الأمر كتبها. */
  workspace: Workspace | null;
  /** ملفات ظهرت أو اتغيّرت بسبب الأمر ده تحديدًا. */
  newFiles: string[];
  error?: string;
}

/**
 * ينفّذ أمر **جوه** مساحة الشغل. ده الفرق الجوهري عن /kali-env/exec:
 * الأمر بيتنفذ في مجلد المساحة، فمخرجاته بتنزل فيه وبتفضل.
 */
export async function runInWorkspace(
  slugRaw: string,
  command: string,
  opts?: { timeoutMs?: number },
): Promise<WorkspaceRunResult> {
  const slug = slugify(slugRaw);
  const dir = wsDir(slug);
  if (!fs.existsSync(dir)) throw new Error(`مساحة الشغل «${slug}» مش موجودة — اتعملها الأول`);
  const before = new Set<string>();
  {
    const files: WorkspaceFile[] = [];
    walk(dir, dir, files);
    for (const f of files) if (f.kind === "file") before.add(`${f.rel}:${f.bytes}:${f.mtime}`);
  }
  const started = Date.now();
  const timeoutMs = Math.min(Math.max(opts?.timeoutMs ?? 300_000, 1000), 900_000);
  const guestCwd = `${GUEST_BASE}/${slug}`;
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let error: string | undefined;
  const layout = detectProotLayout();
  if (layout.ready && layout.rootfs) {
    try {
      const r = await runInProot({
        command,
        cwd: guestCwd,
        env: {
          HOME: guestCwd,
          NUCLEI_TEMPLATES: "/opt/nuclei-templates",
        },
        timeoutMs,
        onData: (stream, chunk) => {
          if (stream === "stdout") stdout += chunk;
          else stderr += chunk;
          if (stdout.length > 400_000) stdout = stdout.slice(-300_000);
          if (stderr.length > 200_000) stderr = stderr.slice(-150_000);
        },
      });
      exitCode = r.exitCode;
      error = r.error;
      if (!stdout && r.stdout) stdout = r.stdout.slice(-300_000);
      if (!stderr && r.stderr) stderr = r.stderr.slice(-150_000);
    } catch (e) {
      error = (e as Error).message;
    }
  } else {
    try {
      const { kaliAnywhereExec } = await import("./kali-anywhere");
      const prep = `mkdir -p ${guestCwd}/scans ${guestCwd}/loot ${guestCwd}/payloads ${guestCwd}/reports ${guestCwd}/scripts ${guestCwd}/notes && cd ${guestCwd} && export HOME=${guestCwd} NUCLEI_TEMPLATES=/opt/nuclei-templates && (${command})`;
      const r = await kaliAnywhereExec(prep, timeoutMs);
      if (!r) {
        exitCode = 127;
        error = "مافيش عقدة كالي متصلة حالًا";
      } else {
        exitCode = r.exitCode;
        stdout = (r.stdout || "").slice(-300_000);
        stderr = (r.stderr || "").slice(-150_000);
        if (stdout.trim() || stderr.trim()) {
          const scansDir = path.join(dir, "scans");
          fs.mkdirSync(scansDir, { recursive: true });
          const toolName = command.trim().split(/\s+/)[0]?.replace(/[^a-z0-9_-]/gi, "") || "cmd";
          const outName = `${toolName}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt`;
          fs.writeFileSync(
            path.join(scansDir, outName),
            `# Command: ${command}\n# Plane: ${r.plane}\n# Exit: ${r.exitCode} · Duration: ${r.durationMs}ms\n\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}\n`,
          );
        }
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const ms = Date.now() - started;
  let workspace: Workspace | null = null;
  const newFiles: string[] = [];
  try {
    workspace = getWorkspace(slug);
    for (const f of workspace.files) {
      if (f.kind !== "file") continue;
      if (!before.has(`${f.rel}:${f.bytes}:${f.mtime}`)) newFiles.push(f.rel);
    }
  } catch {
    /* */
  }
  // اليوميات = دليل حقيقي إن الأمر ده اتنفذ هنا، بالذيل بتاعه.
  try {
    const tail = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(-2000);
    fs.appendFileSync(
      journalPath(slug),
      JSON.stringify({ at: new Date().toISOString(), cmd: command, exitCode, ms, tail }) + "\n",
    );
  } catch {
    /* */
  }
  return { ok: exitCode === 0 && !error, exitCode, stdout, stderr, ms, workspace, newFiles, error };
}

/**
 * قراءة ملف من مساحة الشغل — للنص بس، وبحد أقصى صريح. ده اللي بيخلي
 * المستخدم يفتح نتيجة المسح جوه البرنامج بدل ما ينزّلها.
 */
export function readWorkspaceFile(slugRaw: string, relRaw: string): { rel: string; text: string; bytes: number; truncated: boolean } {
  const slug = slugify(slugRaw);
  const dir = wsDir(slug);
  if (!fs.existsSync(dir)) throw new Error(`مساحة الشغل «${slug}» مش موجودة`);
  const rel = String(relRaw ?? "");
  if (!rel || rel.includes("\0")) throw new Error("مسار ملف غير صالح");
  const abs = path.resolve(dir, rel);
  const back = path.relative(dir, abs);
  if (back.startsWith("..") || path.isAbsolute(back)) throw new Error("مسار خارج مساحة الشغل — مرفوض");
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error("المسار ده مش ملف");
  if (!INTERESTING.test(rel)) {
    // مش نص معروف — بنقول بصراحة بدل ما نبعت بايتات بايظة للواجهة
    return { rel: back, text: "", bytes: st.size, truncated: false };
  }
  const LIMIT = 512 * 1024;
  const fd = fs.openSync(abs, "r");
  try {
    const len = Math.min(st.size, LIMIT);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return { rel: back, text: buf.toString("utf8"), bytes: st.size, truncated: st.size > LIMIT };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * أمريّة جاهزة للنسخ — بتشغّل نفس مساحة الشغل من طرفية على جهاز المستخدم
 * (نفس نمط باقي البرنامج: أمر مطلق، مش مسار نسبي).
 */
export function workspaceShellCommand(slugRaw: string): { ok: boolean; slug?: string; commands?: Record<string, string>; error?: string } {
  const slug = slugify(slugRaw);
  let dir: string;
  try {
    dir = wsDir(slug);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!fs.existsSync(dir)) return { ok: false, error: `مساحة الشغل «${slug}» مش موجودة` };
  const layout = detectProotLayout();
  const proot = layout.prootBin || "$HOME/kali-rootfs/rootfs/usr/local/bin/proot-static";
  const rootfs = layout.rootfs || "$HOME/kali-rootfs/rootfs";
  const bind = `${dir}:${GUEST_BASE}/${slug}`;
  return {
    ok: true,
    slug,
    commands: {
      local: `${proot} -0 -R ${rootfs} -b ${bind} -w ${GUEST_BASE}/${slug} /bin/bash -l`,
      ssh: `curl -sS -X POST "https://nova.waifly.com/api/kali-env/workspaces/${slug}/run" -H "Content-Type: application/json" -d '{"command":"id && pwd && ls -la"}'`,
    },
  };
}

/** فحص سريع إن الأمر بيفتح شل فعلًا — بيستخدم في التقارير مش في كل طلب. */
export async function workspaceSelfTest(): Promise<{ ok: boolean; detail: string }> {
  try {
    const slug = "self-test";
    try {
      await createWorkspace(slug);
    } catch {
      /* موجودة */
    }
    const r = await runInWorkspace(slug, "pwd && echo NOVA_WS_OK && ls -d scans loot reports 2>/dev/null | tr '\\n' ' '", { timeoutMs: 60_000 });
    const ok = r.stdout.includes("NOVA_WS_OK") && r.stdout.includes(`${GUEST_BASE}/${slug}`);
    return { ok, detail: ok ? `المساحة شغّالة فعلًا في ${GUEST_BASE}/${slug}` : `فشل: ${(r.stdout + r.stderr).slice(0, 300)}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** مفتوح للاختبارات: تثبيت spawn مش مستخدم هنا عن قصد — كل التنفيذ عبر runInProot. */
void spawn;
