# Sky (MakerDAO) Immunefi Bug Bounty Submission Report

- **Program**: `https://immunefi.com/bug-bounty/sky/`
- **Target Asset (In-Scope `[2026-07-06]`)**:
  - Repository: `https://github.com/sky-ecosystem/diamond-pau` (`dev` branch, `src/facets/uniswap-v3/UniswapV3Facet.sol`)
  - Live Ethereum Mainnet `PAU_BEACON`: `0x829dC2b7E94B1954F0764E573f2E0d45Afa28199`
  - Live Ethereum Mainnet `UNISWAP_V3_FACET`: `0x445D9Dc752F269Be48250f1A180CAC4c61cE4bab` (`VERSION = "1.0.0"`, `20,042 bytes` runtime bytecode — 100% opcode-identical to `src/facets/uniswap-v3/UniswapV3Facet.sol`)
  - Also shared by live Mainnet `SPARK_ALM_CONTROLLER` (`0x5c46Fc65855c0C7465a1EA85EEA0B24B601502D3`, controlling `SPARK_ALM_PROXY` `0x1601843c5E9bC251A3272907010AFa41Fa18347E` with `$684.11M+ sUSDS`) and `GROVE_ALM_CONTROLLER` (`0xfd9dEA9a8D5B955649579Af482DB7198A392A9F5`)
- **Threat Model Alignment**:
  - Per `diamond-pau/docs/THREAT_MODEL.md` and `diamond-pau/docs/SECURITY.md`:
    > *"The `ALLOCATOR_ROLE` is untrusted / assumed compromisable at any time. SubDAO `Controller` facets must strictly enforce `maxSlippage`, TWAP bounds (`twapSecondsAgo`), and `RateLimits` so that a compromised `ALLOCATOR_ROLE` key cannot extract value from `ALMProxy` via price manipulation or sandwich attacks."*
- **Verification Status**: **100% Verified via Live Ethereum Mainnet-Fork Foundry PoC (`test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol`, 3/3 Tests Passing, Zero Mocks)**

---

## Executive Summary

We identified and verified on an Ethereum Mainnet fork **two coupled mathematical flaws** in `UniswapV3Facet.sol` (`0x445D9Dc752F269Be48250f1A180CAC4c61cE4bab`) that together allow a compromised `ALLOCATOR_ROLE` (or an attacker sandwiching `ALLOCATOR_ROLE` calls) to **completely bypass both the 30-minute TWAP oracle check (`twapSecondsAgo`) and the `maxSlippage` protection** during `addLiquidity` and `removeLiquidity`, while simultaneously **causing honest `removeLiquidity` calls to revert on tiny normal market tick shifts**:

1. **`SKY-VULN-01` (`UniswapV3Facet.addLiquidity` — Unbounded `target` vs. TWAP `expectedAmounts` & `min(liquidity0, liquidity1)` Collapse)**:
   - `_validateAddLiquidityParameters` (`src/facets/uniswap-v3/UniswapV3Facet.sol`, lines `659–748`) computes `expectedLiquidity` at `twapTick` via `LiquidityAmounts.getLiquidityForAmounts(sqrtTWAPPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96, target.amount0, target.amount1)` and then derives `expectedAmounts = getAmountsForLiquidity(sqrtTWAPPriceX96, ..., expectedLiquidity)`.
   - Crucially, `_validateAddLiquidityParameters` **only checks `min.amount0 >= expectedAmounts.amount0 * maxSlippage / 1e18` and `min.amount1 >= expectedAmounts.amount1 * maxSlippage / 1e18` — it NEVER checks that `target` (`amount0Desired`, `amount1Desired`) is proportional to `expectedAmounts`!**
   - Because `getLiquidityForAmounts` returns `min(liquidity0_TWAP, liquidity1_TWAP)` whenever `ticks.lower < twapTick < ticks.upper`:
     - **Case A (`expectedLiquidity == 0`)**: Passing `target = (10,000,000 DAI, 0 USDC)` when `ticks.lower < twapTick < ticks.upper` causes `liquidity1_TWAP = 0`, so `expectedLiquidity = min(liquidity0_TWAP, 0) = 0`, `expectedAmounts = (0, 0)`, and `min = (0, 0)` passes `_checkSlippage(0, 0, maxSlippage)` for **any** `maxSlippage` (even `0.999e18` = `0.1%`).
     - **Case B (`expectedLiquidity > 0` and `spotTick` strictly inside `[ticks.lower, ticks.upper]`)**: Passing `target = (10,000,000 DAI, 15,000 USDC)` when `twapTick` is near `ticks.lower` yields `expectedLiquidity > 0` with `expectedAmounts.amount0 = 303.57 DAI`, allowing `min.amount0 = 303.27 DAI`. When an attacker flash-manipulates `spotTick` down inside `[ticks.lower, ticks.upper]` (`spotTick = ticks.lower + 1`), `NonfungiblePositionManager.mint` uses the **manipulated spot price** and consumes **`7,921,380.05 DAI`** (**26,094x** more `DAI` than the TWAP expected `303.57 DAI`!) at the manipulated spot price.

