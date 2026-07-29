# 有邻 DAO 前端

本目录是原有视觉原型的直接演进版本，保留 Logo、账户首页、项目广场和
既有响应式视觉。数据层已替换为 Monad Testnet：

- Wagmi 3：浏览器注入钱包、网络切换、合约写交易；
- Viem 2：类型化地址、金额、公共 RPC 与交易回执；
- React Query 5：项目、P/R 账户状态和捐款索引缓存；
- 由 `黑客松/youlin-contracts/scripts/export-abi.ts` 自动生成 ABI 与地址。

页面没有本地项目数组或“点击后加数字”的模拟逻辑。合约尚未部署时会明确
显示空状态，并阻止发送交易；部署后项目广场从 `projectCount` 和每个项目
的 core/times/content 视图恢复。

## 开发与构建

```powershell
npm install
npm run dev
npm run build
```

`npm run build` 执行 Next 静态导出。公开仓库不包含 ChatGPT Sites 的专用
`.openai/hosting.json` 和打包脚本；生产站点继续由原 Sites 源仓库独立维护，
避免公开 GitHub 推送改变其远端配置。

公开前端环境变量只能包含公共配置：

```text
NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_EXPLORER_URL=https://testnet.monadscan.com
```

私钥、助记词、上传服务密钥和签名服务密钥禁止写入任何
`NEXT_PUBLIC_*` 变量。

## 部署

生产 Sites 项目继续使用既有项目
`appgprj_6a63884968b48191bafad3fff55f0c86`，但其专用配置不发布到本仓库。
公开 GitHub 仓库与 Sites 源仓库是两条独立发布链路。
