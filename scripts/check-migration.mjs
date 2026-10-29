import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', 'review', 'uploads']);
const textExt = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.toml', '.md', '.html', '.css', '.sh', '.txt', '.svg']);
const patterns = [
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ['Telegram token', /(?<![0-9])[0-9]{7,12}:[A-Za-z0-9_-]{30,45}(?![A-Za-z0-9_-])/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Slack webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/],
  ['Personal tunnel host', /https?:\/\/[a-z0-9-]+\.(?:ngrok-free\.(?:app|dev|io)|ngrok\.(?:app|io)|ts\.net)/i],
  ['OpenClaw bearer literal', /OPENCLAW_TOKEN\s*=\s*["'][A-Za-z0-9_-]{20,}["']/],
  ['Provider key literal', /(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})/],
  ['URL with embedded credentials', /https?:\/\/[^\s/@:"'<>]+:[^\s/@"'<>]+@/]
];
const findings = [];
let files = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) await walk(path.join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(root, path.join(dir, entry.name));
    if (/\.(zip|tar|tgz|map|tsbuildinfo|pem|key|p12|pfx)$/i.test(rel) || /(^|\/)\.env(?!\.example)/.test(rel)) {
      findings.push(`${rel}: forbidden artifact`);
      continue;
    }
    if (!textExt.has(path.extname(entry.name)) && entry.name !== '.env.example') continue;
    files++;
    const text = await readFile(path.join(dir, entry.name), 'utf8');
    for (const [label, pattern] of patterns) {
      if (pattern.test(text)) findings.push(`${rel}: ${label}`);
    }
  }
}
await walk(root);
const legacyIndex = await readFile(path.join(root, 'artifacts/api-server/src/index.ts'), 'utf8');
if (!legacyIndex.includes('process.exit(1)')) findings.push('legacy API entrypoint is not quarantined');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!pkg.scripts.start.includes('platform/server.mjs')) findings.push('root start script does not point to safe control plane');
if (findings.length) {
  console.error('Migration check failed:');
  for (const finding of findings) console.error(' - ' + finding);
  process.exit(1);
}
console.log(`Migration check passed: ${files} text files scanned; no forbidden artifacts or known secret patterns found.`);
