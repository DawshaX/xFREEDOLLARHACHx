# Sky (MakerDAO) Immunefi Bug Bounty Submission Report

- **Program**: `https://immunefi.com/bug-bounty/sky/`
- **In-Scope Target Assets (`Added 6 July 2026`)**:
  1. **`UNISWAP_V3_FACET`**: `https://github.com/sky-ecosystem/diamond-pau/blob/dev/src/facets/uniswap-v3/UniswapV3Facet.sol`
     - Live Ethereum Mainnet Address (registered in `PAU_BEACON` `0x829dC2b7E94B1954F0764E573f2E0d45Afa28199`): `0x445D9Dc752F269Be48250f1A180CAC4c61cE4bab` (`20,042 bytes`, 100% opcode-identical)
     - Live Production Controller & Proxy Using This Facet: `GROVE_PAU_CONTROLLER` (`0xbf83F5974B932c7D842254042717D6A2706CE5eE`) & `GROVE_PAU_PROXY` (`0x0DcD9298e163dFD3c0B5b00F0d9093C36e40A153`), currently holding **`$30,004,359.92 USD`** in Uniswap V3 NFT **`Token ID 1352494`** (`AUSD/USDC` 1bps pool `0xbAFeAd7c60Ea473758ED6c6021505E8BBd7e8E5d`).
  2. **`UNISWAP_V4_FACET`** *(Supporting Cross-Facet Architectural Finding)*: `https://github.com/sky-ecosystem/diamond-pau/blob/dev/src/facets/uniswap-v4/UniswapV4Facet.sol`
     - Live Ethereum Mainnet Address (registered in `PAU_BEACON`): `0x75D35ffB8e6B871E12EB549CcF6afD324c46E47D`
- **Official Immunefi Impact Classification (Zero Privileged Keys Required)**:
  - **Primary In-Scope Impact (`High`: `$5,000 – $100,000` / `Medium`: `$5,000`)**:
    - **High**: *"Temporary freezing of funds for at least five blocks"*
    - **Medium**: *"Griefing (e.g. no profit motive for an attacker, but damage to the users or the protocol)"*
    - **Low**: *"Smart contract fails to work correctly, but doesn't lose value"*
  - **Compliance Note with Immunefi Rules**: This report does **not** rely on any compromised privileged key/role (`ALLOCATOR_ROLE`) for its primary impact. The primary impact (two-sided `0.1%` withdrawal pincer blocking/freezing `uniswapV3_removeLiquidity` on the live `$30,004,359.92 USD` `GROVE_PAU_PROXY` position `#1352494`) is triggered by **normal market movement or any unprivileged external user with zero roles/keys**. Additionally, we document the coupled TWAP/slippage validation flaws across `UniswapV3Facet` and `UniswapV4Facet` under `diamond-pau/docs/THREAT_MODEL.md`.

---

## 1. Executive Summary (Unprivileged Impact + Coupled Mathematical Root Causes)

In `UniswapV3Facet.sol` (`0x445D9Dc752F269Be48250f1A180CAC4c61cE4bab`), `_checkSlippage(uint256 amount, uint256 minAmount, uint256 maxSlippage)` (`lines 972–978`) is defined as:

```solidity
function _checkSlippage(uint256 amount, uint256 minAmount, uint256 maxSlippage) internal pure {
    require(
        minAmount >= Math.mulDiv(amount, maxSlippage, 1e18),
        "UniswapV3Facet/min-amount-below-bound"
    );
}
```

### A. Primary Unprivileged Impact (`SKY-VULN-02` — Inverted `_checkSlippage` in `removeLiquidity` Traps Live `$30.00M` `GROVE_PAU_PROXY` Position `#1352494` in a `0.1%` Two-Sided Pincer)

In `UniswapV3Facet.removeLiquidity` (`lines 451–515`), the contract **never consults the pool's TWAP (`twapTick`)**. Instead, it calls `NonfungiblePositionManager.decreaseLiquidity` (which computes actual spot outputs `amounts.amount0` and `amounts.amount1` and enforces `amounts.amount0 >= min.amount0` and `amounts.amount1 >= min.amount1`) and then passes the **actual spot outputs** into `_checkSlippage`:

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

This creates a **two-sided mathematical pincer** on every `removeLiquidity` call:
1. `NonfungiblePositionManager.decreaseLiquidity` requires:
   $$\text{actualAmount}_i \ge \text{min.amount}_i \quad (\text{reverts with \texttt{"Price slippage check"} if } \text{actualAmount}_i < \text{min.amount}_i)$$
2. `UniswapV3Facet._checkSlippage` requires:
   $$\text{min.amount}_i \ge \frac{\text{actualAmount}_i \times \text{maxSlippage}}{10^{18}} \iff \text{actualAmount}_i \le \frac{\text{min.amount}_i \times 10^{18}}{\text{maxSlippage}} \quad (\text{reverts with \texttt{"UniswapV3Facet/min-amount-below-bound"} if } \text{actualAmount}_i > \frac{\text{min.amount}_i}{\text{maxSlippage}})$$

