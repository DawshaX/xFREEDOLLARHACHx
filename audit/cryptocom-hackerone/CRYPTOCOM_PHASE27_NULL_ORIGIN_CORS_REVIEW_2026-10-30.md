# Crypto.com — Phase 27 Null-Origin CORS & Auth-Flow Source Triage (2026-10-30)

## Result

**Verified Critical vulnerabilities: 0. Verified account takeover: 0. Submission-ready Critical reports: 0.**

Phase 27 deliberately avoided the closed Phase 26 request matrix. Two new high-impact hypotheses were narrowed from official client source; only the distinct, safely testable null-origin CORS question progressed to dynamic validation.

Sanitized machine evidence: `audit/cryptocom-hackerone/evidence/phase27-null-origin-cors-results.json`.

## 1. JWT Source Triage — No Blind Algorithm Probe

The Exchange-Pro browser client stores its session value as `token` and sends it in the custom **`exchange-token`** request header. The reviewed Exchange source did not establish that this session value is a JWT. Explicit `intercomUserJwt` values belong to the separate Intercom integration.

Therefore no `alg:none`, forged-signature, or random-identity request was made. Sending a fabricated JWT to an opaque-token boundary without source evidence would be blind probing, not a reproducible vulnerability hypothesis.

## 2. OAuth Callback Leakage Triage — No Valid-Code Claim

The official client constructs an authorization-code flow with:

- `response_type=code`
- first-party redirect URI `https://exchange-be.crypto.com/oauth_redirect`
- fixed first-party front-end destinations in `state`

The previously captured invalid-code callback response is an empty **302** to `https://crypto.com/exchange`, not an HTML page that loads third-party resources. The reviewed client did not reveal a query-string `code` or `access_token` consumer that would establish a second leakage boundary.

No new callback request was sent, no real authorization code was used, and no third-party OAuth-code disclosure is claimed. A valid-code flow cannot be inferred from the invalid-code response.

## 3. New Dynamic Check — Special `null` Origin

Earlier CORS checks used a conventional invalid web origin. Phase 27 tested only the special `Origin: null` case against two read-only routes. No cookies, account token, authorization header, or real-user identifier was included.

The already-challenged NTS API-key-list route was **not** retested.

| Preflight | Result | Browser security conclusion |
|---|---|---|
| `OPTIONS https://exchange-fe.crypto.com/v1/private/get-user-info` with `Origin: null`, requested method GET, requested headers `content-type,exchange-token` | **404**, `Cannot OPTIONS /v1/private/get-user-info`; no `Access-Control-Allow-Origin` | Null-origin browser read was not allowed by this response |
| `OPTIONS https://exchange-be.crypto.com/user/withdrawal_info` with the same origin/requested capabilities | **200**, fixed `Access-Control-Allow-Origin: https://crypto.com`; no `Access-Control-Allow-Credentials` | The server did not reflect or grant `null`; a null-origin browser cannot use this response for a credentialed cross-origin read |

The conditional harness allowed an actual GET only if the preflight returned `Access-Control-Allow-Origin: null` or `*`. Neither did, so **no Phase 27 actual sensitive-read request was sent**.

## 4. Non-Repeat Register and Impact Boundary

- Do not repeat these two exact null-origin preflights without a new implementation change or technical reason.
- Do not retest the challenged NTS API-key-list path as part of this CORS branch.
- A fixed ACAO value for `https://crypto.com` is not evidence of null-origin reflection.
- CORS headers alone would not have proven ATO; a valid exploit would also require a browser-available credential mechanism and protected data. Neither was demonstrated.
- No state-changing operation, challenge bypass, credential guessing, or account creation occurred.

## 5. Bottom Line

The new JWT, OAuth-leakage, and null-origin branches produced no qualifying vulnerability. Phase 27 adds negative evidence only and does not alter the severity of any previous candidate.
