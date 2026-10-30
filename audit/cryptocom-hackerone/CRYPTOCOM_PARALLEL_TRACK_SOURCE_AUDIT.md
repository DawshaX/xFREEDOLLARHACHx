# Crypto.com (HackerOne) — Parallel Track Source Code & Architecture Security Audit

- **Program**: `https://hackerone.com/crypto/policy_scopes`
- **Target Scope**:
  1. **Developer Platform & AI Agent Ecosystem** (`developer-platform-api.crypto.com`, `developer.crypto.com`, `developer-api.crypto.com`, `*.crypto.com`)
  2. **Exchange & Broker CLI Ecosystem** (`https://crypto.com/exchange`, `x-growth.crypto.com`, `wapi.crypto.com`, `cdcx-cli`, `crypto-agent-trading`)
  3. **Smart Wallet & Account Abstraction Contracts** (`ApprovalPaymaster.sol`, `GeneralPaymaster.sol`, `OTKAccount.sol`, `LiquidETHV1.sol`)

---

## Finding 1 (`CDC-DEV-01`): Unverified Client-Side JWT Decoding (`jwtDecode`), Untrusted `wallet_addEthereumChain` RPC Injection, Zero-Slippage Swaps (`amountOutMin = '0'`), and Hardcoded 18-Decimal Transfers in `cdc-ai-agent-signer-app`

### Affected Components
- **Repository**: `https://github.com/crypto-com/cdc-ai-agent-signer-app`
- **Integrated API**: `https://developer-platform-api.crypto.com/api/v1/cdc-developer-platform/token/{transfer,swap,wrap}` (`@crypto.com/developer-platform-client`)
- **Files & Lines**:
  - `src/hooks/useTransactionDetails.ts` (lines 12–43)
  - `src/utils/switchNetworks.ts` (lines 12–40)
  - `src/pages/SwapToken.tsx` (line 64) & `src/hooks/useSwapToken.ts` (lines 68–86)
  - `src/pages/TransferToken.tsx` (line 66) & `cryptocom-ai-agent-service/src/services/token/token.service.ts` (line 45)

### Root Cause Analysis

#### 1. Missing Cryptographic Verification on Transaction Magic-Link Token (`CWE-347`)
In `src/hooks/useTransactionDetails.ts`:
```ts
const queryParams = new URLSearchParams(location.search);
const token = queryParams.get('token');
...
const decoded: DecodedToken = jwtDecode(token);
if (decoded.exp < Date.now() / 1000) {
  setError('The link has expired. Please request a new one.');
  setIsProcessing(false);
  return;
}
setTransactionDetails(decoded);
```
The application uses `jwtDecode` (`jwt-decode`), which only Base64Url-decodes the token payload in the browser without verifying any cryptographic signature (`HMAC`/`RSA`/`ECDSA`) and without querying `developer-platform-api.crypto.com` to verify that the `[transactionID]` route parameter matches a legitimate server-issued transaction session.

#### 2. Untrusted RPC & Chain Configuration Injection via `wallet_addEthereumChain` (`CWE-829`)
In `src/utils/switchNetworks.ts`:
```ts
await ethereum?.request({
  method: 'wallet_addEthereumChain',
  params: [
    {
      chainId: chainIdHex,
      chainName: transactionDetails.chain.name,
      nativeCurrency: {
        name: transactionDetails.currency,
        symbol: transactionDetails.currency,
        decimals: 18,
      },
      rpcUrls: [transactionDetails.chain.rpc],
    },
  ],
});
```
Rather than looking up the RPC URL from the trusted static `CHAINS` allowlist in `src/constants/chain.constants.ts` (`chainId: 25, 338, 388, 240`), `switchToCustomNetwork` takes `transactionDetails.chain.rpc` and `transactionDetails.chain.name` directly from the unverified URL token payload and passes them to MetaMask's `wallet_addEthereumChain`.

