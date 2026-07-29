// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IYoulinReputation {
    function balanceOf(address account) external view returns (uint256);
    function availableBalanceOf(address account) external view returns (uint256);
    function lockedBalanceOf(address account) external view returns (uint256);

    function mintByProtocol(
        address to,
        uint256 amount,
        uint8 reason,
        uint256 referenceId
    ) external;

    function lockByProtocol(address account, uint256 amount, uint256 referenceId) external;
    function unlockByProtocol(address account, uint256 amount, uint256 referenceId) external;
    function burnLockedByProtocol(address account, uint256 amount, uint256 referenceId) external;

    function reallocateLockedByProtocol(
        address from,
        address to,
        uint256 amount,
        uint256 referenceId
    ) external;
}
