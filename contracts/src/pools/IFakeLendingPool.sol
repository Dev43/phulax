// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IFakeLendingPool {
    // Aave-shape events so KeeperHub `web3/query-transactions` decoding
    // recognises the activity surface.
    event Supply(address indexed reserve, address indexed user, address indexed onBehalfOf, uint256 amount);
    event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount);
    event Borrow(address indexed reserve, address indexed user, uint256 amount, uint256 collateralValue);
    event Liquidate(address indexed reserve, address indexed user, address indexed liquidator, uint256 seized, uint256 repaid);
    event ReservesSwept(address indexed reserve, address indexed by, address indexed to, uint256 amount);

    function supply(address asset, uint256 amount, address onBehalfOf) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function borrow(address asset, uint256 amount) external;
    function liquidate(address user, address asset) external returns (uint256 seized);
    function withdrawReserves(address asset, address to) external returns (uint256 amount);

    function balanceOf(address asset, address user) external view returns (uint256);
    function borrowedOf(address asset, address user) external view returns (uint256);
    function getAssetPrice(address asset) external view returns (uint256);
}