2. **`SKY-VULN-02` (`UniswapV3Facet.removeLiquidity` — Missing TWAP Reference & Inverted `_checkSlippage` Direction)**:
   - `removeLiquidity` (`src/facets/uniswap-v3/UniswapV3Facet.sol`, lines `451–515`) **never queries `twapTick` or `LiquidityAmounts.getAmountsForLiquidity` at the TWAP price**.
   - Instead, it calls `NonfungiblePositionManager.decreaseLiquidity` (which computes `(amounts.amount0, amounts.amount1)` at the **current manipulated spot price** and enforces `amounts.amount >= min.amount`), and then calls:
     ```solidity
     _checkSlippage(amounts.amount0, min.amount0, poolConfig.maxSlippage);
     _checkSlippage(amounts.amount1, min.amount1, poolConfig.maxSlippage);
     ```
     where `_checkSlippage(amount, minAmount, maxSlippage)` (`lines 972–978`) enforces:
     ```solidity
     require(minAmount >= Math.mulDiv(amount, maxSlippage, 1e18), "UniswapV3Facet/min-amount-below-bound");
     ```
   - This creates a **double failure**:
     1. **Zero protection against spot manipulation**: Combined with `decreaseLiquidity`'s check (`amount >= minAmount`), the code constrains `minAmount` to lie in `[actualSpotAmount * maxSlippage / 1e18, actualSpotAmount]`. A compromised allocator simply sets `min = actualSpotAmounts` at the manipulated spot price, satisfying `actualSpotAmount >= actualSpotAmount * maxSlippage / 1e18` as a mathematical tautology (`1e18 >= maxSlippage`) at **any** manipulated spot price!
     2. **Honest allocator DoS (`"UniswapV3Facet/min-amount-below-bound"`)**: Because `_checkSlippage` places an **upper bound** on `actualAmount` (`actualAmount <= minAmount * 1e18 / maxSlippage`), if an honest allocator submits `removeLiquidity` with `min = expectedNow * maxSlippage / 1e18` (`2%` slippage tolerance) and a small normal trade shifts the pool tick slightly inside `[ticks.lower, ticks.upper]` so that `actualAmount0` increases by `> 2%`, `removeLiquidity` **reverts** even though the proxy received **more** `token0` than `min.amount0`!

---

## Vulnerable Code Analysis (`src/facets/uniswap-v3/UniswapV3Facet.sol`)

### 1. `_validateAddLiquidityParameters` (`lines 659–748`)

```solidity
(int24 twapTick, ) = OracleLibrary.consult(pool, poolConfig.twapSecondsAgo);

uint160 sqrtPriceX96      = TickMath.getSqrtRatioAtTick(twapTick);
uint160 sqrtPriceLowerX96 = TickMath.getSqrtRatioAtTick(ticks.lower);
uint160 sqrtPriceUpperX96 = TickMath.getSqrtRatioAtTick(ticks.upper);

uint128 expectedLiquidity = LiquidityAmounts.getLiquidityForAmounts(
    sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    target.amount0,
    target.amount1
);

TokenAmounts memory expectedAmounts;

(expectedAmounts.amount0, expectedAmounts.amount1) = LiquidityAmounts.getAmountsForLiquidity(
    sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    expectedLiquidity
);

_checkSlippage(expectedAmounts.amount0, min.amount0, poolConfig.maxSlippage);
_checkSlippage(expectedAmounts.amount1, min.amount1, poolConfig.maxSlippage);
```

