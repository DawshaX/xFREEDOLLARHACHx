# Crypto.com — Bounded Live Web/API Review (2026-10-30)

## Result

**New verified vulnerabilities: 0. New Critical findings: 0. Submission-ready reports from this review: 0.**

This review does **not** upgrade any source-level candidate to a live vulnerability. No entry is added to `state/discovered-vulnerabilities-vault.json` from the unverified candidates below.

## 1. Scope, Rules, and Safety Constraints

Verified against the official program assets and rules:

- `https://hackerone.com/crypto/policy_scopes`
- Official scope CSV: `https://hackerone.com/teams/crypto/assets/download_csv.csv`
- `https://github.com/crypto-com/h1-policy-guidelines`
- `https://hackerone.com/crypto/safe_harbor`

Relevant scope rows observed in the official CSV:

| Asset | Submission | Bounty eligible | Maximum severity |
|---|---:|---:|---:|
| `*.crypto.com` | Yes | Yes | Critical |
| `https://crypto.com/exchange` | Yes | Yes | Critical |
| `developer-platform-api.crypto.com` | Yes | Yes | Critical |
| `developer.crypto.com` | Yes | Yes | Critical |
| `developer-api.crypto.com` | Yes | Yes | Critical |

The official guidelines require a specific, manually verified, reproducible vulnerability and a clear PoC. Scanner output, theoretical impact, missing headers, non-sensitive errors, and library/version observations without working exploitation are not sufficient.

Testing was deliberately bounded:

- No denial of service, load testing, brute force, credential guessing, or broad automated scanning.
- No access to another user's account, notifications, credentials, sessions, or funds.
- No trading, withdrawal, transaction, or state-changing financial request.
- No invocation of the discovered development **login** path and no attempt to obtain or use a token.
- Only a small number of deterministic requests, including negative controls with a randomly generated UUID that could not belong to a real flow.
- Response values that could contain credentials or identifiers were not printed or archived.

## 2. Live Results

### 2.1 Developer Platform domains — currently not resolvable

The following names could not be resolved by the sandbox resolver:

- `developer-platform-api.crypto.com`
- `developer.crypto.com`
- `developer-api.crypto.com`

Independent DNS-over-HTTPS checks through both Cloudflare and Google returned `Status: 0` with **no `A`, `AAAA`, `CNAME`, or `HTTPS` answer**, and an SOA authority record for `crypto.com`.

**Interpretation:** the three services were not reachable for live API validation during this review. This is an availability observation, **not a vulnerability** and not evidence of subdomain takeover. The latest official TypeScript SDK still contains `BASE_URL = 'https://developer-platform-api.crypto.com'` in `src/lib/constants/global.constants.ts` at repository commit `2d0da269de72f416a59ad65d3ff77b66701d867e` (`1.1.4`).

### 2.2 `x-growth.crypto.com` CLI credential-polling candidate — not proven

A single negative-control request was sent to the exact production polling path used by the official CLI:

- `POST https://x-growth.crypto.com/static/cli/authenticate?ts=<current-ms>`
- JSON body shape: `{"session": "<fresh random UUIDv4>", "ts": <current-ms>}`
- Result: **HTTP 500**, **0-byte response body**.

No credentials, personal data, session data, or useful sensitive error were returned. An empty HTTP 500 is not a reportable vulnerability under the published rules.

The latest `crypto-com/cdcx-cli` source reviewed at commit `4d1112e86b061f8bdd8a6d92c3fd9aeb55b3b7bc` (`1.2.6`) still:

1. Generates a UUIDv4 `session_id` in the CLI.
2. Places it in the browser `authorize_broker` URL as both `redirect_uri ... ?id=<session_id>` and `broker_reference_id=<session_id>`.
3. Uses the same value as `session` when polling for `api_key` and `secret_key`.
4. Does not show a PKCE `code_challenge` / `code_verifier` binding in `crates/cdcx-cli/src/groups/auth_login.rs`.

**Status:** `CDC-DEV-03` remains a **source-level session-binding hypothesis**, not a verified live account/API-key compromise. A valid proof requires a researcher's own CLI authorization flow and own test account, with a second client attempting to retrieve only that same researcher's own credentials. The random-session negative control does not establish that impact.

### 2.3 Exchange production client — static review plus one bounded existence check

