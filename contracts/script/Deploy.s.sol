// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PhulaxAccount} from "../src/PhulaxAccount.sol";
import {Hub} from "../src/Hub.sol";
import {PhulaxINFT} from "../src/inft/PhulaxINFT.sol";
import {FakeLendingPool} from "../src/pools/FakeLendingPool.sol";
import {FakePoolAdapter} from "../src/adapters/FakePoolAdapter.sol";
import {DemoAsset} from "../src/DemoAsset.sol";

/// @notice Deploy the Phulax demo set to 0G testnet (Galileo, chain id 16602).
///
///         Self-contained: deploys a fresh DemoAsset ERC20 unless one is
///         passed in via DEMO_ASSET_ADDRESS. After running, the printed
///         addresses go into:
///           - keeperhub workflow JSON (FakeLendingPool address)
///           - agent .env (PhulaxAccount + Hub + DemoAsset)
///           - web .env.local (Hub + DemoAsset)
///
///         Run with `--verify` so the contracts show up on the 0G explorer
///         and KeeperHub workflows can use `abi-with-auto-fetch`. The ABI
///         JSON files in `contracts/abis/` (produced by `pnpm run abis`) are
///         the paste-in fallback if verification flakes.
///
///         Env vars:
///           PRIVATE_KEY                 deployer hot key (funded on Galileo)
///           AGENT_ADDRESS               guardian agent address (single-selector)
///           DEMO_ASSET_ADDRESS          (optional) reuse a pre-deployed ERC20
///           POOL_SEED_AMOUNT            (optional) DemoAsset units to mint+supply
///                                       into the pool as initial reserves.
///                                       default: 100e18
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address agent = vm.envOr("AGENT_ADDRESS", deployer);
        address existingAsset = vm.envOr("DEMO_ASSET_ADDRESS", address(0));
        uint256 poolSeed = vm.envOr("POOL_SEED_AMOUNT", uint256(100e18));

        vm.startBroadcast(pk);

        Hub hub = new Hub();
        PhulaxINFT inft = new PhulaxINFT();
        FakeLendingPool pool = new FakeLendingPool();

        DemoAsset asset;
        if (existingAsset == address(0)) {
            asset = new DemoAsset("Phulax Demo USD", "pUSD", 18);
        } else {
            asset = DemoAsset(existingAsset);
        }

        FakePoolAdapter adapter = new FakePoolAdapter(address(pool), address(asset));
        pool.setAssetPrice(address(asset), 1e18);

        // Seed the pool with reserves so the first attacker actually has
        // something to drain. Skipped if reusing an external asset that the
        // deployer doesn't have mint rights on.
        if (existingAsset == address(0) && poolSeed > 0) {
            asset.mint(deployer, poolSeed);
            asset.approve(address(pool), poolSeed);
            pool.supply(address(asset), poolSeed, deployer);
        }

        PhulaxAccount account = new PhulaxAccount(deployer, agent);
        account.setAdapter(address(adapter), true);
        hub.register(address(account), deployer);
        hub.setRiskPolicy(address(account), 7000, type(uint256).max);

        vm.stopBroadcast();

        console2.log("chainId           ", block.chainid);
        console2.log("deployer          ", deployer);
        console2.log("agent             ", agent);
        console2.log("Hub               ", address(hub));
        console2.log("PhulaxINFT        ", address(inft));
        console2.log("FakeLendingPool   ", address(pool));
        console2.log("DemoAsset (pUSD)  ", address(asset));
        console2.log("FakePoolAdapter   ", address(adapter));
        console2.log("PhulaxAccount     ", address(account));
        console2.log("pool reserves     ", asset.balanceOf(address(pool)));
    }
}
