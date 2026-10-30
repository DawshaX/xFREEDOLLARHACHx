# Crypto.com `cdcx-cli` MCP — State-Changing Fiat and OTC Operations Bypass Acknowledgment Gating

**Research ID:** `CDC-MCP-01`
**Date:** 2026-10-30
**Reviewed project:** `crypto-com/cdcx-cli` `1.2.6`
**Reviewed commit:** `4d1112e86b061f8bdd8a6d92c3fd9aeb55b3b7bc`
**Status:** Locally executed and source-verified safety-control defect; **not submitted and not represented as a live Critical vulnerability**

## Summary

The MCP safety layer classifies methods through an explicit mutation/dangerous allowlist in `crates/cdcx-core/src/safety.rs`. Any unmatched `private/` method falls through to `SensitiveRead`, which passes without `acknowledged=true` and without `--allow-dangerous`.

The current official 95-operation Exchange OpenAPI document contains state-changing operations absent from that allowlist. A regression using the official YAML, all ten production overlays, the production schema registry, production MCP tool generation, and the production runtime gate verified:

| Official method | Generated MCP tool | Derived tier | `acknowledged` schema | Runtime gate with dangerous methods disabled and no acknowledgment |
|---|---|---|---|---|
| `private/fiat/fiat-create-bank-account` | `cdcx_fiat_bank-account` | `sensitive_read` | Absent and not required | `Ok(())` |
| `private/otc/request-deal` | `cdcx_otc_request-deal` | `sensitive_read` | Absent and not required | `Ok(())` |
| `private/otc/request-quote` | `cdcx_otc_request-quote` | `sensitive_read` | Absent and not required | `Ok(())` |

Test result: **1 passed, 0 failed**. The test was local only. No API credential, bank/Plaid flow, OTC quote/deal, trade, or other financial request was used.

## Why `request-deal` is not a read operation

The official OpenAPI specification describes `private/otc/request-deal` as **“Request a deal”** and, for the RFQ flow, **“Request a deal from a quote (RFQ flow).”** Its successful official example returns:

```json
{
  "method": "private/otc/request-deal",
  "code": 0,
  "result": {
    "deal_status": "ACCEPTED",
    "leg_list": [
      {
        "instrument_name": "BTC_USD",
        "quantity": "1",
        "price": "95734.2",
        "side": "BUY",
        "type": "PRICE"
      }
    ]
  }
}
```

That is a prospective economic state change, not sensitive read-only retrieval. This report does not claim that a real deal was requested or executed during research.

## Root cause

`SafetyTier::from_method` explicitly lists several trading mutations but not these fiat/OTC operations:

```rust
// Everything else that's private is SensitiveRead
_ => Self::SensitiveRead,
```

The MCP gate then permits `Read | SensitiveRead` unconditionally:

```rust
match tier {
    SafetyTier::Read | SafetyTier::SensitiveRead => Ok(()),
    SafetyTier::Mutate => { /* acknowledged=true required */ }
    SafetyTier::Dangerous => { /* allow-dangerous + acknowledged=true required */ }
}
```

Production tool generation adds the required `acknowledged` property only for `Mutate` and `Dangerous`. Because the three operations are misclassified, the property is absent and the runtime check returns `Ok(())` even when `allow_dangerous=false` and no acknowledgment is supplied.

## Exact reproduction artifacts

- Test log: `audit/cryptocom-hackerone/evidence/mcp-official-gating-test-2026-10-30.log`
- Exact temporary regression patch: `audit/cryptocom-hackerone/evidence/mcp-official-gating-test-2026-10-30.patch`
- Official YAML source used by the CLI: `https://exchange-developer.crypto.com/exchange/v1/openapi/exchange-openapi.generated.yaml`
- Reviewed YAML SHA-256: `90a5945a647e693c69347c4b75f3fd03f3b6ec7e293335a6ab2f593cdd84c9f8`
- Test log SHA-256: `a6f196caaafab69eb3fe5132b9fd805201337aa81ea9a19d8331595db3766037`
- Regression patch SHA-256: `9e789906b25c43783452eaca4da24ebbf3094c28009009f72fa122cdac14afc0`

To rerun locally:

```bash
git clone https://github.com/crypto-com/cdcx-cli.git
cd cdcx-cli
git checkout 4d1112e86b061f8bdd8a6d92c3fd9aeb55b3b7bc
curl -fsSLo exchange-openapi.generated.yaml \
  https://exchange-developer.crypto.com/exchange/v1/openapi/exchange-openapi.generated.yaml
patch -p0 < /path/to/mcp-official-gating-test-2026-10-30.patch
CDCX_OPENAPI_YAML="$PWD/exchange-openapi.generated.yaml" \
  cargo test -p cdcx-cli official_state_changing_operations_runtime_gating_regression -- --nocapture
```

Restore the temporary test edit afterward with `git checkout -- crates/cdcx-cli/src/mcp/tools.rs`. The research checkout was restored and left clean.

## Security impact and constraints

The defect defeats the CLI's own defense-in-depth acknowledgment boundary. In an MCP client that relies on tool metadata or server-side gating to require confirmation, an enabled agent could invoke these operations under the less restrictive `sensitive_read` policy. `request-deal` is the highest-priority case because it accepts instrument, price, quantity, side, and quote identifiers and creates/requests a deal.

Important constraints:

- MCP is a local, explicitly enabled interface; this is not an unauthenticated remote API exploit.
- Fiat/OTC services and valid credentials are required for real operations.
- No indirect prompt injection, autonomous agent invocation, real financial effect, or cross-user impact was demonstrated.
- The CLI repository is not independently listed in the reviewed HackerOne scope CSV, although Exchange APIs and `*.crypto.com` are listed. Scope eligibility must not be overstated.
- This is therefore a verified local safety-control defect, **not a verified Critical vulnerability or a submission-ready HackerOne report**.

## Recommended remediation

1. Add `private/otc/request-deal` to the mutation or dangerous tier according to its actual execution semantics; do not leave it as `SensitiveRead`.
2. Classify `private/otc/request-quote` and `private/fiat/fiat-create-bank-account` as mutations.
3. Replace the permissive private-method fallback with a generated, spec-aware classification step or a default-deny review queue for unmatched non-read operations.
4. Add a CI invariant over every official operation: all state-changing methods must have the intended tier, an `acknowledged` schema property where applicable, and a runtime gating test.
5. Treat operation names as an incomplete semantic signal; review request/response documentation for economic effects when adding new API groups.
