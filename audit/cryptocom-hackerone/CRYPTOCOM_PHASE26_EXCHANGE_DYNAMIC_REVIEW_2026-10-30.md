# Crypto.com — Phase 26 Exchange Dynamic & Source Review (2026-10-30)

## Result

**Verified Critical vulnerabilities: 0. Verified account takeover: 0. Submission-ready Critical reports: 0.**

This was a bounded, public/unauthenticated review of `https://crypto.com/exchange` and the two currently named Developer Platform hosts. It produced elimination evidence, not a new vulnerability report. No result in this document upgrades `CDC-WEB-01`, `CDC-MCP-01`, or any source-audit candidate.

Machine-readable sanitized evidence: `audit/cryptocom-hackerone/evidence/phase26-exchange-dynamic-review-2026-10-30.json`.

## 1. Safety and Scope

Testing remained within the previously verified Crypto.com HackerOne scope and safe-harbor constraints:

- No account credentials, API secrets, real tokens, or real-user identifiers were supplied.
- No trading, withdrawal, purchase, logout, deletion, credential creation, or other financial/account state change was attempted.
- No DoS, brute force, session enumeration, credential guessing, or broad endpoint fuzzing.
- No Cloudflare challenge bypass, alternate-network rotation, or third-party infrastructure testing.
- Only one benign 1×1 PNG was successfully uploaded. A second file was inert HTML with no script or active content and was rejected.
- Responses were reduced to statuses, documented error fields, byte counts, hashes, and JSON structure. No real-user data was observed or archived.

## 2. Static Coverage and Source-to-Sink Review

The accumulated Exchange review covers **645 JavaScript files / 8,303,793 bytes** across Exchange-Pro and Legacy Exchange.

Phase 26 added:

- **123 direct Exchange-Pro API call sites / 122 unique service-method-path tuples** extracted from the reviewed modules.
- Focused tracing of BFF, BE, NTS, worker, OAuth, KYC, payment-card, Dual Invest, WebSocket, upload, navigation, and HTML-sink paths.
- A close-proximity URL/source-to-navigation/HTML-sink pass produced three files for manual review:
  - `exchange-js/login-BS0uRhCv.js` — official OAuth URL construction; no new attacker-controlled sink demonstrated.
  - `exchange-js/root-CgDhaEKC.js` — page analytics and authenticated navigation logic; no new unauthenticated chain demonstrated.
  - `legacy-exchange/index-D7ETiHqh.js` — a competition link separate from the nearby query value; no query-to-`window.open` flow demonstrated.

**Conclusion:** no reproducible DOM XSS, token-exfiltration, or open-redirect-to-OAuth chain was established.

## 3. VIP Upload Validation — Active-Content Hypothesis Closed

Legacy `vip-portal-SSOi6lIS.js` actively uses the upload token/key exports to encrypt `{timestamp,token}` and submits `FormData` to:

`POST https://exchange-fe.crypto.com/v1/files/vip-form-upload-files`

A fresh browser with no account credential used the official `/exchange/vip-portal` form:

| Test | Result | Security conclusion |
|---|---|---|
| 68-byte benign 1×1 PNG, SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460` | Upload returned **201** and a file URL on `dprd-static-bff.dprd.crypto.com` | Confirms the public form accepts its intended image flow; not a vulnerability by itself |
| Retrieve only that returned PNG directly | **403 CloudFront**, both curl and browser | No public retrieval demonstrated from the research vantage point |
| 166-byte inert HTML document, no JavaScript or active content, SHA-256 `c0cc0f24dc9f647da1d88cabeb63f8adbd00f57057abffd1405d98cbf79bed9d` | Upload returned **400**, with no file URL | No active-content acceptance demonstrated |

No HTML, SVG, script, executable, polyglot, or further content was uploaded. There is **no verified arbitrary active-content upload, stored XSS, public file read, or Critical impact**. The earlier public client token/key observation is not treated as a credential disclosure.

## 4. Sensitive Paths Without `/private/` — Server Authorization Still Enforced

Static naming alone is not an authorization result. Four read-only operations were therefore called without a token or account session, using only the official fixed parameters/body where applicable:

| Operation | Result |
|---|---|
| `GET /v3/predictions/positions` | **404 / NOT_FOUND** |
| `GET /proxy/main-app/exapi/kyc/get_popup_status` | **401 / 264005 / UNAUTHORIZED** |
| `GET /proxy/kyc-web/web_api/v2/kyc/resubmissions?product_name=exchange_id_resubmit` | **401 / 264005 / UNAUTHORIZED** |
| `POST /proxy/datacenter/internal/v1/userinfo/aums/user_aum_detail` with the official fixed read body | **401 / 264005 / UNAUTHORIZED** |

The Predictions close/close-limit methods were **not** called. No positions, KYC records, AUM data, or other account data were returned.

## 5. Legacy OAuth and Financial Proxy Reads — All Negative

Ten official GET paths were selected from the Legacy client and requested once without an account credential. All returned **401 / 264005 / UNAUTHORIZED**, including:

- `/proxy/authnz2/v1/internal/oauth2/tokens?client_id=trading-view`
- `/proxy/authnz/v1/authentication/social-auth/list`
- `/proxy/rails/exapi/user/show`
- `/proxy/cashier/api/v1/payment-cards`
- `/proxy/rails/api/v1/dual-invest/account`
- `/proxy/rails/api/v1/dual-invest/positions/open`
- `/proxy/rails//api/v1/dual-invest/positions/settled`
- `/proxy/rails/api/v1/dual-invest/auto-renew-chains/positions`
- `/proxy/rails/api/v1/dual-invest/auto-renew-chains/orders?limit=10`
- `/proxy/rails/api/v1/dual-invest/auto-renew-chains`

