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
import protocolArtifact from "./YoulinProtocol.abi.json";
import reputationArtifact from "./YoulinReputation.abi.json";
import { youlinDeployment } from "./addresses";

export const protocolAbi = protocolArtifact as Abi;
export const reputationAbi = reputationArtifact as Abi;
export const participationAbi = participationArtifact as Abi;

export const protocolAddress = youlinDeployment.protocol as Address;
export const reputationAddress = youlinDeployment.reputation as Address;
export const participationAddress = youlinDeployment.participation as Address;
export const isYoulinDeployed = youlinDeployment.deployed;

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
    refetchInterval: 10_000,
    queryFn: async () => {
      if (!publicClient) return [] as ChainProject[];
      const count = (await publicClient.readContract({
        address: protocolAddress,
        abi: protocolAbi,
        functionName: "projectCount"
      })) as bigint;

      const projects = await Promise.all(
        Array.from({ length: Number(count) }, async (_, index) => {
          const id = BigInt(index + 1);
          const [core, times, content] = (await Promise.all([
            publicClient.readContract({
              address: protocolAddress,
              abi: protocolAbi,
              functionName: "getProjectCore",
              args: [id]
            }),
            publicClient.readContract({
              address: protocolAddress,
              abi: protocolAbi,
              functionName: "getProjectTimes",
              args: [id]
            }),
            publicClient.readContract({
              address: protocolAddress,
              abi: protocolAbi,
              functionName: "getProjectContent",
              args: [id]
            })
          ])) as [ProjectCoreTuple, ProjectTimesTuple, ProjectContentTuple];
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
    refetchInterval: 10_000,
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

export type TransactionPhase =
  | { kind: "idle" }
  | { kind: "wallet"; label: string }
  | { kind: "confirming"; label: string; hash: Hash }
  | { kind: "success"; label: string; hash: Hash }
  | { kind: "error"; label: string; message: string };

export type ContractCall = {
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
    async ({ functionName, args = [], value, label }: ContractCall) => {
      if (!isYoulinDeployed) {
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
          address: protocolAddress,
          abi: protocolAbi,
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
