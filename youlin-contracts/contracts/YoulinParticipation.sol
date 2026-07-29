// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract YoulinParticipation is ERC1155, AccessControl {
    bytes32 public constant PROTOCOL_ROLE = keccak256("PROTOCOL_ROLE");

    error ZeroAddress();
    error NonTransferable();

    event ParticipationMinted(uint256 indexed projectId, address indexed account);

    constructor(address admin, string memory baseURI) ERC1155(baseURI) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 projectId) external onlyRole(PROTOCOL_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf(to, projectId) == 0) {
            _mint(to, projectId, 1, "");
            emit ParticipationMinted(projectId, to);
        }
    }

    function hasCredential(address account, uint256 projectId) external view returns (bool) {
        return balanceOf(account, projectId) == 1;
    }

    function safeTransferFrom(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public pure override {
        revert NonTransferable();
    }

    function safeBatchTransferFrom(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public pure override {
        revert NonTransferable();
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
