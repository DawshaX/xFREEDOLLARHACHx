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
  if (kaliRoot()) {
    const r = await runKali(cmd, timeoutMs, onData);
    try { const { scanRunFromPlane } = await import("./kali-scan-stats"); scanRunFromPlane("hub", cmd, r.exitCode === 0, r.stdout.length); } catch { /* الإحصائية ماتكسّرش التنفيذ */ }
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: r.durationMs, plane: "الهَب — كالي المدمجة (rootfs + proot)" };
  }
  const nodes = await orderedFleetNodes();
  for (const a of nodes) {
    if (a.mode !== "MODE_BARE" && a.mode !== "MODE_PROOT") continue; // مش جاهزة — التالية (الجاهزة بتتجرب الأول)
    const rr = await execStreamOnLocalAgent(remoteRunCmdStream(cmd, a.mode, timeoutMs), a.id, timeoutMs + 10_000, onData);
    if (!rr) continue;
    try { const { scanRunFromPlane } = await import("./kali-scan-stats"); scanRunFromPlane(a.hostname, cmd, rr.exitCode === 0, rr.stdout.length); } catch { /* الإحصائية ماتكسّرش التنفيذ */ }
    return {
      stdout: rr.stdout,
      stderr: rr.stderr,
      exitCode: rr.exitCode,
      durationMs: rr.durationMs,
      plane: `${a.hostname} — عقدة كالي سحابية (${a.mode === "MODE_BARE" ? "نظام كالي" : "rootfs + proot"})`,
    };
  }
  return null;
}

/** التنفيذ الموحّد: هَب → عقدة. null = مافيش طايرة كالي متاحة حالًا. */
export async function kaliAnywhereExec(cmd: string, timeoutMs = 60_000): Promise<KaliAnywhereResult | null> {
  if (!cmd.trim()) return null;
  if (kaliRoot()) {
    const r = await runKali(cmd, timeoutMs);
    try { const { scanRunFromPlane } = await import("./kali-scan-stats"); scanRunFromPlane("hub", cmd, r.exitCode === 0, r.stdout.length); } catch { /* الإحصائية ماتكسّرش التنفيذ */ }
    return { ...r, plane: "الهَب — كالي المدمجة (rootfs + proot)" };
  }
  const nodes = await orderedFleetNodes();
  for (const a of nodes) {
    if (a.mode !== "MODE_BARE" && a.mode !== "MODE_PROOT") continue; // مش جاهزة — التالية (الجاهزة بتتجرب الأول)
    const rr = await execOnLocalAgent(remoteRunCmd(cmd, a.mode, timeoutMs), a.id, timeoutMs + 10_000);
    if (!rr) continue;
    try { const { scanRunFromPlane } = await import("./kali-scan-stats"); scanRunFromPlane(a.hostname, cmd, rr.exitCode === 0, rr.stdout.length); } catch { /* الإحصائية ماتكسّرش التنفيذ */ }
    return {
      stdout: rr.stdout,
      stderr: rr.stderr,
      exitCode: rr.exitCode,
      durationMs: rr.durationMs,
      plane: `${a.hostname} — عقدة كالي سحابية (${a.mode === "MODE_BARE" ? "نظام كالي" : "rootfs + proot"})`,
    };
  }
  return null;
}
