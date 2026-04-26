// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IFlashBorrower {
    function onFlashLoan(address asset, uint256 amount, bytes calldata data) external;
}

/// @title FlashLender
/// @notice Minimal flash-loan source used in `ExploitFlashLoan.t.sol`. Lends
///         any asset it holds with no fee, requires the borrower to restore
///         the pre-loan balance before the call returns. Separate from the
///         demo `FakeLendingPool` so the lending pool itself can be drained
///         during the callback without violating the lender's invariant.
contract FlashLender {
    using SafeERC20 for IERC20;

    function flashLoan(address asset, uint256 amount, bytes calldata data) external {
        uint256 balBefore = IERC20(asset).balanceOf(address(this));
        require(balBefore >= amount, "insufficient liquidity");

        IERC20(asset).safeTransfer(msg.sender, amount);
        IFlashBorrower(msg.sender).onFlashLoan(asset, amount, data);

        require(IERC20(asset).balanceOf(address(this)) >= balBefore, "loan not repaid");
    }
}
