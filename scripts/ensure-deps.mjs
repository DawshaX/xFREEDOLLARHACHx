#!/usr/bin/env node
/**
 * ensure-deps — البوابات بتفشل وهميًا لما snapshot الرملة بيسترجع بدون
 * node_modules (الدليل اللي مش بيتخزّن بين اللفات). بدل «20 اختبار أحمر»
 * والتفسير كل مرة: نرجّع الاعتمادات بأمانة أول مرة، وسريعًا بعدها (loose ms
 * لو موجودين بالفعل). لو lock devd خالط نرفض نلفّ وندور.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (existsSync("artifacts/api-server/node_modules/.bin/esbuild")
 && existsSync("artifacts/kali-panel/node_modules/.bin/vite")
 && existsSync("node_modules/.bin/tsc")) {
  process.exit(0);
}
console.log("ensure-deps: node_modules مش موجودة (snapshot strip) — corepack pnpm install --frozen-lockfile");
const r = spawnSync("corepack", ["pnpm", "install", "--frozen-lockfile"], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("ensure-deps: install فشل — مش هنكمّل ببوابات خضراء كذبة");
  process.exit(r.status ?? 1);
}
console.log("ensure-deps: تم ✓");