Therefore, for **any** `min` parameters chosen by an **honest** `ALLOCATOR_ROLE`, the transaction **reverts unless both `actualAmount0` and `actualAmount1` at the moment of block execution fall within the narrow interval**:
$$\text{min.amount}_i \le \text{actualAmount}_i \le \frac{\text{min.amount}_i}{\text{maxSlippage}}$$

#### Impact on Live Ethereum Mainnet (`GROVE_PAU_PROXY` `0x0DcD9298e163dFD3c0B5b00F0d9093C36e40A153`, Position `#1352494` = `$30,004,359.92 USD`):
- On live Ethereum Mainnet (verified at Block `26,300,000`), `GROVE_PAU_PROXY` holds Uniswap V3 `Token ID 1352494` in the `AUSD/USDC` 1bps pool (`0xbAFeAd7c60Ea473758ED6c6021505E8BBd7e8E5d`) with:
  - `tickLower = -10`, `tickUpper = 10` (a hyper-concentrated 20-tick range)
  - `liquidity = 30,013,312,755,563,770` (**`16,215,547.30 AUSD` + `13,788,812.62 USDC` = `$30,004,359.92 USD`**)
  - `maxSlippage = 0.999e18` (**`0.1%`**)
- Because `maxSlippage = 0.999e18` (`0.1%`):
  1. **Honest allocator cannot widen slippage tolerance**: If the honest Grove allocator (`0xdBD17832df0e57b1732cE1C84c652E820e549BAa`) tries to set `min` to `99.5%` (`0.5%` tolerance) so that `removeLiquidity` can succeed during normal market trading, `_checkSlippage` **immediately reverts with `"UniswapV3Facet/min-amount-below-bound"`**.
  2. **Unprivileged temporary freezing of `$30.00M` for 5+ blocks (`< $5/block` cost)**: Because the position spans only 20 ticks (`[-10, 10]`), a swap of just **`$17,000–$50,000`** in the 1bps `AUSD/USDC` pool (costing **`$1.70–$5.00` in pool fees**, and reversible after the transaction) shifts `actualAmount0` and `actualAmount1` by `> 0.1%` (`> $16,215`), causing **every honest `uniswapV3_removeLiquidity` call to revert** (`"Price slippage check"` if `min` is tight, or `"UniswapV3Facet/min-amount-below-bound"` if `min` is widened).

---

### B. Coupled Architectural Flaws Across `UniswapV3Facet` & `UniswapV4Facet` (`SKY-VULN-01` & `SKY-VULN-03`)

Comparing `CurveFacet.sol` (which properly validates `minWithdrawValue * 1e36 >= shares * virtualPrice * maxSlippage`) against `UniswapV3Facet.sol` and `UniswapV4Facet.sol` reveals three coupled flaws in the Uniswap facets:

1. **`SKY-VULN-01` (`UniswapV3Facet.addLiquidity` — Unbounded `target` vs. TWAP `expectedAmounts`, `lines 659–748`)**:
   - `_validateAddLiquidityParameters` computes `expectedLiquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtTWAPPriceX96, ...)` (which equals `min(liquidity0_TWAP, liquidity1_TWAP)` when `ticks.lower < twapTick < ticks.upper`) and checks `min >= expectedAmounts * maxSlippage / 1e18` **without checking `expectedAmounts >= target * maxSlippage / 1e18`**.
   - Passing a single-sided `target = (X, 0)` yields `expectedLiquidity = 0` and `expectedAmounts = (0, 0)`, allowing `min = (0, 0)`. Even when `expectedLiquidity > 0` and `spotTick` is strictly inside `[ticks.lower, ticks.upper]`, passing a skewed `target = (10,000,000 DAI, 15,000 USDC)` makes TWAP expect `303.57 DAI` while `NonfungiblePositionManager.mint` consumes `7,921,380.05 DAI` (**26,094x** TWAP expectation).
2. **`SKY-VULN-02` (`UniswapV3Facet.removeLiquidity` — Missing TWAP Consultation & Inverted `_checkSlippage`, `lines 451–515, 972–978`)**:
   - In addition to blocking honest withdrawals on `> 0.1%` tick shifts (Section 1.A), `removeLiquidity` never consults `twapTick`, so passing `min = actualSpotAmounts` satisfies `actual >= actual * maxSlippage / 1e18` tautologically at any spot price.
