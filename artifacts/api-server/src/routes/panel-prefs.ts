/**
 * panel-prefs — تفضيلات اللوحة المملوكة للمالك، محفوظة على السيرفر
 * (state/panel-prefs.json)، مش في المتصفح بس.
 *
 * لماذا: المالك قال «مش كل ما أخش أعيد الضبط» — الـlocalStorage بيتمسح مع
 * البراوزر/الجهاز، فأي تفضيل مهم (الوضع المستقل، الشات مفتوح، الجلسة الجذر)
 * لازم يعيش حيث البرنامج نفسه عايش.
 *
 * الأمان: القيم مش أسرار — إعدادات واجهة. التوكن الموحّد على /api هو الحارس.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";

export interface PanelPrefs {
  autonomyMode: "autonomous" | "assist" | "off";
  offensivePosture: boolean;
  rootSessionId: string;
  chatOpen: boolean;
  chatWide: boolean;
  hudOpen: boolean;
  hiddenHud: string[];
  arenaDefault: string;
  planMode: boolean;
  pinnedByOwnerAt: string | null;
}

/** وضع المالك المثبَّت: مستقل + هجومي + الجلسة الجذر دائمة — يتحقق حتى أول زيارة
 *  مفيش فيها أي إعداد سابق. كل حاجة قابلة للتغيير من اللوحة، بس البداية زي ما طلب. */
export function ownerDefaults(): PanelPrefs {
  return {
    autonomyMode: "autonomous",
    offensivePosture: true,
    rootSessionId: "nova-root",
    chatOpen: true,
    chatWide: false,
    hudOpen: false,
    hiddenHud: [],
    arenaDefault: "cockpit",
    planMode: true,
    pinnedByOwnerAt: null,
  };
}

function prefsPath(): string {
  return path.resolve(process.env.NOVA_PANEL_PREFS || path.join(process.cwd(), "state", "panel-prefs.json"));
}

export function readPanelPrefs(): PanelPrefs {
  const base = ownerDefaults();
  try {
    const raw = fs.readFileSync(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as { prefs?: Partial<PanelPrefs> } & Partial<PanelPrefs>;
    const j: Partial<PanelPrefs> = parsed.prefs && typeof parsed.prefs === "object" ? parsed.prefs : parsed;
    return {
      ...base,
      ...j,
      hiddenHud: Array.isArray(j.hiddenHud) ? j.hiddenHud.filter((x): x is string => typeof x === "string") : base.hiddenHud,
    };
  } catch {
    return base;
  }
}

export function writePanelPrefs(prefs: PanelPrefs): boolean {
  try {
    const p = prefsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: "nova.panel-prefs/1", updatedAt: new Date().toISOString(), prefs }, null, 2));
    fs.renameSync(tmp, p);
    return true;
  } catch {
    return false;
  }
}

const router: IRouter = Router();

router.get("/panel/prefs", (_req: Request, res: Response) => {
  res.setHeader("X-Prefs-Store", "file");
  res.json({ ok: true, prefs: readPanelPrefs(), defaults: ownerDefaults() });
});

router.put("/panel/prefs", (req: Request, res: Response) => {
  res.setHeader("X-Prefs-Store", "file");
  const body = (req.body ?? {}) as { prefs?: Partial<PanelPrefs>; by?: string };
  if (!body.prefs || typeof body.prefs !== "object") { res.status(400).json({ ok: false, error: "prefs object required" }); return; }
  const cur = readPanelPrefs();
  const incoming = body.prefs as Partial<PanelPrefs>;
  const next: PanelPrefs = {
    autonomyMode: ["autonomous", "assist", "off"].includes(String(incoming.autonomyMode)) ? (incoming.autonomyMode as PanelPrefs["autonomyMode"]) : cur.autonomyMode,
    offensivePosture: typeof incoming.offensivePosture === "boolean" ? incoming.offensivePosture : cur.offensivePosture,
    rootSessionId: typeof incoming.rootSessionId === "string" && incoming.rootSessionId.trim() ? incoming.rootSessionId.trim() : cur.rootSessionId,
    chatOpen: typeof incoming.chatOpen === "boolean" ? incoming.chatOpen : cur.chatOpen,
    chatWide: typeof incoming.chatWide === "boolean" ? incoming.chatWide : cur.chatWide,
    hudOpen: typeof incoming.hudOpen === "boolean" ? incoming.hudOpen : cur.hudOpen,
    hiddenHud: Array.isArray(incoming.hiddenHud) ? incoming.hiddenHud.filter((x): x is string => typeof x === "string") : cur.hiddenHud,
    arenaDefault: typeof incoming.arenaDefault === "string" && incoming.arenaDefault.trim() ? incoming.arenaDefault.trim() : cur.arenaDefault,
    planMode: typeof incoming.planMode === "boolean" ? incoming.planMode : cur.planMode,
    pinnedByOwnerAt: body.by === "owner" ? new Date().toISOString() : cur.pinnedByOwnerAt,
  };
  if (!writePanelPrefs(next)) { res.status(500).json({ ok: false, error: "write failed" }); return; }
  res.json({ ok: true, prefs: next });
});

export default router;
