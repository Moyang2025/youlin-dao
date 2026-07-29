// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library YoulinTypes {
    enum ProjectState {
        Draft,
        Round1Funding,
        Round1Failed,
        MidSubmissionPending,
        MidScoring,
        Round2Funding,
        FinalSubmissionPending,
        FinalScoring,
        ChallengeWindow,
        DisputeVoting,
        Settled,
        ChallengeSucceeded,
        Cancelled
    }

    enum ReputationReason {
        Bootstrap,
        Round1Donation,
        Round2Donation,
        MidScoreReward,
        FinalScoreReward,
        HighScoreBonus,
        ChallengeReward
    }
}
