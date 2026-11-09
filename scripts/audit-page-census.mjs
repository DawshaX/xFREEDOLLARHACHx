#!/usr/bin/env node
/**
 * CyberNova — Page Census (بند 5 «47 روت Placeholder» بقى رقم مُقاس مش إحساس)
 * ────────────────────────────────────────────────────────────────────────────
 * قبل التاريخ ده كان «الصفحات اللي بلا وظيفة» رقم مرجعي في الاستعراض (47) من
 * غير قائمة اسمائية. السكربت ده بيحوّل الادعاء لإحصاء قابل لإعادة القياس:
 *
 *   REAL            — فيها تفاعل شبكي حقيقي (useQuery/useMutation/jsonRequest/
 *                     WebSocket/EventSource/fetch) أو قراءة حالة حية.
 *   WRAPPER-OR-THIN — صفحة رقيقة (<60 سطر) بتركّب مكونات أكبر؛ الوظيفة جواها.
 *   LOCAL-LOGIC     — منطق محلي غني (state كتير + أحداث) من غير شبكة.
 *   STATIC-SUSPECT  — مرشحة تكون «كرتات جميلة بلا وظيفة»: لا شبكة لا منطق.
 *
 * الاستخدام: node scripts/audit-page-census.mjs [--json]
 * مش بوابة قاسية — عدّاد قياس للـROADMAP (audit-* الصارمة شغلها منع الكذب،
 * وده شغله رصد المساحة). STATIC-SUSPECT مش اتهام — بيفتح فيه عينين.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = path.join(ROOT, "artifacts/kali-panel/src/pages");
const APP = path.join(ROOT, "artifacts/kali-panel/src/App.tsx");
const asJson = process.argv.includes("--json");

const NET = /probeServices?\(|streamOllamaViaServer|useQuery|useMutation|jsonRequest|apiRequest|emitPlatformWsEvent|new WebSocket|EventSource|fetch\(/g;
const INTER = /onClick|onSubmit|onChange|onKeyDown|onMouseEnter/g;
const STATE = /useState/g;

const appSrc = fs.readFileSync(APP, "utf8");
const files = fs.readdirSync(PAGES).filter((f) => f.endsWith(".tsx"));
const rows = [];
for (const f of files) {
  const s = fs.readFileSync(path.join(PAGES, f), "utf8");
  const api = (s.match(NET) || []).length;
  const inter = (s.match(INTER) || []).length;
  const state = (s.match(STATE) || []).length;
  const lines = s.split("\n").length;
  const base = f.replace(/\.tsx$/, "");
  const routes = (appSrc.match(new RegExp(`pages/${base}`, "g")) || []).length;
  let cls = "STATIC-SUSPECT";
  if (api > 0) cls = "REAL";
  else if (lines < 60) cls = "WRAPPER-OR-THIN";
  else if (state > 2 && inter > 3) cls = "LOCAL-LOGIC";
  rows.push({ file: f, cls, routed: routes > 0, api, inter, state, lines });
}

const by = rows.reduce((a, r) => { a[r.cls] = (a[r.cls] || 0) + 1; return a; }, {});
const suspects = rows.filter((r) => r.cls === "STATIC-SUSPECT");
const unrouted = rows.filter((r) => !r.routed);

if (asJson) {
  console.log(JSON.stringify({ total: rows.length, classes: by, suspects, unrouted }, null, 2));
} else {
  console.log(`page-census: ${rows.length} صفحة · routed=${rows.filter((r) => r.routed).length}`);
  console.log(`  classes: ${JSON.stringify(by)}`);
  if (suspects.length) {
    console.log("  STATIC-SUSPECT (افتحها بعينين):");
    for (const r of suspects) console.log(`    - ${r.file} (lines=${r.lines} routed=${r.routed})`);
  }
  if (unrouted.length) console.log(`  UNROUTED: ${unrouted.map((r) => r.file).join(", ")}`);
}