#### 3. Hardcoded Zero Minimum Output (`amountOutMin = '0'`) on Token Swaps (`CWE-682`)
In `src/pages/SwapToken.tsx` (line 64) and `src/hooks/useSwapToken.ts` (lines 68–86):
```ts
const handleSwap = async (): Promise<void> => {
  if (!transactionDetails) {
    setError('Transaction details are missing or invalid.');
    return;
  }
  await swapTokens(transactionDetails, '0');
};
```
Every swap executed through the Signer App passes `amountOutMin = '0'` to `swapExactTokensForTokens`, disabling slippage protection on mainnet routers (`0x66C0893E38B2a52E1Dc442b2dE75B802CcA49566` on Cronos Mainnet and `0x4E792B8c9bcB9E200C3713810C4D6eA8C4230E7c` on Cronos zkEVM Mainnet).

#### 4. Hardcoded 18 Decimals on ERC-20 Transfers (`CWE-682`)
In `src/pages/TransferToken.tsx` (line 66):
```ts
const contract = new ethers.Contract(transactionDetails.contractAddress, erc20Abi, signer);
const txResponse = await contract.transfer(
  transactionDetails.to,
  ethers.parseUnits(transactionDetails.amount.toString(), 18)
);
```
The transfer call hardcodes `18` decimals instead of using the token's actual `decimals()` (such as `6` for `USDCe` or `8` for `CDCBTC`), causing a $10^{12}\times$ or $10^{10}\times$ unit scaling mismatch.

### Recommended Remediation
1. **Verify Transaction State Server-Side or via Asymmetric JWS (`RS256`/`ES256`)**:
   - Validate the JWT signature against a pinned public key or fetch the canonical transaction payload by `transactionId` from `developer-platform-api.crypto.com` over HTTPS.
2. **Enforce Strict Chain Allowlist in `switchNetworks.ts`**:
   ```ts
   const allowedChain = CHAINS.find((c) => c.chainId === transactionDetails.chain.id);
   if (!allowedChain) throw new Error('Unsupported chainId');
   // Use allowedChain.rpc and allowedChain.name instead of untrusted token fields
   ```
3. **Use Token `decimals` and Non-Zero Slippage Bounds**:
   - Query `decimals()` before calling `ethers.parseUnits(amount, decimals)` and compute `amountOutMin` via router `getAmountsOut` with a configurable slippage tolerance (e.g., `0.5%`).

---

## Finding 2 (`CDC-DEV-02`): Unchecked ERC-20 Fee `amount` in `ApprovalPaymaster.sol` and Permanent Key Depletion Lockout in `OTKAccount.sol`

### Affected Components
- **Repository**: `https://github.com/crypto-com/developer-platform-sdk-examples`
- **Files**:
  - `ai/smart-wallet-example/smart-wallet-core-solidty/contracts/paymasters/ApprovalPaymaster.sol` (lines 48–85)
  - `ai/smart-wallet-example/smart-wallet-core-solidty/contracts/OTKAccount.sol` (lines 58–62, 147–174)

### Root Cause Analysis

#### 1. `ApprovalPaymaster.sol` Does Not Validate Decoded `amount` Against `PRICE_FOR_PAYING_FEES` or `requiredETH`
In `ApprovalPaymaster.validateAndPayForPaymasterTransaction` (lines 48–82):
```solidity
(address token, uint256 amount, bytes memory data) = abi.decode(
    _transaction.paymasterInput[4:],
    (address, uint256, bytes)
);
require(token == allowedToken, "Invalid token");
address userAddress = address(uint160(_transaction.from));
address thisAddress = address(this);
uint256 providedAllowance = IERC20(token).allowance(userAddress, thisAddress);
require(providedAllowance >= PRICE_FOR_PAYING_FEES, "Min allowance too low");

uint256 requiredETH = _transaction.gasLimit * _transaction.maxFeePerGas;
try IERC20(token).transferFrom(userAddress, thisAddress, amount) {} catch ...
(bool success, ) = payable(BOOTLOADER_FORMAL_ADDRESS).call{value: requiredETH}("");
```
While the contract checks that the user's `allowance(userAddress, address(this)) >= PRICE_FOR_PAYING_FEES`, it never checks that the user-supplied `amount` decoded from `_transaction.paymasterInput[4:]` is `>= PRICE_FOR_PAYING_FEES` (or proportional to `requiredETH`). Passing `amount = 0` transfers `0` ERC-20 tokens while the Paymaster still pays `requiredETH` in native gas to `BOOTLOADER_FORMAL_ADDRESS`.

