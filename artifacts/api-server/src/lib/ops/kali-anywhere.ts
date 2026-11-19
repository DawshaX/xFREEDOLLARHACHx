/**
 * kali-anywhere — «اتصالات الطرفية كلها واحدة» (TEST25).
 *
 * أي طرفية في البرنامج (‎/kali-env · ‎/kali-command · Live Terminal · اللايف أجينت)
 * بتمر من هنا: كالي على الهَب؟ نفّذ محليًا. مافيش؟ نفّذ حرفيًا على أول عقدة كالي
 * سحابية (probe → proot/bare عبر قناة الأجينت المقيّسة). الرد دايمًا فيه plane
 * — الطايرة اللي اتنفّذ عليها فعلًا. مافيش 404 خامل: إما تنفيذ حقيقي أو null
 * والنداء بيرد برسالة صادقة بخطوات الإصلاح.
 */
import { getConnectedAgentList, execOnLocalAgent, execStreamOnLocalAgent } from "../../routes/local-agent";
import { broadcastEvent } from "../ws-hub";
import { createPushNotification } from "../push-hub";
import { kaliRoot, runKali } from "./kali-env";
import { KALI_NODE_PROBE, remoteRunCmd, remoteRunCmdStream } from "./kali-node-installer";
import { probeAllKaliNodes, orderPrewarmedFirst, readProbeCache, isFleetNode, type KaliProbeRow } from "./kali-node-probe";

/** TEST30 — العقد مرتبة prewarm-first: الجاهزة (كالي مقاسة) الأول، فالباقي.
 *  الكاش طازة (≤3د)؟ بيستخدمه — مافيش قياس متكرر ببلاش. */
async function orderedFleetNodes(): Promise<Array<{ id: string; hostname: string; mode: string }>> {
  const agents = getConnectedAgentList().filter(isFleetNode);
  if (!agents.length) return [];
  const cache = readProbeCache();
  let rows: KaliProbeRow[];
  if (cache.fresh && cache.rows.length) {
    rows = cache.rows.filter((r) => agents.some((a) => a.id === r.id));
  } else {
    rows = await probeAllKaliNodes();
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return orderPrewarmedFirst(rows)
    .map((r) => ({ id: r.id, hostname: r.hostname, mode: r.mode }))
    .filter((r) => byId.has(r.id) && agents.some((a) => a.id === r.id))
    .concat(agents.filter((a) => !rows.some((row) => row.id === a.id)).map((a) => ({ id: a.id, hostname: a.hostname ?? a.id, mode: "" })));
}

export type KaliAnywhereResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  plane: string;
  /** TEST93x — id العقدة الفعلي (hostnames بتتكرر — 11 عقدة runnervmccnms مقاس 17:33) */
  nodeId?: string;
};

export function isLinuxFleetNode(a: { platform: string; capabilities?: string[] }): boolean {
  return a.platform === "linux" && !(a.capabilities ?? []).includes("self-node");
}

/** أين كالي عايشة فعلًا؟ للعرض السريع في السياق والصفحات. */
export function kaliAnywhereSummary(): { hub: boolean; linuxNodes: number } {
  let linuxNodes = 0;
  try {
    linuxNodes = getConnectedAgentList().filter(isLinuxFleetNode).length;
  } catch {
    linuxNodes = 0;
  }
  return { hub: Boolean(kaliRoot()), linuxNodes };
}

/**
 * البث الموحّد (TEST27 — «الظهور اللحظي»): نفس منطق kaliAnywhereExec لكن chunks
 * بتوصل لحظيًا عبر onData (SSE فوقه). null = مافيش طايرة كالي متاحة حالًا.
 */
