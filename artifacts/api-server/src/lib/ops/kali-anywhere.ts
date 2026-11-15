/**
 * kali-anywhere — «اتصالات الطرفية كلها واحدة» (TEST25).
 *
 * أي طرفية في البرنامج (‎/kali-env · ‎/kali-command · Live Terminal · اللايف أجينت)
 * بتمر من هنا: كالي على الهَب؟ نفّذ محليًا. مافيش؟ نفّذ حرفيًا على أول عقدة كالي
 * سحابية (probe → proot/bare عبر قناة الأجينت المقيّسة). الرد دايمًا فيه plane
 * — الطايرة اللي اتنفّذ عليها فعلًا. مافيش 404 خامل: إما تنفيذ حقيقي أو null
 * والنداء بيرد برسالة صادقة بخطوات الإصلاح.
 */
import { getConnectedAgentList, execOnLocalAgent } from "../../routes/local-agent";
import { kaliRoot, runKali } from "./kali-env";
import { KALI_NODE_PROBE, remoteRunCmd } from "./kali-node-installer";

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

/** التنفيذ الموحّد: هَب → عقدة. null = مافيش طايرة كالي متاحة حالًا. */
export async function kaliAnywhereExec(cmd: string, timeoutMs = 60_000): Promise<KaliAnywhereResult | null> {
  if (!cmd.trim()) return null;
  if (kaliRoot()) {
    const r = await runKali(cmd, timeoutMs);
    return { ...r, plane: "الهَب — كالي المدمجة (rootfs + proot)" };
  }
  const agents = getConnectedAgentList().filter(isLinuxFleetNode);
  for (const a of agents) {
    const probe = await execOnLocalAgent(KALI_NODE_PROBE, a.id, 10_000);
    const mode = probe ? String(probe.stdout).trim() : "";
    if (mode !== "MODE_BARE" && mode !== "MODE_PROOT") continue;
    const rr = await execOnLocalAgent(remoteRunCmd(cmd, mode, timeoutMs), a.id, timeoutMs + 10_000);
    if (!rr) continue;
    return {
      stdout: rr.stdout,
      stderr: rr.stderr,
      exitCode: rr.exitCode,
      durationMs: rr.durationMs,
      plane: `${a.hostname} — عقدة كالي سحابية (${mode === "MODE_BARE" ? "نظام كالي" : "rootfs + proot"})`,
    };
  }
  return null;
}
