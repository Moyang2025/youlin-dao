"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  useConnection,
  usePublicClient,
  useWriteContract
} from "wagmi";
import {
  formatEther,
  type Abi,
  type Address,
  type Hash
} from "viem";

import participationArtifact from "./YoulinParticipation.abi.json";
import genesisArtifact from "./YoulinGenesisTreasury.abi.json";
import profileRegistryArtifact from "./YoulinProfileRegistry.abi.json";
import protocolArtifact from "./YoulinProtocol.abi.json";
import reputationArtifact from "./YoulinReputation.abi.json";
import { youlinDeployment } from "./addresses";

export const protocolAbi = protocolArtifact as Abi;
export const reputationAbi = reputationArtifact as Abi;
export const participationAbi = participationArtifact as Abi;
export const genesisTreasuryAbi = genesisArtifact as Abi;
export const profileRegistryAbi = profileRegistryArtifact as Abi;

export const protocolAddress = youlinDeployment.protocol as Address;
export const reputationAddress = youlinDeployment.reputation as Address;
export const participationAddress = youlinDeployment.participation as Address;
export const genesisTreasuryAddress =
  youlinDeployment.genesisTreasury as Address;
export const profileRegistryAddress =
  youlinDeployment.profileRegistry as Address;
export const isYoulinDeployed = youlinDeployment.deployed;
export const isGenesisDeployed = youlinDeployment.genesisDeployed;
export const isProfileDeployed = youlinDeployment.profileDeployed;

export type AccountProfile = {
  nickname: string;
  avatarURI: string;
  bio: string;
  updatedAt: bigint;
  exists: boolean;
};

export function useYoulinAccountProfile(address?: Address) {
  const publicClient = usePublicClient({ chainId: youlinDeployment.chainId });

  return useQuery({
    queryKey: ["youlin", "account-profile", profileRegistryAddress, address],
    enabled: isProfileDeployed && Boolean(publicClient && address),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!publicClient || !address) {
        throw new Error("请先连接钱包。");
      }
      const result = (await publicClient.readContract({
        address: profileRegistryAddress,
        abi: profileRegistryAbi,
        functionName: "getProfile",
        args: [address]
      })) as readonly [string, string, string, bigint, boolean];
      return {
        nickname: result[0],
        avatarURI: result[1],
        bio: result[2],
        updatedAt: result[3],
        exists: result[4]
      } satisfies AccountProfile;
    }
  });
}

export const PROJECT_STATES = [
  "草案待确认",
  "第一轮募捐",
  "首轮未达标",
  "待提交中期材料",
  "中期评分",
  "第二轮募捐",
  "待提交结项材料",
  "结项评分",
  "挑战窗口",
  "争议投票",
  "已结算",
  "挑战成功",
  "已取消"
] as const;

type ProjectCoreTuple = readonly [
  Address,
  Address,
  number,
  bigint,
  bigint,
  bigint,
  number,
  number,
  boolean,
  boolean
];

type ProjectTimesTuple = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint
];

type ProjectContentTuple = readonly [
  string,
  Hash,
  string,
  Hash,
  string,
  Hash
];

export type ProjectMetadata = {
  name?: string;
  title?: string;
  category?: string;
  summary?: string;
  location?: string;
  fundUse?: unknown;
  milestones?: unknown;
};

export type ChainProject = {
  id: bigint;
  creator: Address;
  projectWallet: Address;
  state: number;
  stateLabel: string;
  targetAmount: bigint;
  round1Raised: bigint;
  round2Raised: bigint;
  midScore: number;
  finalScore: number;
  round1FundsClaimed: boolean;
  settled: boolean;
  times: ProjectTimesTuple;
  metadataURI: string;
  metadataHash: Hash;
  midEvidenceURI: string;
  midEvidenceHash: Hash;
  finalEvidenceURI: string;
  finalEvidenceHash: Hash;
  metadata?: ProjectMetadata;
};

type GenesisProposalTuple = readonly [
  Address,
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
  boolean,
  boolean,
  boolean,
  string,
  Hash
];

export type GenesisProposal = {
  id: bigint;
  proposer: Address;
  recipient: Address;
  amount: bigint;
  snapshotVersion: bigint;
  votingEndsAt: bigint;
  voterCount: bigint;
  supportWeight: bigint;
  rejectWeight: bigint;
  finalized: boolean;
  passed: boolean;
  executed: boolean;
  cancelled: boolean;
  metadataURI: string;
  metadataHash: Hash;
  hasVoted: boolean;
};

