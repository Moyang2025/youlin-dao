// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UD60x18, ud} from "@prb/math/src/UD60x18.sol";
import {IYoulinParticipation} from "./interfaces/IYoulinParticipation.sol";
import {IYoulinReputation} from "./interfaces/IYoulinReputation.sol";
import {YoulinTypes} from "./libraries/YoulinTypes.sol";

contract YoulinProtocol is AccessControl, Pausable, ReentrancyGuard {
    uint256 public constant SCORE_THRESHOLD = 60;
    uint256 public constant BPS = 10_000;
    uint256 public constant MID_SCORE_REWARD_R = 0.1 ether;
    uint256 public constant FINAL_SCORE_REWARD_R = 0.1 ether;
    uint256 public constant FAILED_CHALLENGE_INITIATOR_SHARE_BPS = 5_000;
    uint256 public constant FAILED_CHALLENGE_DONOR_SHARE_BPS = 5_000;
    uint256 public constant MAX_CHALLENGE_SUPPORTERS = 64;

    IYoulinReputation public immutable reputation;
    IYoulinParticipation public immutable participation;

    uint64 public immutable minExpectedDuration;
    uint64 public immutable midVotingDuration;
    uint64 public immutable finalVotingDuration;
    uint64 public immutable challengeDuration;
    uint64 public immutable disputeVotingDuration;
    uint256 public immutable minChallengeStake;
    uint256 public immutable minJurorStake;
    uint16 public immutable challengePassBps;
    uint16 public immutable minDisputeVoters;
    uint256 public immutable firstProjectId;

    struct Project {
        address creator;
        address payable projectWallet;
        YoulinTypes.ProjectState state;
        uint128 targetAmount;
        uint128 round1Raised;
        uint128 round2Raised;
        uint64 round1Deadline;
        uint64 expectedDuration;
        uint64 activatedAt;
        uint64 round1CompletedAt;
        uint64 midSubmissionDeadline;
        uint64 midSubmittedAt;
        uint64 midVotingEndsAt;
        uint64 finalSubmissionDeadline;
        uint64 finalSubmittedAt;
        uint64 finalVotingEndsAt;
        uint64 challengeEndsAt;
        uint64 disputeVotingEndsAt;
        uint16 midScore;
        uint16 finalScore;
        bool round1FundsClaimed;
        bool settled;
        bytes32 metadataHash;
        bytes32 midEvidenceHash;
        bytes32 finalEvidenceHash;
        string metadataURI;
        string midEvidenceURI;
        string finalEvidenceURI;
    }

    uint256 public projectCount;
    mapping(uint256 projectId => Project project) private projects;
    mapping(uint256 projectId => address[] accounts) private initiatorsByProject;
    mapping(uint256 projectId => mapping(address account => bool accepted)) public isInitiator;
    mapping(uint256 projectId => mapping(address account => uint256 amount)) public initiatorStake;
    mapping(uint256 projectId => uint256 amount) public totalInitiatorStake;
    mapping(uint256 projectId => uint256 count) public acceptedInitiatorCount;

    mapping(address account => uint256[] projectIds) private initiatedProjectIds;
    mapping(address account => mapping(uint256 projectId => bool isIndexed))
        private hasIndexedInitiation;
    mapping(address account => uint256[] projectIds) private participatedProjectIds;
    mapping(address account => mapping(uint256 projectId => bool isIndexed))
        private hasIndexedParticipation;

    mapping(uint256 projectId => mapping(address donor => uint256 amount))
        public round1DonationOf;
    mapping(uint256 projectId => mapping(address donor => uint256 amount))
        public round2DonationOf;
    mapping(uint256 projectId => mapping(address donor => bool claimed))
        public round1ReputationClaimed;
    mapping(uint256 projectId => mapping(address donor => bool refunded))
        public round1Refunded;
    mapping(uint256 projectId => uint256 count) public uniqueDonorCount;

    mapping(uint256 projectId => mapping(address scorer => bool submitted))
        public hasSubmittedMidScore;
    mapping(uint256 projectId => mapping(address scorer => bool submitted))
        public hasSubmittedFinalScore;
    mapping(uint256 projectId => uint256[10] histogram) private midScoreHistogram;
    mapping(uint256 projectId => uint256[10] histogram) private finalScoreHistogram;
    mapping(uint256 projectId => uint256 weight) public midTotalWeight;
    mapping(uint256 projectId => uint256 weightedSum) public midWeightedScoreSum;
    mapping(uint256 projectId => uint256 count) public midScoreCount;
    mapping(uint256 projectId => uint256 weight) public finalTotalWeight;
    mapping(uint256 projectId => uint256 weightedSum) public finalWeightedScoreSum;
    mapping(uint256 projectId => uint256 count) public finalScoreCount;

    mapping(uint256 projectId => mapping(address challenger => uint256 amount))
        public challengeStake;
    mapping(uint256 projectId => address[] challengers) private projectChallengers;
    mapping(uint256 projectId => uint256 amount) public totalChallengeStake;
    mapping(uint256 projectId => mapping(address voter => bool voted))
        public hasVotedOnDispute;
    mapping(uint256 projectId => mapping(address voter => uint256 amount))
        public disputeVoteStake;
    mapping(uint256 projectId => uint256 weight) public disputeSupportWeight;
    mapping(uint256 projectId => uint256 weight) public disputeRejectWeight;
    mapping(uint256 projectId => uint256 count) public disputeVoterCount;
    mapping(uint256 projectId => bool succeeded) public challengeSucceeded;

    mapping(uint256 projectId => uint256 amount) public donorRewardPool;
    mapping(uint256 projectId => uint256 amount) public initiatorRewardPool;
    mapping(uint256 projectId => uint256 amount) public successfulChallengeRewardPool;
    mapping(uint256 projectId => mapping(address account => bool claimed))
        public donorRewardClaimed;
    mapping(uint256 projectId => mapping(address account => bool claimed))
        public initiatorRewardClaimed;
    mapping(uint256 projectId => mapping(address account => bool claimed))
        public successfulChallengeRewardClaimed;
    mapping(uint256 projectId => uint256 amount) public successfulChallengeRewardsClaimed;
    mapping(uint256 projectId => uint256 count) public successfulChallengeClaimCount;
    mapping(uint256 projectId => mapping(address voter => bool unlocked))
        public disputeVoteStakeUnlocked;

    error ZeroAddress();
    error ZeroAmount();
    error InvalidConfiguration();
    error ProjectNotFound(uint256 projectId);
    error InvalidProjectState(YoulinTypes.ProjectState actual);
    error DeadlineNotInFuture();
    error DeadlinePassed();
    error ExpectedDurationTooShort(uint256 minimum, uint256 supplied);
    error EmptyURI();
    error EmptyHash();
    error AlreadyAccepted();
    error InitiatorCountNotMet(uint256 required, uint256 actual);
    error InitiatorStakeNotMet(uint256 required, uint256 actual);
    error DonationExceedsRemaining(uint256 remaining, uint256 supplied);
    error Round1NotCompleted();
    error NoDonation();
    error ReputationAlreadyClaimed();
    error InitiatorCannotEarnDonationReputation();
    error Round1FundsAlreadyClaimed();
    error NotInitiator();
    error NativeTransferFailed();
    error Round1NotFailed();
    error RefundAlreadyClaimed();
    error SubmissionWindowOpen();
    error VotingWindowOpen();
    error ScoreOutOfRange();
    error NotEligibleToScore();
    error ScoreAlreadySubmitted();
    error ZeroVotingWeight();
    error FinalSubmissionNotPending();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error InitiatorCannotChallenge();
    error ChallengeAlreadySupported();
    error ChallengeStakeTooLow(uint256 minimum, uint256 supplied);
    error TooManyChallengeSupporters(uint256 maximum);
    error NoChallenge();
    error ChallengeExists();
    error JurorNotEligible();
    error JurorStakeTooLow(uint256 minimum, uint256 supplied);
    error DisputeVoteAlreadySubmitted();
    error ProjectNotSettled();
    error NothingToClaim();
    error RewardAlreadyClaimed();
    error VoteStakeAlreadyUnlocked();

    event ProjectDraftCreated(
        uint256 indexed projectId,
        address indexed creator,
        address indexed projectWallet,
        uint256 targetAmount
    );
    event InitiationAccepted(
        uint256 indexed projectId,
        address indexed initiator,
        uint256 stakeAmount
    );
    event ProjectActivated(uint256 indexed projectId, uint256 activatedAt);
    event ProjectDraftCancelled(uint256 indexed projectId, uint256 unlockedStake);
    event DonationReceived(
        uint256 indexed projectId,
        address indexed donor,
        uint8 indexed round,
        uint256 amount
    );
    event Round1Completed(
        uint256 indexed projectId,
        uint256 completedAt,
        uint256 midSubmissionDeadline
    );
    event Round1DonationReputationClaimed(
        uint256 indexed projectId,
        address indexed donor,
        uint256 amount
    );
    event Round1FundsClaimed(
        uint256 indexed projectId,
        address indexed projectWallet,
        uint256 amount
    );
    event Round1Failed(uint256 indexed projectId);
    event Round1Refunded(uint256 indexed projectId, address indexed donor, uint256 amount);
    event MidReviewSubmitted(
        uint256 indexed projectId,
        string evidenceURI,
        bytes32 evidenceHash,
        uint256 finalSubmissionDeadline
    );
    event MidSubmissionOverdue(uint256 indexed projectId, uint256 finalSubmissionDeadline);
    event ScoreSubmitted(
        uint256 indexed projectId,
        address indexed scorer,
        uint8 indexed reviewType,
        uint8 rawScore,
        uint256 weight
    );
    event ScoreFinalized(
        uint256 indexed projectId,
        uint8 indexed reviewType,
        uint16 score100
    );
    event FinalReviewSubmitted(
        uint256 indexed projectId,
        string evidenceURI,
        bytes32 evidenceHash
    );
    event FinalSubmissionOverdue(uint256 indexed projectId);
    event ChallengeSupported(
        uint256 indexed projectId,
        address indexed challenger,
        uint256 stakeAmount,
        string evidenceURI,
        bytes32 evidenceHash
    );
    event DisputeVotingStarted(uint256 indexed projectId, uint256 votingEndsAt);
    event DisputeVoteCast(
        uint256 indexed projectId,
        address indexed voter,
        bool supportChallenge,
        uint256 stakeAmount,
        uint256 weight
    );
    event DisputeFinalized(uint256 indexed projectId, bool challengeSucceeded);
    event ProjectSettled(
        uint256 indexed projectId,
        uint16 finalScore,
        bool challengeSucceeded,
        uint256 returnedStake,
        uint256 burnedStake,
        uint256 mintedStake
    );
    event ChallengeRewardClaimed(
        uint256 indexed projectId,
        address indexed account,
        uint8 indexed rewardType,
        uint256 amount
    );
    event DisputeVoteStakeUnlocked(
        uint256 indexed projectId,
        address indexed voter,
        uint256 amount
    );

    constructor(
        address admin,
        address reputationAddress,
        address participationAddress,
        uint64 minExpectedDuration_,
        uint64 midVotingDuration_,
        uint64 finalVotingDuration_,
        uint64 challengeDuration_,
        uint64 disputeVotingDuration_,
        uint256 minChallengeStake_,
        uint256 minJurorStake_,
        uint16 challengePassBps_,
        uint16 minDisputeVoters_,
        uint256 previousProjectCount_
    ) {
        if (
            admin == address(0) ||
            reputationAddress == address(0) ||
            participationAddress == address(0)
        ) revert ZeroAddress();
        if (
            minExpectedDuration_ == 0 ||
            midVotingDuration_ == 0 ||
            finalVotingDuration_ == 0 ||
            challengeDuration_ == 0 ||
            disputeVotingDuration_ == 0 ||
            minChallengeStake_ == 0 ||
            minJurorStake_ == 0 ||
            challengePassBps_ > BPS ||
            minDisputeVoters_ == 0
        ) revert InvalidConfiguration();

        reputation = IYoulinReputation(reputationAddress);
        participation = IYoulinParticipation(participationAddress);
        minExpectedDuration = minExpectedDuration_;
        midVotingDuration = midVotingDuration_;
        finalVotingDuration = finalVotingDuration_;
        challengeDuration = challengeDuration_;
        disputeVotingDuration = disputeVotingDuration_;
        minChallengeStake = minChallengeStake_;
        minJurorStake = minJurorStake_;
        challengePassBps = challengePassBps_;
        minDisputeVoters = minDisputeVoters_;
        projectCount = previousProjectCount_;
        firstProjectId = previousProjectCount_ + 1;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function initiatorBounds(
        uint256 targetAmount
    ) public pure returns (uint256 minimum, uint256 maximum) {
        if (targetAmount == 0) revert ZeroAmount();
        uint256 targetBasedMinimum = Math.ceilDiv(targetAmount, 1_000 ether);
        minimum = Math.max(3, targetBasedMinimum);
        uint256 targetBasedMaximum = Math.min(10, targetAmount / (10 ether));
        maximum = Math.max(minimum, targetBasedMaximum);
    }

    function createProjectDraft(
        address payable projectWallet,
        uint128 targetAmount,
        uint64 round1Deadline,
        uint64 expectedDuration,
        string calldata metadataURI,
        bytes32 metadataHash
    ) external whenNotPaused returns (uint256 projectId) {
        return _createProjectDraft(
            projectWallet,
            targetAmount,
            round1Deadline,
            expectedDuration,
            metadataURI,
            metadataHash
        );
    }

    /// @dev Backwards-compatible selector for legacy scripts. The address list is
    /// intentionally ignored: initiation is public and never invitation-gated.
    function createProjectDraft(
        address payable projectWallet,
        uint128 targetAmount,
        uint64 round1Deadline,
        uint64 expectedDuration,
        address[] calldata,
        string calldata metadataURI,
        bytes32 metadataHash
    ) external whenNotPaused returns (uint256 projectId) {
        return _createProjectDraft(
            projectWallet,
            targetAmount,
            round1Deadline,
            expectedDuration,
            metadataURI,
            metadataHash
        );
    }

    function _createProjectDraft(
        address payable projectWallet,
        uint128 targetAmount,
        uint64 round1Deadline,
        uint64 expectedDuration,
        string calldata metadataURI,
        bytes32 metadataHash
    ) private returns (uint256 projectId) {
        if (projectWallet == address(0)) revert ZeroAddress();
        if (targetAmount == 0) revert ZeroAmount();
        if (round1Deadline <= block.timestamp) revert DeadlineNotInFuture();
        if (expectedDuration < minExpectedDuration) {
            revert ExpectedDurationTooShort(minExpectedDuration, expectedDuration);
        }
        if (bytes(metadataURI).length == 0) revert EmptyURI();
        if (metadataHash == bytes32(0)) revert EmptyHash();

        projectId = ++projectCount;
        Project storage project = projects[projectId];
        project.creator = msg.sender;
        project.projectWallet = projectWallet;
        project.state = YoulinTypes.ProjectState.Draft;
        project.targetAmount = targetAmount;
        project.round1Deadline = round1Deadline;
        project.expectedDuration = expectedDuration;
        project.metadataURI = metadataURI;
        project.metadataHash = metadataHash;

        emit ProjectDraftCreated(projectId, msg.sender, projectWallet, targetAmount);
    }

    function acceptInitiation(
        uint256 projectId,
        uint256 stakeAmount
    ) external whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.Draft) {
            revert InvalidProjectState(project.state);
        }
        if (isInitiator[projectId][msg.sender]) revert AlreadyAccepted();
        if (stakeAmount == 0) revert ZeroAmount();

        reputation.lockByProtocol(msg.sender, stakeAmount, projectId);
        isInitiator[projectId][msg.sender] = true;
        initiatorStake[projectId][msg.sender] = stakeAmount;
        initiatorsByProject[projectId].push(msg.sender);
        totalInitiatorStake[projectId] += stakeAmount;
        acceptedInitiatorCount[projectId] += 1;
        _indexInitiatedProject(msg.sender, projectId);

        emit InitiationAccepted(projectId, msg.sender, stakeAmount);
    }

    function activateProject(
        uint256 projectId
    ) external whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.Draft) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp >= project.round1Deadline) revert DeadlinePassed();
        (uint256 minimum, ) = initiatorBounds(project.targetAmount);
        uint256 accepted = acceptedInitiatorCount[projectId];
        if (accepted < minimum) {
            revert InitiatorCountNotMet(minimum, accepted);
        }
        uint256 totalStake = totalInitiatorStake[projectId];
        if (totalStake < project.targetAmount) {
            revert InitiatorStakeNotMet(project.targetAmount, totalStake);
        }

        project.state = YoulinTypes.ProjectState.Round1Funding;
        project.activatedAt = uint64(block.timestamp);
        emit ProjectActivated(projectId, block.timestamp);
    }

    function cancelExpiredDraft(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.Draft) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp < project.round1Deadline) revert SubmissionWindowOpen();
        uint256 unlocked = _unlockAllInitiatorStakes(projectId);
        project.state = YoulinTypes.ProjectState.Cancelled;
        project.settled = true;
        emit ProjectDraftCancelled(projectId, unlocked);
        emit ProjectSettled(projectId, 0, false, unlocked, 0, 0);
    }

    function donateRound1(
        uint256 projectId
    ) external payable nonReentrant whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.Round1Funding) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp > project.round1Deadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroAmount();

        uint256 remaining = round1Cap(projectId) - project.round1Raised;
        if (msg.value > remaining) revert DonationExceedsRemaining(remaining, msg.value);

        bool firstDonation = round1DonationOf[projectId][msg.sender] == 0 &&
            round2DonationOf[projectId][msg.sender] == 0;
        round1DonationOf[projectId][msg.sender] += msg.value;
        project.round1Raised += uint128(msg.value);
        if (firstDonation) {
            uniqueDonorCount[projectId] += 1;
            _mintParticipationAndIndex(msg.sender, projectId);
        }
        emit DonationReceived(projectId, msg.sender, 1, msg.value);

        if (project.round1Raised == round1Cap(projectId)) {
            project.round1CompletedAt = uint64(block.timestamp);
            project.midSubmissionDeadline = uint64(
                block.timestamp + (uint256(project.expectedDuration) * 2) / 3
            );
            project.state = YoulinTypes.ProjectState.MidSubmissionPending;
            emit Round1Completed(
                projectId,
                block.timestamp,
                project.midSubmissionDeadline
            );
        }
    }

    function claimRound1DonationReputation(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.round1CompletedAt == 0) revert Round1NotCompleted();
        uint256 donation = round1DonationOf[projectId][msg.sender];
        if (donation == 0) revert NoDonation();
        if (isInitiator[projectId][msg.sender]) {
            revert InitiatorCannotEarnDonationReputation();
        }
        if (round1ReputationClaimed[projectId][msg.sender]) {
            revert ReputationAlreadyClaimed();
        }
        round1ReputationClaimed[projectId][msg.sender] = true;
        reputation.mintByProtocol(
            msg.sender,
            donation,
            uint8(YoulinTypes.ReputationReason.Round1Donation),
            projectId
        );
        emit Round1DonationReputationClaimed(projectId, msg.sender, donation);
    }

    function claimRound1Funds(
        uint256 projectId
    ) external nonReentrant projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.round1CompletedAt == 0) revert Round1NotCompleted();
        if (!isInitiator[projectId][msg.sender]) revert NotInitiator();
        if (project.round1FundsClaimed) revert Round1FundsAlreadyClaimed();

        project.round1FundsClaimed = true;
        uint256 amount = project.round1Raised;
        (bool success, ) = project.projectWallet.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
        emit Round1FundsClaimed(projectId, project.projectWallet, amount);
    }

    function markRound1Failed(uint256 projectId) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.Round1Funding) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp <= project.round1Deadline) revert SubmissionWindowOpen();
        if (project.round1Raised >= round1Cap(projectId)) revert Round1NotFailed();
        uint256 unlocked = _unlockAllInitiatorStakes(projectId);
        project.state = YoulinTypes.ProjectState.Round1Failed;
        project.settled = true;
        emit Round1Failed(projectId);
        emit ProjectSettled(projectId, 0, false, unlocked, 0, 0);
    }

    function refundRound1(
        uint256 projectId
    ) external nonReentrant projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.Round1Failed) {
            revert InvalidProjectState(project.state);
        }
        uint256 amount = round1DonationOf[projectId][msg.sender];
        if (amount == 0) revert NoDonation();
        if (round1Refunded[projectId][msg.sender]) revert RefundAlreadyClaimed();
        round1Refunded[projectId][msg.sender] = true;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
        emit Round1Refunded(projectId, msg.sender, amount);
    }

    function submitMidReview(
        uint256 projectId,
        string calldata evidenceURI,
        bytes32 evidenceHash
    ) external whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.MidSubmissionPending) {
            revert InvalidProjectState(project.state);
        }
        if (!isInitiator[projectId][msg.sender]) revert NotInitiator();
        if (block.timestamp > project.midSubmissionDeadline) revert DeadlinePassed();
        if (bytes(evidenceURI).length == 0) revert EmptyURI();
        if (evidenceHash == bytes32(0)) revert EmptyHash();

        project.midEvidenceURI = evidenceURI;
        project.midEvidenceHash = evidenceHash;
        project.midSubmittedAt = uint64(block.timestamp);
        project.midVotingEndsAt = uint64(block.timestamp + midVotingDuration);
        uint256 firstPhaseDuration = block.timestamp - project.round1CompletedAt;
        project.finalSubmissionDeadline = uint64(block.timestamp + firstPhaseDuration);
        project.state = YoulinTypes.ProjectState.MidScoring;
        emit MidReviewSubmitted(
            projectId,
            evidenceURI,
            evidenceHash,
            project.finalSubmissionDeadline
        );
    }

    function markMidSubmissionOverdue(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.MidSubmissionPending) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp <= project.midSubmissionDeadline) revert SubmissionWindowOpen();
        project.midScore = 0;
        project.finalSubmissionDeadline = uint64(
            uint256(project.midSubmissionDeadline) + uint256(project.expectedDuration) / 3
        );
        project.state = YoulinTypes.ProjectState.FinalSubmissionPending;
        emit ScoreFinalized(projectId, 1, 0);
        emit MidSubmissionOverdue(projectId, project.finalSubmissionDeadline);
    }

    function submitMidScore(
        uint256 projectId,
        uint8 score
    ) external whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.MidScoring) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp > project.midVotingEndsAt) revert DeadlinePassed();
        if (score < 1 || score > 10) revert ScoreOutOfRange();
        if (!canSubmitMidScore(projectId, msg.sender)) revert NotEligibleToScore();

        uint256 weight = donationWeight(round1DonationOf[projectId][msg.sender]);
        if (weight == 0) revert ZeroVotingWeight();
        hasSubmittedMidScore[projectId][msg.sender] = true;
        midScoreHistogram[projectId][score - 1] += 1;
        midTotalWeight[projectId] += weight;
        midWeightedScoreSum[projectId] += weight * score;
        midScoreCount[projectId] += 1;
        reputation.mintByProtocol(
            msg.sender,
            MID_SCORE_REWARD_R,
            uint8(YoulinTypes.ReputationReason.MidScoreReward),
            projectId
        );
        emit ScoreSubmitted(projectId, msg.sender, 1, score, weight);
    }

    function finalizeMidScore(uint256 projectId) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.MidScoring) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp <= project.midVotingEndsAt) revert VotingWindowOpen();
        uint16 score100 = _calculateScore(
            midWeightedScoreSum[projectId],
            midTotalWeight[projectId]
        );
        project.midScore = score100;
        project.state = score100 >= SCORE_THRESHOLD
            ? YoulinTypes.ProjectState.Round2Funding
            : YoulinTypes.ProjectState.FinalSubmissionPending;
        emit ScoreFinalized(projectId, 1, score100);
    }

    function donateRound2(
        uint256 projectId
    ) external payable nonReentrant whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.Round2Funding) {
            revert InvalidProjectState(project.state);
        }
        if (project.midScore < SCORE_THRESHOLD) revert NotEligibleToScore();
        if (block.timestamp > project.finalSubmissionDeadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroAmount();

        uint256 remaining = round2Cap(projectId) - project.round2Raised;
        if (msg.value > remaining) revert DonationExceedsRemaining(remaining, msg.value);
        bool firstDonation = round1DonationOf[projectId][msg.sender] == 0 &&
            round2DonationOf[projectId][msg.sender] == 0;
        round2DonationOf[projectId][msg.sender] += msg.value;
        project.round2Raised += uint128(msg.value);
        if (firstDonation) {
            uniqueDonorCount[projectId] += 1;
            _mintParticipationAndIndex(msg.sender, projectId);
        }
        if (!isInitiator[projectId][msg.sender]) {
            reputation.mintByProtocol(
                msg.sender,
                msg.value,
                uint8(YoulinTypes.ReputationReason.Round2Donation),
                projectId
            );
        }
        if (project.round2Raised == round2Cap(projectId)) {
            project.state = YoulinTypes.ProjectState.FinalSubmissionPending;
        }
        emit DonationReceived(projectId, msg.sender, 2, msg.value);

        (bool success, ) = project.projectWallet.call{value: msg.value}("");
        if (!success) revert NativeTransferFailed();
    }

    function submitFinalReview(
        uint256 projectId,
        string calldata evidenceURI,
        bytes32 evidenceHash
    ) external whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (
            project.state != YoulinTypes.ProjectState.Round2Funding &&
            project.state != YoulinTypes.ProjectState.FinalSubmissionPending
        ) revert FinalSubmissionNotPending();
        if (!isInitiator[projectId][msg.sender]) revert NotInitiator();
        if (block.timestamp > project.finalSubmissionDeadline) revert DeadlinePassed();
        if (bytes(evidenceURI).length == 0) revert EmptyURI();
        if (evidenceHash == bytes32(0)) revert EmptyHash();

        project.finalEvidenceURI = evidenceURI;
        project.finalEvidenceHash = evidenceHash;
        project.finalSubmittedAt = uint64(block.timestamp);
        project.finalVotingEndsAt = uint64(block.timestamp + finalVotingDuration);
        project.state = YoulinTypes.ProjectState.FinalScoring;
        emit FinalReviewSubmitted(projectId, evidenceURI, evidenceHash);
    }

    function markFinalSubmissionOverdue(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (
            project.state != YoulinTypes.ProjectState.Round2Funding &&
            project.state != YoulinTypes.ProjectState.FinalSubmissionPending
        ) revert FinalSubmissionNotPending();
        if (block.timestamp <= project.finalSubmissionDeadline) {
            revert SubmissionWindowOpen();
        }
        project.finalScore = 0;
        emit FinalSubmissionOverdue(projectId);
        emit ScoreFinalized(projectId, 2, 0);
        _settleLowScore(projectId);
    }

    function submitFinalScore(
        uint256 projectId,
        uint8 score
    ) external whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.FinalScoring) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp > project.finalVotingEndsAt) revert DeadlinePassed();
        if (score < 1 || score > 10) revert ScoreOutOfRange();
        if (!canSubmitFinalScore(projectId, msg.sender)) revert NotEligibleToScore();

        uint256 donated = round1DonationOf[projectId][msg.sender] +
            round2DonationOf[projectId][msg.sender];
        uint256 weight = donationWeight(donated);
        if (weight == 0) revert ZeroVotingWeight();
        hasSubmittedFinalScore[projectId][msg.sender] = true;
        finalScoreHistogram[projectId][score - 1] += 1;
        finalTotalWeight[projectId] += weight;
        finalWeightedScoreSum[projectId] += weight * score;
        finalScoreCount[projectId] += 1;
        reputation.mintByProtocol(
            msg.sender,
            FINAL_SCORE_REWARD_R,
            uint8(YoulinTypes.ReputationReason.FinalScoreReward),
            projectId
        );
        emit ScoreSubmitted(projectId, msg.sender, 2, score, weight);
    }

    function finalizeFinalScore(uint256 projectId) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.FinalScoring) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp <= project.finalVotingEndsAt) revert VotingWindowOpen();
        uint16 score100 = _calculateScore(
            finalWeightedScoreSum[projectId],
            finalTotalWeight[projectId]
        );
        project.finalScore = score100;
        emit ScoreFinalized(projectId, 2, score100);
        if (score100 < SCORE_THRESHOLD) {
            _settleLowScore(projectId);
        } else {
            project.challengeEndsAt = uint64(block.timestamp + challengeDuration);
            project.state = YoulinTypes.ProjectState.ChallengeWindow;
        }
    }

    function supportChallenge(
        uint256 projectId,
        uint256 stakeAmount,
        string calldata evidenceURI,
        bytes32 evidenceHash
    ) external whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.ChallengeWindow) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp > project.challengeEndsAt) revert ChallengeWindowClosed();
        if (isInitiator[projectId][msg.sender]) revert InitiatorCannotChallenge();
        if (challengeStake[projectId][msg.sender] != 0) revert ChallengeAlreadySupported();
        if (stakeAmount < minChallengeStake) {
            revert ChallengeStakeTooLow(minChallengeStake, stakeAmount);
        }
        if (projectChallengers[projectId].length >= MAX_CHALLENGE_SUPPORTERS) {
            revert TooManyChallengeSupporters(MAX_CHALLENGE_SUPPORTERS);
        }
        if (bytes(evidenceURI).length == 0) revert EmptyURI();
        if (evidenceHash == bytes32(0)) revert EmptyHash();

        reputation.lockByProtocol(msg.sender, stakeAmount, projectId);
        challengeStake[projectId][msg.sender] = stakeAmount;
        totalChallengeStake[projectId] += stakeAmount;
        projectChallengers[projectId].push(msg.sender);
        emit ChallengeSupported(
            projectId,
            msg.sender,
            stakeAmount,
            evidenceURI,
            evidenceHash
        );
    }

    function beginDisputeVoting(uint256 projectId) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.ChallengeWindow) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp <= project.challengeEndsAt) revert ChallengeWindowOpen();
        if (totalChallengeStake[projectId] == 0) revert NoChallenge();
        project.disputeVotingEndsAt = uint64(block.timestamp + disputeVotingDuration);
        project.state = YoulinTypes.ProjectState.DisputeVoting;
        emit DisputeVotingStarted(projectId, project.disputeVotingEndsAt);
    }

    function voteOnDispute(
        uint256 projectId,
        bool support,
        uint256 stakeAmount
    ) external whenNotPaused projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.DisputeVoting) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp > project.disputeVotingEndsAt) revert DeadlinePassed();
        if (isInitiator[projectId][msg.sender] || challengeStake[projectId][msg.sender] != 0) {
            revert JurorNotEligible();
        }
        if (hasVotedOnDispute[projectId][msg.sender]) {
            revert DisputeVoteAlreadySubmitted();
        }
        if (stakeAmount < minJurorStake) {
            revert JurorStakeTooLow(minJurorStake, stakeAmount);
        }
        uint256 weight = Math.sqrt(stakeAmount);
        reputation.lockByProtocol(msg.sender, stakeAmount, projectId);
        hasVotedOnDispute[projectId][msg.sender] = true;
        disputeVoteStake[projectId][msg.sender] = stakeAmount;
        disputeVoterCount[projectId] += 1;
        if (support) {
            disputeSupportWeight[projectId] += weight;
        } else {
            disputeRejectWeight[projectId] += weight;
        }
        emit DisputeVoteCast(projectId, msg.sender, support, stakeAmount, weight);
    }

    function finalizeDispute(uint256 projectId) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.DisputeVoting) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp <= project.disputeVotingEndsAt) revert VotingWindowOpen();
        uint256 supportWeight = disputeSupportWeight[projectId];
        uint256 totalWeight = supportWeight + disputeRejectWeight[projectId];
        bool succeeded = disputeVoterCount[projectId] >= minDisputeVoters &&
            totalWeight != 0 &&
            supportWeight * BPS >= totalWeight * challengePassBps;
        challengeSucceeded[projectId] = succeeded;
        if (succeeded) {
            _settleSuccessfulChallenge(projectId);
        } else {
            _settleFailedChallenge(projectId);
        }
        emit DisputeFinalized(projectId, succeeded);
    }

    function settleWithoutChallenge(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (project.state != YoulinTypes.ProjectState.ChallengeWindow) {
            revert InvalidProjectState(project.state);
        }
        if (block.timestamp <= project.challengeEndsAt) revert ChallengeWindowOpen();
        if (totalChallengeStake[projectId] != 0) revert ChallengeExists();
        _settleNormal(projectId);
    }

    function claimDonorChallengeReward(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (!project.settled || challengeSucceeded[projectId]) revert ProjectNotSettled();
        if (donorRewardClaimed[projectId][msg.sender]) revert RewardAlreadyClaimed();
        uint256 donation = round1DonationOf[projectId][msg.sender] +
            round2DonationOf[projectId][msg.sender];
        if (donation == 0 || donorRewardPool[projectId] == 0) revert NothingToClaim();
        uint256 totalDonations = uint256(project.round1Raised) + project.round2Raised;
        uint256 reward = Math.mulDiv(donorRewardPool[projectId], donation, totalDonations);
        if (reward == 0) revert NothingToClaim();
        donorRewardClaimed[projectId][msg.sender] = true;
        _mintChallengeReward(projectId, msg.sender, reward, 1);
    }

    function claimInitiatorChallengeReward(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (!project.settled || challengeSucceeded[projectId]) revert ProjectNotSettled();
        if (initiatorRewardClaimed[projectId][msg.sender]) revert RewardAlreadyClaimed();
        uint256 stake = initiatorStake[projectId][msg.sender];
        if (stake == 0 || initiatorRewardPool[projectId] == 0) revert NothingToClaim();
        uint256 reward = Math.mulDiv(
            initiatorRewardPool[projectId],
            stake,
            totalInitiatorStake[projectId]
        );
        if (reward == 0) revert NothingToClaim();
        initiatorRewardClaimed[projectId][msg.sender] = true;
        _mintChallengeReward(projectId, msg.sender, reward, 2);
    }

    function claimSuccessfulChallengeReward(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (
            !project.settled ||
            project.state != YoulinTypes.ProjectState.ChallengeSucceeded
        ) revert ProjectNotSettled();
        if (successfulChallengeRewardClaimed[projectId][msg.sender]) {
            revert RewardAlreadyClaimed();
        }
        uint256 stake = challengeStake[projectId][msg.sender];
        if (stake == 0) revert NothingToClaim();
        uint256 pool = successfulChallengeRewardPool[projectId];
        uint256 claimed = successfulChallengeRewardsClaimed[projectId];
        uint256 claimCount = successfulChallengeClaimCount[projectId];
        uint256 reward = claimCount + 1 == projectChallengers[projectId].length
            ? pool - claimed
            : Math.mulDiv(pool, stake, totalChallengeStake[projectId]);
        if (reward == 0) revert NothingToClaim();
        successfulChallengeRewardClaimed[projectId][msg.sender] = true;
        successfulChallengeRewardsClaimed[projectId] = claimed + reward;
        successfulChallengeClaimCount[projectId] = claimCount + 1;
        _mintChallengeReward(projectId, msg.sender, reward, 3);
    }

    function unlockDisputeVoteStake(
        uint256 projectId
    ) external projectExists(projectId) {
        Project storage project = projects[projectId];
        if (!project.settled) revert ProjectNotSettled();
        uint256 amount = disputeVoteStake[projectId][msg.sender];
        if (amount == 0) revert NothingToClaim();
        if (disputeVoteStakeUnlocked[projectId][msg.sender]) {
            revert VoteStakeAlreadyUnlocked();
        }
        disputeVoteStakeUnlocked[projectId][msg.sender] = true;
        reputation.unlockByProtocol(msg.sender, amount, projectId);
        emit DisputeVoteStakeUnlocked(projectId, msg.sender, amount);
    }

    function donationWeight(uint256 donationWei) public pure returns (uint256) {
        if (donationWei == 0) return 0;
        UD60x18 base = ud(1 ether + donationWei);
        return base.ln().unwrap();
    }

    function canSubmitMidScore(
        uint256 projectId,
        address account
    ) public view returns (bool) {
        if (projectId == 0 || projectId > projectCount) return false;
        Project storage project = projects[projectId];
        return
            project.state == YoulinTypes.ProjectState.MidScoring &&
            block.timestamp <= project.midVotingEndsAt &&
            round1DonationOf[projectId][account] != 0 &&
            !isInitiator[projectId][account] &&
            !hasSubmittedMidScore[projectId][account] &&
            participation.hasCredential(account, projectId);
    }

    function canSubmitFinalScore(
        uint256 projectId,
        address account
    ) public view returns (bool) {
        if (projectId == 0 || projectId > projectCount) return false;
        Project storage project = projects[projectId];
        uint256 donation = round1DonationOf[projectId][account] +
            round2DonationOf[projectId][account];
        return
            project.state == YoulinTypes.ProjectState.FinalScoring &&
            block.timestamp <= project.finalVotingEndsAt &&
            donation != 0 &&
            !isInitiator[projectId][account] &&
            !hasSubmittedFinalScore[projectId][account] &&
            participation.hasCredential(account, projectId);
    }

    function canChallenge(
        uint256 projectId,
        address account
    ) external view returns (bool) {
        if (projectId == 0 || projectId > projectCount) return false;
        Project storage project = projects[projectId];
        return
            project.state == YoulinTypes.ProjectState.ChallengeWindow &&
            project.finalScore >= SCORE_THRESHOLD &&
            block.timestamp <= project.challengeEndsAt &&
            !isInitiator[projectId][account] &&
            challengeStake[projectId][account] == 0 &&
            reputation.availableBalanceOf(account) >= minChallengeStake;
    }

    function claimableRewards(
        uint256 projectId,
        address account
    )
        external
        view
        returns (
            uint256 donorReward,
            uint256 initiatorReward,
            uint256 successfulChallengerReward,
            uint256 voteStakeToUnlock
        )
    {
        if (projectId == 0 || projectId > projectCount) return (0, 0, 0, 0);
        Project storage project = projects[projectId];
        if (!donorRewardClaimed[projectId][account] && donorRewardPool[projectId] != 0) {
            uint256 donation = round1DonationOf[projectId][account] +
                round2DonationOf[projectId][account];
            uint256 totalDonations = uint256(project.round1Raised) + project.round2Raised;
            if (donation != 0 && totalDonations != 0) {
                donorReward = Math.mulDiv(
                    donorRewardPool[projectId],
                    donation,
                    totalDonations
                );
            }
        }
        if (
            !initiatorRewardClaimed[projectId][account] &&
            initiatorRewardPool[projectId] != 0 &&
            initiatorStake[projectId][account] != 0
        ) {
            initiatorReward = Math.mulDiv(
                initiatorRewardPool[projectId],
                initiatorStake[projectId][account],
                totalInitiatorStake[projectId]
            );
        }
        if (
            !successfulChallengeRewardClaimed[projectId][account] &&
            successfulChallengeRewardPool[projectId] != 0 &&
            challengeStake[projectId][account] != 0
        ) {
            successfulChallengerReward = Math.mulDiv(
                successfulChallengeRewardPool[projectId],
                challengeStake[projectId][account],
                totalChallengeStake[projectId]
            );
        }
        if (
            project.settled &&
            !disputeVoteStakeUnlocked[projectId][account]
        ) {
            voteStakeToUnlock = disputeVoteStake[projectId][account];
        }
    }

    function getScoreHistograms(
        uint256 projectId
    )
        external
        view
        projectExists(projectId)
        returns (uint256[10] memory mid, uint256[10] memory final_)
    {
        return (midScoreHistogram[projectId], finalScoreHistogram[projectId]);
    }

    function getChallengeSummary(
        uint256 projectId
    )
        external
        view
        projectExists(projectId)
        returns (
            uint256 totalStake,
            uint256 challengerCount,
            uint256 supportWeight,
            uint256 rejectWeight,
            uint256 voterCount,
            bool succeeded
        )
    {
        return (
            totalChallengeStake[projectId],
            projectChallengers[projectId].length,
            disputeSupportWeight[projectId],
            disputeRejectWeight[projectId],
            disputeVoterCount[projectId],
            challengeSucceeded[projectId]
        );
    }

    function getProjectCore(
        uint256 projectId
    )
        external
        view
        projectExists(projectId)
        returns (
            address creator,
            address projectWallet,
            YoulinTypes.ProjectState state,
            uint256 targetAmount,
            uint256 round1Raised,
            uint256 round2Raised,
            uint16 midScore,
            uint16 finalScore,
            bool round1FundsClaimed,
            bool settled
        )
    {
        Project storage project = projects[projectId];
        return (
            project.creator,
            project.projectWallet,
            project.state,
            project.targetAmount,
            project.round1Raised,
            project.round2Raised,
            project.midScore,
            project.finalScore,
            project.round1FundsClaimed,
            project.settled
        );
    }

    function getProjectTimes(
        uint256 projectId
    )
        external
        view
        projectExists(projectId)
        returns (
            uint64 round1Deadline,
            uint64 expectedDuration,
            uint64 activatedAt,
            uint64 round1CompletedAt,
            uint64 midSubmissionDeadline,
            uint64 midSubmittedAt,
            uint64 midVotingEndsAt,
            uint64 finalSubmissionDeadline,
            uint64 finalSubmittedAt,
            uint64 finalVotingEndsAt,
            uint64 challengeEndsAt,
            uint64 disputeVotingEndsAt
        )
    {
        Project storage project = projects[projectId];
        return (
            project.round1Deadline,
            project.expectedDuration,
            project.activatedAt,
            project.round1CompletedAt,
            project.midSubmissionDeadline,
            project.midSubmittedAt,
            project.midVotingEndsAt,
            project.finalSubmissionDeadline,
            project.finalSubmittedAt,
            project.finalVotingEndsAt,
            project.challengeEndsAt,
            project.disputeVotingEndsAt
        );
    }

    function getProjectContent(
        uint256 projectId
    )
        external
        view
        projectExists(projectId)
        returns (
            string memory metadataURI,
            bytes32 metadataHash,
            string memory midEvidenceURI,
            bytes32 midEvidenceHash,
            string memory finalEvidenceURI,
            bytes32 finalEvidenceHash
        )
    {
        Project storage project = projects[projectId];
        return (
            project.metadataURI,
            project.metadataHash,
            project.midEvidenceURI,
            project.midEvidenceHash,
            project.finalEvidenceURI,
            project.finalEvidenceHash
        );
    }

    function getInitiators(
        uint256 projectId
    )
        external
        view
        projectExists(projectId)
        returns (address[] memory accounts, bool[] memory accepted, uint256[] memory stakes)
    {
        accounts = initiatorsByProject[projectId];
        uint256 length = accounts.length;
        accepted = new bool[](length);
        stakes = new uint256[](length);
        for (uint256 i; i < length; ++i) {
            accepted[i] = isInitiator[projectId][accounts[i]];
            stakes[i] = initiatorStake[projectId][accounts[i]];
        }
    }

    function getInitiatedProjects(
        address account,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory result) {
        return _paginate(initiatedProjectIds[account], offset, limit);
    }

    function getParticipatedProjects(
        address account,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory result) {
        return _paginate(participatedProjectIds[account], offset, limit);
    }

    function round1Cap(
        uint256 projectId
    ) public view projectExists(projectId) returns (uint256) {
        return projects[projectId].targetAmount / 2;
    }

    function round2Cap(
        uint256 projectId
    ) public view projectExists(projectId) returns (uint256) {
        Project storage project = projects[projectId];
        return project.targetAmount - (project.targetAmount / 2);
    }

    function remainingRound1(
        uint256 projectId
    ) external view projectExists(projectId) returns (uint256) {
        return round1Cap(projectId) - projects[projectId].round1Raised;
    }

    function remainingRound2(
        uint256 projectId
    ) external view projectExists(projectId) returns (uint256) {
        return round2Cap(projectId) - projects[projectId].round2Raised;
    }

    modifier projectExists(uint256 projectId) {
        if (projectId < firstProjectId || projectId > projectCount) {
            revert ProjectNotFound(projectId);
        }
        _;
    }

    function _indexInitiatedProject(address account, uint256 projectId) private {
        if (!hasIndexedInitiation[account][projectId]) {
            hasIndexedInitiation[account][projectId] = true;
            initiatedProjectIds[account].push(projectId);
        }
    }

    function _mintParticipationAndIndex(address account, uint256 projectId) private {
        participation.mint(account, projectId);
        if (!hasIndexedParticipation[account][projectId]) {
            hasIndexedParticipation[account][projectId] = true;
            participatedProjectIds[account].push(projectId);
        }
    }

    function _calculateScore(
        uint256 weightedScoreSum,
        uint256 totalWeight
    ) private pure returns (uint16) {
        if (totalWeight == 0) return 0;
        return uint16(Math.mulDiv(weightedScoreSum, 10, totalWeight));
    }

    function _unlockAllInitiatorStakes(
        uint256 projectId
    ) private returns (uint256 unlocked) {
        address[] storage accounts = initiatorsByProject[projectId];
        for (uint256 i; i < accounts.length; ++i) {
            uint256 stake = initiatorStake[projectId][accounts[i]];
            if (stake != 0) {
                reputation.unlockByProtocol(accounts[i], stake, projectId);
                unlocked += stake;
            }
        }
    }

    function _settleLowScore(uint256 projectId) private {
        Project storage project = projects[projectId];
        uint256 burned;
        address[] storage accounts = initiatorsByProject[projectId];
        for (uint256 i; i < accounts.length; ++i) {
            uint256 stake = initiatorStake[projectId][accounts[i]];
            if (stake != 0) {
                reputation.burnLockedByProtocol(accounts[i], stake, projectId);
                burned += stake;
            }
        }
        project.state = YoulinTypes.ProjectState.Settled;
        project.settled = true;
        emit ProjectSettled(projectId, project.finalScore, false, 0, burned, 0);
    }

    function _settleNormal(uint256 projectId) private {
        Project storage project = projects[projectId];
        uint256 returned;
        uint256 burned;
        uint256 minted;
        address[] storage accounts = initiatorsByProject[projectId];
        for (uint256 i; i < accounts.length; ++i) {
            address account = accounts[i];
            uint256 stake = initiatorStake[projectId][account];
            if (stake == 0) continue;
            uint256 returnAmount = Math.mulDiv(stake, project.finalScore, 80);
            if (returnAmount <= stake) {
                if (returnAmount != 0) {
                    reputation.unlockByProtocol(account, returnAmount, projectId);
                    returned += returnAmount;
                }
                uint256 burnAmount = stake - returnAmount;
                if (burnAmount != 0) {
                    reputation.burnLockedByProtocol(account, burnAmount, projectId);
                    burned += burnAmount;
                }
            } else {
                reputation.unlockByProtocol(account, stake, projectId);
                uint256 mintAmount = returnAmount - stake;
                reputation.mintByProtocol(
                    account,
                    mintAmount,
                    uint8(YoulinTypes.ReputationReason.HighScoreBonus),
                    projectId
                );
                returned += stake;
                minted += mintAmount;
            }
        }
        project.state = YoulinTypes.ProjectState.Settled;
        project.settled = true;
        emit ProjectSettled(
            projectId,
            project.finalScore,
            false,
            returned,
            burned,
            minted
        );
    }

    function _settleSuccessfulChallenge(uint256 projectId) private {
        Project storage project = projects[projectId];
        address[] storage initiators = initiatorsByProject[projectId];
        uint256 rewardPool;
        for (uint256 i; i < initiators.length; ++i) {
            uint256 stake = initiatorStake[projectId][initiators[i]];
            if (stake != 0) {
                reputation.burnLockedByProtocol(initiators[i], stake, projectId);
                rewardPool += stake;
            }
        }
        address[] storage challengers = projectChallengers[projectId];
        for (uint256 i; i < challengers.length; ++i) {
            reputation.unlockByProtocol(
                challengers[i],
                challengeStake[projectId][challengers[i]],
                projectId
            );
        }
        successfulChallengeRewardPool[projectId] = rewardPool;
        project.state = YoulinTypes.ProjectState.ChallengeSucceeded;
        project.settled = true;
        emit ProjectSettled(
            projectId,
            project.finalScore,
            true,
            0,
            rewardPool,
            0
        );
    }

    function _settleFailedChallenge(uint256 projectId) private {
        uint256 forfeited;
        address[] storage challengers = projectChallengers[projectId];
        for (uint256 i; i < challengers.length; ++i) {
            uint256 stake = challengeStake[projectId][challengers[i]];
            reputation.burnLockedByProtocol(challengers[i], stake, projectId);
            forfeited += stake;
        }
        initiatorRewardPool[projectId] = Math.mulDiv(
            forfeited,
            FAILED_CHALLENGE_INITIATOR_SHARE_BPS,
            BPS
        );
        donorRewardPool[projectId] = forfeited - initiatorRewardPool[projectId];
        _settleNormal(projectId);
    }

    function _mintChallengeReward(
        uint256 projectId,
        address account,
        uint256 amount,
        uint8 rewardType
    ) private {
        reputation.mintByProtocol(
            account,
            amount,
            uint8(YoulinTypes.ReputationReason.ChallengeReward),
            projectId
        );
        emit ChallengeRewardClaimed(projectId, account, rewardType, amount);
    }

    function _paginate(
        uint256[] storage source,
        uint256 offset,
        uint256 limit
    ) private view returns (uint256[] memory result) {
        if (offset >= source.length || limit == 0) return new uint256[](0);
        uint256 end = Math.min(source.length, offset + limit);
        result = new uint256[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            result[i - offset] = source[i];
        }
    }
}
