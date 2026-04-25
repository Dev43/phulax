// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IAdapter
/// @notice Normalises lending/yield protocol calls so PhulaxAccount only
///         needs to know `deposit(amount) / withdraw() -> amount / balance()`.
///         Adapter implementations are stateless wrappers around a specific
///         protocol; the account holds the underlying token, the adapter
///         shuttles funds in and out.
interface IAdapter {
    /// @notice Underlying ERC20 token managed by this adapter.
    function asset() external view returns (address);

    /// @notice Pull `amount` of `asset()` from `msg.sender` and supply to the
    ///         underlying protocol. Caller must have approved.
    function deposit(uint256 amount) external;

    /// @notice Pull everything this account holds in the underlying protocol
    ///         and send it back to `msg.sender`. Returns the amount returned.
    function withdrawAll() external returns (uint256);

    /// @notice Current balance the caller has in the underlying protocol,
    ///         denominated in `asset()`.
    function balanceOf(address account) external view returns (uint256);
}