The UI code expects the OAuth path to return `access_tokens` history for the current account; no token, account, social-link, card, or investment data was returned without authentication.

Two bounded `public/../` normalization variants against the read-only OAuth-token path both reached a Cloudflare **403** challenge. No challenge bypass or additional normalization fuzzing was attempted. No backend sensitive data was observed.

## 6. WebSocket Authorization Checks

A fresh browser held neither `token` nor `exchange-token` in local storage.

### Private user stream

Connection: `wss://deriv-web-stream.crypto.com/v1/user`

A single `user.balance` subscription without an account credential returned:

- `id: 1`
- `method: subscribe`
- `code: 40101`
- `message: Unauthorized`

### Global BFF stream

Connection: `wss://exchange-fe.crypto.com/v1/global/websocket`

The first run established that binary frames were present but could not interpret them. A follow-up used the **official Exchange `vendor-protobuf` FlatBuffers decoder**, rather than guessing. Ten decoded frames contained public market ticker/price structures (for example instrument/high/low/volume fields), not `user.balance` or account records. No private subscription acceptance or private data was demonstrated.

No `public/auth` message, forged signature, or credential material was sent.

## 7. Direct Exchange-BE Reads

Six active Legacy operations routed to `https://exchange-be.crypto.com` were tested without a session:

| Operation | Result |
|---|---|
| `GET /user/withdrawal_info` | `10002 / Not logged-in`, `data: null` |
| `GET /user/device/list` | `10002 / Not logged-in`, `data: null` |
| `GET /user/device/activity` | `10016 / User does not exist`, `data: null` |
| `GET /deposit/unverified_deposits?pageSize=10` | `10002 / Not logged-in`, `data: null` |
| `GET /common/main_app_withdrawal_status` | `10002 / Not logged-in`, `data: null` |
| `POST /addr/address_list` with empty JSON read body | `10002 / Not logged-in`, `data: null` |

The device-activity request had no `deviceId`; its error does not prove an IDOR. No device identifiers were guessed or enumerated. TOTP creation, address deletion, withdrawal, and other state-changing operations were not called.

## 8. Developer Platform DNS — No Takeover Evidence

Additional Cloudflare DoH queries for `CNAME`, `NS`, and `HTTPS` on:

- `developer-platform-api.crypto.com`
- `developer.crypto.com`

returned `Status: 0`, no answer records, and the `crypto.com` SOA in authority. Together with the earlier A/AAAA checks, this does **not** establish a dangling CNAME, dangling delegation, or subdomain takeover. The services remain unavailable for meaningful live API validation from this environment.

## 9. Non-Repeat Register

Future work should not repeat these exact negative cases without a new technical reason:

1. Benign-PNG/inert-HTML VIP upload validation and direct retrieval of the returned PNG.
2. The four sensitive non-`/private/` reads in Section 4.
3. The ten Legacy sensitive proxy GETs in Section 5.
4. The two OAuth-token `public/../` path-normalization variants.
5. Unauthenticated `user.balance` subscription on the two tested WebSocket endpoints.
6. The six direct Exchange-BE reads in Section 7.

A new hypothesis should instead identify a distinct server-side trust boundary or a concrete source-to-sink path. Public client constants, path names, AES usage, HTTP 200 envelopes, or scanner output alone must not be promoted to vulnerabilities.

## 10. Bottom Line

Phase 26 expanded dynamic coverage across upload, REST/BFF/BE, OAuth-token history, internal proxy, WebSocket, DNS, and source-to-sink boundaries. **No genuine Critical vulnerability was found, and nothing in this review is suitable for submission as a Critical report.** The result is preserved to prevent duplicate work and to keep later research evidence-driven.