- When `sqrtPriceLowerX96 < sqrtPriceX96 < sqrtPriceUpperX96`, `LiquidityAmounts.getLiquidityForAmounts` computes:
  $$L_0 = \text{getLiquidityForAmount0}(\sqrt{P_{\text{TWAP}}}, \sqrt{P_u}, \text{target}_0), \quad L_1 = \text{getLiquidityForAmount1}(\sqrt{P_l}, \sqrt{P_{\text{TWAP}}}, \text{target}_1)$$
  and returns $L_{\text{expected}} = \min(L_0, L_1)$.
- Consequently, if $L_1 \ll L_0$ (or $L_1 = 0$), then $\text{expectedAmounts.amount0} = \text{getAmount0ForLiquidity}(\sqrt{P_{\text{TWAP}}}, \sqrt{P_u}, L_1) \ll \text{target.amount0}$ (or $0$).
- Yet `NonfungiblePositionManager.mint` / `increaseLiquidity` receives the **full `target.amount0`** (`amount0Desired = target.amount0`) and computes actual liquidity at the **current spot price** $\sqrt{P_{\text{spot}}}$, consuming up to **100% of `target.amount0`** at a flash-manipulated spot price while `min.amount0` is bounded only against $\text{expectedAmounts.amount0} \approx 0$!

### 2. `removeLiquidity` (`lines 451–515`) & `_checkSlippage` (`lines 972–978`)

```solidity
(amounts.amount0, amounts.amount1) = INonfungiblePositionManager(positionManager).decreaseLiquidity(
    INonfungiblePositionManager.DecreaseLiquidityParams({
        tokenId:    tokenId,
        liquidity:  liquidity,
        amount0Min: min.amount0,
        amount1Min: min.amount1,
        deadline:   deadline
    })
);

_checkSlippage(amounts.amount0, min.amount0, poolConfig.maxSlippage);
_checkSlippage(amounts.amount1, min.amount1, poolConfig.maxSlippage);
```

- `amounts.amount0` and `amounts.amount1` are the **actual spot outputs** returned by `decreaseLiquidity`, not TWAP-derived expected outputs.
- Checking `min.amount >= amounts.amount * maxSlippage / 1e18` never compares `amounts` against `twapTick` and reverts honest withdrawals whenever either token's received amount increases slightly above `min.amount / maxSlippage`.

---

## Live Ethereum Mainnet-Fork Foundry PoC (`test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol`)

### Environment & Execution Command

- **Repository**: `https://github.com/sky-ecosystem/diamond-pau` (`dev` branch, Solc `0.8.34`)
- **Fork Block**: Ethereum Mainnet block `22,181,045` (`UNISWAP_V3_DAI_USDC_POOL` `0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168`)
- **Zero `vm.mockCall`**: All swaps, mints, burns, and TWAP consultations execute against live Uniswap V3 Mainnet contracts (`UNISWAP_V3_DAI_USDC_POOL`, `UNISWAP_V3_ROUTER`, `UNISWAP_V3_POSITION_MANAGER`).

```bash
forge test --match-path test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol -vv
```

### Actual Foundry Output (3 Passed, 0 Failed)

```text
Ran 3 tests for test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol:PoC_UniswapV3_SlippageAndTWAPBypassTest
[PASS] test_PoC1_addAndRemoveLiquidity_zeroExpectedLiquidityBypass() (gas: 3038657)
Logs:
  === PoC 1: Zero expectedLiquidity TWAP & Slippage Bypass (maxSlippage = 0.1%) ===
  ALMProxy Initial Value (USD 1e18) : 10000000000000000000000000
  ALMProxy Final Value   (USD 1e18) : 9803853746672470939449464
  ALMProxy Net Loss      (USD 1e18) : 196146253327529060550536
  Max Allowed Loss @ 0.1% (USD 1e18): 10000000000000000000000
  Attacker Net Profit    (DAI 1e18) : 191806784780528822773969

[PASS] test_PoC2_addLiquidity_nonZeroExpectedLiquidity_inRangeSpot_bypassesTWAP() (gas: 3304396)
Logs:
  === PoC 2: Non-Zero expectedLiquidity & In-Range Spot Tick Bypass (maxSlippage = 0.1%) ===
  expectedLiquidity at TWAP         : 30133457007200699639
  TWAP expectedAmount0 (DAI 1e18)   : 303571467861095370116
  Actual minted amount0 (DAI 1e18)  : 7921380054718193884031654
  ALMProxy Net Loss    (USD 1e18)   : 173245058759876166677946
  Attacker Net Profit  (DAI 1e18)   : 169395220263567549844991

[PASS] test_PoC3_removeLiquidity_invertedSlippageCheck_revertsHonestAllocatorOnSmallTickShift() (gas: 2290256)
Suite result: ok. 3 passed; 0 failed; 0 skipped; finished in 5.83s (11.53s CPU time)
```

