#!/usr/bin/env node
/**
 * NOVA — fleet-node kit builder
 * ─────────────────────────────
 * Produces `dist-node-kit/nova-node-kit.zip`: everything a brand-new machine
 * needs to join the fleet, with **zero configuration**.
 *
 * Why a kit and not just "upload nova-agent.js":
 *   Pterodactyl-style panels (Waifly included) run a fixed "Main file" such as
 *   index.js. Giving the user one file named index.js — that already knows the
 *   hub address — turns "join the fleet" into: upload, press Start, done.
 *
 * The agent source is read from the repository at build time, so the kit can
 * never drift from the agent the panel downloads from /api/local-agent.
 *
 *   node scripts/make-node-kit.mjs [--hub ws://host:port/api/local-agent/ws]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "dist-node-kit");
const STAGE = path.join(OUT_DIR, "nova-node-kit");
const ZIP = path.join(OUT_DIR, "nova-node-kit.zip");

const argHub = process.argv.indexOf("--hub");
const HUB =
  (argHub > -1 ? process.argv[argHub + 1] : process.env.NOVA_HUB) ||
  "ws://node.waifly.com:27214/api/local-agent/ws";

const agentSrc = path.join(ROOT, "nova-agent.js");
if (!fs.existsSync(agentSrc)) {
  console.error("✗ nova-agent.js مش موجود في جذر الريبو");
  process.exit(1);
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

fs.copyFileSync(agentSrc, path.join(STAGE, "nova-agent.js"));

fs.writeFileSync(
  path.join(STAGE, "index.js"),
  `#!/usr/bin/env node
/**
 * NOVA fleet node — entry point
 * ─────────────────────────────
 * Panels (Pterodactyl eggs, Waifly Node.js, any "Main file: index.js" host)
 * run this file. It starts the fleet agent pointed at the hub, with defaults
 * filled in so the node is online without touching a single setting.
 *
 * Override with environment variables if you want:
 *   NOVA_SERVER     hub address          (default below)
 *   NOVA_AGENT_ID   name shown in panel  (default: hostname)
 *   NOVA_READ_ONLY  1 = connect, never run a command
 */
const path = require("node:path");
const os = require("node:os");

const HUB = process.env.NOVA_SERVER || ${JSON.stringify(HUB)};
const ID = process.env.NOVA_AGENT_ID || "node-" + os.hostname().slice(0, 12).toLowerCase();

process.env.NOVA_SERVER = HUB;
process.env.NOVA_AGENT_ID = ID;

console.log("[nova-node] starting · hub=" + HUB + " · id=" + ID + " · node=" + process.version);
require(path.join(__dirname, "nova-agent.js"));
`,
);

fs.writeFileSync(
  path.join(STAGE, "package.json"),
  `${JSON.stringify(
    {
      name: "nova-fleet-node",
      version: "1.0.0",
      private: true,
      description: "NOVA fleet node — connects this machine to the hub and runs the tasks it is given",
      main: "index.js",
      scripts: { start: "node index.js" },
      engines: { node: ">=18" },
    },
    null,
    2,
  )}\n`,
);

fs.writeFileSync(
  path.join(STAGE, "start.sh"),
  `#!/bin/sh
# NOVA fleet node — start script (nothing to install)
cd "$(dirname "$0")" || exit 1
export NODE_ENV=production
exec node index.js
`,
  { mode: 0o755 },
);

fs.writeFileSync(
  path.join(STAGE, "node.env.example"),
  `# NOVA fleet node — settings (copy to .env when the host allows editing files)
NOVA_SERVER=${HUB}
NOVA_AGENT_ID=node-2
# NOVA_READ_ONLY=1   # connect but refuse to run commands (monitor only)
`,
);

fs.writeFileSync(
  path.join(STAGE, "README-AR.txt"),
  `NOVA — ملفات نود الأسطول
════════════════════════

الملفات دي بتخلّي أي سيرفر/جهاز يبقى "نود" تابع للسيرفر الأساسي.
مفيش تثبيت مطلوب — بس Node.js (18 أو أحدث، وكل الاستضافات بتوفره).

المحتوى:
  index.js           الملف اللي الاستضافة بتشغّله (Main file)
  nova-agent.js      الوكيل نفسه
  package.json       بيقول للاستضافة إن الدخول من index.js
  start.sh           بديل لو الاستضافة بتشغّل أوامر شل
  node.env.example   الإعدادات (اختياري)

عنوان الهاب المدمج:
  ${HUB}

طريقتين للتركيب
───────────────
① الأسهل — من غير رفع أي ملف (لو فيه Console):
   curl -fsSL ${HUB.replace(/^ws/, "http").replace(/\/api\/local-agent\/ws$/, "")}/api/local-agent/download-agent | bash -s -- --id node-2

② لو الاستضافة بتطلب ملفات (Upload):
   ارفع المجلد كله → خلّي "Main file" = index.js → اضغط Start.
   النود بيظهر في اللوحة في ثانية.

ملاحظات
────────
• الاتصال صادر (outbound) — مش محتاج IP عام ولا فتح بورت ولا إعدادات شبكة.
• لو عايز نود للمراقبة بس من غير تنفيذ أوامر: NOVA_READ_ONLY=1
• الوكيل بيعيد الاتصال لوحده لو الشبكة قطعت (backoff لحد 30 ثانية).
`,
);

// One zip with the files at the root (panels expect index.js at the top level).
execFileSync("zip", ["-q", "-r", ZIP, "."], { cwd: STAGE });

const bytes = fs.statSync(ZIP).size;
console.log(`✓ ${path.relative(ROOT, ZIP)} — ${(bytes / 1024).toFixed(1)} KB · hub=${HUB}`);
