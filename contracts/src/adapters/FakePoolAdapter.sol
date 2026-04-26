// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAdapter} from "./IAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFakeLendingPool} from "../pools/IFakeLendingPool.sol";

/// @title FakePoolAdapter
/// @notice Adapter shim around `FakeLendingPool` exposing the IAdapter shape.
///
///         The adapter is the supplier of record at the pool — `pool.supply`
///         registers `address(this)` as the position holder. Per-PhulaxAccount
///         bookkeeping lives in `_supplied` so multiple accounts can share one
///         adapter without their balances colliding at the pool layer.
contract FakePoolAdapter is IAdapter {
    using SafeERC20 for IERC20;

    IFakeLendingPool public immutable pool;
    address public immutable underlying;

    // PhulaxAccount address => deposited amount (1:1 with pool shares).
    mapping(address => uint256) internal _supplied;

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
        pool.supply(underlying, amount, address(this));
        _supplied[msg.sender] += amount;
    }

    function withdrawAll() external returns (uint256 returned) {
        uint256 bal = _supplied[msg.sender];
        if (bal == 0) return 0;
        _supplied[msg.sender] = 0;
        returned = pool.withdraw(underlying, bal, msg.sender);
    }

    function balanceOf(address account) external view returns (uint256) {
        return _supplied[account];
    }
}
