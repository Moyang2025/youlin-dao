"use client";

import {
  useCallback,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSwitchChain
} from "wagmi";
import {
  isAddress,
  isHex,
  keccak256,
  parseEther,
  toBytes,
  zeroHash,
  type Address,
  type Hex
} from "viem";

import {
  displayEther,
  isYoulinDeployed,
  readableContractError,
  shortAddress,
  useYoulinAccountProfile,
  useGenesisTreasury,
  useYoulinProfile,
  useYoulinProjects,
  useYoulinTransaction,
  type ChainProject,
  type AccountProfile,
  type ContractCall,
  type GenesisProposal,
  type GenesisTreasuryState,
  type TransactionPhase
} from "@/lib/contracts/youlin";
import { youlinDeployment } from "@/lib/contracts/addresses";

type View = "profile" | "projects";
type Modal =
  | { type: "project"; projectId: bigint }
  | { type: "donate"; projectId: bigint }
  | { type: "score"; projectId: bigint; stage: "mid" | "final" }
  | { type: "challenge"; projectId: bigint }
  | { type: "credential"; projectId: bigint }
  | { type: "reputation" }
  | { type: "create" }
  | { type: "genesis" }
  | { type: "account-profile" }
  | null;

type IconName =
  | "wallet"
  | "user"
  | "grid"
  | "link"
  | "clock"
  | "check"
  | "lock"
  | "arrow"
  | "search"
  | "shield"
  | "x"
  | "plus"
  | "spark"
  | "file"
  | "coins"
  | "vote"
  | "external";

const EMPTY_PROFILE = {
  total: 0n,
  locked: 0n,
  available: 0n,
  participated: [] as bigint[],
  initiated: [] as bigint[],
  donations: {} as Record<string, { round1: bigint; round2: bigint }>
};

