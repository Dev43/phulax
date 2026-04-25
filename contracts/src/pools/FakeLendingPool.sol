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
        // Collateral check uses the manipulable oracle — vuln #1's payload.
        uint256 collateralValue = supplied[msg.sender][asset] * price[asset] / 1e18;
        uint256 borrowedValue = borrowed[msg.sender][asset] * price[asset] / 1e18;
        uint256 maxBorrowValue = collateralValue * COLLATERAL_FACTOR_BPS / 10_000;
        require(borrowedValue + (amount * price[asset] / 1e18) <= maxBorrowValue, "undercollateralised");

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

    function balanceOf(address asset, address user) external view returns (uint256) {
        return supplied[user][asset];
    }
}