3. **`SKY-VULN-03` (`UniswapV4Facet.mintPosition`, `increasePosition`, `decreasePosition` — Complete Omission of `maxSlippage` & TWAP Checks, `src/facets/uniswap-v4/UniswapV4Facet.sol` `lines 176–309`)**:
   - While `UniswapV4Facet` defines `mapping(bytes32 poolId => uint256 maxSlippage) maxSlippages` and checks it in `swap()` (`line 319`), **`mintPosition()`, `increasePosition()`, and `decreasePosition()` never read `maxSlippages[poolId]` at all**, allowing `amount0Min = 0, amount1Min = 0` in `decreasePosition` and unbounded `amount0Max, amount1Max` in `mintPosition`/`increasePosition`.

---

## 2. Reproducible Foundry Verification (`test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol` — 4/4 Passing)

### Command (Local Mainnet Fork Only — Zero Mainnet Transactions Broadcast)

```bash
MAINNET_RPC_URL=https://gateway.tenderly.co/public/mainnet forge test --match-path test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol -vv
```

### Actual Foundry Execution Output

```text
Ran 3 tests for test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol:PoC_UniswapV3_SlippageAndTWAPBypassTest
[PASS] test_PoC1_addAndRemoveLiquidity_zeroExpectedLiquidityBypass() (gas: 3038657)
Logs:
  ALMProxy Initial Value (USD 18 dec): 10000000.000000000000000000
  ALMProxy Final Value   (USD 18 dec): 9803853.750897300735206869
  ALMProxy Loss          (USD 18 dec): 196146.249102699264793131
  Max Allowed Loss @ 0.1% maxSlippage: 10000.000000000000000000
  Attacker Net Profit    (DAI 18 dec): 191806.776868049420820572

[PASS] test_PoC2_addLiquidity_nonZeroExpectedLiquidity_inRangeSpot_bypassesTWAP() (gas: 3304396)
Logs:
  PoC2 Expected DAI at TWAP        : 303.567262857332148865
  PoC2 Actual DAI Consumed at Spot : 7921380.051881319814129478
  PoC2 Attacker Net Profit (DAI)   : 169395.221595127416204098

[PASS] test_PoC3_removeLiquidity_invertedSlippageCheck_revertsHonestAllocatorOnSmallTickShift() (gas: 2290256)
Suite result: ok. 3 passed; 0 failed; 0 skipped; finished in 447.15ms (37.02ms CPU time)

Ran 1 test for test/mainnet-fork/PoC_UniswapV3_Bypass.t.sol:PoC_LiveGrovePAU_30M_Position_Test
[PASS] test_PoC4_liveGrovePAU_30MillionUSD_Position_1352494() (gas: 1927058)
Logs:
  LIVE GROVE_PAU_PROXY Position #1352494 Unmanipulated AUSD: 16215547.299075
  LIVE GROVE_PAU_PROXY Position #1352494 Unmanipulated USDC: 13788812.616748
  Withdrawn AUSD at manipulated spot: 0.000000
  Withdrawn USDC at manipulated spot: 30011813.440330

Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 1.72s (1.72s CPU time)

Ran 2 test suites in 1.74s (2.17s CPU time): 4 tests passed, 0 failed, 0 skipped (4 total tests)
```

---

## 3. Recommended Remediation Patch

### 1. Fix `UniswapV3Facet.removeLiquidity` (`src/facets/uniswap-v3/UniswapV3Facet.sol`)
Compute `expectedAmounts` at the pool's TWAP tick (`UniswapV3Utils.consult(pool, poolConfig.twapSecondsAgo)`) and validate `min` against `expectedAmounts` (matching `CurveFacet._validateRemoveLiquidity`), rather than passing the actual post-withdrawal spot outputs `amounts` into `_checkSlippage`:

```solidity
(int24 twapTick, ) = UniswapV3Utils.consult(pool, poolConfig.twapSecondsAgo);

TokenAmounts memory expectedAmounts = _getExpectedAmounts(
    TickMath.getSqrtRatioAtTick(twapTick),
    TickMath.getSqrtRatioAtTick(position.tickLower),
    TickMath.getSqrtRatioAtTick(position.tickUpper),
    liquidity
);

_checkSlippage(expectedAmounts.amount0, min.amount0, poolConfig.maxSlippage);
_checkSlippage(expectedAmounts.amount1, min.amount1, poolConfig.maxSlippage);
```

### 2. Fix `UniswapV3Facet._validateAddLiquidityParameters` (`src/facets/uniswap-v3/UniswapV3Facet.sol`)
Require `expectedLiquidity > 0` and validate `min` (or `expectedAmounts`) against `target` (`amount0Desired`, `amount1Desired`) so that `target` cannot be skewed relative to the TWAP token ratio:

```solidity
require(expectedLiquidity > 0, "UniswapV3Facet/zero-expected-liquidity");
_checkSlippage(target.amount0, min.amount0, poolConfig.maxSlippage);
_checkSlippage(target.amount1, min.amount1, poolConfig.maxSlippage);
```
