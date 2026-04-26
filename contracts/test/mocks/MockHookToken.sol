// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITokenReceiver {
    function onTokensReceived(address from, uint256 amount) external;
}

/// @title MockHookToken
/// @notice ERC20 with an ERC777-style `tokensReceived` callback on the
///         destination. Used in `ExploitReentrancy.t.sol` to drive the
///         reentrancy door in `FakeLendingPool.withdraw`. Real-world parallels:
///         CREAM Finance ERC777 reentrancy ($130M, 2021), Lendf.Me ($25M, 2020).
contract MockHookToken is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev OZ v5 hooks here on every transfer. Best-effort callback — a
    ///      reverting receiver just means no reentry, not a stuck transfer.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to.code.length > 0) {
            try ITokenReceiver(to).onTokensReceived(from, value) {} catch {}
        }
    }
}
