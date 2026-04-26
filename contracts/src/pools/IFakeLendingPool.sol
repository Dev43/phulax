// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IFakeLendingPool {
    // Aave-shape events so KeeperHub `web3/query-transactions` decoding
    // recognises the activity surface.
    event Supply(address indexed reserve, address indexed user, address indexed onBehalfOf, uint256 amount);
    event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount);
    event Borrow(address indexed reserve, address indexed user, uint256 amount, uint256 collateralValue);

    function supply(address asset, uint256 amount, address onBehalfOf) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function borrow(address asset, uint256 amount) external;

    function balanceOf(address asset, address user) external view returns (uint256);
    function getAssetPrice(address asset) external view returns (uint256);
}
