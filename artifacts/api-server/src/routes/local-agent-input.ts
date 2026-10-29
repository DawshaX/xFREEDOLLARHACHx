/**
 * Local Agent Input Control Routes
 * Mouse, keyboard, clipboard and screen control via nova-agent.js
 * Uses execOnLocalAgent() to send xdotool/scrot commands directly to the connected Kali machine
 */
import { Router } from "express";
import { execOnLocalAgent } from "./local-agent";
import { auditLog } from "../lib/audit";

const router = Router();

// ── Helper: build result from exec output ──────────────────────────────────────
function execResult(r: { stdout: string; stderr: string; exitCode: number; durationMs: number } | null) {
  if (!r) return { ok: false, error: "no local agent connected — run nova-agent.js on your Kali machine" };
  return { ok: r.exitCode === 0, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: r.durationMs };
}

// ── POST /api/local-agent/input/mouse ─────────────────────────────────────────
// { action: "move"|"click"|"double"|"right_click"|"scroll_up"|"scroll_down"|"drag_to"|"position",
//   x?, y?, button?, amount?, agentId? }
router.post("/local-agent/input/mouse", async (req, res) => {
  const { action, x, y, button = 1, amount = 3, agentId } = req.body as {
    action: string; x?: number; y?: number; button?: number; amount?: number; agentId?: string;
  };

  const D = "DISPLAY=:0 "; // X11 display prefix
  let cmd = "";

  switch (action) {
    case "move":
      if (x === undefined || y === undefined) { res.status(400).json({ ok: false, error: "x and y required for move" }); return; }
      cmd = `${D}xdotool mousemove ${x} ${y}`;
      break;
    case "click":
      cmd = (x !== undefined && y !== undefined)
        ? `${D}xdotool mousemove ${x} ${y} click ${button}`
        : `${D}xdotool click ${button}`;
      break;
    case "double":
      cmd = (x !== undefined && y !== undefined)
        ? `${D}xdotool mousemove ${x} ${y} click --repeat 2 --delay 100 ${button}`
        : `${D}xdotool click --repeat 2 --delay 100 ${button}`;
      break;
    case "right_click":
      cmd = (x !== undefined && y !== undefined)
        ? `${D}xdotool mousemove ${x} ${y} click 3`
        : `${D}xdotool click 3`;
      break;
    case "scroll_up":
      cmd = (x !== undefined && y !== undefined)
        ? `${D}xdotool mousemove ${x} ${y} click --repeat ${amount} 4`
        : `${D}xdotool click --repeat ${amount} 4`;
      break;
    case "scroll_down":
      cmd = (x !== undefined && y !== undefined)
        ? `${D}xdotool mousemove ${x} ${y} click --repeat ${amount} 5`
        : `${D}xdotool click --repeat ${amount} 5`;
      break;
    case "drag_to":
      if (x === undefined || y === undefined) { res.status(400).json({ ok: false, error: "x and y required for drag" }); return; }
      cmd = `${D}xdotool mousedown 1 mousemove ${x} ${y} mouseup 1`;
      break;
    case "position":
      cmd = `${D}xdotool getmouselocation 2>&1`;
      break;
    default:
      res.status(400).json({ ok: false, error: `unknown mouse action: ${action}` }); return;
  }

  auditLog({ ts: new Date().toISOString(), action: "mouse_input", data: { action, x, y, button } });
  const r = await execOnLocalAgent(cmd, agentId, 10_000);
  res.json(execResult(r));
});

// ── POST /api/local-agent/input/keyboard ──────────────────────────────────────
// { action: "type"|"key"|"enter"|"escape"|"tab"|"copy"|"paste"|"cut"|"undo"|"select_all",
//   text?, key?, delay?, agentId? }
router.post("/local-agent/input/keyboard", async (req, res) => {
  const { action, text, key, delay = 30, agentId } = req.body as {
    action: string; text?: string; key?: string; delay?: number; agentId?: string;
  };

  const D = "DISPLAY=:0 ";
  let cmd = "";

  switch (action) {
    case "type":
      if (!text) { res.status(400).json({ ok: false, error: "text required for type" }); return; }
      // Use printf to handle special characters safely
      cmd = `${D}xdotool type --clearmodifiers --delay ${delay} -- ${JSON.stringify(text)}`;
      break;
    case "key":
      if (!key) { res.status(400).json({ ok: false, error: "key required" }); return; }
      cmd = `${D}xdotool key ${key}`;
      break;
    case "enter":       cmd = `${D}xdotool key Return`; break;
    case "escape":      cmd = `${D}xdotool key Escape`; break;
    case "tab":         cmd = `${D}xdotool key Tab`; break;
    case "backspace":   cmd = `${D}xdotool key BackSpace`; break;
    case "delete":      cmd = `${D}xdotool key Delete`; break;
    case "copy":        cmd = `${D}xdotool key ctrl+c`; break;
    case "paste":       cmd = `${D}xdotool key ctrl+v`; break;
    case "cut":         cmd = `${D}xdotool key ctrl+x`; break;
    case "undo":        cmd = `${D}xdotool key ctrl+z`; break;
    case "redo":        cmd = `${D}xdotool key ctrl+y`; break;
    case "select_all":  cmd = `${D}xdotool key ctrl+a`; break;
    case "close":       cmd = `${D}xdotool key alt+F4`; break;
    case "alt_tab":     cmd = `${D}xdotool key alt+Tab`; break;
    case "super":       cmd = `${D}xdotool key super`; break;
    case "screenshot":  cmd = `${D}xdotool key Print`; break;
    default:
      res.status(400).json({ ok: false, error: `unknown keyboard action: ${action}` }); return;
  }

  auditLog({ ts: new Date().toISOString(), action: "keyboard_input", data: { action, text: text?.slice(0, 50), key } });
  const r = await execOnLocalAgent(cmd, agentId, 10_000);
  res.json(execResult(r));
});

