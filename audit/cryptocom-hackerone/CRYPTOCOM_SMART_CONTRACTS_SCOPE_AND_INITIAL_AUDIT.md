# Crypto.com (HackerOne) — Smart Contracts & Open-Scope Architecture Audit Dossier

- **Program URL**: `https://hackerone.com/crypto`
- **Submission Fee**: **`$0.00` (100% Free — No Deposit, No Stake, No Burn)**
- **Signal Requirement**: `-1.0` (Open to all researchers from day 1)
- **Response Efficiency**: `100%` (**14 hours** average first response, **16 hours** triage, **5 days 1 hour** to bounty)
- **Maximum Bounty**: Up to **`$1,000,000 USD`** (CDCETH Extreme Severity) / **`$2,000,000 USD`** (Exchange Critical)
- **Open Scope Policy**: Enabled (*"Rewards reports for all owned assets based on impact, even if not listed in scope"*)

---

## 1. On-Chain Smart Contracts Inventory (Ethereum Mainnet & Cronos Mainnet)

### 1.1 `CDCETH` — Crypto.com Wrapped Staked ETH (`LiquidETHV1`) on Ethereum Mainnet (Explicit H1 Scope)
- **Proxy Address**: `0xfe18aE03741a5b84e39C295Ac9C856eD7991C38e` (`FiatTokenProxy`)
- **Implementation Address (ZOS Slot)**: `0x7e772ed6e4BfEAE80f2d58e4254f6b6e96669253` (`LiquidETHV1`)
- **Proxy Admin (ZOS Slot)**: `0x328a6715c5c0b4bc2b35fa2320b45605ab7b18bc`
- **Owner / MasterMinter / Pauser / Blacklister**: `0xfdaad168e93b6c776a9adb404b874aacd8937b67`
- **Exchange Rate Oracle**: `0x59b0189d1e5556c97637c505919518bf25df0fc8` (EOA)
- **Current Exchange Rate (`exchangeRate()`)**: `1,077,114,565,575,585,090` (`1.077114565575585090 ETH per CDCETH`)
- **Initialization State**:
  - Proxy (`0xfe18...`): `slot[8] (initialized) = 1`, `slot[18] (_initializedVersion) = 2`
  - Implementation (`0x7e77...`): `slot[8] (initialized) = 1`, `slot[18] (_initializedVersion) = 2`

### 1.2 `CDCBTC` — Crypto.com Wrapped BTC (`FiatTokenV2_1`) on Cronos Mainnet (Explicit H1 Scope — Added 2026-04-22)
- **Proxy Address**: `0x2e53c5586e12a99d4CAE366E9Fc5C14fE9c6495d` (`FiatTokenProxy`)
- **Implementation Address (ZOS Slot)**: `0xDDCDe8DE19284cC5Aab6db5AC6Af1dcdA175f5e2` (`FiatTokenV2_1`)
- **Proxy Admin (ZOS Slot)**: `0x4ffef991fb61f2ff8e47c80fe49cf2b6383fa93a`
- **Owner**: `0x2aa6132df397b3b369fde39f00ca1019c5fb24ad`
- **MasterMinter / Pauser / Blacklister**: `0x4b7b0a16912e2162fdbff5b82b9da948a04b21e8`
- **Initialization State**:
  - Proxy (`0x2e53...`): `slot[8] (initialized) = 1`, `slot[18] (_initializedVersion) = 2`
  - Implementation (`0xDDCDe8...`): `slot[8] (initialized) = 1`, `slot[18] (_initializedVersion) = 2`

### 1.3 `CDCETH` — Crypto.com Wrapped Staked ETH (`LiquidETHV1`) on Cronos Mainnet (Open Scope — `wrapped-tokens-os/deployments/mainnet`)
- **Proxy Address**: `0x7a7c9db510aB29A2FC362a4c34260BEcB5cE3446` (`FiatTokenProxy`, `totalSupply = 9,422.58 CDCETH` / `~$25M+ USD`)
- **Implementation Address (ZOS Slot)**: `0xCC4b4878d64A76616c483a280fBfdBb08b705757` (`LiquidETHV1`)
- **Proxy Admin (ZOS Slot)**: `0xb94baf66fdbfdf1c2413ad4feb0be4810d890dc1`
- **Owner / MasterMinter / Pauser / Blacklister**: `0x6392aadd46a6957cee6ee39c23d8315d8c4e657e`
- **Exchange Rate Oracle**: `0x011c72baa9436ff3de7ad7af543f4f23bdfa2b5e` (EOA)
- **Initialization State**:
  - Proxy (`0x7a7c...`): `slot[8] (initialized) = 1`, `slot[18] (_initializedVersion) = 2`
  - **Implementation (`0xCC4b4878d64A76616c483a280fBfdBb08b705757`)**: **`slot[8] (initialized) = 0`, `slot[18] (_initializedVersion) = 0` (UNINITIALIZED!)**

