// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Permissionless-mint ERC20 used by the testnet demo. The web UI lets
///         the connected wallet self-mint a balance before depositing into
///         FakeLendingPool — saves us a faucet drip per demo run. Not for
///         production; intentionally has no access control on `mint`.
contract DemoAsset is ERC20 {
    uint8 private immutable DEC;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        DEC = d;
    }

    function decimals() public view override returns (uint8) {
        return DEC;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
