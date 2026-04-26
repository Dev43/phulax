// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Hub
/// @notice Lightweight registry. Frontends + KeeperHub workflows discover
///         active accounts and policy thresholds via Hub events; we don't
///         enumerate on-chain.
contract Hub {
    struct RiskPolicy {
        // detection threshold scaled to 1e4 (e.g. 7000 = 0.70).
        uint16 thresholdBps;
        // max amount the agent may withdraw per block (informational; the
        // actual blast radius is bounded by PhulaxAccount.withdraw shape).
        uint256 perBlockCap;
    }

    mapping(address account => address owner) public accountOwner;
    mapping(address account => RiskPolicy) public policy;
    mapping(address account => uint256 tokenId) public linkedINFT;

    event AccountRegistered(address indexed account, address indexed owner);
    event RiskPolicySet(address indexed account, uint16 thresholdBps, uint256 perBlockCap);
    event INFTLinked(address indexed account, uint256 indexed tokenId);

    error NotAccountOwner();

    function register(address account, address owner_) external {
        // No auth — anyone can publicise an account/owner pair, but only the
        // owner can later mutate policy. Cheap public bulletin board.
        require(accountOwner[account] == address(0), "already registered");
        accountOwner[account] = owner_;
        emit AccountRegistered(account, owner_);
    }

    function setRiskPolicy(address account, uint16 thresholdBps, uint256 perBlockCap) external {
        if (accountOwner[account] != msg.sender) revert NotAccountOwner();
        policy[account] = RiskPolicy(thresholdBps, perBlockCap);
        emit RiskPolicySet(account, thresholdBps, perBlockCap);
    }

    function linkINFT(address account, uint256 tokenId) external {
        if (accountOwner[account] != msg.sender) revert NotAccountOwner();
        linkedINFT[account] = tokenId;
        emit INFTLinked(account, tokenId);
    }
}
