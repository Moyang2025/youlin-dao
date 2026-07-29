// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {YoulinTypes} from "./libraries/YoulinTypes.sol";

contract YoulinReputation is ERC20, AccessControl {
    bytes32 public constant PROTOCOL_ROLE = keccak256("PROTOCOL_ROLE");

    mapping(address account => uint256 amount) public lockedBalanceOf;
    bool public bootstrapClosed;

    error ZeroAddress();
    error ZeroAmount();
    error NonTransferable();
    error InsufficientAvailableReputation(uint256 available, uint256 requested);
    error InsufficientLockedReputation(uint256 locked, uint256 requested);
    error BootstrapAlreadyClosed();
    error ArrayLengthMismatch();

    event ReputationChanged(
        address indexed account,
        int256 amount,
        uint8 indexed reason,
        uint256 indexed referenceId
    );
    event ReputationLocked(address indexed account, uint256 amount, uint256 indexed referenceId);
    event ReputationUnlocked(address indexed account, uint256 amount, uint256 indexed referenceId);
    event ReputationBurned(address indexed account, uint256 amount, uint256 indexed referenceId);
    event ReputationReallocated(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 indexed referenceId
    );
    event BootstrapClosed();

    constructor(address admin) ERC20("Youlin Reputation", "R") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function availableBalanceOf(address account) public view returns (uint256) {
        return balanceOf(account) - lockedBalanceOf[account];
    }

    function bootstrapMint(
        address[] calldata accounts,
        uint256[] calldata amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bootstrapClosed) revert BootstrapAlreadyClosed();
        if (accounts.length != amounts.length) revert ArrayLengthMismatch();

        for (uint256 i; i < accounts.length; ++i) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            _mint(accounts[i], amounts[i]);
            emit ReputationChanged(
                accounts[i],
                int256(amounts[i]),
                uint8(YoulinTypes.ReputationReason.Bootstrap),
                0
            );
        }
    }

    function closeBootstrap() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bootstrapClosed) revert BootstrapAlreadyClosed();
        bootstrapClosed = true;
        emit BootstrapClosed();
    }

    function mintByProtocol(
        address to,
        uint256 amount,
        uint8 reason,
        uint256 referenceId
    ) external onlyRole(PROTOCOL_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
        emit ReputationChanged(to, int256(amount), reason, referenceId);
    }

    function lockByProtocol(
        address account,
        uint256 amount,
        uint256 referenceId
    ) external onlyRole(PROTOCOL_ROLE) {
        if (amount == 0) revert ZeroAmount();
        uint256 available = availableBalanceOf(account);
        if (available < amount) {
            revert InsufficientAvailableReputation(available, amount);
        }
        lockedBalanceOf[account] += amount;
        emit ReputationLocked(account, amount, referenceId);
    }

    function unlockByProtocol(
        address account,
        uint256 amount,
        uint256 referenceId
    ) external onlyRole(PROTOCOL_ROLE) {
        _consumeLocked(account, amount);
        emit ReputationUnlocked(account, amount, referenceId);
    }

    function burnLockedByProtocol(
        address account,
        uint256 amount,
        uint256 referenceId
    ) external onlyRole(PROTOCOL_ROLE) {
        _consumeLocked(account, amount);
        _burn(account, amount);
        emit ReputationBurned(account, amount, referenceId);
    }

    function reallocateLockedByProtocol(
        address from,
        address to,
        uint256 amount,
        uint256 referenceId
    ) external onlyRole(PROTOCOL_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        _consumeLocked(from, amount);
        _burn(from, amount);
        _mint(to, amount);
        emit ReputationReallocated(from, to, amount, referenceId);
        emit ReputationChanged(
            from,
            -int256(amount),
            uint8(YoulinTypes.ReputationReason.ChallengeReward),
            referenceId
        );
        emit ReputationChanged(
            to,
            int256(amount),
            uint8(YoulinTypes.ReputationReason.ChallengeReward),
            referenceId
        );
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }

    function _consumeLocked(address account, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 locked = lockedBalanceOf[account];
        if (locked < amount) {
            revert InsufficientLockedReputation(locked, amount);
        }
        unchecked {
            lockedBalanceOf[account] = locked - amount;
        }
    }
}