function Icon({
  name,
  size = 20,
  strokeWidth = 1.8
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  const paths: Record<IconName, ReactNode> = {
    wallet: (
      <>
        <path d="M4 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3h11" />
        <path d="M15 11h5v4h-5a2 2 0 0 1 0-4Z" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c.8-4 3.5-6 8-6s7.2 2 8 6" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    x: <path d="m6 6 12 12M18 6 6 18" />,
    plus: <path d="M12 5v14M5 12h14" />,
    spark: (
      <>
        <path d="m12 2 1.2 4.8L18 8l-4.8 1.2L12 14l-1.2-4.8L6 8l4.8-1.2L12 2Z" />
        <path d="m5 15 .7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15Z" />
      </>
    ),
    file: (
      <>
        <path d="M6 2h8l4 4v16H6z" />
        <path d="M14 2v5h5M9 12h6M9 16h6" />
      </>
    ),
    coins: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      </>
    ),
    vote: (
      <>
        <path d="M7 3h10v5H7zM5 8h14l2 4v9H3v-9z" />
        <path d="m9 14 2 2 4-4" />
      </>
    ),
    external: (
      <>
        <path d="M14 4h6v6M20 4l-9 9" />
        <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
      </>
    )
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function Logo() {
  return (
    <div className="logo-lockup">
      <span className="logo-crop" aria-hidden="true">
        <img src="/youlin-logo.png" alt="" />
      </span>
      <span className="logo-type">
        <strong>有邻</strong>
        <small>YOULIN DAO</small>
      </span>
    </div>
  );
}

function AppButton({
  children,
  onClick,
  variant = "primary",
  disabled = false
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      className={`app-button ${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function StateBadge({
  children,
  tone = "teal"
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`state-badge ${tone}`}>{children}</span>;
}

function Progress({
  value,
  max,
  tone
}: {
  value: bigint;
  max: bigint;
  tone: "teal" | "blue" | "amber";
}) {
  const percentage =
    max === 0n ? 0 : Math.min(100, Number((value * 10_000n) / max) / 100);
  return (
    <div className={`progress ${tone}`}>
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}

const projectTitle = (project: ChainProject) =>
  project.metadata?.name ?? project.metadata?.title ?? `有邻项目 #${project.id}`;
const projectSummary = (project: ChainProject) =>
  project.metadata?.summary ?? `链上材料：${project.metadataURI || "未提供 URI"}`;
const projectCategory = (project: ChainProject) =>
  project.metadata?.category ?? project.metadata?.location ?? "公共项目";
const projectTone = (project: ChainProject): "teal" | "blue" | "amber" =>
  project.state === 1 ? "blue" : project.state >= 8 && project.state <= 11 ? "amber" : "teal";
const projectDeadline = (project: ChainProject) => {
  const indexes: Record<number, number> = {
    0: 0,
    1: 0,
    3: 4,
    4: 6,
    5: 7,
    6: 7,
    7: 9,
    8: 10,
    9: 11
  };
  const timestamp = project.times[indexes[project.state] ?? 0];
  if (!timestamp) return "无进行中截止时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(Number(timestamp) * 1000));
};

export default function Home() {
  const [view, setView] = useState<View>("profile");
  const [modal, setModal] = useState<Modal>(null);
  const [privacy, setPrivacy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const [toast, setToast] = useState("");
  const [txPhase, setTxPhase] = useState<TransactionPhase>({ kind: "idle" });

  const connection = useConnection();
  const connectors = useConnectors();
  const connectMutation = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const projectsQuery = useYoulinProjects();
  const profileQuery = useYoulinProfile(connection.address);
  const accountProfileQuery = useYoulinAccountProfile(connection.address);
  const genesisQuery = useGenesisTreasury(connection.address);
  const profile = profileQuery.data ?? EMPTY_PROFILE;
  const accountProfile = accountProfileQuery.data;
  const projects = projectsQuery.data ?? [];

  const onPhase = useCallback((phase: TransactionPhase) => setTxPhase(phase), []);
  const transaction = useYoulinTransaction(onPhase);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3_200);
  }, []);

  const run = useCallback(
    async (call: ContractCall, closeOnSuccess = true) => {
      try {
        const hash = await transaction.execute(call);
        if (closeOnSuccess) setModal(null);
        notify(`交易已确认：${shortAddress(hash as Address)}`);
      } catch (error) {
        notify(readableContractError(error));
      }
    },
    [notify, transaction]
  );

  const handleWallet = () => {
    if (connection.isConnected) {
      if (connection.chainId !== youlinDeployment.chainId) {
        switchChain({ chainId: youlinDeployment.chainId });
      } else {
        disconnect();
      }
      return;
    }
    const connector = connectors[0];
    if (!connector) {
      notify("未检测到浏览器钱包，请安装 MetaMask 或兼容钱包。");
      return;
    }
    connectMutation.mutate(
      { connector },
      {
        onError: (error) => notify(readableContractError(error))
      }
    );
  };

  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        const text = `${projectTitle(project)}${projectCategory(project)}${project.stateLabel}`;
        const matchesQuery = !query || text.includes(query);
        const matchesFilter =
          filter === "全部" ||
          (filter === "募捐中" && [1, 5].includes(project.state)) ||
          (filter === "待审核" && [3, 4, 6, 7, 8, 9].includes(project.state)) ||
          (filter === "我参与的" &&
            profile.participated.some((id) => id === project.id));
        return matchesQuery && matchesFilter;
      }),
    [filter, profile.participated, projects, query]
  );

  const selectedProject =
    modal && "projectId" in modal
      ? projects.find((project) => project.id === modal.projectId)
      : undefined;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo />
        <div className="topbar-actions">
          <span
            className={`network-pill ${
              connection.isConnected &&
              connection.chainId !== youlinDeployment.chainId
                ? "wrong-network"
                : ""
            }`}
          >
            <span />
            Monad Testnet
          </span>
          <button
            className={`icon-button privacy-button ${privacy ? "active" : ""}`}
            onClick={() => setPrivacy((current) => !current)}
            aria-label="切换隐私预览"
          >
            <Icon name={privacy ? "lock" : "shield"} size={18} />
          </button>
          <button
            className="wallet-button"
            onClick={handleWallet}
            title={
              connection.isConnected
                ? connection.chainId === youlinDeployment.chainId
                  ? "点击断开钱包"
                  : "切换到 Monad Testnet"
                : "连接浏览器钱包"
            }
          >
            <Icon name="wallet" size={17} />
            {connection.isConnected
              ? accountProfile?.nickname || shortAddress(connection.address)
              : connectMutation.isPending
                ? "连接中…"
                : "连接钱包"}
          </button>
        </div>
      </header>

      <div className="deployment-banner" role="status">
        <Icon name="shield" size={18} />
        <span>
          {isYoulinDeployed
            ? "Monad Testnet Demo：为黑客松演示缩短了时间窗口；测试 MON 不构成真实募捐。"
            : "Monad Testnet Demo：合约地址尚未写入，本页不会展示模拟链上数据或发送交易。"}
        </span>
      </div>

      {txPhase.kind !== "idle" && (
        <TransactionStatus phase={txPhase} />
      )}

      <main>
        {view === "profile" ? (
          <ProfileView
            privacy={privacy}
            address={connection.address}
            accountProfile={accountProfile}
            profile={profile}
            projects={projects}
            loading={profileQuery.isLoading}
            accountProfileLoading={accountProfileQuery.isLoading}
            genesis={genesisQuery.data}
            genesisLoading={genesisQuery.isLoading}
            openModal={setModal}
            goProjects={() => setView("projects")}
          />
        ) : (
          <ProjectsView
            projects={filteredProjects}
            loading={projectsQuery.isLoading}
            error={projectsQuery.error}
            genesis={genesisQuery.data}
            genesisLoading={genesisQuery.isLoading}
            query={query}
            setQuery={setQuery}
            filter={filter}
            setFilter={setFilter}
            openModal={setModal}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="主要导航">
        <button
          className={view === "profile" ? "active" : ""}
          onClick={() => setView("profile")}
        >
          <Icon name="user" />
          <span>我的有邻</span>
        </button>
        <button
          className={view === "projects" ? "active" : ""}
          onClick={() => setView("projects")}
        >
          <Icon name="grid" />
          <span>项目广场</span>
        </button>
      </nav>

      {modal && (
        <ModalSheet
          modal={modal}
          project={selectedProject}
          address={connection.address}
          profile={profile}
          accountProfile={accountProfile}
          genesis={genesisQuery.data}
          close={() => setModal(null)}
          openModal={setModal}
          run={run}
          pending={transaction.isPending}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

function TransactionStatus({ phase }: { phase: TransactionPhase }) {
  if (phase.kind === "idle") return null;
  const label =
    phase.kind === "wallet"
      ? "请在钱包中确认"
      : phase.kind === "confirming"
        ? "交易已提交，等待链上确认"
        : phase.kind === "success"
          ? "交易已确认"
          : "交易失败";
  const hash = "hash" in phase ? phase.hash : undefined;
  return (
    <div className={`transaction-status ${phase.kind}`}>
      <Icon name={phase.kind === "error" ? "x" : "link"} size={18} />
      <div>
        <strong>{label} · {phase.label}</strong>
        {phase.kind === "error" && <span>{phase.message}</span>}
        {hash && (
          <a
            href={`${youlinDeployment.explorerUrl}/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(hash as Address)} <Icon name="external" size={13} />
          </a>
        )}
      </div>
    </div>
  );
}

function displayAvatarURI(uri?: string) {
  if (!uri) return undefined;
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  }
  return uri.startsWith("https://") || uri.startsWith("http://")
    ? uri
    : undefined;
}

function AccountAvatar({
  nickname,
  avatarURI,
  address,
  privacy = false,
  preview = false
}: {
  nickname?: string;
  avatarURI?: string;
  address?: Address;
  privacy?: boolean;
  preview?: boolean;
}) {
  const source = displayAvatarURI(avatarURI);
  const fallback = privacy
    ? "隐"
    : nickname?.trim().slice(0, 1) || address?.slice(2, 4).toUpperCase() || "邻";
  return (
    <span className={`account-avatar ${preview ? "preview" : ""}`}>
      <span>{fallback}</span>
      {source && !privacy && (
        <img
          src={source}
          alt={nickname ? `${nickname}的头像` : "账户头像"}
          referrerPolicy="no-referrer"
          onError={(event) => event.currentTarget.remove()}
        />
      )}
    </span>
  );
}

function ProfileView({
  privacy,
  address,
  accountProfile,
  profile,
  projects,
  loading,
  accountProfileLoading,
  genesis,
  genesisLoading,
  openModal,
  goProjects
}: {
  privacy: boolean;
  address?: Address;
  accountProfile?: AccountProfile;
  profile: typeof EMPTY_PROFILE;
  projects: ChainProject[];
  loading: boolean;
  accountProfileLoading: boolean;
  genesis?: GenesisTreasuryState;
  genesisLoading: boolean;
  openModal: (modal: Modal) => void;
  goProjects: () => void;
}) {
  const participated = profile.participated
    .map((id) => projects.find((project) => project.id === id))
    .filter((project): project is ChainProject => Boolean(project));
  const records = profile.participated.length + profile.initiated.length;

  return (
    <>
      <section className="profile-hero">
        <div className="account-identity">
          <AccountAvatar
            nickname={accountProfile?.nickname}
            avatarURI={accountProfile?.avatarURI}
            address={address}
            privacy={privacy}
          />
          <div>
            <span className="eyebrow">我的有邻 · 链上公益履历</span>
            <h1>
              {address
                ? accountProfileLoading
                  ? "读取链上资料…"
                  : accountProfile?.nickname || `邻友 ${address.slice(-4).toUpperCase()}`
                : "连接钱包，恢复链上履历"}
            </h1>
            <p>
              {address && accountProfile?.bio
                ? accountProfile.bio
                : "每一次捐款、评分、质押与结算，都从 Monad 合约状态中恢复。"}
            </p>
            <button
              className="profile-edit-button"
              onClick={() => openModal({ type: "account-profile" })}
              disabled={!address}
            >
              <Icon name="user" size={16} />
              {accountProfile?.exists ? "编辑链上资料" : "创建链上资料"}
            </button>
          </div>
        </div>
        <div className="hero-proof">
          <span className="proof-icon"><Icon name="link" /></span>
          <div>
            <strong>{loading ? "读取中…" : `${records} 项链上记录`}</strong>
            <span>{address ? shortAddress(address) : "尚未关联钱包"}</span>
          </div>
        </div>
      </section>

      <section className="profile-grid">
        <article className="reputation-card">
          <div className="section-heading">
            <div>
              <span className="section-kicker">R · SOULBOUND REPUTATION</span>
              <h2>统一声誉 R</h2>
            </div>
            <button
              className="text-button"
              onClick={() => openModal({ type: "reputation" })}
            >
              查看链上余额 <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="r-total">
            <span className="r-orb">R</span>
            <div>
              <strong>{privacy ? "•••" : displayEther(profile.total, 2)}</strong>
              <span>不可转让 · 总声誉</span>
            </div>
          </div>
          <div className="r-breakdown">
            <div>
              <span>可用 R</span>
              <strong>{privacy ? "••" : displayEther(profile.available, 2)}</strong>
            </div>
            <div>
              <span>质押中</span>
              <strong>{privacy ? "••" : displayEther(profile.locked, 2)}</strong>
            </div>
            <div>
              <span>参与项目</span>
              <strong>{privacy ? "••" : profile.participated.length}</strong>
            </div>
          </div>
          <div className="stake-note">
            <Icon name="lock" size={18} />
            <div>
              <strong>{displayEther(profile.locked, 2)} R 正在承担链上责任</strong>
              <span>锁定 R 仍计入总声誉，但不能重复使用</span>
            </div>
          </div>
        </article>

        <article className="protocol-card">
          <div className="protocol-copy">
            <span className="section-kicker">WHY ONCHAIN</span>
            <h2>从一次捐款，到一段完整履历</h2>
            <p>项目状态、资金流、评分、挑战和结算由合约执行，页面不保存一份可篡改的替代结果。</p>
          </div>
          <div className="mini-chain" aria-label="有邻协议核心流程">
            <div><span>01</span><strong>捐款</strong><small>获得 P 与 R</small></div>
            <i />
            <div><span>02</span><strong>中期评分</strong><small>60 分开启二轮</small></div>
            <i />
            <div><span>03</span><strong>结项沉淀</strong><small>结果进入账户</small></div>
          </div>
        </article>
      </section>

      <GenesisSpotlight
        genesis={genesis}
        loading={genesisLoading}
        onOpen={() => openModal({ type: "genesis" })}
      />

      <section className="content-grid">
        <div className="content-column">
          <div className="section-heading">
            <div>
              <span className="section-kicker">P · PROJECT CREDENTIALS</span>
              <h2>项目参与凭证</h2>
            </div>
            <button className="text-button" onClick={goProjects}>
              查看项目 <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="credential-list">
            {participated.map((project) => {
              const donation = profile.donations[project.id.toString()] ?? {
                round1: 0n,
                round2: 0n
              };
              return (
                <CredentialCard
                  key={project.id.toString()}
                  project={project}
                  donation={donation.round1 + donation.round2}
                  onClick={() =>
                    openModal({ type: "credential", projectId: project.id })
                  }
                />
              );
            })}
            {!address && <EmptyState title="尚未连接钱包" body="连接后读取 P、R、捐款和发起项目索引。" />}
            {address && !loading && participated.length === 0 && (
              <EmptyState title="当前钱包还没有 P" body="首次有效捐款会由合约铸造不可转让的项目参与凭证。" />
            )}
          </div>
        </div>

        <aside className="action-column">
          <div className="section-heading">
            <div>
              <span className="section-kicker">NEXT ONCHAIN ACTIONS</span>
              <h2>下一步参与</h2>
            </div>
          </div>
          {projects
            .filter((project) => [1, 5, 8].includes(project.state))
            .slice(0, 2)
            .map((project, index) => (
              <button
                className={`action-card ${index === 0 ? "featured" : ""}`}
                key={project.id.toString()}
                onClick={() =>
                  openModal(
                    project.state === 8
                      ? { type: "challenge", projectId: project.id }
                      : { type: "donate", projectId: project.id }
                  )
                }
              >
                <span className={`action-icon ${project.state === 8 ? "amber" : ""}`}>
                  <Icon name={project.state === 8 ? "shield" : "coins"} />
                </span>
                <div>
                  <small>{project.stateLabel}</small>
                  <strong>{projectTitle(project)}</strong>
                  <span>{project.state === 8 ? "审阅材料并质押 R" : "通过合约发送真实 MON"}</span>
                </div>
                <Icon name="arrow" />
              </button>
            ))}
          <button className="create-card" onClick={() => openModal({ type: "create" })}>
            <span><Icon name="plus" /></span>
            <div>
              <strong>共同发起新项目</strong>
              <small>每位发起人用自己的钱包确认并锁定 R</small>
            </div>
          </button>
        </aside>
      </section>
    </>
  );
}

function GenesisSpotlight({
  genesis,
  loading,
  onOpen
}: {
  genesis?: GenesisTreasuryState;
  loading: boolean;
  onOpen: () => void;
}) {
  const treasuryBalance = genesis
    ? genesis.availableBalance + genesis.reservedBalance
    : 0n;
  return (
    <section className="genesis-spotlight">
      <div className="genesis-symbol">创</div>
      <div className="genesis-copy">
        <span className="section-kicker">GENESIS · DONOR-GOVERNED TREASURY</span>
        <h2>创世项目与捐款者共治金库</h2>
        <p>
          捐款在同一笔交易中获得等额 R 与创世 P；金库支出必须由至少 3
          位捐款者投票，并取得已投票对数权重的 66% 赞成。
        </p>
      </div>
      <div className="genesis-metrics">
        <div>
          <span>累计捐款</span>
          <strong>{loading ? "读取中…" : `${displayEther(genesis?.totalDonated ?? 0n, 2)} MON`}</strong>
        </div>
        <div>
          <span>捐款者</span>
          <strong>{loading ? "—" : (genesis?.donorCount ?? 0n).toString()}</strong>
        </div>
        <div>
          <span>金库余额</span>
          <strong>{loading ? "—" : `${displayEther(treasuryBalance, 2)} MON`}</strong>
        </div>
      </div>
      <AppButton onClick={onOpen} disabled={!youlinDeployment.genesisDeployed}>
        <Icon name="vote" size={17} /> 进入创世项目
      </AppButton>
    </section>
  );
}

function CredentialCard({
  project,
  donation,
  onClick
}: {
  project: ChainProject;
  donation: bigint;
  onClick: () => void;
}) {
  const tone = projectTone(project);
  return (
    <button className="credential-card" onClick={onClick}>
      <span className={`p-seal ${tone}`}>P</span>
      <div>
        <span className="credential-title">{projectTitle(project)}</span>
        <strong>{project.stateLabel}</strong>
        <small>累计支持 {displayEther(donation, 2)} MON · 项目 #{project.id}</small>
      </div>
      <StateBadge tone={tone}>{project.finalScore ? `${project.finalScore} 分` : project.stateLabel}</StateBadge>
      <Icon name="arrow" size={18} />
    </button>
  );
}

function ProjectsView({
  projects,
  loading,
  error,
  genesis,
  genesisLoading,
  query,
  setQuery,
  filter,
  setFilter,
  openModal
}: {
  projects: ChainProject[];
  loading: boolean;
  error: Error | null;
  genesis?: GenesisTreasuryState;
  genesisLoading: boolean;
  query: string;
  setQuery: (value: string) => void;
  filter: string;
  setFilter: (value: string) => void;
  openModal: (modal: Modal) => void;
}) {
  return (
    <>
      <section className="explore-hero">
        <div>
          <span className="eyebrow">MONAD PUBLIC GOODS</span>
          <h1>项目广场</h1>
          <p>所有卡片均由当前 Monad Testnet 合约状态恢复，不使用本地项目数组。</p>
        </div>
        <div className="search-box">
          <Icon name="search" size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目、领域或状态"
            aria-label="搜索项目"
          />
        </div>
      </section>

      <GenesisSpotlight
        genesis={genesis}
        loading={genesisLoading}
        onOpen={() => openModal({ type: "genesis" })}
      />

      <section className="mechanism-banner">
        <div className="mechanism-title">
          <span className="mechanism-mark"><Icon name="shield" /></span>
          <div>
            <span className="section-kicker">YOULIN TWO-ROUND PROTOCOL</span>
            <h2>两轮募捐，把一次性信任拆成两次判断</h2>
          </div>
        </div>
        <div className="mechanism-steps">
          <div><strong>50%</strong><span>第一轮只募集目标的一半</span></div>
          <i />
          <div><strong>≥ 60</strong><span>对数加权中期评分及格</span></div>
          <i />
          <div><strong>直达</strong><span>二轮资金同交易进入项目钱包</span></div>
        </div>
      </section>

      <section className="filter-row">
        <div className="filter-tabs">
          {["全部", "募捐中", "待审核", "我参与的"].map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <span>{loading ? "读取中…" : `${projects.length} 个项目`}</span>
      </section>

      {error && <EmptyState title="链上读取失败" body={readableContractError(error)} />}
      {!loading && !error && projects.length === 0 && (
        <EmptyState
          title={isYoulinDeployed ? "当前筛选没有项目" : "等待测试网部署"}
          body={
            isYoulinDeployed
              ? "创建项目的交易确认后，卡片会从合约 projectCount 自动出现。"
              : "部署地址写入生成文件后，项目广场会直接读取 Monad Testnet。"
          }
        />
      )}

      <section className="project-grid">
        {projects.map((project) => {
          const tone = projectTone(project);
          const raised = project.round1Raised + project.round2Raised;
          return (
            <article className="project-card" key={project.id.toString()}>
              <div className={`project-cover ${tone}`}>
                <span>{projectCategory(project)}</span>
                <StateBadge tone={tone}>{project.stateLabel}</StateBadge>
                <div className="cover-symbol">{projectTitle(project).slice(0, 1)}</div>
              </div>
              <div className="project-body">
                <h2>{projectTitle(project)}</h2>
                <p>{projectSummary(project)}</p>
                <div className="project-metrics">
                  <div><span>已筹</span><strong>{displayEther(raised, 2)} MON</strong></div>
                  <div><span>总目标</span><strong>{displayEther(project.targetAmount, 2)} MON</strong></div>
                  {project.midScore > 0 && <div><span>中期分</span><strong>{project.midScore}</strong></div>}
                </div>
                <Progress value={raised} max={project.targetAmount} tone={tone} />
                <div className="project-meta">
                  <span><Icon name="clock" size={15} /> {projectDeadline(project)}</span>
                  <span><Icon name="wallet" size={15} /> {shortAddress(project.projectWallet)}</span>
                </div>
                <div className="card-actions">
                  <AppButton
                    variant="secondary"
                    onClick={() => openModal({ type: "project", projectId: project.id })}
                  >
                    查看完整链路
                  </AppButton>
                  {[1, 5].includes(project.state) && (
                    <AppButton onClick={() => openModal({ type: "donate", projectId: project.id })}>
                      捐款
                    </AppButton>
                  )}
                  {[4, 7].includes(project.state) && (
                    <AppButton
                      onClick={() =>
                        openModal({
                          type: "score",
                          projectId: project.id,
                          stage: project.state === 4 ? "mid" : "final"
                        })
                      }
                    >
                      评分
                    </AppButton>
                  )}
                  {project.state === 8 && (
                    <AppButton onClick={() => openModal({ type: "challenge", projectId: project.id })}>
                      挑战
                    </AppButton>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}

function ModalSheet({
  modal,
  project,
  address,
  profile,
  accountProfile,
  genesis,
  close,
  openModal,
  run,
  pending
}: {
  modal: Exclude<Modal, null>;
  project?: ChainProject;
  address?: Address;
  profile: typeof EMPTY_PROFILE;
  accountProfile?: AccountProfile;
  genesis?: GenesisTreasuryState;
  close: () => void;
  openModal: (modal: Modal) => void;
  run: (call: ContractCall, closeOnSuccess?: boolean) => Promise<void>;
  pending: boolean;
}) {
  const title =
    modal.type === "account-profile"
      ? accountProfile?.exists
        ? "编辑链上账户资料"
        : "创建链上账户资料"
      : modal.type === "reputation"
      ? "统一声誉 R"
      : modal.type === "genesis"
        ? "创世项目与捐款者共治金库"
      : modal.type === "create"
        ? "共同发起新项目"
        : modal.type === "donate"
          ? `支持${project ? projectTitle(project) : "项目"}`
          : modal.type === "score"
            ? `${modal.stage === "mid" ? "中期" : "结项"}评分`
            : modal.type === "challenge"
              ? "结项挑战"
              : modal.type === "credential"
                ? "项目参与凭证 P"
                : project
                  ? projectTitle(project)
                  : "项目";

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <section
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="section-kicker">YOULIN · MONAD TESTNET DEMO</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        {modal.type === "reputation" && <ReputationDetail profile={profile} />}
        {modal.type === "account-profile" && (
          <AccountProfileForm
            address={address}
            accountProfile={accountProfile}
            run={run}
            pending={pending}
          />
        )}
        {modal.type === "genesis" && (
          <GenesisTreasuryPanel
            address={address}
            genesis={genesis}
            run={run}
            pending={pending}
          />
        )}
        {modal.type === "create" && (
          <CreateProjectForm address={address} run={run} pending={pending} />
        )}
        {project && modal.type === "project" && (
          <ProjectDetail
            project={project}
            address={address}
            run={run}
            pending={pending}
            openModal={openModal}
          />
        )}
        {project && modal.type === "credential" && (
          <CredentialDetail
            project={project}
            donation={profile.donations[project.id.toString()]}
          />
        )}
        {project && modal.type === "donate" && (
          <DonationForm project={project} run={run} pending={pending} />
        )}
        {project && modal.type === "score" && (
          <ScoreForm project={project} stage={modal.stage} run={run} pending={pending} />
        )}
        {project && modal.type === "challenge" && (
          <ChallengeForm project={project} run={run} pending={pending} />
        )}
        {"projectId" in modal && !project && (
          <EmptyState title="项目尚未读取" body="请关闭后重试，或检查 Monad RPC 状态。" />
        )}
      </section>
    </div>
  );
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

function AccountProfileForm({
  address,
  accountProfile,
  run,
  pending
}: {
  address?: Address;
  accountProfile?: AccountProfile;
  run: (call: ContractCall, closeOnSuccess?: boolean) => Promise<void>;
  pending: boolean;
}) {
  const [nickname, setNickname] = useState(accountProfile?.nickname ?? "");
  const [avatarURI, setAvatarURI] = useState(accountProfile?.avatarURI ?? "");
  const [bio, setBio] = useState(accountProfile?.bio ?? "");
  const normalizedNickname = nickname.trim();
  const normalizedAvatar = avatarURI.trim();
  const normalizedBio = bio.trim();
  const nicknameBytes = utf8Bytes(normalizedNickname);
  const avatarBytes = utf8Bytes(normalizedAvatar);
  const bioBytes = utf8Bytes(normalizedBio);
  const avatarValid =
    normalizedAvatar.length === 0 || Boolean(displayAvatarURI(normalizedAvatar));
  const valid =
    Boolean(address) &&
    Boolean(normalizedNickname || normalizedAvatar || normalizedBio) &&
    nicknameBytes <= 64 &&
    avatarBytes <= 512 &&
    bioBytes <= 512 &&
    avatarValid;

  return (
    <div className="modal-content profile-form">
      <div className="profile-preview-card">
        <AccountAvatar
          preview
          nickname={normalizedNickname}
          avatarURI={normalizedAvatar}
          address={address}
        />
        <div>
          <span>链上公开资料预览</span>
          <strong>{normalizedNickname || (address ? shortAddress(address) : "邻友")}</strong>
          <p>{normalizedBio || "写一段关于你的社区关注与参与方向。"}</p>
        </div>
      </div>

      <label className="profile-field">
        <span>昵称 <small>{nicknameBytes} / 64 字节</small></span>
        <input
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="例如：小邻、社区园丁"
          autoComplete="nickname"
        />
      </label>

      <label className="profile-field">
        <span>头像链接 <small>{avatarBytes} / 512 字节</small></span>
        <input
          value={avatarURI}
          onChange={(event) => setAvatarURI(event.target.value)}
          placeholder="https://… 或 ipfs://…"
          inputMode="url"
        />
        {!avatarValid && <em>仅支持 http://、https:// 或 ipfs:// 链接</em>}
      </label>

      <label className="profile-field">
        <span>自我描述 <small>{bioBytes} / 512 字节</small></span>
        <textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          placeholder="介绍你关注的社区议题、参与经验或希望共同完成的事情"
          rows={5}
        />
      </label>

      <div className="warning-box profile-public-note">
        <Icon name="shield" />
        <div>
          <strong>这些资料会公开写入 Monad Testnet</strong>
          <span>请勿填写手机号、住址、私钥或其他敏感信息；头像图片本身存放在你提供的外部链接。</span>
        </div>
      </div>

      {!address && <EmptyState title="请先连接钱包" body="钱包地址就是资料所有者，任何其他账户都不能替你修改。" />}

      <div className="modal-action-row profile-actions">
        <AppButton
          disabled={!valid || pending}
          onClick={() =>
            void run(
              {
                contract: "profile",
                functionName: "setProfile",
                args: [normalizedNickname, normalizedAvatar, normalizedBio],
                label: accountProfile?.exists ? "更新链上账户资料" : "创建链上账户资料"
              },
              true
            )
          }
        >
          <Icon name="user" size={17} />
          {accountProfile?.exists ? "保存链上修改" : "创建链上资料"}
        </AppButton>
        {accountProfile?.exists && (
          <AppButton
            variant="danger"
            disabled={pending || !address}
            onClick={() =>
              void run(
                {
                  contract: "profile",
                  functionName: "clearProfile",
                  label: "清空链上账户资料"
                },
                true
              )
            }
          >
            清空资料
          </AppButton>
        )}
      </div>
    </div>
  );
}

function GenesisTreasuryPanel({
  address,
  genesis,
  run,
  pending
}: {
  address?: Address;
  genesis?: GenesisTreasuryState;
  run: (call: ContractCall, closeOnSuccess?: boolean) => Promise<void>;
  pending: boolean;
}) {
  const [donationAmount, setDonationAmount] = useState("0.1");
  const [recipient, setRecipient] = useState("");
  const [proposalAmount, setProposalAmount] = useState("0.1");
  const [purpose, setPurpose] = useState("");
  if (!genesis) {
    return (
      <div className="modal-content">
        <EmptyState
          title="创世金库尚未读取"
          body="请稍后重试，或检查 Monad RPC 与创世合约部署状态。"
        />
      </div>
    );
  }

  const remaining =
    genesis.cumulativeDonation >= genesis.perAddressCap
      ? 0n
      : genesis.perAddressCap - genesis.cumulativeDonation;
  const donationValid =
    Number(donationAmount) > 0 &&
    parseEther(donationAmount || "0") <= remaining;
  const proposalValid =
    isAddress(recipient) &&
    Number(proposalAmount) > 0 &&
    parseEther(proposalAmount || "0") <= genesis.availableBalance &&
    purpose.trim().length > 0;
  const createProposal = () => {
    const normalizedPurpose = purpose.trim();
    void run(
      {
        contract: "genesis",
        functionName: "createProposal",
        args: [
          recipient as Address,
          parseEther(proposalAmount),
          `data:text/plain;charset=utf-8,${encodeURIComponent(normalizedPurpose)}`,
          keccak256(toBytes(normalizedPurpose))
        ],
        label: "创建金库支出提案"
      },
      false
    );
  };

  return (
    <div className="modal-content genesis-panel">
      <div className="genesis-ledger">
        <div>
          <span>金库余额</span>
          <strong>
            {displayEther(genesis.availableBalance + genesis.reservedBalance, 4)} MON
          </strong>
        </div>
        <div>
          <span>累计捐款者</span>
          <strong>{genesis.donorCount.toString()}</strong>
        </div>
        <div>
          <span>我的累计捐款</span>
          <strong>{displayEther(genesis.cumulativeDonation, 4)} / {displayEther(genesis.perAddressCap, 0)} MON</strong>
        </div>
      </div>

      <section className="genesis-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">DONATE · MINT R + P</span>
            <h3>向创世项目捐款</h3>
          </div>
        </div>
        <label className="amount-field">
          <span>捐款金额 · 剩余额度 {displayEther(remaining, 4)} MON</span>
          <div>
            <input
              type="number"
              min="0.0001"
              step="0.1"
              value={donationAmount}
              onChange={(event) => setDonationAmount(event.target.value)}
            />
            <strong>MON</strong>
          </div>
        </label>
        <div className="result-preview">
          <div><span>即时获得</span><strong>{donationAmount || "0"} R</strong></div>
          <div><span>创世凭证</span><strong>首次捐款铸造 P</strong></div>
        </div>
        <AppButton
          disabled={pending || !address || !donationValid}
          onClick={() =>
            void run(
              {
                contract: "genesis",
                functionName: "donate",
                value: parseEther(donationAmount),
                label: "创世项目捐款"
              },
              false
            )
          }
        >
          <Icon name="wallet" size={17} /> 捐款并即时获得 R
        </AppButton>
      </section>

      <section className="genesis-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">PROPOSE · ONCHAIN TREASURY</span>
            <h3>创建资金使用提案</h3>
          </div>
        </div>
        <div className="form-grid">
          <label className="text-field">
            <span>收款地址</span>
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x…"
            />
          </label>
          <label className="amount-field">
            <span>申请金额</span>
            <div>
              <input
                type="number"
                min="0.0001"
                value={proposalAmount}
                onChange={(event) => setProposalAmount(event.target.value)}
              />
              <strong>MON</strong>
            </div>
          </label>
        </div>
        <label className="text-field">
          <span>资金用途说明</span>
          <textarea
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="说明收款方、用途、交付物和可核验依据"
          />
        </label>
        <div className="rule-box">
          <strong>弃权不计入赞成或反对</strong>
          <p>
            至少 3 个快照捐款地址实际投票；赞成对数权重达到已投总权重的
            66% 后，任何人都可以执行预先锁定的转账。
          </p>
        </div>
        <AppButton
          variant="secondary"
          disabled={
            pending ||
            !address ||
            genesis.cumulativeDonation === 0n ||
            !proposalValid
          }
          onClick={createProposal}
        >
          <Icon name="plus" size={17} /> 创建链上提案
        </AppButton>
      </section>

      <section className="genesis-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">VOTE · LOG WEIGHTED</span>
            <h3>金库提案</h3>
          </div>
          <span>{genesis.proposalCount.toString()} 项</span>
        </div>
        <div className="genesis-proposals">
          {genesis.proposals.map((proposal) => (
            <GenesisProposalCard
              key={proposal.id.toString()}
              proposal={proposal}
              address={address}
              run={run}
              pending={pending}
            />
          ))}
          {genesis.proposals.length === 0 && (
            <EmptyState
              title="还没有资金使用提案"
              body="创世捐款者可以提交收款地址、金额和用途说明。"
            />
          )}
        </div>
      </section>
    </div>
  );
}

function GenesisProposalCard({
  proposal,
  address,
  run,
  pending
}: {
  proposal: GenesisProposal;
  address?: Address;
  run: (call: ContractCall, closeOnSuccess?: boolean) => Promise<void>;
  pending: boolean;
}) {
  const castWeight = proposal.supportWeight + proposal.rejectWeight;
  const approval =
    castWeight === 0n
      ? 0
      : Number((proposal.supportWeight * 10_000n) / castWeight) / 100;
  const votingOpen =
    !proposal.finalized &&
    Date.now() <= Number(proposal.votingEndsAt) * 1000;
  const canFinalize =
    !proposal.finalized &&
    Date.now() > Number(proposal.votingEndsAt) * 1000;
  const status = proposal.cancelled
    ? "已取消"
    : proposal.executed
      ? "已执行"
      : proposal.finalized
        ? proposal.passed
          ? "已通过"
          : "未通过"
        : votingOpen
          ? "投票中"
          : "待定案";
  const isProposer =
    Boolean(address) &&
    proposal.proposer.toLowerCase() === address?.toLowerCase();

  return (
    <article className="genesis-proposal-card">
      <header>
        <div>
          <span>提案 #{proposal.id.toString()}</span>
          <strong>{displayEther(proposal.amount, 4)} MON → {shortAddress(proposal.recipient)}</strong>
        </div>
        <StateBadge tone={proposal.passed ? "teal" : votingOpen ? "blue" : "amber"}>
          {status}
        </StateBadge>
      </header>
      <p>{decodeProposalPurpose(proposal.metadataURI)}</p>
      <div className="proposal-vote-metrics">
        <div><span>赞成权重</span><strong>{displayEther(proposal.supportWeight, 3)}</strong></div>
        <div><span>反对权重</span><strong>{displayEther(proposal.rejectWeight, 3)}</strong></div>
        <div><span>赞成比例</span><strong>{approval.toFixed(2)}%</strong></div>
        <div><span>投票账户</span><strong>{proposal.voterCount.toString()} / 最少 3</strong></div>
      </div>
      <div className="project-meta">
        <span><Icon name="clock" size={15} /> 截止 {new Date(Number(proposal.votingEndsAt) * 1000).toLocaleString("zh-CN")}</span>
        <span><Icon name="wallet" size={15} /> {shortAddress(proposal.proposer)}</span>
      </div>
      <div className="modal-action-row">
        {votingOpen && !proposal.hasVoted && (
          <>
            <AppButton
              disabled={pending || !address}
              onClick={() =>
                void run(
                  {
                    contract: "genesis",
                    functionName: "vote",
                    args: [proposal.id, true],
                    label: `赞成金库提案 #${proposal.id}`
                  },
                  false
                )
              }
            >
              赞成
            </AppButton>
            <AppButton
              variant="danger"
              disabled={pending || !address}
              onClick={() =>
                void run(
                  {
                    contract: "genesis",
                    functionName: "vote",
                    args: [proposal.id, false],
                    label: `反对金库提案 #${proposal.id}`
                  },
                  false
                )
              }
            >
              反对
            </AppButton>
          </>
        )}
        {votingOpen && proposal.hasVoted && (
          <span className="modal-note">当前钱包已经投票</span>
        )}
        {canFinalize && (
          <AppButton
            disabled={pending}
            onClick={() =>
              void run(
                {
                  contract: "genesis",
                  functionName: "finalizeProposal",
                  args: [proposal.id],
                  label: `定案金库提案 #${proposal.id}`
                },
                false
              )
            }
          >
            定案
          </AppButton>
        )}
        {proposal.finalized && proposal.passed && !proposal.executed && (
          <AppButton
            disabled={pending}
            onClick={() =>
              void run(
                {
                  contract: "genesis",
                  functionName: "executeProposal",
                  args: [proposal.id],
                  label: `执行金库提案 #${proposal.id}`
                },
                false
              )
            }
          >
            执行转账
          </AppButton>
        )}
        {!proposal.finalized && proposal.voterCount === 0n && isProposer && (
          <AppButton
            variant="quiet"
            disabled={pending}
            onClick={() =>
              void run(
                {
                  contract: "genesis",
                  functionName: "cancelProposal",
                  args: [proposal.id],
                  label: `取消金库提案 #${proposal.id}`
                },
                false
              )
            }
          >
            取消提案
          </AppButton>
        )}
      </div>
    </article>
  );
}

function decodeProposalPurpose(uri: string) {
  const plainMarker = "data:text/plain;charset=utf-8,";
  const jsonMarker = "data:application/json;charset=utf-8,";
  const marker = uri.startsWith(plainMarker)
    ? plainMarker
    : uri.startsWith(jsonMarker)
      ? jsonMarker
      : undefined;
  if (!marker) return uri;
  try {
    const decoded = decodeURIComponent(uri.slice(marker.length));
    if (marker === jsonMarker) {
      const metadata = JSON.parse(decoded) as {
        purpose?: string;
        title?: string;
      };
      return metadata.purpose ?? metadata.title ?? decoded;
    }
    return decoded;
  } catch {
    return uri.slice(marker.length);
  }
}

function ReputationDetail({ profile }: { profile: typeof EMPTY_PROFILE }) {
  const rows = [
    ["总声誉", `${displayEther(profile.total, 4)} R`, "balanceOf"],
    ["可用声誉", `${displayEther(profile.available, 4)} R`, "availableBalanceOf"],
    ["锁定声誉", `${displayEther(profile.locked, 4)} R`, "lockedBalanceOf"],
    ["参与项目", `${profile.participated.length} 个`, "P 凭证索引"],
    ["发起项目", `${profile.initiated.length} 个`, "共同发起索引"]
  ];
  return (
    <div className="modal-content">
      <div className="explain-box">
        <Icon name="spark" />
        <p>以下数值直接读取 YoulinReputation 和 YoulinProtocol；R 不可转让，总量等于可用与锁定之和。</p>
      </div>
      <div className="ledger-list">
        {rows.map(([label, amount, note]) => (
          <div key={label}>
            <span className="ledger-icon">R</span>
            <div><strong>{label}</strong><small>{note}</small></div>
            <b>{amount}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectDetail({
  project,
  address,
  run,
  pending,
  openModal
}: {
  project: ChainProject;
  address?: Address;
  run: (call: ContractCall, closeOnSuccess?: boolean) => Promise<void>;
  pending: boolean;
  openModal: (modal: Modal) => void;
}) {
  const tone = projectTone(project);
  const phases = [
    ["共同发起", `${displayEther(project.targetAmount, 2)} R 总质押门槛`, project.state > 0],
    ["第一轮", `${displayEther(project.round1Raised, 2)} / ${displayEther(project.targetAmount / 2n, 2)} MON`, project.state > 1],
    ["中期审核", project.midScore ? `${project.midScore} 分` : "尚未定分", project.state > 4],
    ["第二轮", `${displayEther(project.round2Raised, 2)} / ${displayEther(project.targetAmount - project.targetAmount / 2n, 2)} MON`, project.state > 5],
    ["结项与挑战", project.finalScore ? `${project.finalScore} 分` : "尚未定分", project.settled]
  ] as const;
  return (
    <div className="modal-content">
      <div className="project-detail-summary">
        <StateBadge tone={tone}>{project.stateLabel}</StateBadge>
        <p>{projectSummary(project)}</p>
        <div>
          <span>项目 #{project.id}</span>
          <span>截止 {projectDeadline(project)}</span>
          <span>钱包 {shortAddress(project.projectWallet)}</span>
        </div>
      </div>
      <div className="phase-list">
        {phases.map(([label, value, done], index) => (
          <div className={done ? "done" : ""} key={label}>
            <span>{done ? <Icon name="check" size={16} /> : index + 1}</span>
            <div><strong>{label}</strong><small>{value}</small></div>
          </div>
        ))}
      </div>
      <div className="evidence-card">
        <Icon name="file" />
        <div>
          <strong>链上材料承诺</strong>
          <span>{project.metadataURI}</span>
          <small>{project.metadataHash}</small>
        </div>
        <a href={project.metadataURI} target="_blank" rel="noreferrer" aria-label="打开材料">
          <Icon name="external" size={17} />
        </a>
      </div>
      <ProjectActions
        project={project}
        address={address}
        run={run}
        pending={pending}
        openModal={openModal}
      />
    </div>
  );
}

function ProjectActions({
  project,
  address,
  run,
  pending,
  openModal
}: {
  project: ChainProject;
  address?: Address;
  run: (call: ContractCall, closeOnSuccess?: boolean) => Promise<void>;
  pending: boolean;
  openModal: (modal: Modal) => void;
}) {
  const [stake, setStake] = useState("1");
  const [evidenceURI, setEvidenceURI] = useState("");
  const [evidenceHash, setEvidenceHash] = useState<Hex>(zeroHash);
  const [jurorStake, setJurorStake] = useState("0.5");
  const [support, setSupport] = useState(true);
  const id = project.id;
  const evidenceValid = evidenceURI.length > 0 && isHex(evidenceHash, { strict: true }) && evidenceHash.length === 66;

  const action = (functionName: string, label: string, args: readonly unknown[] = [id]) => (
    <AppButton
      variant="secondary"
      disabled={pending}
      onClick={() => void run({ functionName, args, label }, false)}
    >
      {label}
    </AppButton>
  );

  return (
    <div className="chain-actions">
      <div className="section-heading">
        <div><span className="section-kicker">STATE-AWARE ACTIONS</span><h2>当前链上操作</h2></div>
      </div>
      {project.state === 0 && (
        <>
          <label className="amount-field">
            <span>我的发起质押</span>
            <div><input value={stake} onChange={(event) => setStake(event.target.value)} /><strong>R</strong></div>
          </label>
          <div className="modal-action-row">
            <AppButton disabled={pending} onClick={() => void run({
              functionName: "acceptInitiation",
              args: [id, parseEther(stake)],
              label: "确认共同发起"
            }, false)}>确认并锁定 R</AppButton>
            {action("activateProject", "尝试激活项目")}
            {action("cancelExpiredDraft", "截止后取消草案")}
          </div>
        </>
      )}
      {project.state === 1 && (
        <div className="modal-action-row">
          <AppButton onClick={() => openModal({ type: "donate", projectId: id })}>第一轮捐款</AppButton>
          {action("markRound1Failed", "截止后判定未达标")}
        </div>
      )}
      {project.state === 2 && (
        <div className="modal-action-row">{action("refundRound1", "领取首轮退款")}</div>
      )}
      {project.state === 3 && (
        <>
          <EvidenceFields uri={evidenceURI} setUri={setEvidenceURI} hash={evidenceHash} setHash={setEvidenceHash} />
          <div className="modal-action-row">
            <AppButton disabled={pending || !evidenceValid} onClick={() => void run({
              functionName: "submitMidReview",
              args: [id, evidenceURI, evidenceHash],
              label: "提交中期材料"
            }, false)}>提交中期材料</AppButton>
            {action("markMidSubmissionOverdue", "截止后标记逾期")}
            {action("claimRound1DonationReputation", "领取首轮捐款 R")}
            {action("claimRound1Funds", "项目方领取首轮资金")}
          </div>
        </>
      )}
      {project.state === 4 && (
        <div className="modal-action-row">
          <AppButton onClick={() => openModal({ type: "score", projectId: id, stage: "mid" })}>提交中期评分</AppButton>
          {action("finalizeMidScore", "窗口结束后定分")}
        </div>
      )}
      {[5, 6].includes(project.state) && (
        <>
          <EvidenceFields uri={evidenceURI} setUri={setEvidenceURI} hash={evidenceHash} setHash={setEvidenceHash} />
          <div className="modal-action-row">
            {project.state === 5 && <AppButton onClick={() => openModal({ type: "donate", projectId: id })}>第二轮捐款</AppButton>}
            <AppButton disabled={pending || !evidenceValid} onClick={() => void run({
              functionName: "submitFinalReview",
              args: [id, evidenceURI, evidenceHash],
              label: "提交结项材料"
            }, false)}>提交结项材料</AppButton>
            {action("markFinalSubmissionOverdue", "截止后标记逾期")}
          </div>
        </>
      )}
      {project.state === 7 && (
        <div className="modal-action-row">
          <AppButton onClick={() => openModal({ type: "score", projectId: id, stage: "final" })}>提交结项评分</AppButton>
          {action("finalizeFinalScore", "窗口结束后定分")}
        </div>
      )}
      {project.state === 8 && (
        <div className="modal-action-row">
          <AppButton variant="danger" onClick={() => openModal({ type: "challenge", projectId: id })}>质押 R 发起挑战</AppButton>
          {action("beginDisputeVoting", "挑战期后开始争议投票")}
          {action("settleWithoutChallenge", "无挑战直接结算")}
        </div>
      )}
      {project.state === 9 && (
        <>
          <label className="amount-field">
            <span>争议投票质押</span>
            <div><input value={jurorStake} onChange={(event) => setJurorStake(event.target.value)} /><strong>R</strong></div>
          </label>
          <div className="filter-tabs compact-tabs">
            <button className={support ? "active" : ""} onClick={() => setSupport(true)}>支持挑战</button>
            <button className={!support ? "active" : ""} onClick={() => setSupport(false)}>反对挑战</button>
          </div>
          <div className="modal-action-row">
            <AppButton disabled={pending} onClick={() => void run({
              functionName: "voteOnDispute",
              args: [id, support, parseEther(jurorStake)],
              label: "提交争议投票"
            }, false)}>提交争议投票</AppButton>
            {action("finalizeDispute", "窗口结束后裁决")}
          </div>
        </>
      )}
      {project.settled && (
        <div className="modal-action-row">
          {action("claimDonorChallengeReward", "领取捐款者挑战奖励")}
          {action("claimInitiatorChallengeReward", "领取发起人挑战奖励")}
          {action("claimSuccessfulChallengeReward", "领取成功挑战奖励")}
          {action("unlockDisputeVoteStake", "解锁争议投票质押")}
        </div>
      )}
      {!address && <div className="modal-note">连接钱包后才能发送以上交易。</div>}
      <div className="rule-box">
        <strong>权限与时间仍由合约复核</strong>
        <p>按钮只改善操作入口；资格、金额、截止时间和状态转换均在交易执行时由 YoulinProtocol 再次校验。</p>
      </div>
    </div>
  );
}

function EvidenceFields({
  uri,
  setUri,
  hash,
  setHash
}: {
  uri: string;
  setUri: (value: string) => void;
  hash: Hex;
  setHash: (value: Hex) => void;
}) {
  return (
    <>
      <label className="text-field">
        <span>材料 URI</span>
        <input value={uri} onChange={(event) => setUri(event.target.value)} placeholder="ipfs://… 或 https://…" />
      </label>
      <label className="text-field">
        <span>材料内容 keccak256</span>
        <input value={hash} onChange={(event) => setHash(event.target.value as Hex)} placeholder="0x…" />
      </label>
    </>
  );
}

function CredentialDetail({
  project,
  donation
}: {
  project: ChainProject;
  donation?: { round1: bigint; round2: bigint };
}) {
  const total = (donation?.round1 ?? 0n) + (donation?.round2 ?? 0n);
  return (
    <div className="modal-content">
      <div className="credential-preview">
        <div className="large-p">P</div>
        <div>
          <span>NON-TRANSFERABLE PROJECT CREDENTIAL</span>
          <h3>{projectTitle(project)}</h3>
          <p>项目 #{project.id} · 累计支持 {displayEther(total, 4)} MON</p>
        </div>
      </div>
      <div className="credential-facts">
        <div><span>凭证状态</span><strong>永久保留</strong></div>
        <div><span>Token ID</span><strong>{project.id.toString()}</strong></div>
        <div><span>项目结果</span><strong>{project.finalScore ? `${project.finalScore} 分` : project.stateLabel}</strong></div>
      </div>
      <div className="explain-box">
        <Icon name="link" />
        <p>P 由首次有效捐款在 YoulinParticipation 中铸造，余额上限为 1，禁止单笔与批量转让。</p>
      </div>
    </div>
  );
}

function DonationForm({
  project,
  run,
  pending
}: {
  project: ChainProject;
  run: (call: ContractCall) => Promise<void>;
  pending: boolean;
}) {
  const [amount, setAmount] = useState("0.1");
  const isRound2 = project.state === 5;
  const raised = isRound2 ? project.round2Raised : project.round1Raised;
  const cap = isRound2
    ? project.targetAmount - project.targetAmount / 2n
    : project.targetAmount / 2n;
  return (
    <div className="modal-content">
      <div className="donation-context">
        <StateBadge tone={projectTone(project)}>{isRound2 ? "第二轮" : "第一轮"}</StateBadge>
        <div>
          <strong>{displayEther(raised, 2)} / {displayEther(cap, 2)} MON</strong>
          <span>{project.stateLabel} · 截止 {projectDeadline(project)}</span>
        </div>
      </div>
      <label className="amount-field">
        <span>捐款金额</span>
        <div>
          <input type="number" min="0.0001" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <strong>MON</strong>
        </div>
      </label>
      <div className="result-preview">
        <div><span>预计获得</span><strong>{amount || "0"} R</strong></div>
        <div><span>项目凭证</span><strong>首次捐款铸造 P</strong></div>
      </div>
      {isRound2 && (
        <div className="warning-box">
          <Icon name="shield" />
          <p>第二轮 MON 经协议登记后在同一笔交易中直达不可变项目钱包，不进入可退款托管。</p>
        </div>
      )}
      <AppButton
        disabled={pending || Number(amount) <= 0}
        onClick={() =>
          void run({
            functionName: isRound2 ? "donateRound2" : "donateRound1",
            args: [project.id],
            value: parseEther(amount),
            label: `${isRound2 ? "第二轮" : "第一轮"}捐款`
          })
        }
      >
        <Icon name="wallet" size={17} /> 在钱包中确认真实交易
      </AppButton>
    </div>
  );
}

function ScoreForm({
  project,
  stage,
  run,
  pending
}: {
  project: ChainProject;
  stage: "mid" | "final";
  run: (call: ContractCall) => Promise<void>;
  pending: boolean;
}) {
  const [score, setScore] = useState(8);
  return (
    <div className="modal-content">
      <div className="explain-box">
        <Icon name="vote" />
        <p>评分权重由合约计算 ln(1 + 累计捐款)。共同发起人不能给自己的项目评分。</p>
      </div>
      <div className="score-project">
        <span>{stage === "mid" ? "中期材料" : "结项材料"}</span>
        <strong>{projectTitle(project)}</strong>
        <small>{stage === "mid" ? project.midEvidenceURI : project.finalEvidenceURI}</small>
      </div>
      <div className="score-picker">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
          <button key={value} className={score === value ? "active" : ""} onClick={() => setScore(value)}>
            {value}
          </button>
        ))}
      </div>
      <div className="score-meaning">
        <span>1 · 严重未完成</span><strong>当前选择：{score} 分</strong><span>10 · 完整超预期</span>
      </div>
      <AppButton
        disabled={pending}
        onClick={() =>
          void run({
            functionName: stage === "mid" ? "submitMidScore" : "submitFinalScore",
            args: [project.id, score],
            label: `提交${stage === "mid" ? "中期" : "结项"}评分`
          })
        }
      >
        提交链上评分
      </AppButton>
    </div>
  );
}

function ChallengeForm({
  project,
  run,
  pending
}: {
  project: ChainProject;
  run: (call: ContractCall) => Promise<void>;
  pending: boolean;
}) {
  const [stake, setStake] = useState("1");
  const [uri, setUri] = useState("");
  const [hash, setHash] = useState<Hex>(zeroHash);
  const valid = uri.length > 0 && isHex(hash, { strict: true }) && hash.length === 66;
  return (
    <div className="modal-content">
      <div className="challenge-score">
        <span>结项审核已通过</span><strong>{project.finalScore}</strong>
        <small>低于 60 分的项目会直接失败，不进入挑战窗口</small>
      </div>
      <EvidenceFields uri={uri} setUri={setUri} hash={hash} setHash={setHash} />
      <label className="amount-field">
        <span>挑战质押</span>
        <div><input type="number" value={stake} min="1" onChange={(event) => setStake(event.target.value)} /><strong>R</strong></div>
      </label>
      <div className="warning-box">
        <Icon name="lock" />
        <p>挑战失败将损失质押 R；挑战成功时，发起人的项目质押按挑战质押比例分配。</p>
      </div>
      <AppButton
        variant="danger"
        disabled={pending || !valid}
        onClick={() =>
          void run({
            functionName: "supportChallenge",
            args: [project.id, parseEther(stake), uri, hash],
            label: "质押 R 并登记挑战"
          })
        }
      >
        质押 R 并登记挑战
      </AppButton>
    </div>
  );
}

function CreateProjectForm({
  address,
  run,
  pending
}: {
  address?: Address;
  run: (call: ContractCall) => Promise<void>;
  pending: boolean;
}) {
  const [projectWallet, setProjectWallet] = useState(address ?? "");
  const [target, setTarget] = useState("6");
  const [deadlineMinutes, setDeadlineMinutes] = useState("30");
  const [durationMinutes, setDurationMinutes] = useState("20");
  const [initiators, setInitiators] = useState(address ?? "");
  const [uri, setUri] = useState("");
  const [hash, setHash] = useState<Hex>(zeroHash);
  const invited = initiators
    .split(/[\s,，]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const valid =
    isAddress(projectWallet) &&
    Number(target) > 0 &&
    Number(deadlineMinutes) > 0 &&
    Number(durationMinutes) > 0 &&
    invited.length >= 3 &&
    invited.every((value) => isAddress(value)) &&
    uri.length > 0 &&
    isHex(hash, { strict: true }) &&
    hash.length === 66;

  return (
    <div className="modal-content">
      <div className="create-rules">
        <div><span>目标</span><strong>{target || "0"} MON</strong></div>
        <div><span>总发起质押</span><strong>≥ {target || "0"} R</strong></div>
        <div><span>最低共同发起人</span><strong>动态 ≥ 3</strong></div>
      </div>
      <label className="text-field">
        <span>不可变项目收款钱包</span>
        <input value={projectWallet} onChange={(event) => setProjectWallet(event.target.value)} placeholder="0x…" />
      </label>
      <label className="amount-field">
        <span>项目目标</span>
        <div><input value={target} onChange={(event) => setTarget(event.target.value)} /><strong>MON</strong></div>
      </label>
      <div className="form-grid">
        <label className="text-field">
          <span>第一轮截止（分钟后）</span>
          <input value={deadlineMinutes} onChange={(event) => setDeadlineMinutes(event.target.value)} />
        </label>
        <label className="text-field">
          <span>预计项目时长（分钟）</span>
          <input value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
        </label>
      </div>
      <label className="text-field">
        <span>共同发起钱包（逗号或换行分隔，须包含创建者）</span>
        <textarea value={initiators} onChange={(event) => setInitiators(event.target.value)} placeholder="0x…, 0x…, 0x…" />
      </label>
      <EvidenceFields uri={uri} setUri={setUri} hash={hash} setHash={setHash} />
      <div className="rule-box">
        <strong>创建只登记草案</strong>
        <p>每位受邀人仍需分别调用 acceptInitiation 锁定自己的 R；人数和总质押同时达标后才能激活。</p>
      </div>
      <AppButton
        disabled={pending || !valid}
        onClick={() =>
          void run({
            functionName: "createProjectDraft",
            args: [
              projectWallet as Address,
              parseEther(target),
              BigInt(Math.floor(Date.now() / 1000) + Number(deadlineMinutes) * 60),
              BigInt(Number(durationMinutes) * 60),
              invited as Address[],
              uri,
              hash
            ],
            label: "创建项目草案"
          })
        }
      >
        创建链上项目草案
      </AppButton>
      {!valid && <div className="modal-note">请填写有效钱包、至少 3 位发起人、材料 URI 与 32 字节内容哈希。</div>}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-chain-state">
      <Icon name="link" />
      <div><strong>{title}</strong><span>{body}</span></div>
    </div>
  );
}