export async function kaliAnywhereExecStream(
  cmd: string,
  timeoutMs: number,
  onData: (streamType: "stdout" | "stderr", chunk: string) => void,
): Promise<KaliAnywhereResult | null> {
  if (!cmd.trim()) return null;
  const execId = `kali-stream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const broadcastStart = (plane: string) => {
    try { broadcastEvent("kali_exec_start", { id: execId, cmd: cmd.slice(0, 200), plane, startedAt: Date.now(), running: true }); } catch {}
  };
  const broadcastChunk = (chunk: string) => {
    try { broadcastEvent("kali_exec_chunk", { id: execId, chunk: chunk.slice(0, 4000), ts: Date.now() }); } catch {}
  };

  if (kaliRoot()) {
    broadcastStart("الهَب — كالي المدمجة (rootfs + proot)");
    const wrappedOnData = (t: "stdout" | "stderr", c: string) => { onData(t, c); broadcastChunk(c); };
    const r = await runKali(cmd, timeoutMs, wrappedOnData);
    try { const { scanRunFromPlane } = await import("./kali-scan-stats"); scanRunFromPlane("hub", cmd, r.exitCode === 0, r.stdout.length); } catch { /* الإحصائية ماتكسّرش التنفيذ */ }
    try { broadcastEvent("kali_exec_done", { id: execId, cmd: cmd.slice(0, 200), plane: "الهَب — كالي المدمجة", exitCode: r.exitCode, durationMs: r.durationMs, running: false }); } catch {}
    /* TEST70 للStream كمان — الفشل المحلي (127) مش نتيجة: ننزل للأسطول */
    if (r.exitCode === 0) {
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: r.durationMs, plane: "الهَب — كالي المدمجة (rootfs + proot)" };
    }
  }
  /* TEST71 — fault-tolerant: مافيش throw بيقع العملية */
  let nodes: Array<{ id: string; hostname: string; mode: string }> = [];
  let lastErr: string | null = null;
  try {
    nodes = await orderedFleetNodes();
  } catch (e) {
    return { stdout: "", stderr: String((e as Error)?.message ?? e).slice(0, 300), exitCode: 127, durationMs: 0, plane: "الهَب — التعذّر على الأسطول" };
  }
  for (const a of nodes) {
    if (a.mode !== "MODE_BARE" && a.mode !== "MODE_PROOT") continue; // مش جاهزة — التالية (الجاهزة بتتجرب الأول)
    const plane = `${a.hostname} — عقدة كالي سحابية (${a.mode === "MODE_BARE" ? "نظام كالي" : "rootfs + proot"})`;
    broadcastStart(plane);
    const wrappedOnData = (t: "stdout" | "stderr", c: string) => { onData(t, c); broadcastChunk(c); };
    let rr: Awaited<ReturnType<typeof execStreamOnLocalAgent>> = null;
    try {
      rr = await execStreamOnLocalAgent(remoteRunCmdStream(cmd, a.mode, timeoutMs), a.id, timeoutMs + 10_000, wrappedOnData);
    } catch (e) {
      lastErr = String((e as Error)?.message ?? e).slice(0, 300);
      continue; // العقدة دي وقعت — التالية
    }
    if (!rr) continue;
    try { const { scanRunFromPlane } = await import("./kali-scan-stats"); scanRunFromPlane(a.hostname, cmd, rr.exitCode === 0, rr.stdout.length); } catch { /* الإحصائية ماتكسّرش التنفيذ */ }
    try { broadcastEvent("kali_exec_done", { id: execId, cmd: cmd.slice(0, 200), plane, exitCode: rr.exitCode, durationMs: rr.durationMs, running: false }); } catch {}
    return {
      stdout: rr.stdout,
      stderr: rr.stderr,
      exitCode: rr.exitCode,
      durationMs: rr.durationMs,
      plane,
      nodeId: a.id,
    };
  }
  /* مافيش عقدة ردت — فشل محلي صادق (exitCode 127) بخصوص الاختناق إن وجد */
  return {
    stdout: "", stderr: lastErr ?? "مافيش عقدة كالي ردت", exitCode: 127, durationMs: 0,
    plane: "الهَب — مافيش عقدة كالي ردت",
  };
}

/** TEST93q — القياس الاتحادي: نفس الأمر على كل العقد الجاهزة (حتى 6) بالتوازي،
 * والرد = نتائج كل عقدة لوحدها. ليه؟ القياس الأحادي بيخلي عقدة طازة تدبل
 * الكتالوج المتراكم (مقاس حي 10:2xZ: عقدة pass-E الطازة قاست 205 فوق 228 اللي
 * قاستها عقدة C/D/E). الكتالوج الحقيقي للأسطول = اتحاد اللي كل عقدة **مقاسة**
 * عندها فعلًا — مش آخر قياس اتكتب. */
export async function kaliFleetUnionExec(
  cmd: string,
  timeoutMs = 90_000,
  maxNodes = 16,
): Promise<{ planes: string[]; stdouts: string[] }> {
  if (!cmd.trim()) return { planes: [], stdouts: [] };
  let nodes: Array<{ id: string; hostname: string; mode: string }> = [];
  try {
    const all = (await orderedFleetNodes()).filter((a) => a.mode === "MODE_BARE" || a.mode === "MODE_PROOT");
    /* TEST93w — dedupe بالid (مقاس: العقد مكررة في orderedFleetNodes) */
    const seen = new Set<string>();
    nodes = all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))).slice(0, maxNodes);
  } catch {
    return { planes: [], stdouts: [] };
  }
  if (!nodes.length) return { planes: [], stdouts: [] };
  const probe1 = async (a: { id: string; hostname: string; mode: string; }) => {
    const rr = await execOnLocalAgent(remoteRunCmd(cmd, a.mode, timeoutMs), a.id, timeoutMs + 10_000);
    if (!rr || !rr.stdout) throw new Error(`no-reply:${a.hostname}`);
    return { plane: `${a.hostname} (${a.mode === "MODE_BARE" ? "نظام كالي" : "rootfs + proot"})`, stdout: rr.stdout };
  };
  const results = await Promise.allSettled(nodes.map(probe1));
  const planes: string[] = [];
  const stdouts: string[] = [];
  const failed: typeof nodes = [];
  results.forEach((x, i) => {
    if (x.status === "fulfilled") {
      planes.push(x.value.plane);
      stdouts.push(x.value.stdout);
    } else {
      failed.push(nodes[i]);
    }
  });
  /* TEST93w — retry تسلسلي للعقد اللي بورت (مقاس 14:08: العقد المرهقة بعد
   * تثبيت ثقيل بوركت الprobe 45s فاتشالت من الاتحاد — 253 نزلت 209 كاذبة) */
  for (const a of failed.slice(0, 3)) {
    try {
      const v = await probe1(a);
      planes.push(v.plane);
      stdouts.push(v.stdout);
    } catch { /* وقعت فعلاً — من غيرها */ }
  }
  return { planes, stdouts };
}

/** التنفيذ الموحّد: هَب → عقدة. null = مافيش طايرة كالي متاحة حالًا.
 * TEST93t — preferHostname: بيثبت التنفيذ على عقدة معينة (hostname أول بالترتيب) —
 * مقاس F2 11:17: مرحلة التثبيت على runnervmccnms والبوابة راحت على عقدة طازة
 * تانية → INSTALL_FAIL كاذبة رغم «Setting up ✓». */
export async function kaliAnywhereExec(cmd: string, timeoutMs = 60_000, preferNodeId?: string): Promise<KaliAnywhereResult | null> {
  if (!cmd.trim()) return null;  // ── بث حي لكل الصفحات: أي تنفيذ كالي يظهر فورًا في كل مكان ──────────
  const execId = `kali-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const broadcastStart = (plane: string) => {
    try {
      broadcastEvent("kali_exec_start", { id: execId, cmd: cmd.slice(0, 200), plane, startedAt: Date.now(), running: true });
    } catch {}
  };
  const broadcastDone = (plane: string, exitCode: number | null, durationMs: number) => {
    try {
      broadcastEvent("kali_exec_done", { id: execId, cmd: cmd.slice(0, 200), plane, exitCode, durationMs, running: false });
    } catch {}
    try {
      if (exitCode === 0) createPushNotification({ kind: "success", title: `✓ كالي: ${cmd.slice(0, 40)}`, body: `اتنفّذ على ${plane} في ${durationMs}ms`, link: "/kali-env" });
    } catch {}
  };

  if (kaliRoot()) {
    broadcastStart("الهَب — كالي المدمجة (rootfs + proot)");
    const r = await runKali(cmd, timeoutMs);
    try { const { scanRunFromPlane } = await import("./kali-scan-stats"); scanRunFromPlane("hub", cmd, r.exitCode === 0, r.stdout.length); } catch { /* الإحصائية ماتكسّرش التنفيذ */ }
    broadcastDone("الهَب — كالي المدمجة (rootfs + proot)", r.exitCode, r.durationMs);
    /* TEST70 — فكس terminal exec (127 فوري مقاس 14:30): على الهَب بقايا rootfs
     * ب/os-release كالي بس من غير proot → runKali بيفشل 127. الفشل المحلي مش
     * نتيجة — بننزل للأسطول فورًا (نجاح محلي بس بيرجع). */
    if (r.exitCode === 0) {
      return { ...r, plane: "الهَب — كالي المدمجة (rootfs + proot)" };
    }
  }
  /* TEST71 — المسار كله fault-tolerant: مافيش throw بيقع العملية (كراش لوب
   * مقاس 15:01 — كل استثناء غير معالج هنا = سقوط الهَب كله). */
  let nodes: Array<{ id: string; hostname: string; mode: string }> = [];
  try {
    nodes = await orderedFleetNodes();
  } catch (e) {
    try { broadcastEvent("kali_exec_done", { id: execId, cmd: cmd.slice(0, 200), plane: "fleet-enumeration-failed", exitCode: 127, durationMs: Date.now() - Date.now(), running: false }); } catch {}
    return { stdout: "", stderr: String((e as Error)?.message ?? e).slice(0, 300), exitCode: 127, durationMs: 0, plane: "الهَب — التعذّر على الأسطول" };
  }
  /* TEST93t — التثبيت على عقدة معينة أولاً (البوابة لازم نفس عقدة التثبيت) */
  if (preferNodeId) {
    const hit = nodes.find((n) => n.id === preferNodeId) ?? nodes.find((n) => n.hostname === preferNodeId);
    if (hit) nodes = [hit, ...nodes.filter((n) => n.id !== hit.id)];
  }
  let lastErr: string | null = null;
  for (const a of nodes) {
    if (a.mode !== "MODE_BARE" && a.mode !== "MODE_PROOT") continue; // مش جاهزة — التالية (الجاهزة بتتجرب الأول)
    const plane = `${a.hostname} — عقدة كالي سحابية (${a.mode === "MODE_BARE" ? "نظام كالي" : "rootfs + proot"})`;
    broadcastStart(plane);
    let rr: Awaited<ReturnType<typeof execOnLocalAgent>> = null;
    try {
      rr = await execOnLocalAgent(remoteRunCmd(cmd, a.mode, timeoutMs), a.id, timeoutMs + 10_000);
    } catch (e) {
      lastErr = String((e as Error)?.message ?? e).slice(0, 300);
      continue; // العقدة دي وقعت — التالية
    }
    if (!rr) continue;
    try { const { scanRunFromPlane } = await import("./kali-scan-stats"); scanRunFromPlane(a.hostname, cmd, rr.exitCode === 0, rr.stdout.length); } catch { /* الإحصائية ماتكسّرش التنفيذ */ }
    broadcastDone(plane, rr.exitCode, rr.durationMs);
    return {
      stdout: rr.stdout,
      stderr: rr.stderr,
      exitCode: rr.exitCode,
      durationMs: rr.durationMs,
      plane,
      nodeId: a.id,
    };
  }
  /* مافيش عقدة ردت — فشل محلي صادق (exitCode 127) بخصوص الاختناق إن وجد */
  return {
    stdout: "", stderr: lastErr ?? "مافيش عقدة كالي ردت", exitCode: 127, durationMs: 0,
    plane: "الهَب — مافيش عقدة كالي ردت",
  };
}