`https://crypto.com/exchange` redirected to `/exchange-pro` and then `/exchange-pro/en-US`, ending in HTTP 200. A focused review covered **34 public first-party JavaScript assets (371,464 bytes)** related to authentication, session handling, API clients, account functions, configuration, transfers, and notifications.

#### Candidate A — development authentication paths

The production `root-CgDhaEKC.js` bundle contains references to:

- `/__dev/auth/accounts`
- `/__dev/auth/probe`
- `/__dev/auth/login`

The same bundle renders the Developer Tools trigger only when the production-environment check is false; the shipped environment is `dprd`, so the trigger is hidden. In addition, the visible `Ef` component does not automatically invoke the probe callback.

One unauthenticated request matching the client's probe method was made:

- `POST https://crypto.com/__dev/auth/probe`
- `content-type: application/json`, empty body, no cookies or credentials.
- Result: **HTTP 405**, **0-byte response body**.

The development **login** and **accounts** paths were not called. No token was requested, obtained, or used.

**Status:** no authentication bypass or sensitive exposure was verified. Presence of development strings in a public bundle is not itself a vulnerability.

#### Candidate B — OAuth `state` and PKCE observation

The public login bundle builds the OAuth authorization URL with `response_type=code` and a deterministic `state` formed from the application origin/path. The reviewed client-side URL builder does not add a PKCE challenge.

**Status:** observation only. It does not prove login CSRF, authorization-code theft, or account takeover because server-side nonce, cookie, redirect, and callback validation were not established. No live OAuth callback manipulation was attempted.

#### Candidate C — notification HTML rendering sink

The reviewed bundle maps `notification_content` to `contentText` after replacing newlines with `<br />`. For four deposit/withdrawal **requested** event types, a toast renders `contentText` using `dangerouslySetInnerHTML`.

**Status:** unverified sink, not a vulnerability by itself. The reviewed code does not establish that an attacker can inject markup into another user's private notification. Any valid validation would require only researcher-owned test accounts and a benign markup marker; no injection was sent during this review.

## 3. Evidence Integrity

Relevant SHA-256 values:

| Evidence | Bytes | SHA-256 |
|---|---:|---|
| Official scope CSV | 5,270 | `959273a235f237e29865b76bc0b942f2104c39a669f9377d968d8f8b927bf994` |
| Development probe response body | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| CLI random-session negative-control response body | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Exchange `root-CgDhaEKC.js` | 252,247 | `87f0c6bd8ac1a7537db3a0c722470a7274181327367b7f6e60c17b214df59283` |
| Exchange `login-BS0uRhCv.js` | 6,740 | `57dff04a61262af5d5f3b1f439875d4a612f88e5f37595082327a5e856785a76` |
| Exchange `browserClient-AlbxOCrl.js` | 10,502 | `10a34954ad6f30025b9f1e8ec55c49e75ca8667640764378a3d10677678acb45` |

Machine-readable, sanitized status evidence is stored in `audit/cryptocom-hackerone/evidence/live-web-api-review-2026-10-30.json`. Cookie values, request UUIDs, and any potential credential values are intentionally excluded.

## 4. Next Valid Validation Gates

1. **Developer Platform:** repeat only when the official domains resolve again; start from documented SDK endpoints and a researcher-owned project/API key. Do not report DNS unavailability as a vulnerability.
2. **CLI session binding:** use a new researcher-owned test account and a fresh CLI flow. Never use observed/third-party session IDs. The only acceptable credential-retrieval proof is against the researcher's own session and must stop immediately after demonstrating the binding failure.
3. **Exchange authenticated API:** use two researcher-owned test accounts for authorization-matrix checks. Do not share passwords, API secrets, cookies, or withdrawal-enabled keys with the assistant.
4. **Notification sink:** first establish a benign, cross-account source of attacker-controlled notification content; without that source, close the candidate as self-impact/unproven.
5. **Severity:** do not chain multiple low-impact observations merely to inflate severity. Crypto.com's own severity guidance explicitly says multiple Low issues may not be combined to claim High.

## 5. Bottom Line

The review produced useful elimination evidence and three clearly labelled research candidates, but **no real Critical vulnerability was discovered or verified**. Submitting any of these observations now would violate the program's reproducibility requirements and risks a spam/Not Applicable outcome.
