# 有邻 DAO 前端

这是原有视觉原型的链上版本，保留 Logo、账户首页、项目广场和响应式视觉。页面通过 Wagmi 3、Viem 2 和 React Query 5 连接 Monad Testnet；项目、P、R、募捐、评分、挑战、结算、创世金库治理以及账户个人资料都从合约恢复，不使用本地模拟数组冒充结果。

## 开发

```powershell
npm install
npm run build
npm run dev
```

`npm run build` 会进行类型检查和静态导出，并由 `postbuild` 生成 Sites 所需的 `dist/client`、`dist/server` 和 `.openai/hosting.json`。ABI 与地址由 `youlin-contracts/scripts/export-abi.ts` 自动生成。

公开前端变量只能包含公共配置：

```text
NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_EXPLORER_URL=https://testnet.monadscan.com
```

不得把私钥、助记词或服务密钥放入任何 `NEXT_PUBLIC_*` 变量。

## Monad Testnet

```text
YoulinProtocol         0x60634746d377ea1d71F78cB22bf8436D34e15B99
YoulinProtocolLegacy   0x20a1Df8893fD7531A77E225f9727b45959D2ff66
YoulinReputation       0x3f3C0f177C4076aCb9be40198d9Ff93a74D5a3c3
YoulinParticipation    0xa8B7b596b9ebcA4Eb8BF6d9f95Ef68DcEB758CeF
YoulinGenesisTreasury  0xe4a470a21E272945fcDAAF7625f6D11703183fC6
YoulinProfileRegistry  0x3d6Bd044f11018114c1793E80Aed53d230D46Ac7
```

连接钱包后可在“我的有邻”编辑昵称、头像 URI 和自我描述。资料由当前钱包直接写入 `YoulinProfileRegistry`；昵称允许重复，头像支持 `https://`、`http://` 与 `ipfs://`。三个字段均为公开链上数据，页面不会把资料保存为本地替代状态。

“项目参与凭证”会同时读取普通协议项目 P 与创世 P。创世 P 通过 `YoulinParticipation.hasCredential(账户, GENESIS_PROJECT_ID)` 直接核验，不依赖前端根据捐款金额猜测。

创世项目没有全局募捐上限；每个地址最多通过它累计获得 100 R。捐款即时获得等额 R，首次捐款铸造创世 P。金库提案按创建时的累计捐款快照使用 `ln(1 + 捐款 MON)` 加权；至少 3 个地址实际投票，赞成票达到已投赞成与反对总权重的 66% 才能通过，弃权不计入分母。

## Sites

`.openai/hosting.json` 固定复用 Sites 项目 `appgprj_6a63884968b48191bafad3fff55f0c86`。本目录的 Git `origin` 是 Sites 专用源，不得改成 GitHub。公开 GitHub 仓库通过独立 staging clone 同步，两个远端互不覆盖。

桌面端与 390×844 手机端已验证：创世金库、已执行治理提案和四个原项目均可恢复，干净浏览器会话无控制台错误或警告。