### Summary of Verified PoC Results

| Test Case | Configuration | Expected TWAP / Max Slippage Bound | Actual On-Chain Outcome |
| :--- | :--- | :--- | :--- |
| **`test_PoC1`** (`expectedLiquidity == 0`) | `maxSlippage = 0.999e18` (`0.1%`), `twapSecondsAgo = 1800` (`30 min`), `$10,000,000 DAI` | Max allowed loss: `$10,000.00` (`0.1%`) | `ALMProxy` loses **`$196,146.25`** (**`1.961%` = `19.6x` maxSlippage**); Attacker nets **`+$191,806.78 DAI`** profit in 1 block |
| **`test_PoC2`** (`expectedLiquidity > 0` & in-range `spotTick`) | `maxSlippage = 0.999e18` (`0.1%`), `twapSecondsAgo = 1800` (`30 min`), `spotTick = tick.lower + 1` | TWAP `expectedAmount0 = 303.57 DAI` (`min.amount0 = 303.27 DAI`) | `mint` consumes **`7,921,380.05 DAI`** (**`26,094x` TWAP expectation**); `ALMProxy` loses **`$173,245.06`**; Attacker nets **`+$169,395.22 DAI`** profit |
| **`test_PoC3`** (Honest `removeLiquidity` DoS) | `maxSlippage = 0.98e18` (`2.0%`), honest `min = expected * 0.98` | Should succeed when normal trade shifts tick slightly inside range | **Reverts** with `"UniswapV3Facet/min-amount-below-bound"` because `actualAmount0 > honestMin.amount0 / 0.98` |

---

## Recommended Remediation

### 1. Fix `_validateAddLiquidityParameters` (`src/facets/uniswap-v3/UniswapV3Facet.sol`)

Require `expectedLiquidity > 0` and enforce that `expectedAmounts` at the TWAP price cannot deviate from `target` (`amount0Desired`, `amount1Desired`) by more than `maxSlippage` (so `target` cannot be skewed relative to the TWAP ratio to shrink `expectedAmounts`), or check `min` directly against `target`:

```solidity
require(expectedLiquidity > 0, "UniswapV3Facet/zero-expected-liquidity");

// Ensure `target` itself matches the TWAP ratio within `maxSlippage`, and `min` is bounded against `target`:
_checkSlippage(target.amount0, min.amount0, poolConfig.maxSlippage);
_checkSlippage(target.amount1, min.amount1, poolConfig.maxSlippage);
_checkSlippage(target.amount0, expectedAmounts.amount0, poolConfig.maxSlippage);
_checkSlippage(target.amount1, expectedAmounts.amount1, poolConfig.maxSlippage);
```

### 2. Fix `removeLiquidity` (`src/facets/uniswap-v3/UniswapV3Facet.sol`)

Compute `expectedAmounts` at the pool's TWAP tick (`OracleLibrary.consult(pool, poolConfig.twapSecondsAgo)`) using `LiquidityAmounts.getAmountsForLiquidity(sqrtTWAPPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96, liquidity)` and validate `min` (or `amounts`) against `expectedAmounts` at the TWAP price rather than comparing `min` against `amounts`:

```solidity
(int24 twapTick, ) = OracleLibrary.consult(pool, poolConfig.twapSecondsAgo);

TokenAmounts memory expectedAmounts;
(expectedAmounts.amount0, expectedAmounts.amount1) = LiquidityAmounts.getAmountsForLiquidity(
    TickMath.getSqrtRatioAtTick(twapTick),
    TickMath.getSqrtRatioAtTick(position.tickLower),
    TickMath.getSqrtRatioAtTick(position.tickUpper),
    liquidity
);

_checkSlippage(expectedAmounts.amount0, min.amount0, poolConfig.maxSlippage);
_checkSlippage(expectedAmounts.amount1, min.amount1, poolConfig.maxSlippage);
```
