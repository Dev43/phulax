// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PhulaxINFT} from "../src/inft/PhulaxINFT.sol";

/// @notice Mint a reference Phulax Guardian iNFT (ERC-7857-shaped) on Galileo.
///
///         Required by `tasks/todo.md` §14.B.9 / `STRATEGY.md` §9 deliverables.
///         The token URI points at the publish-log anchor in 0G Storage that
///         packages {model_hash, weights, adapter, eval, dataset_sha256,
///         template_version, provider, task_id, timestamp} — see
///         `ml/upload/og_storage.py` and `ml/artifacts.json#publish_log`.
///
///         Env vars (all optional, sane defaults baked in for the live
///         testnet deploy):
///           PRIVATE_KEY              deployer hot key (funded on Galileo)
///           PHULAX_INFT_ADDRESS      defaults to the 2026-04 deploy address
///           PHULAX_ACCOUNT_ADDRESS   guardian account bound to this token
///           INFT_RECIPIENT           defaults to deployer
///           INFT_METADATA_URI        defaults to og://<publish-log>/<key>
///
///         Run with `--priority-gas-price 2gwei` (Galileo minimum).
contract MintINFT is Script {
    // Deployed 2026-04 on chain id 16602 (see contracts/README.md table and
    // contracts/broadcast/Deploy.s.sol/16602/run-latest.json).
    address constant DEFAULT_INFT = 0xe5c3e4b205844EFe2694949d5723aa93B7F91616;
    address constant DEFAULT_ACCOUNT = 0xA70060465c1cD280E72366082fE20C7618C18a66;

    // Mirror of ml/artifacts.json#publish_log as of 2026-05-02. The streamId
    // is the receipt log; the key wraps model_hash. Anyone can fetch the
    // entry and reconstruct {weights_sha256, adapter_cid, eval_cid, dataset,
    // template_version} from it.
    string constant DEFAULT_URI =
        "og://0x7070707070707070707070707070707070707070707070707070707070707002"
        "/phulax/publish/0x0f11b81a69774f2cc4c657fb6524d05cf28e6996c52f8f68120f154138ae3676";

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address inftAddr = vm.envOr("PHULAX_INFT_ADDRESS", DEFAULT_INFT);
        address accountAddr = vm.envOr("PHULAX_ACCOUNT_ADDRESS", DEFAULT_ACCOUNT);
        address recipient = vm.envOr("INFT_RECIPIENT", deployer);
        string memory uri = vm.envOr("INFT_METADATA_URI", string(DEFAULT_URI));

        require(bytes(uri).length > 0, "MintINFT: empty URI");

        vm.startBroadcast(pk);
        uint256 tokenId = PhulaxINFT(inftAddr).mint(recipient, accountAddr, uri);
        vm.stopBroadcast();

        console2.log("chainId           ", block.chainid);
        console2.log("PhulaxINFT        ", inftAddr);
        console2.log("PhulaxAccount     ", accountAddr);
        console2.log("recipient         ", recipient);
        console2.log("tokenId           ", tokenId);
        console2.log("tokenURI          ", uri);
        // Explorer URL for the README capture (§14.B.9):
        //   https://chainscan-galileo.0g.ai/token/<inft>?id=<tokenId>
    }
}
