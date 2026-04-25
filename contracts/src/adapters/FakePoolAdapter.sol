// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAdapter} from "./IAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFakeLendingPool} from "../pools/IFakeLendingPool.sol";

/// @title FakePoolAdapter
/// @notice Adapter shim around `FakeLendingPool` exposing the IAdapter shape.
contract FakePoolAdapter is IAdapter {
    using SafeERC20 for IERC20;

    IFakeLendingPool public immutable pool;
    address public immutable underlying;

    constructor(address pool_, address underlying_) {
        pool = IFakeLendingPool(pool_);
        underlying = underlying_;
    }

    function asset() external view returns (address) {
        return underlying;
    }

    function deposit(uint256 amount) external {
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(underlying).forceApprove(address(pool), amount);
        pool.supply(underlying, amount, msg.sender);
    }

    function withdrawAll() external returns (uint256 returned) {
        uint256 bal = pool.balanceOf(underlying, msg.sender);
        if (bal == 0) return 0;
        // pool sends underlying directly to msg.sender (the PhulaxAccount /
        // owner). Adapter is non-custodial on the way out.
        returned = pool.withdraw(underlying, bal, msg.sender);
    }

    function balanceOf(address account) external view returns (uint256) {
        return pool.balanceOf(underlying, account);
    }
}
