# Crypto.com Exchange — Disable-2FA Magic Token Disclosed in Full URL to Third Parties

**Research ID:** `CDC-WEB-01`
**Date:** 2026-10-30
**Affected asset:** `https://crypto.com/exchange/disable-2fa`
**Program:** Crypto.com on HackerOne (`$0` submission fee)
**Status:** Live-reproduced security-relevant disclosure; draft for human review, **not submitted**
**Severity position:** Medium confidentiality candidate at most; **not a Critical finding and not an account-takeover claim**

## Executive summary

When the Exchange disable-2fa magic-link route is opened with a `magic_token` query parameter, the complete URL is automatically transmitted to third-party analytics, advertising, and error-monitoring services. The token is also retained in same-origin consent-state data.

Three fresh-browser reproductions with deliberately invalid, non-secret markers observed the same disclosure pattern. The exact persisted harness reproduced:

| Destination | Marker location | Completed response in the persisted run |
|---|---|---:|
| `insights.rtgio.co/pageview/cryptocom` | `pgl` query parameter containing the complete target URL | 200 |
| `www.google.com/measurement/conversion` | `url` query parameter containing the complete target URL | 200 |
| `analytics.google.com/g/collect` | `dl` query parameter containing the complete target URL | 204 |
| `notify.bugsnag.com/` | `events[0].request.url` and multiple breadcrumb fields in the JSON POST body | Request observed; no response status claimed |

The disable-2fa POST was intercepted and fulfilled locally in every run. It did **not** reach the backend. No real token, account, credentials, or 2FA state was used or changed.

## Why this is security relevant

The route is not a generic marketing page. Its client-side flow reads `magic_token` and automatically constructs a request to:

```text
POST https://exchange-be.crypto.com/security/disable_2fa_by_magic_link
```

Consequently, the query value is a security-sensitive magic-link credential, not ordinary analytics metadata. Disclosing the complete URL expands the number of systems and processors that handle a credential intended for a 2FA-disable flow.

The demonstrated impact is **unintended third-party disclosure of the full token-bearing URL**. The research does not establish that an external attacker can read provider data, that a disclosed real token remains usable, or that this alone yields account takeover. Those claims must not be made without separate evidence.

## Safe reproduction steps

1. Use a fresh browser profile and an obviously invalid marker such as `CYBERNOVA-INVALID-NOT-REAL-<random>`. Never substitute a real magic token.
2. Locally intercept `**/security/disable_2fa_by_magic_link*` and fulfill it without forwarding the request.
3. Navigate to:

   ```text
   https://crypto.com/exchange/disable-2fa?magic_token=<INVALID_MARKER>
   ```

4. Inspect outbound requests for the invalid marker. The complete target URL appears in `pgl` at RTG, `url` at Google Ads measurement, `dl` at Google Analytics, and Bugsnag request/breadcrumb fields.
5. Confirm that the sensitive POST was locally fulfilled and that no real account operation occurred.

An executable invalid-marker-only Playwright reproduction is saved at:

```text
audit/cryptocom-hackerone/poc/disable_2fa_magic_token_disclosure.js
```

Its allowlisted, cookie-free output from an actual run is saved at:

```text
audit/cryptocom-hackerone/evidence/magic-token-disclosure-repro3-2026-10-30.json
```

## Execution evidence

- Earlier fresh-browser run 1: 258 requests, zero page errors, one locally intercepted sensitive POST, and all four disclosure destinations observed.
- Earlier fresh-browser run 2: 258 requests, zero page errors, one locally intercepted sensitive POST, all four destinations observed, and completed RTG 200 / Google Ads 200 / Analytics 204 responses.
- Persisted harness run 3: navigation 200, one locally intercepted sensitive POST, all four destinations observed, completed RTG 200 / Google Ads 200 / Analytics 204 responses, and zero page errors.
- Ordering is not stable: in run 1 RTG preceded the intercepted POST by approximately 1.1 seconds; in run 2 it followed the POST. Therefore pre-consumption disclosure is possible in at least one run, but a reliable race or reusable-token window is **not** claimed.

SHA-256 integrity values:

| Artifact | SHA-256 |
|---|---|
| Sanitized persisted run 3 | `6adbdb60ccdb833f66f1dafb33cbeccb579a739dd4bbab97e037ea63a90b126a` |
| Executable invalid-marker PoC | `ef89c43d48e5d7858edc33ab5818884051bd513db21a95307aca85b428ab4293` |
| Ephemeral raw run 1 (not published; contains transient browser state) | `2f660bedd4aff51e7983c61ba287fe5b1274e3a480c73f07d8c0dfbcf2004de5` |
| Ephemeral raw run 2 (not published; contains transient browser state) | `a0def04b5ab225daa2cf1d0b99779a557a3bb5e398a24f0eb184f5a638bb6e29` |

## Expected behavior

- Security tokens should not remain in a URL that analytics or monitoring code can collect.
- Third-party telemetry should be disabled or strictly redacted on account-security routes.
- A one-time token should be consumed and removed from browser-visible state before unrelated third-party code executes.

## Suggested remediation

1. Prefer a URL fragment or an immediately exchanged, short-lived code rather than a query credential; fragments are not sent in HTTP referrers and can be kept out of telemetry.
2. Remove sensitive query parameters with `history.replaceState` before any analytics, advertising, or error-monitoring initialization. This is defense in depth, not a substitute for avoiding query credentials.
3. Disable advertising and nonessential analytics on disable-2fa and comparable security routes.
4. Configure Bugsnag and other telemetry to redact `magic_token`, full request URLs, breadcrumbs, and router state on sensitive routes.
5. Enforce short expiry, single use, and binding to the intended account and action server-side; rotate any token suspected of disclosure.
6. Audit related reset, verification, and magic-link routes for the same telemetry pattern.

## Scope and reporting boundary

The in-scope root cause is the Crypto.com page's decision to initialize third-party telemetry while a security credential remains in the URL. No testing of third-party provider infrastructure is requested or authorized. This draft does not assert Critical severity, external attacker access to provider consoles, real-token usability, 2FA bypass, or account takeover. Program triage should determine whether the demonstrated confidentiality exposure is accepted and how it is rated.