export type GenesisTreasuryState = {
  totalDonated: bigint;
  donorCount: bigint;
  perAddressCap: bigint;
  votingDuration: bigint;
  availableBalance: bigint;
  reservedBalance: bigint;
  cumulativeDonation: bigint;
  proposalCount: bigint;
  genesisProjectId: bigint;
  hasCredential: boolean;
  proposals: GenesisProposal[];
};

const resolveContentUri = (uri: string) =>
  uri.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`
    : uri;

async function fetchMetadata(uri: string): Promise<ProjectMetadata | undefined> {
  if (!uri || (!uri.startsWith("https://") && !uri.startsWith("ipfs://"))) {
    return undefined;
  }
  try {
    const resolved = resolveContentUri(uri);
    const url = new URL(resolved);
    const canonicalDemoHost =
      "youlin-dao-civic-profile-july24.mo-yang2023.chatgpt.site";
    const requestUrl =
      url.hostname === canonicalDemoHost &&
      url.pathname.startsWith("/demo/metadata/")
        ? `${url.pathname}${url.search}`
        : resolved;
    const response = await fetch(requestUrl);
    if (!response.ok) return undefined;
    return (await response.json()) as ProjectMetadata;
  } catch {
    return undefined;
  }
}

export function useYoulinProjects() {
  const publicClient = usePublicClient({ chainId: youlinDeployment.chainId });

  return useQuery({
    queryKey: ["youlin", "projects", protocolAddress],
    enabled: isYoulinDeployed && Boolean(publicClient),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!publicClient) return [] as ChainProject[];
      const count = (await publicClient.readContract({
        address: protocolAddress,
        abi: protocolAbi,
        functionName: "projectCount"
      })) as bigint;

      const ids = Array.from({ length: Number(count) }, (_, index) =>
        BigInt(index + 1)
      );
      const views = await publicClient.multicall({
        allowFailure: false,
        contracts: ids.flatMap((id) => [
          {
            address: protocolAddress,
            abi: protocolAbi,
            functionName: "getProjectCore",
            args: [id]
          },
          {
            address: protocolAddress,
            abi: protocolAbi,
            functionName: "getProjectTimes",
            args: [id]
          },
          {
            address: protocolAddress,
            abi: protocolAbi,
            functionName: "getProjectContent",
            args: [id]
          }
        ])
      });
      const projects = await Promise.all(
        ids.map(async (id, index) => {
          const core = views[index * 3] as ProjectCoreTuple;
          const times = views[index * 3 + 1] as ProjectTimesTuple;
          const content = views[index * 3 + 2] as ProjectContentTuple;
          const metadata = await fetchMetadata(content[0]);
          return {
            id,
            creator: core[0],
            projectWallet: core[1],
            state: Number(core[2]),
            stateLabel: PROJECT_STATES[Number(core[2])] ?? `状态 ${core[2]}`,
            targetAmount: core[3],
            round1Raised: core[4],
            round2Raised: core[5],
            midScore: Number(core[6]),
            finalScore: Number(core[7]),
            round1FundsClaimed: core[8],
            settled: core[9],
            times,
            metadataURI: content[0],
            metadataHash: content[1],
            midEvidenceURI: content[2],
            midEvidenceHash: content[3],
            finalEvidenceURI: content[4],
            finalEvidenceHash: content[5],
            metadata
          } satisfies ChainProject;
        })
      );
      return projects.reverse();
    }
  });
}

export function useYoulinProfile(address?: Address) {
  const publicClient = usePublicClient({ chainId: youlinDeployment.chainId });

  return useQuery({
    queryKey: ["youlin", "profile", address, reputationAddress],
    enabled: isYoulinDeployed && Boolean(publicClient && address),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!publicClient || !address) {
        return {
          total: 0n,
          locked: 0n,
          available: 0n,
          participated: [] as bigint[],
          initiated: [] as bigint[],
          donations: {} as Record<string, { round1: bigint; round2: bigint }>
        };
      }
      const [total, locked, available, participated, initiated] =
        (await Promise.all([
          publicClient.readContract({
            address: reputationAddress,
            abi: reputationAbi,
            functionName: "balanceOf",
            args: [address]
          }),
          publicClient.readContract({
            address: reputationAddress,
            abi: reputationAbi,
            functionName: "lockedBalanceOf",
            args: [address]
          }),
          publicClient.readContract({
            address: reputationAddress,
            abi: reputationAbi,
            functionName: "availableBalanceOf",
            args: [address]
          }),
          publicClient.readContract({
            address: protocolAddress,
            abi: protocolAbi,
            functionName: "getParticipatedProjects",
            args: [address, 0n, 100n]
          }),
          publicClient.readContract({
            address: protocolAddress,
            abi: protocolAbi,
            functionName: "getInitiatedProjects",
            args: [address, 0n, 100n]
          })
        ])) as [bigint, bigint, bigint, bigint[], bigint[]];
      const donationRows = await Promise.all(
        participated.map(async (projectId) => {
          const [round1, round2] = (await Promise.all([
            publicClient.readContract({
              address: protocolAddress,
              abi: protocolAbi,
              functionName: "round1DonationOf",
              args: [projectId, address]
            }),
            publicClient.readContract({
              address: protocolAddress,
              abi: protocolAbi,
              functionName: "round2DonationOf",
              args: [projectId, address]
            })
          ])) as [bigint, bigint];
          return [projectId.toString(), { round1, round2 }] as const;
        })
      );
      return {
        total,
        locked,
        available,
        participated,
        initiated,
        donations: Object.fromEntries(donationRows) as Record<
          string,
          { round1: bigint; round2: bigint }
        >
      };
    }
  });
}

export function useGenesisTreasury(address?: Address) {
  const publicClient = usePublicClient({ chainId: youlinDeployment.chainId });

  return useQuery({
    queryKey: ["youlin", "genesis", genesisTreasuryAddress, address],
    enabled: isGenesisDeployed && Boolean(publicClient),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!publicClient) throw new Error("Monad RPC 暂不可用。");
      const common = {
        address: genesisTreasuryAddress,
        abi: genesisTreasuryAbi
      } as const;
      const base = await publicClient.multicall({
        allowFailure: false,
        contracts: [
          { ...common, functionName: "totalDonated" },
          { ...common, functionName: "donorCount" },
          { ...common, functionName: "perAddressCap" },
          { ...common, functionName: "votingDuration" },
          { ...common, functionName: "availableBalance" },
          { ...common, functionName: "reservedBalance" },
          {
            ...common,
            functionName: "cumulativeDonationOf",
            args: [address ?? "0x0000000000000000000000000000000000000000"]
          },
          { ...common, functionName: "proposalCount" },
          { ...common, functionName: "GENESIS_PROJECT_ID" }
        ]
      });
      const proposalCount = base[7] as bigint;
      const genesisProjectId = base[8] as bigint;
      const hasCredential = address
        ? ((await publicClient.readContract({
            address: participationAddress,
            abi: participationAbi,
            functionName: "hasCredential",
            args: [address, genesisProjectId]
          })) as boolean)
        : false;
      const ids = Array.from({ length: Number(proposalCount) }, (_, index) =>
        BigInt(index + 1)
      );
      const rows =
        ids.length === 0
          ? []
          : await publicClient.multicall({
              allowFailure: false,
              contracts: ids.flatMap((id) => [
                {
                  ...common,
                  functionName: "getProposal",
                  args: [id]
                },
                {
                  ...common,
                  functionName: "hasVoted",
                  args: [
                    id,
                    address ??
                      "0x0000000000000000000000000000000000000000"
                  ]
                }
              ])
            });
      const proposals = ids
        .map((id, index) => {
          const row = rows[index * 2] as GenesisProposalTuple;
          return {
            id,
            proposer: row[0],
            recipient: row[1],
            amount: row[2],
            snapshotVersion: row[3],
            votingEndsAt: row[4],
            voterCount: row[5],
            supportWeight: row[6],
            rejectWeight: row[7],
            finalized: row[8],
            passed: row[9],
            executed: row[10],
            cancelled: row[11],
            metadataURI: row[12],
            metadataHash: row[13],
            hasVoted: rows[index * 2 + 1] as boolean
          } satisfies GenesisProposal;
        })
        .reverse();

      return {
        totalDonated: base[0] as bigint,
        donorCount: base[1] as bigint,
        perAddressCap: base[2] as bigint,
        votingDuration: base[3] as bigint,
        availableBalance: base[4] as bigint,
        reservedBalance: base[5] as bigint,
        cumulativeDonation: base[6] as bigint,
        proposalCount,
        genesisProjectId,
        hasCredential,
        proposals
      } satisfies GenesisTreasuryState;
    }
  });
}

export type TransactionPhase =
  | { kind: "idle" }
  | { kind: "wallet"; label: string }
  | { kind: "confirming"; label: string; hash: Hash }
  | { kind: "success"; label: string; hash: Hash }
  | { kind: "error"; label: string; message: string };

export type ContractCall = {
  contract?: "protocol" | "genesis" | "profile";
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  label: string;
};

export function useYoulinTransaction(
  onPhase: (phase: TransactionPhase) => void
) {
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: youlinDeployment.chainId });
  const queryClient = useQueryClient();
  const mutation = useWriteContract();

  const execute = useCallback(
    async ({
      contract = "protocol",
      functionName,
      args = [],
      value,
      label
    }: ContractCall) => {
      const isDeployed =
        contract === "genesis"
          ? isGenesisDeployed
          : contract === "profile"
            ? isProfileDeployed
            : isYoulinDeployed;
      if (!isDeployed) {
        throw new Error("Monad Testnet 合约尚未部署，当前不会发送交易。");
      }
      if (!connection.isConnected) {
        throw new Error("请先连接钱包。");
      }
      if (connection.chainId !== youlinDeployment.chainId) {
        throw new Error("请先切换到 Monad Testnet。");
      }
      if (!publicClient) {
        throw new Error("Monad RPC 暂不可用。");
      }

      try {
        onPhase({ kind: "wallet", label });
        const hash = await mutation.mutateAsync({
          address:
            contract === "genesis"
              ? genesisTreasuryAddress
              : contract === "profile"
                ? profileRegistryAddress
                : protocolAddress,
          abi:
            contract === "genesis"
              ? genesisTreasuryAbi
              : contract === "profile"
                ? profileRegistryAbi
                : protocolAbi,
          functionName,
          args,
          value,
          chainId: youlinDeployment.chainId
        });
        onPhase({ kind: "confirming", label, hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("交易已上链但执行回滚。");
        }
        await queryClient.invalidateQueries({ queryKey: ["youlin"] });
        onPhase({ kind: "success", label, hash });
        return hash;
      } catch (error) {
        const message = readableContractError(error);
        onPhase({ kind: "error", label, message });
        throw error;
      }
    },
    [connection, mutation, onPhase, publicClient, queryClient]
  );

  return {
    execute,
    isPending: mutation.isPending
  };
}

export function readableContractError(error: unknown) {
  if (!(error instanceof Error)) return "未知交易错误";
  const friendlyErrors: Array<[string, string]> = [
    ["DonationExceedsRemaining", "捐款金额超过本轮项目的剩余可募金额"],
    ["DonationCapExceeded", "本次捐款会超过该地址通过创世项目累计获得 100 R 的上限"],
    ["EmptyProfile", "昵称、头像链接和自我描述不能同时为空"],
    ["ProfileNotFound", "当前钱包还没有可清空的链上资料"],
    ["FieldTooLong", "资料字段超过链上长度限制，请缩短后重试"],
    ["NotEligibleAtSnapshot", "该地址在提案快照时尚未向创世项目捐款，不能参与本次投票"],
    ["AlreadyVoted", "该地址已经对本提案投过票"],
    ["VotingStillActive", "投票期尚未结束"],
    ["VotingEnded", "本提案投票期已经结束"],
    ["NotEnoughVoters", "实际投票地址不足 3 个，本提案不能通过"],
    ["InsufficientAvailableBalance", "创世金库当前可提案余额不足"],
    ["ProposalNotPassed", "本提案未达到通过条件"],
    ["ProposalAlreadyExecuted", "本提案已经执行"],
    ["WalletNotConnected", "请先连接钱包"],
    ["WrongNetwork", "请先切换到 Monad Testnet"],
    ["Provider not found", "未检测到浏览器钱包，请安装并启用 MetaMask 或兼容钱包后刷新页面"],
    ["Connector not found", "未检测到可用的钱包连接器，请启用钱包扩展后刷新页面"],
    ["No provider was found", "未检测到浏览器钱包，请安装并启用 MetaMask 或兼容钱包后刷新页面"]
  ];
  for (const [signature, message] of friendlyErrors) {
    if (error.message.includes(signature)) return message;
  }
  const match = error.message.match(
    /(?:reverted with custom error|reason:)\s*['"]?([^'"\n]+)/
  );
  if (match) return match[1].trim();
  if (error.message.includes("User rejected")) return "用户已取消钱包签名";
  return error.message.split("\n")[0].slice(0, 180);
}

export const displayEther = (value: bigint, digits = 2) => {
  const amount = Number(formatEther(value));
  return Number.isFinite(amount) ? amount.toFixed(digits) : "0.00";
};

export const shortAddress = (address?: Address) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "未连接";
