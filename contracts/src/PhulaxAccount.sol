// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "./adapters/IAdapter.sol";

/// @title PhulaxAccount
/// @notice Per-user account holding deposits into yield/lending adapters.
///
///         **Architectural invariants enforced here, not in docs:**
///
///         1. The agent role can call exactly one selector: `withdraw(address)`.
///            That function is hard-coded to send recovered funds to `owner`.
///            There is no `to` parameter and no code path the agent can take
///            to redirect funds. Fuzz-tested.
///         2. `setAgent`, `revokeAgent`, `setAdapter`, `execute` are all
///            owner-only. `execute` is the only escape hatch and is never
///            reachable from the agent path.
///         3. No upgradability. No `delegatecall` on the agent path. The
///            owner's `execute` does use a low-level call but is owner-only.
contract PhulaxAccount {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public agent;
    mapping(address adapter => bool) public allowedAdapter;

    event AgentSet(address indexed agent);
    event AgentRevoked(address indexed agent);
    event AdapterSet(address indexed adapter, bool allowed);
    event Deposited(address indexed adapter, uint256 amount);
    event Withdrawn(address indexed adapter, uint256 amount, address indexed by);
    event Executed(address indexed target, bytes data);

    error NotOwner();
    error NotOwnerOrAgent();
    error AdapterNotAllowed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOwnerOrAgent() {
        if (msg.sender != owner && msg.sender != agent) revert NotOwnerOrAgent();
        _;
    }

    constructor(address owner_, address agent_) {
        owner = owner_;
        agent = agent_;
        emit AgentSet(agent_);
    }

    // -------------------------------------------------------------- owner ops

    function setAgent(address newAgent) external onlyOwner {
        agent = newAgent;
        emit AgentSet(newAgent);
    }

    function revokeAgent() external onlyOwner {
        address old = agent;
        agent = address(0);
        emit AgentRevoked(old);
    }

    function setAdapter(address adapter, bool allowed) external onlyOwner {
        allowedAdapter[adapter] = allowed;
        emit AdapterSet(adapter, allowed);
    }

    /// @notice Owner-only escape hatch. Never reachable from the agent path.
    function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "execute failed");
        emit Executed(target, data);
        return ret;
    }

    // ------------------------------------------------------------- user flows

    function deposit(address adapter, uint256 amount) external onlyOwner {
        if (!allowedAdapter[adapter]) revert AdapterNotAllowed();
        address asset = IAdapter(adapter).asset();
        IERC20(asset).safeTransferFrom(owner, address(this), amount);
        IERC20(asset).forceApprove(adapter, amount);
        IAdapter(adapter).deposit(amount);
        emit Deposited(adapter, amount);
    }

    /// @notice Recover funds from an adapter and send them to `owner`.
    ///         **Recipient is hard-coded** — no `to` parameter exists. This is
    ///         the entire surface the agent role can touch. Fuzz invariant
    ///         `invariant_withdrawAlwaysToOwner` proves no input can redirect.
    function withdraw(address adapter) external onlyOwnerOrAgent returns (uint256) {
        if (!allowedAdapter[adapter]) revert AdapterNotAllowed();

        uint256 returned = IAdapter(adapter).withdrawAll();

        address asset = IAdapter(adapter).asset();
        uint256 selfBal = IERC20(asset).balanceOf(address(this));
        if (selfBal > 0) {
            IERC20(asset).safeTransfer(owner, selfBal);
        }
        emit Withdrawn(adapter, returned, msg.sender);
        return returned;
    }
}
