// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UD60x18, ud} from "@prb/math/src/UD60x18.sol";
import {YoulinTypes} from "./libraries/YoulinTypes.sol";

interface IYoulinGenesisReputation {
    function mintByProtocol(
        address to,
        uint256 amount,
        uint8 reason,
        uint256 referenceId
    ) external;
}

interface IYoulinGenesisParticipation {
    function mint(address to, uint256 projectId) external;
}

contract YoulinGenesisTreasury is AccessControl, Pausable, ReentrancyGuard {
    uint256 public constant GENESIS_PROJECT_ID =
        uint256(keccak256("YOULIN_GENESIS_PROJECT"));
    uint256 public constant BPS = 10_000;
    uint256 public constant PASS_BPS = 6_600;
    uint256 public constant MIN_VOTERS = 3;
    uint64 public constant MIN_VOTING_DURATION = 60;
    uint64 public constant MAX_VOTING_DURATION = 30 days;

    struct DonationCheckpoint {
        uint64 version;
        uint192 amount;
    }

    struct Proposal {
        address proposer;
        address payable recipient;
        uint128 amount;
        uint64 snapshotVersion;
        uint64 votingEndsAt;
        uint32 voterCount;
        uint256 supportWeight;
        uint256 rejectWeight;
        bool finalized;
        bool passed;
        bool executed;
        bool cancelled;
        string metadataURI;
        bytes32 metadataHash;
    }

    IYoulinGenesisReputation public immutable reputation;
    IYoulinGenesisParticipation public immutable participation;

    uint256 public perAddressCap;
    uint64 public votingDuration;
    uint64 public donationVersion;
    uint256 public totalDonated;
    uint256 public donorCount;
    uint256 public proposalCount;
    uint256 public reservedBalance;

    mapping(address donor => uint256 amount) public cumulativeDonationOf;
    mapping(address donor => uint64 joinedAtVersion) public donorJoinedAtVersion;
    mapping(address donor => DonationCheckpoint[]) private donationCheckpoints;
    mapping(uint256 proposalId => Proposal proposal) private proposals;
    mapping(uint256 proposalId => mapping(address voter => bool voted))
        public hasVoted;
    mapping(address proposer => uint256 proposalId) public activeProposalOf;

    error ZeroAddress();
    error ZeroAmount();
    error EmptyURI();
    error EmptyHash();
    error InvalidVotingDuration(uint256 supplied);
    error DonationCapExceeded(uint256 remaining, uint256 supplied);
    error UseDonateFunction();
    error NotDonor();
    error NotEligibleAtSnapshot();
    error ProposalNotFound(uint256 proposalId);
    error ActiveProposalExists(uint256 proposalId);
    error InsufficientUnreservedBalance(uint256 available, uint256 requested);
    error VotingClosed();
    error VotingStillOpen();
    error AlreadyVoted();
    error AlreadyFinalized();
    error ProposalDidNotPass();
    error AlreadyExecuted();
    error AlreadyCancelled();
    error VotesAlreadyCast();
    error NotProposer();
    error NativeTransferFailed();

    event GenesisDonationReceived(
        address indexed donor,
        uint256 amount,
        uint256 cumulativeAmount,
        uint256 weight,
        uint64 indexed donationVersion
    );
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address indexed recipient,
        uint256 amount,
        uint64 snapshotVersion,
        uint64 votingEndsAt,
        string metadataURI,
        bytes32 metadataHash
    );
    event ProposalVoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 snapshotDonation,
        uint256 weight
    );
    event ProposalFinalized(
        uint256 indexed proposalId,
        bool passed,
        uint256 supportWeight,
        uint256 rejectWeight,
        uint256 voterCount
    );
    event ProposalExecuted(
        uint256 indexed proposalId,
        address indexed recipient,
        uint256 amount
    );
    event ProposalCancelled(uint256 indexed proposalId);
    event PerAddressCapUpdated(uint256 previousCap, uint256 newCap);
    event VotingDurationUpdated(uint64 previousDuration, uint64 newDuration);

    constructor(
        address admin,
        IYoulinGenesisReputation reputation_,
        IYoulinGenesisParticipation participation_,
        uint64 votingDuration_,
        uint256 perAddressCap_
    ) {
        if (
            admin == address(0) ||
            address(reputation_) == address(0) ||
            address(participation_) == address(0)
        ) {
            revert ZeroAddress();
        }
        if (perAddressCap_ == 0 || perAddressCap_ > type(uint192).max) {
            revert ZeroAmount();
        }
        _validateVotingDuration(votingDuration_);

        reputation = reputation_;
        participation = participation_;
        votingDuration = votingDuration_;
        perAddressCap = perAddressCap_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    receive() external payable {
        revert UseDonateFunction();
    }

    function donate() external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();

        uint256 previous = cumulativeDonationOf[msg.sender];
        uint256 updated = previous + msg.value;
        if (updated > perAddressCap) {
            uint256 remaining = previous >= perAddressCap
                ? 0
                : perAddressCap - previous;
            revert DonationCapExceeded(remaining, msg.value);
        }

        uint64 version = ++donationVersion;
        cumulativeDonationOf[msg.sender] = updated;
        totalDonated += msg.value;
        _writeDonationCheckpoint(msg.sender, version, updated);

        if (previous == 0) {
            donorJoinedAtVersion[msg.sender] = version;
            donorCount += 1;
            participation.mint(msg.sender, GENESIS_PROJECT_ID);
        }

        reputation.mintByProtocol(
            msg.sender,
            msg.value,
            uint8(YoulinTypes.ReputationReason.GenesisDonation),
            GENESIS_PROJECT_ID
        );

        emit GenesisDonationReceived(
            msg.sender,
            msg.value,
            updated,
            donationWeight(updated),
            version
        );
    }

    function createProposal(
        address payable recipient,
        uint128 amount,
        string calldata metadataURI,
        bytes32 metadataHash
    ) external whenNotPaused returns (uint256 proposalId) {
        if (cumulativeDonationOf[msg.sender] == 0) revert NotDonor();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (bytes(metadataURI).length == 0) revert EmptyURI();
        if (metadataHash == bytes32(0)) revert EmptyHash();

        uint256 active = activeProposalOf[msg.sender];
        if (active != 0) {
            revert ActiveProposalExists(active);
        }

        uint256 available = availableBalance();
        if (amount > available) {
            revert InsufficientUnreservedBalance(available, amount);
        }

        proposalId = ++proposalCount;
        Proposal storage proposal = proposals[proposalId];
        proposal.proposer = msg.sender;
        proposal.recipient = recipient;
        proposal.amount = amount;
        proposal.snapshotVersion = donationVersion;
        proposal.votingEndsAt = uint64(block.timestamp) + votingDuration;
        proposal.metadataURI = metadataURI;
        proposal.metadataHash = metadataHash;

        activeProposalOf[msg.sender] = proposalId;
        reservedBalance += amount;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            recipient,
            amount,
            proposal.snapshotVersion,
            proposal.votingEndsAt,
            metadataURI,
            metadataHash
        );
    }

    function vote(uint256 proposalId, bool support) external whenNotPaused {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.finalized) revert AlreadyFinalized();
        if (block.timestamp > proposal.votingEndsAt) revert VotingClosed();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        uint256 snapshotDonation = donationAtVersion(
            msg.sender,
            proposal.snapshotVersion
        );
        if (snapshotDonation == 0) revert NotEligibleAtSnapshot();

        uint256 weight = donationWeight(snapshotDonation);
        hasVoted[proposalId][msg.sender] = true;
        proposal.voterCount += 1;
        if (support) {
            proposal.supportWeight += weight;
        } else {
            proposal.rejectWeight += weight;
        }

        emit ProposalVoteCast(
            proposalId,
            msg.sender,
            support,
            snapshotDonation,
            weight
        );
    }

    function finalizeProposal(
        uint256 proposalId
    ) external returns (bool passed) {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.finalized) revert AlreadyFinalized();
        if (block.timestamp <= proposal.votingEndsAt) revert VotingStillOpen();

        uint256 castWeight = proposal.supportWeight + proposal.rejectWeight;
        passed =
            proposal.voterCount >= MIN_VOTERS &&
            castWeight != 0 &&
            proposal.supportWeight * BPS >= castWeight * PASS_BPS;

        proposal.finalized = true;
        proposal.passed = passed;
        if (!passed) {
            reservedBalance -= proposal.amount;
            activeProposalOf[proposal.proposer] = 0;
        }

        emit ProposalFinalized(
            proposalId,
            passed,
            proposal.supportWeight,
            proposal.rejectWeight,
            proposal.voterCount
        );
    }

    function executeProposal(
        uint256 proposalId
    ) external nonReentrant whenNotPaused {
        Proposal storage proposal = _proposal(proposalId);
        if (!proposal.finalized) revert VotingStillOpen();
        if (!proposal.passed) revert ProposalDidNotPass();
        if (proposal.executed) revert AlreadyExecuted();

        proposal.executed = true;
        reservedBalance -= proposal.amount;
        activeProposalOf[proposal.proposer] = 0;

        (bool success, ) = proposal.recipient.call{value: proposal.amount}("");
        if (!success) revert NativeTransferFailed();

        emit ProposalExecuted(
            proposalId,
            proposal.recipient,
            proposal.amount
        );
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage proposal = _proposal(proposalId);
        if (msg.sender != proposal.proposer) revert NotProposer();
        if (proposal.finalized) revert AlreadyFinalized();
        if (proposal.cancelled) revert AlreadyCancelled();
        if (proposal.voterCount != 0) revert VotesAlreadyCast();

        proposal.cancelled = true;
        proposal.finalized = true;
        reservedBalance -= proposal.amount;
        activeProposalOf[proposal.proposer] = 0;
        emit ProposalCancelled(proposalId);
    }

    function setPerAddressCap(
        uint256 newCap
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newCap == 0 || newCap > type(uint192).max) revert ZeroAmount();
        uint256 previous = perAddressCap;
        perAddressCap = newCap;
        emit PerAddressCapUpdated(previous, newCap);
    }

    function setVotingDuration(
        uint64 newDuration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _validateVotingDuration(newDuration);
        uint64 previous = votingDuration;
        votingDuration = newDuration;
        emit VotingDurationUpdated(previous, newDuration);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function availableBalance() public view returns (uint256) {
        return address(this).balance - reservedBalance;
    }

    function donationWeight(
        uint256 donationWei
    ) public pure returns (uint256) {
        if (donationWei == 0) return 0;
        UD60x18 base = ud(1 ether + donationWei);
        return base.ln().unwrap();
    }

    function donationAtVersion(
        address donor,
        uint64 version
    ) public view returns (uint256) {
        DonationCheckpoint[] storage checkpoints = donationCheckpoints[donor];
        uint256 low;
        uint256 high = checkpoints.length;

        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (checkpoints[mid].version > version) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return low == 0 ? 0 : checkpoints[low - 1].amount;
    }

    function getProposal(
        uint256 proposalId
    )
        external
        view
        returns (
            address proposer,
            address recipient,
            uint256 amount,
            uint64 snapshotVersion,
            uint64 votingEndsAt,
            uint256 voterCount,
            uint256 supportWeight,
            uint256 rejectWeight,
            bool finalized,
            bool passed,
            bool executed,
            bool cancelled,
            string memory metadataURI,
            bytes32 metadataHash
        )
    {
        Proposal storage proposal = _proposal(proposalId);
        return (
            proposal.proposer,
            proposal.recipient,
            proposal.amount,
            proposal.snapshotVersion,
            proposal.votingEndsAt,
            proposal.voterCount,
            proposal.supportWeight,
            proposal.rejectWeight,
            proposal.finalized,
            proposal.passed,
            proposal.executed,
            proposal.cancelled,
            proposal.metadataURI,
            proposal.metadataHash
        );
    }

    function _proposal(
        uint256 proposalId
    ) private view returns (Proposal storage proposal) {
        if (proposalId == 0 || proposalId > proposalCount) {
            revert ProposalNotFound(proposalId);
        }
        proposal = proposals[proposalId];
    }

    function _writeDonationCheckpoint(
        address donor,
        uint64 version,
        uint256 amount
    ) private {
        donationCheckpoints[donor].push(
            DonationCheckpoint({version: version, amount: uint192(amount)})
        );
    }

    function _validateVotingDuration(uint64 duration) private pure {
        if (
            duration < MIN_VOTING_DURATION ||
            duration > MAX_VOTING_DURATION
        ) {
            revert InvalidVotingDuration(duration);
        }
    }
}