### 1.4 `CDCBTC` — Crypto.com Wrapped BTC (`FiatTokenV2_1`) on Ethereum Mainnet (Open Scope)
- **Proxy Address**: `0xDDCDe8DE19284cC5Aab6db5AC6Af1dcdA175f5e2` (`FiatTokenProxy`)
- **Implementation Address (ZOS Slot)**: `0x0A84f3855CC1Ae96d7D1c2cFF9600DfD2Fedf13C` (`FiatTokenV2_1`)
- **Proxy Admin (ZOS Slot)**: `0x8c87e65a2d6721aa07cfecfa601a66a3c6371ff2`
- **Owner / MasterMinter / Pauser / Blacklister**: `0x63a41e38901086142c5628d9f7a863c1fedc48e1`
- **Initialization State**:
  - Proxy (`0xDDCDe8...`): `slot[8] (initialized) = 1`, `slot[18] (_initializedVersion) = 2`
  - Implementation (`0x0A84...`): `slot[8] (initialized) = 1`, `slot[18] (_initializedVersion) = 2`

---

## 2. Initial On-Chain Finding (`CDC-NOTE-01`): Uninitialized `LiquidETHV1` Implementation on Cronos Mainnet

### Technical Root Cause
In `https://github.com/crypto-com/wrapped-tokens-os/blob/main/deploy/deploy_staked_token.ts` (lines 103–105):
```ts
// Transfer ownership of the implementation contract to the admin
const liquidETHV1Implementation = await ethers.getContractAt('LiquidETHV1', liquidETHV1Deployment.address);
await (await liquidETHV1Implementation.transferOwnership(admin)).wait();
```
The deployment script transferred `_owner` of the implementation contract `0xCC4b4878d64A76616c483a280fBfdBb08b705757` on Cronos Mainnet to `admin` (`0xb94baf66fdbfdf1c2413ad4feb0be4810d890dc1`), assuming that `transferOwnership` locks the implementation contract.

However, in `FiatTokenV1.sol` (lines 629–656), `initialize(...)` is `public` (without `onlyOwner`), checks only `require(!initialized, "FiatToken: contract is already initialized")`, and explicitly overwrites `_owner` via `setOwner(newOwner)`:
```solidity
function initialize(
    string memory tokenName,
    string memory tokenSymbol,
    string memory tokenCurrency,
    uint8 tokenDecimals,
    address newMasterMinter,
    address newPauser,
    address newBlacklister,
    address newOwner
) public {
    require(!initialized, "FiatToken: contract is already initialized");
    ...
    setOwner(newOwner);
    initialized = true;
}
```
Furthermore, `LiquidETHV1.initializeV2(address newOracle, uint256 initialExchangeRate)` and `FiatTokenV2_1.initializeV2_1(address lostAndFound)` are also uncalled (`_initializedVersion == 0`).

### Impact Evaluation
- Any unprivileged external address on Cronos Mainnet can call `initialize(...)`, `initializeV2(...)`, and `initializeV2_1(...)` on `0xCC4b4878d64A76616c483a280fBfdBb08b705757` to overwrite `_owner` and become `owner`, `masterMinter`, `pauser`, `blacklister`, and `oracle` of the `LiquidETHV1` implementation contract.
- Because `LiquidETHV1` does **not** contain `selfdestruct` or `delegatecall`, seizing the implementation contract's own storage does not corrupt the `FiatTokenProxy` (`0x7a7c9db510aB29A2FC362a4c34260BEcB5cE3446`) storage directly, making this a **Low / Defense-in-Depth** issue on its own unless paired with an off-chain service or periphery contract that reads directly from the implementation contract (`exchangeRate()`, `oracle()`, or EIP-712 `DOMAIN_SEPARATOR()`).

---

## 3. Auxiliary Smart Contracts in `crypto-com/wrapped-tokens-os`

In addition to `FiatTokenProxy`, `FiatTokenV2_1`, and `LiquidETHV1`, the official repository (`crypto-com/wrapped-tokens-os`) contains:
1. **`MintForwarder.sol` & `RateLimit.sol`**:
   - Sliding-window rate-limiter (`bucketInterval`, `limitPerPeriod`) that wraps `IMintableERC20.mint(_to, _amount)`.
   - Uses `currentIntervalIndex = (block.timestamp - windowStartTime) / bucketInterval` and tracks `mintAmounts[intervalIndex]`.
2. **`ExchangeRateUpdater.sol`**:
   - Periphery contract designed to hold the `oracle` role of `LiquidETHV1` and enforce `updateLimitPerPeriod` (`MAX_EXCHANGE_RATE_CHANGE = 2e15` / `0.2%`) and `disallowDecreaseExchangeRate`.
   - **On-Chain Verification**: Currently, both Ethereum `CDCETH` (`oracle = 0x59b0189d1e5556c97637c505919518bf25df0fc8`) and Cronos `CDCETH` (`oracle = 0x011c72baa9436ff3de7ad7af543f4f23bdfa2b5e`) use **EOAs** as `oracle()`, not `ExchangeRateUpdater` contracts.
3. **`crypto-com/facilitator-client-ts` (Cronos X402 Payment Facilitator)** & **`crypto-com/cdcx-cli` (Crypto.com Exchange CLI + MCP Server)**:
   - Active 2026 TypeScript/Rust repositories interacting with `USDCe` (`EIP-3009 TransferWithAuthorization`) on Cronos Mainnet and `api.crypto.com`.