#### 2. `OTKAccount.sol` Consumes One-Time Keys Without a Key Rotation / Replenishment Mechanism
In `OTKAccount.sol` (lines 58–62 and 167–172):
```solidity
constructor(address[] memory list) {
    for (uint256 i = 0; i < list.length; i++) {
        otks[list[i]] = true;
    }
}
...
if (otks[recoveredAddress] == true) {
    otks[recoveredAddress] = false;
    return true;
}
```
Each transaction validated via an OTK permanently sets `otks[recoveredAddress] = false`, and the contract has no function to register additional OTKs or an owner fallback key (`recoveredAddress == address(this)` cannot be signed because `address(this)` is a contract deployed via `createAccount`). Once the initial `list` of OTKs is exhausted, all remaining funds in `OTKAccount` are permanently locked.

### Recommended Remediation
1. In `ApprovalPaymaster.sol`, enforce `require(amount >= PRICE_FOR_PAYING_FEES, "Insufficient ERC20 fee amount");` (or calculate the required token amount from `requiredETH`).
2. In `OTKAccount.sol`, store a persistent `owner` EOA address set at construction time and allow authenticated transactions from the account itself (`onlyBootloader`) to add or rotate `otks`.

---

## Finding 3 (`CDC-DEV-03`): Shared `session_id` in Browser Authorization URL and Unauthenticated Credential Polling Endpoint (Missing PKCE / Device-Code Separation) in `cdcx-cli`

### Affected Components
- **Repository**: `https://github.com/crypto-com/cdcx-cli` (`v1.0.2`)
- **Endpoints**:
  - `https://crypto.com/exchange/authorize_broker`
  - `https://x-growth.crypto.com/static/cli/authenticate`
- **File**: `crates/cdcx-cli/src/groups/auth_login.rs` (lines 36–170)

### Root Cause Analysis
In `crates/cdcx-cli/src/groups/auth_login.rs`:
```rust
fn oauth_url(environment: &str, session_id: &str) -> String {
    match environment {
        ...
        _ => format!(
            "https://crypto.com/exchange/authorize_broker?broker_id=cdcx-cli\
             &redirect_uri=https%3A%2F%2Fx-growth.crypto.com%2Fstatic%2Fcli%2Fauthenticate%3Fid%3D{session_id}\
             &broker_reference_id={session_id}"
        ),
    }
}
```
And in `poll_for_credentials` / `poll_for_credentials_headless`:
```rust
let url = format!("{}?ts={}", base_url, ts);
let body = serde_json::json!({ "session": session_id, "ts": ts });
```
Unlike RFC 7636 (PKCE) or RFC 8628 (OAuth 2.0 Device Authorization Grant), the exact same `session_id` transmitted in the public browser URL (`redirect_uri` and `broker_reference_id`) is used as the sole bearer secret to poll `POST https://x-growth.crypto.com/static/cli/authenticate` and retrieve the newly created Exchange `api_key` and `secret_key` (`enabled_trading: true`).

### Theoretical Impact
- **Broker Authorization Session Fixation (`CWE-384`)**: Because `session_id` is generated client-side and not bound to a secret `code_verifier` held only by the legitimate CLI instance, an attacker who induces a user to authorize a pre-generated `authorize_broker` link (or who observes the `session_id` via browser history, proxy logs, or shoulder-surfing) can poll the unauthenticated `x-growth.crypto.com/static/cli/authenticate` endpoint and retrieve the resulting Exchange API key and secret key.

