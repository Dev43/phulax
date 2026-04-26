// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PhulaxAccount} from "../src/PhulaxAccount.sol";
import {Hub} from "../src/Hub.sol";
import {PhulaxINFT} from "../src/inft/PhulaxINFT.sol";
import {FakeLendingPool} from "../src/pools/FakeLendingPool.sol";
import {FakePoolAdapter} from "../src/adapters/FakePoolAdapter.sol";

/// @notice Deploy the Phulax demo set to 0G testnet.
///
///         Run with `--verify` so the contracts show up on the 0G explorer
///         and KeeperHub workflows can use `abi-with-auto-fetch`. The ABI
///         JSON files in `contracts/abis/` (produced by `pnpm run abis`) are
///         the paste-in fallback if verification flakes.
///
///         Env vars:
///           PRIVATE_KEY         — deployer hot key
///           AGENT_ADDRESS       — guardian agent address (single-selector)
///           DEMO_ASSET_ADDRESS  — pre-deployed ERC20 used as the demo asset
///                                 (or omit to skip pool wiring)
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address agent = vm.envOr("AGENT_ADDRESS", deployer);
        address demoAsset = vm.envOr("DEMO_ASSET_ADDRESS", address(0));

        vm.startBroadcast(pk);

        Hub hub = new Hub();
        PhulaxINFT inft = new PhulaxINFT();
        FakeLendingPool pool = new FakeLendingPool();

        FakePoolAdapter adapter;
        PhulaxAccount account;
        if (demoAsset != address(0)) {
            adapter = new FakePoolAdapter(address(pool), demoAsset);
            pool.setAssetPrice(demoAsset, 1e18);

            account = new PhulaxAccount(deployer, agent);
            account.setAdapter(address(adapter), true);
            hub.register(address(account), deployer);
            hub.setRiskPolicy(address(account), 7000, type(uint256).max);
        }

        vm.stopBroadcast();

        console2.log("Hub               ", address(hub));
        console2.log("PhulaxINFT        ", address(inft));
        console2.log("FakeLendingPool   ", address(pool));
        if (demoAsset != address(0)) {
            console2.log("FakePoolAdapter   ", address(adapter));
            console2.log("PhulaxAccount     ", address(account));
        }
    }
}
