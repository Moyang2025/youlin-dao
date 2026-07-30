# 有邻 DAO 前端

本目录是原有视觉原型的直接演进版本，保留 Logo、账户首页、项目广场和
既有响应式视觉。数据层已替换为 Monad Testnet：

- Wagmi 3：浏览器注入钱包、网络切换、合约写交易；
- Viem 2：类型化地址、金额、公共 RPC 与交易回执；
- React Query 5：项目、P/R 账户状态和捐款索引缓存；
- 由 `黑客松/youlin-contracts/scripts/export-abi.ts` 自动生成 ABI 与地址。

页面没有本地项目数组或“点击后加数字”的模拟逻辑。项目广场从已部署
Monad Testnet 协议的 `projectCount` 和每个项目的 core/times/content
视图恢复；当前 4 个演示项目均由真实交易创建。

## 开发与构建

```powershell
npm install
npm run dev
npm run build
```

`npm run build` 执行 Next 静态导出，并由 `postbuild` 生成 Sites 所需的
`dist/client`、`dist/server` 和 `.openai/hosting.json`。

公开前端环境变量只能包含公共配置：

```text
NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_EXPLORER_URL=https://testnet.monadscan.com
```

私钥、助记词、上传服务密钥和签名服务密钥禁止写入任何
`NEXT_PUBLIC_*` 变量。

## 部署

`.openai/hosting.json` 已绑定现有 Sites 项目
`appgprj_6a63884968b48191bafad3fff55f0c86`。不要创建新 Sites 项目，也
不要修改本目录 Git `origin`。公开 GitHub 仓库通过独立 staging clone
同步，Sites 源仓库继续独立维护。

当前协议地址：

```text
YoulinProtocol      0x20a1Df8893fD7531A77E225f9727b45959D2ff66
YoulinReputation    0x3f3C0f177C4076aCb9be40198d9Ff93a74D5a3c3
YoulinParticipation 0xa8B7b596b9ebcA4Eb8BF6d9f95Ef68DcEB758CeF
```

桌面和 390×844 手机视口已验证能恢复 Draft、Round1Funding、
Round1Failed、Settled 四种真实状态；干净浏览器会话无控制台错误或警告。
