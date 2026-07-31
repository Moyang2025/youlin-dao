# 有邻 DAO · Monad 黑客松

有邻 DAO 是一个以参与者链上履历为中心的两轮公共项目协议。共同发起与 R 质押、两轮募捐、不可转让 P/R、对数加权评分、挑战、争议投票、最终结算以及创世金库治理，全部由 Monad Testnet 智能合约执行。

生产站点：[youlin-dao-civic-profile-july24.mo-yang2023.chatgpt.site](https://youlin-dao-civic-profile-july24.mo-yang2023.chatgpt.site/)

## 目录

- `youlin-contracts/`：Solidity 合约、53 项测试、Ignition 部署与真实演示脚本；
- `youlin-interface/`：保留原视觉的 Wagmi/Viem/React Query 链上前端；
- `docs/部署记录.md`：合约地址、部署哈希、验证链接和测试结果；
- `docs/演示账户说明.md`：仅公开地址的演示角色；
- `docs/黑客松演示路径.md`：钱包、捐款、提案、项目发起和两轮流程。

## 已完成

- 53/53 合约测试通过；整体行覆盖率 92.28%，创世金库 96.91%；
- 四份合约部署到 Monad Testnet，并在 Sourcify 验证源码；
- bootstrap 永久关闭；
- 四个原协议项目由真实交易创建，覆盖草案、募捐、失败退款和完整结算；
- 创世金库由 3 名真实捐赠者完成一笔提案、投票、结算和支出；
- 桌面端与 390×844 手机端生产构建验收通过，浏览器控制台 0 error / 0 warning。

## 仓库安全

开发根目录没有执行 `git init`。`youlin-interface/.git` 始终绑定 ChatGPT Sites 专用源；本 GitHub 仓库由独立 staging clone 同步。`.env`、私钥、助记词、Sites 凭据、构建缓存和本地测试账户密钥均不进入公开仓库。