### Recommended Remediation
1. **Implement PKCE (`S256`)**:
   - Have `cdcx-cli` generate a high-entropy `code_verifier` locally and pass only `code_challenge = BASE64URL(SHA256(code_verifier))` in the browser authorization URL (`authorize_broker`).
   - Require `code_verifier` in the `POST https://x-growth.crypto.com/static/cli/authenticate` request body before releasing `api_key` and `secret_key`, and encrypt the credential payload with an ephemeral public key generated by the CLI.

---

## Finding 4 (`CDC-DEV-04`): Unencoded Path & Query Parameter Interpolation in `@crypto.com/developer-platform-client` Used by AI Agent Tool Calls

### Affected Components
- **Repository**: `https://github.com/crypto-com/developer-platform-client-ts`
- **Files**:
  - `src/integrations/cronosid.api.ts` (lines 20, 48)
  - `src/integrations/defi.api.ts` (lines 22, 53, 88)
  - `src/integrations/exchange.api.ts` (line 49)
  - `src/integrations/token.api.ts` (lines 19, 49, 200)
  - `src/integrations/block.api.ts` (line 50)

### Root Cause Analysis
All path and query parameters in `@crypto.com/developer-platform-client` are concatenated directly into URLs using template literals without `encodeURIComponent(...)`:
```ts
const url = `${BASE_URL}/api/v1/cdc-developer-platform/cronosid/resolve/${name}`;
const url = `${BASE_URL}/api/v1/cdc-developer-platform/defi/farms/${protocol}/${symbol}`;
const url = `${BASE_URL}/api/v1/cdc-developer-platform/block/block-tag?blockTag=${blockTag}&txDetail=${txDetail}`;
```
Because `@crypto.com/developer-platform-client` is invoked directly by `AIAgentService.executeFunction` in `cryptocom-ai-agent-service` using LLM-generated `tool_calls` arguments while sending the server's `x-api-key: DASHBOARD_API_KEY` header, special characters (`../`, `?`, `&`, `#`) in LLM-extracted parameters can alter the intended API path or query parameters sent to `developer-platform-api.crypto.com`.

### Recommended Remediation
- Wrap all dynamic path segments and query parameters with `encodeURIComponent(...)` and construct query strings using `new URLSearchParams(...)`.

---

## Finding `CDC-SC-01` — Single-Block `2x` Rate-Limit Bypass & Unprivileged External Allowance Starvation in `RateLimit.sol` (`MintForwarder` & `ExchangeRateUpdater`)

- **Severity**: **High / Medium (CVSS 7.3 — Smart Contract Rate-Limit Invariant Bypass & Griefing)**
- **Target Repository**: `https://github.com/crypto-com/wrapped-tokens-os` (`CDCETH` / `CDCBTC` Official Repository)
- **Vulnerable Files**:
  - `contracts/wrapped-tokens/RateLimit.sol` (lines 125–184)
  - `contracts/wrapped-tokens/MintForwarder.sol` (lines 79–96)
  - `contracts/wrapped-tokens/ExchangeRateUpdater.sol` (lines 74–96)
- **Verified Foundry PoC**: `audit/cryptocom-hackerone/PoC_RateLimit_Bypass.t.sol` (`2/2 PASS`)

### 1. Root Cause #1: Instant `2x` (`200%`) Rate-Limit Bypass in a Single Block (`CWE-682` / `CWE-841`)
In `RateLimit.sol` (lines 142–160), `_replenishAllowance(address caller)` returns early whenever `allowances[caller] == maxAllowances[caller]` **without updating `allowancesLastSet[caller] = block.timestamp`**:

```solidity
    function _replenishAllowance(address caller) internal {
        if (allowances[caller] == maxAllowances[caller]) {
            return; // BUG: Does NOT update allowancesLastSet[caller] = block.timestamp!
        }
        uint256 amountToReplenish = _getReplenishAmount(caller);
        if (amountToReplenish == 0) {
            return;
        }

        allowances[caller] = allowances[caller] + amountToReplenish;
        allowancesLastSet[caller] = block.timestamp;
        ...
    }
```

