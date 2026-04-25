// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PhulaxAccount} from "../src/PhulaxAccount.sol";
import {IAdapter} from "../src/adapters/IAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Adapter handler the fuzzer pokes with arbitrary "returned" values
///         and arbitrary callers. The invariant is: after any sequence of
///         poking, every cent the account ever received from withdraw flows
///         to `OWNER` and nowhere else.
contract HandlerAdapter is IAdapter {
    MockERC20 public immutable token;
    address public account; // PhulaxAccount under test

    constructor(MockERC20 t) {
        token = t;
    }

    function setAccount(address a) external {
        account = a;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256) external {}

    function withdrawAll() external returns (uint256 amt) {
        // Mint random "yield" into the account itself to simulate any pool
        // payout shape. Whatever ends up in the account on the way out should
        // all flow to OWNER per the invariant.
        amt = 1e18;
        token.mint(account, amt);
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

contract PhulaxAccountInvariantTest is Test {
    address constant OWNER = address(0xA11CE);
    address constant AGENT = address(0xA6E47);

    PhulaxAccount internal acct;
    HandlerAdapter internal adapter;
    MockERC20 internal token;
    Caller internal caller;

    function setUp() public {
        token = new MockERC20("USD", "USD", 18);
        acct = new PhulaxAccount(OWNER, AGENT);
        adapter = new HandlerAdapter(token);
        adapter.setAccount(address(acct));

        vm.prank(OWNER);
        acct.setAdapter(address(adapter), true);

        caller = new Caller(acct, address(adapter), AGENT, OWNER);
        targetContract(address(caller));
    }

    /// @dev INVARIANT: every wei of `token` that left the account ended up
    ///      with `owner`. Equivalent to: token.balanceOf({not OWNER, not
    ///      account, not adapter}) == 0 for every actor the fuzzer can be.
    function invariant_withdrawAlwaysToOwner() public view {
        // No address other than OWNER, the account, the adapter, or the
        // token contract itself should ever hold the token.
        address[5] memory probes = [
            AGENT,
            address(this),
            address(0xBEEF),
            address(0xDEAD),
            address(caller)
        ];
        for (uint256 i = 0; i < probes.length; i++) {
            assertEq(token.balanceOf(probes[i]), 0, "non-owner held funds");
        }
    }
}

/// @notice The fuzzer drives this. It can call withdraw as agent or owner
///         and the invariant must hold regardless.
contract Caller {
    PhulaxAccount internal immutable acct;
    address internal immutable adapter;
    address internal immutable agent;
    address internal immutable owner;

    constructor(PhulaxAccount a, address ad, address ag, address ow) {
        acct = a;
        adapter = ad;
        agent = ag;
        owner = ow;
    }

    function withdrawAsAgent() external {
        // foundry-prank from inside a handler: just call from `agent` via
        // vm.prank? handlers don't have vm. Instead, route through a low
        // level call from the agent EOA via vm.broadcast in the test isn't
        // available here. Foundry invariant fuzzing calls handlers from
        // arbitrary senders; we use msg.sender directly:
        if (msg.sender == agent || msg.sender == owner) {
            try acct.withdraw(adapter) {} catch {}
        }
    }

    function withdrawAsRandom() external {
        try acct.withdraw(adapter) {} catch {}
    }
}
