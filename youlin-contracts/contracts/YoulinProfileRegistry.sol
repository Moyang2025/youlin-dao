// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract YoulinProfileRegistry {
    uint256 public constant MAX_NICKNAME_BYTES = 64;
    uint256 public constant MAX_AVATAR_URI_BYTES = 512;
    uint256 public constant MAX_BIO_BYTES = 512;

    struct Profile {
        string nickname;
        string avatarURI;
        string bio;
        uint64 updatedAt;
        bool exists;
    }

    mapping(address account => Profile profile) private profiles;

    error EmptyProfile();
    error ProfileNotFound();
    error FieldTooLong(uint8 field, uint256 supplied, uint256 maximum);

    event ProfileUpdated(
        address indexed account,
        bytes32 indexed nicknameHash,
        bytes32 avatarURIHash,
        bytes32 bioHash,
        uint64 updatedAt
    );
    event ProfileCleared(address indexed account, uint64 updatedAt);

    function setProfile(
        string calldata nickname,
        string calldata avatarURI,
        string calldata bio
    ) external {
        uint256 nicknameLength = bytes(nickname).length;
        uint256 avatarLength = bytes(avatarURI).length;
        uint256 bioLength = bytes(bio).length;
        if (nicknameLength == 0 && avatarLength == 0 && bioLength == 0) {
            revert EmptyProfile();
        }
        _checkLength(0, nicknameLength, MAX_NICKNAME_BYTES);
        _checkLength(1, avatarLength, MAX_AVATAR_URI_BYTES);
        _checkLength(2, bioLength, MAX_BIO_BYTES);

        uint64 timestamp = uint64(block.timestamp);
        profiles[msg.sender] = Profile({
            nickname: nickname,
            avatarURI: avatarURI,
            bio: bio,
            updatedAt: timestamp,
            exists: true
        });

        emit ProfileUpdated(
            msg.sender,
            keccak256(bytes(nickname)),
            keccak256(bytes(avatarURI)),
            keccak256(bytes(bio)),
            timestamp
        );
    }

    function clearProfile() external {
        if (!profiles[msg.sender].exists) revert ProfileNotFound();
        delete profiles[msg.sender];
        emit ProfileCleared(msg.sender, uint64(block.timestamp));
    }

    function getProfile(
        address account
    )
        external
        view
        returns (
            string memory nickname,
            string memory avatarURI,
            string memory bio,
            uint64 updatedAt,
            bool exists
        )
    {
        Profile storage profile = profiles[account];
        return (
            profile.nickname,
            profile.avatarURI,
            profile.bio,
            profile.updatedAt,
            profile.exists
        );
    }

    function _checkLength(
        uint8 field,
        uint256 supplied,
        uint256 maximum
    ) private pure {
        if (supplied > maximum) {
            revert FieldTooLong(field, supplied, maximum);
        }
    }
}