And in both `MintForwarder.mint()` and `ExchangeRateUpdater.updateExchangeRate()`, the contract:
1. Calls `_replenishAllowance(msg.sender)` **before** subtracting the consumed allowance (`_amount` or `diff`).
2. Subtracts `allowances[msg.sender] = allowances[msg.sender] - _amount` **without** updating `allowancesLastSet[msg.sender]`.

**Exploit Sequence (Verified in `test_PoC1_SingleBlock_2x_RateLimit_Bypass`)**:
1. At `t = t0`, `configureCaller(caller, maxQuota, interval)` sets `allowances[caller] = maxQuota` and `allowancesLastSet[caller] = t0`.
2. After `interval` seconds have elapsed (`t = t0 + interval`), `caller` calls `mint(to, maxQuota)` (or `updateExchangeRate()`):
   - `_replenishAllowance(caller)` sees `allowances[caller] == maxAllowances[caller]` and returns early **leaving `allowancesLastSet[caller] == t0`**.
   - `mint()` subtracts `maxQuota`, setting `allowances[caller] = 0` while `allowancesLastSet[caller]` is still `t0` (`interval` seconds in the past!).
3. In the **exact same block (`t = t0 + interval`, `0` seconds elapsed)**, `caller` calls `mint(to, maxQuota)` a second time:
   - Now `allowances[caller] == 0 < maxAllowances[caller]`.
   - `_getReplenishAmount(caller)` calculates `secondsSinceAllowanceSet = block.timestamp - t0 = interval`, returning `amountToReplenish = maxQuota`.
   - `allowances[caller]` is immediately refilled to `maxQuota` in `0` seconds and consumed a second time — allowing **`2x maxAllowances` (`200%` of the configured rate limit)** to be minted or shifted in a single atomic transaction.

### 2. Root Cause #2: Unprivileged Public `currentAllowance(address)` Replenishment Truncation (`CWE-284` / `CWE-682`)
In `RateLimit.sol` (lines 136–139), `currentAllowance(address caller)` is a state-mutating `public` function with **no access control**:

```solidity
    function currentAllowance(address caller) public returns (uint256) {
        _replenishAllowance(caller);
        return allowances[caller];
    }
```

Whenever `allowances[caller] < maxAllowances[caller]`, `_getReplenishAmount(caller)` computes integer division:
```solidity
uint256 amountToReplenish = (secondsSinceAllowanceSet * maxAllowances[caller]) / intervals[caller];
```
And whenever `amountToReplenish >= 1`, `_replenishAllowance` overwrites `allowancesLastSet[caller] = block.timestamp`, permanently discarding the fractional time remainder `(secondsSinceAllowanceSet * maxAllowances[caller]) % intervals[caller]`. Because `currentAllowance(caller)` is `public`, any unprivileged external address can repeatedly call `currentAllowance(caller)` right after `amountToReplenish` crosses `1` unit, destroying up to ~50% of the accrued replenishment time on every poke (`test_PoC2_Unprivileged_External_Allowance_Truncation_Via_currentAllowance`).

### 3. Recommended Fix
1. When `allowances[caller] == maxAllowances[caller]` inside `_replenishAllowance(caller)`, always set `allowancesLastSet[caller] = block.timestamp;` before returning so that spending from a full allowance starts the replenishment timer from the moment of spend.
2. Advance `allowancesLastSet[caller]` only by the time corresponding to the replenished amount (`allowancesLastSet[caller] += (amountToReplenish * intervals[caller]) / maxAllowances[caller]`) or restrict `currentAllowance(address)` to `onlyCallers` while providing `estimatedAllowance(address)` as the `view` getter (and cap `estimatedAllowance` at `maxAllowances[caller]`).
