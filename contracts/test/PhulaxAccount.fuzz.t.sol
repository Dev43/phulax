// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PhulaxAccount} from "../src/PhulaxAccount.sol";
import {IAdapter} from "../src/adapters/IAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Trivial adapter that, on withdrawAll, mints `payout` tokens directly
///         into the calling account. Used to exercise the recipient invariant
///         under fuzzed payout sizes and arbitrary callers.
contract PayoutAdapter is IAdapter {
    MockERC20 public immutable token;
    address public account;
    uint256 public payout;

    constructor(MockERC20 t) {
        token = t;
    }

    function setAccount(address a) external {
        account = a;
    }

    function setPayout(uint256 p) external {
        payout = p;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256) external {}

    function withdrawAll() external returns (uint256) {
        token.mint(account, payout);
        return payout;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

contract PhulaxAccountFuzzTest is Test {
    address constant OWNER = address(0xA11CE);
    address constant AGENT = address(0xA6E47);

    PhulaxAccount internal acct;
    PayoutAdapter internal adapter;
    MockERC20 internal token;

    function setUp() public {
        token = new MockERC20("USD", "USD", 18);
        acct = new PhulaxAccount(OWNER, AGENT);
        adapter = new PayoutAdapter(token);
        adapter.setAccount(address(acct));

        vm.prank(OWNER);
        acct.setAdapter(address(adapter), true);
    }

    /// @notice Fuzz: there is no input under which `withdraw` transfers to a
    ///         non-owner address. We fuzz the caller (must be owner or agent
    ///         to even succeed), the payout amount, and a "candidate
    ///         recipient" — and assert the candidate's balance never moves
    ///         unless the candidate IS the owner.
    function testFuzz_withdrawAlwaysToOwner(address caller, address candidate, uint96 payout) public {
        vm.assume(candidate != OWNER);
        vm.assume(candidate != address(acct));
        vm.assume(candidate != address(adapter));
        vm.assume(candidate != address(token));
        adapter.setPayout(payout);

        uint256 candidateBefore = token.balanceOf(candidate);
        uint256 ownerBefore = token.balanceOf(OWNER);

        vm.prank(caller);
        try acct.withdraw(address(adapter)) {
            // Only owner/agent can succeed; either way, candidate is not owner
            // so candidate's balance must be unchanged.
            assertEq(token.balanceOf(candidate), candidateBefore, "candidate received funds");
            assertEq(token.balanceOf(OWNER), ownerBefore + payout, "owner did not receive payout");
        } catch {
            // call reverted -> nothing moved.
            assertEq(token.balanceOf(candidate), candidateBefore);
            assertEq(token.balanceOf(OWNER), ownerBefore);
        }
    }

    /// @notice Surface check — the agent role can call exactly one selector.
    function test_agentCanOnlyCallWithdraw() public {
        // setAgent: owner-only.
        vm.prank(AGENT);
        vm.expectRevert(PhulaxAccount.NotOwner.selector);
        acct.setAgent(address(0xBAD));

        // revokeAgent: owner-only.
        vm.prank(AGENT);
        vm.expectRevert(PhulaxAccount.NotOwner.selector);
        acct.revokeAgent();

        // setAdapter: owner-only.
        vm.prank(AGENT);
        vm.expectRevert(PhulaxAccount.NotOwner.selector);
        acct.setAdapter(address(adapter), false);

        // execute: owner-only escape hatch, never reachable from agent.
        vm.prank(AGENT);
        vm.expectRevert(PhulaxAccount.NotOwner.selector);
        acct.execute(address(token), "");

        // deposit: owner-only.
        vm.prank(AGENT);
        vm.expectRevert(PhulaxAccount.NotOwner.selector);
        acct.deposit(address(adapter), 1);

        // withdraw: owner OR agent — should succeed.
        adapter.setPayout(1);
        vm.prank(AGENT);
        acct.withdraw(address(adapter));
        assertEq(token.balanceOf(OWNER), 1);
    }
}
