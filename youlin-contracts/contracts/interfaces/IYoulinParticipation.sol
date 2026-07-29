// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IYoulinParticipation {
    function mint(address to, uint256 projectId) external;
    function hasCredential(address account, uint256 projectId) external view returns (bool);
}