// ── POST /api/local-agent/input/screen ────────────────────────────────────────
// { action: "capture"|"info"|"resolution"|"windows"|"active_window", agentId? }
router.post("/local-agent/input/screen", async (req, res) => {
  const { action = "info", agentId } = req.body as { action?: string; agentId?: string };

  let cmd = "";
  switch (action) {
    case "capture":
      cmd = `DISPLAY=:0 scrot -o /tmp/nova_screen.png 2>/dev/null || DISPLAY=:0 import -window root /tmp/nova_screen.png 2>/dev/null; base64 -w 0 /tmp/nova_screen.png && rm -f /tmp/nova_screen.png`;
      break;
    case "info":
      cmd = `DISPLAY=:0 xdotool getdisplaygeometry 2>/dev/null || DISPLAY=:0 xrandr --current 2>/dev/null | head -5 || echo "no display"`;
      break;
    case "resolution":
      cmd = `DISPLAY=:0 xrandr --current 2>/dev/null | grep '*' | awk '{print $1}' | head -1 || DISPLAY=:0 xdotool getdisplaygeometry 2>/dev/null`;
      break;
    case "windows":
      cmd = `DISPLAY=:0 wmctrl -l 2>/dev/null | head -20 || DISPLAY=:0 xdotool search --name "" getwindowname %@ 2>/dev/null | head -20`;
      break;
    case "active_window":
      cmd = `DISPLAY=:0 xdotool getactivewindow getwindowname 2>/dev/null`;
      break;
    default:
      res.status(400).json({ ok: false, error: `unknown screen action: ${action}` }); return;
  }

  const r = await execOnLocalAgent(cmd, agentId, 15_000);
  res.json(execResult(r));
});

// ── POST /api/local-agent/input/clipboard ─────────────────────────────────────
router.post("/local-agent/input/clipboard", async (req, res) => {
  const { action = "get", text, agentId } = req.body as { action?: string; text?: string; agentId?: string };

  let cmd = "";
  switch (action) {
    case "get":
      cmd = `DISPLAY=:0 xclip -o -selection clipboard 2>/dev/null || DISPLAY=:0 xsel --clipboard --output 2>/dev/null || echo ""`;
      break;
    case "set":
      if (!text) { res.status(400).json({ ok: false, error: "text required" }); return; }
      // Write to tmp file to avoid escaping issues
      cmd = `printf %s ${JSON.stringify(text)} | DISPLAY=:0 xclip -selection clipboard 2>/dev/null; echo ok`;
      break;
    default:
      res.status(400).json({ ok: false, error: `unknown clipboard action: ${action}` }); return;
  }

  const r = await execOnLocalAgent(cmd, agentId, 8_000);
  const result = execResult(r);
  res.json(action === "get" ? { ...result, content: r?.stdout || "" } : result);
});

// ── POST /api/local-agent/input/notify ────────────────────────────────────────
router.post("/local-agent/input/notify", async (req, res) => {
  const { title = "CyberNova", message = "", agentId } = req.body as {
    title?: string; message?: string; agentId?: string;
  };
  const t = JSON.stringify(title);
  const m = JSON.stringify(message);
  const cmd = `DISPLAY=:0 notify-send ${t} ${m} 2>/dev/null || echo "notify-send unavailable"`;
  const r = await execOnLocalAgent(cmd, agentId, 8_000);
  res.json(execResult(r));
});

// ── GET /api/local-agent/input/capabilities ───────────────────────────────────
// Check which input control tools are available on the connected agent
router.get("/local-agent/input/capabilities", async (req, res) => {
  const { agentId } = req.query as { agentId?: string };
  const cmd = `
    echo "xdotool:$(which xdotool 2>/dev/null && echo ok || echo missing)"
    echo "scrot:$(which scrot 2>/dev/null && echo ok || echo missing)"
    echo "xclip:$(which xclip 2>/dev/null && echo ok || echo missing)"
    echo "xsel:$(which xsel 2>/dev/null && echo ok || echo missing)"
    echo "import:$(which import 2>/dev/null && echo ok || echo missing)"
    echo "wmctrl:$(which wmctrl 2>/dev/null && echo ok || echo missing)"
    echo "notify-send:$(which notify-send 2>/dev/null && echo ok || echo missing)"
    echo "display:$(DISPLAY=:0 xdotool getdisplaygeometry 2>/dev/null && echo ok || echo no-display)"
  `.trim();
  const r = await execOnLocalAgent(cmd, agentId, 10_000);
  if (!r) { res.json({ ok: false, error: "no agent connected" }); return; }
  const caps: Record<string, boolean> = {};
  for (const line of r.stdout.trim().split("\n")) {
    const [tool, status] = line.split(":");
    if (tool) caps[tool.trim()] = status?.trim() === "ok";
  }
  res.json({ ok: true, capabilities: caps, install: "apt install xdotool scrot xclip wmctrl libnotify-bin" });
});

export default router;
