// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFakeLendingPool} from "./IFakeLendingPool.sol";

/// @title FakeLendingPool
/// @notice Aave-shape demo lending pool. **Intentionally vulnerable** so the
///         Phulax demo has something real to defend against:
///
///           1. Single-block oracle manipulation. `setAssetPrice` is callable
///              by anyone in the same block they want to borrow with the
///              skewed price. Used to demo a borrow-and-drain.
///           2. Reentrancy on `withdraw`. State is mutated AFTER the external
///              token transfer, so a token with a transfer hook (or a malicious
///              `to` address acting as a wrapper) can re-enter and pull more
///              than the user is owed.
///           3. Liquidation at oracle-quoted price. `liquidate` lets anyone
///              repay an underwater borrower's debt and seize their full
///              collateral. Combined with vuln #1, an attacker can crash the
///              oracle to push healthy positions underwater and farm the
///              liquidation bonus.
///           4. Admin rug. `withdrawReserves` lets the admin EOA sweep any
///              reserve to an arbitrary recipient. No timelock, no multisig.
///
///         These vulns must remain reachable in tests — they ARE the demo.
///         Do not "fix" them. Do not promote this contract into the KeeperHub
///         `protocols/` plugin set; it is a deployed demo target only.
contract FakeLendingPool is IFakeLendingPool {
    using SafeERC20 for IERC20;

    // user => reserve => supplied amount (1:1 with shares for simplicity).
    mapping(address => mapping(address => uint256)) public supplied;
    // user => reserve => borrowed amount.
    mapping(address => mapping(address => uint256)) public borrowed;
    // reserve => oracle price, 1e18 precision.
    mapping(address => uint256) internal price;

    // collateral factor in BPS (e.g. 8000 = 80%).
    uint16 public constant COLLATERAL_FACTOR_BPS = 8000;
    // liquidation triggers when borrowedValue/collateralValue > threshold.
    uint16 public constant LIQUIDATION_THRESHOLD_BPS = 8500;

    address public immutable admin;

    error NotAdmin();
    error NoDebt();
    error Healthy();

    constructor() {
        admin = msg.sender;
    }

    /// @notice INTENTIONAL VULN #1 — anyone can move the oracle. Used by the
    ///         demo's draining tx to inflate borrow capacity in-block.
    function setAssetPrice(address asset, uint256 newPrice) external {
        price[asset] = newPrice;
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        return price[asset];
    }

    function supply(address asset, uint256 amount, address onBehalfOf) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        supplied[onBehalfOf][asset] += amount;
        emit Supply(asset, msg.sender, onBehalfOf, amount);
    }

    function borrow(address asset, uint256 amount) external {
        // INTENTIONAL: collateral is oracle-priced, borrow amount is in token
        // units. The asymmetry is what makes single-asset oracle-manipulation
        // drains land — pump price[asset], collateral value spikes, the borrow
        // side stays denominated in tokens, attacker walks away with reserves.
        // Same shape as the Mango / Cream oracle exploits.
        uint256 collateralValue = supplied[msg.sender][asset] * price[asset] / 1e18;
        uint256 maxBorrow = collateralValue * COLLATERAL_FACTOR_BPS / 10_000;
        require(borrowed[msg.sender][asset] + amount <= maxBorrow, "undercollateralised");

        borrowed[msg.sender][asset] += amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Borrow(asset, msg.sender, amount, collateralValue);
    }

    /// @notice INTENTIONAL VULN #2 — checks-effects-interactions deliberately
    ///         violated. Token transfer happens BEFORE the supplied[] balance
    ///         is decremented, so a hook on the token (or a malicious `to`)
    ///         can call back into `withdraw` and drain again.
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        uint256 bal = supplied[msg.sender][asset];
        require(amount <= bal, "exceeds balance");

        // External call FIRST — reentrancy door.
        IERC20(asset).safeTransfer(to, amount);

        // State mutation AFTER. A reentrant call sees the original `bal`.
        supplied[msg.sender][asset] = bal - amount;
        emit Withdraw(asset, msg.sender, to, amount);
        return amount;
    }

    /// @notice INTENTIONAL VULN #3 — liquidation reads collateral value from
    ///         the manipulable oracle. Crash `price[asset]` and previously
    ///         healthy borrowers tip underwater; anyone can then `liquidate`,
    ///         repay the (token-unit) debt, and seize the full token-unit
    ///         collateral. Liquidator profits the spread between the depressed
    ///         oracle price and real-market value of the seized collateral.
    function liquidate(address user, address asset) external returns (uint256 seized) {
        uint256 debt = borrowed[user][asset];
        if (debt == 0) revert NoDebt();

        uint256 collateralValue = supplied[user][asset] * price[asset] / 1e18;
        // borrow amount is treated as USD-pegged token units (see `borrow`).
        // Position is unhealthy if borrowedValue * 10000 > collateralValue * threshold.
        if (debt * 10_000 <= collateralValue * LIQUIDATION_THRESHOLD_BPS) revert Healthy();

        // Liquidator repays the full debt in token units.
        IERC20(asset).safeTransferFrom(msg.sender, address(this), debt);

        // Seize 100% of collateral. Real Aave seizes a partial close + bonus;
        // we take everything for demo brevity — same exploit shape, less code.
        seized = supplied[user][asset];
        supplied[user][asset] = 0;
        borrowed[user][asset] = 0;
        IERC20(asset).safeTransfer(msg.sender, seized);
        emit Liquidate(asset, user, msg.sender, seized, debt);
    }

    /// @notice INTENTIONAL VULN #4 — open-ended admin sweep. No timelock, no
    ///         multisig, no recipient whitelist. The admin EOA can pull any
    ///         reserve at any time. Demos a rogue-team / compromised-key rug.
    function withdrawReserves(address asset, address to) external returns (uint256 amount) {
        if (msg.sender != admin) revert NotAdmin();
        amount = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransfer(to, amount);
        emit ReservesSwept(asset, msg.sender, to, amount);
    }

    function balanceOf(address asset, address user) external view returns (uint256) {
        return supplied[user][asset];
    }

    function borrowedOf(address asset, address user) external view returns (uint256) {
        return borrowed[user][asset];
    }
}
