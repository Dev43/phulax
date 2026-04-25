// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title PhulaxINFT
/// @notice ERC-7857-shaped iNFT. The reference impl for ERC-7857 is rough,
///         so per `tasks/todo.md` §12 risk: ship a minimal ERC-721 with the
///         expected metadata schema and call it "ERC-7857-shaped".
///
///         Token URI points at a 0G Storage CID containing:
///         {
///           policy:      { thresholdBps, perBlockCap, ... },
///           adapters:    [address, ...],
///           classifier:  { weights_cid, eval_cid, model_hash },
///           incident_log_cid: <0G Storage Log root>
///         }
contract PhulaxINFT is ERC721 {
    uint256 public nextId = 1;
    mapping(uint256 => string) internal _uri;
    mapping(uint256 => address) public boundAccount;

    event MetadataUpdated(uint256 indexed tokenId, string uri);
    event AccountBound(uint256 indexed tokenId, address indexed account);

    error NotTokenOwner();

    constructor() ERC721("Phulax Guardian", "PHULAX") {}

    function mint(address to, address account, string calldata uri_) external returns (uint256 tokenId) {
        tokenId = nextId++;
        _safeMint(to, tokenId);
        _uri[tokenId] = uri_;
        boundAccount[tokenId] = account;
        emit MetadataUpdated(tokenId, uri_);
        emit AccountBound(tokenId, account);
    }

    function setTokenURI(uint256 tokenId, string calldata uri_) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        _uri[tokenId] = uri_;
        emit MetadataUpdated(tokenId, uri_);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _uri[tokenId];
    }
}
