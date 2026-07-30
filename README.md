# 有邻 DAO · Monad 黑客松

有邻 DAO 是一个以参与者账户为中心的两轮公共项目协议。项目发起质押、
两轮资金、P/R、对数加权评分、挑战、争议投票和结算全部由 Monad
Testnet 智能合约执行。

## 目录

- `youlin-contracts/`：Solidity 合约、测试、Ignition 部署与演示脚本；
- `youlin-interface/`：保留原视觉的 Wagmi/Viem/React Query 前端；
- `docs/部署记录.md`、`docs/演示账户说明.md`、`docs/黑客松演示路径.md`：交付记录。

## 仓库与站点安全组织

开发工作区根目录不执行 `git init`。原型工作区的
`youlin-interface/.git` 继续绑定 ChatGPT Sites 专用源，不修改其
`origin`。本公开仓库由独立 staging clone 同步以下冻结内容：

```text
README.md
youlin-interface/   # 排除内部 .git、Sites 专用配置、构建目录、.env
youlin-contracts/   # 排除 node_modules、coverage HTML、.env
docs/               # 只发布项目说明、部署记录、演示说明
```

这样 GitHub 推送和 Sites 部署是两条独立链路，任何一条都不会覆盖另一条
的远端配置。

## 当前本地验收

- Solidity 0.8.28 / Prague / viaIR 编译通过；
- 41 条测试通过，总行覆盖率 91.11%；
- Monad Testnet 三合约部署、P/R 角色授权及 Sourcify 源码验证通过；
- bootstrap 已永久关闭，真实地址和 ABI 已自动导出到前端；
- 4 个真实交易项目覆盖草案、募捐、失败退款和完整结算；
- 项目 D 两轮各 `0.03 MON`，中期 80、结项 90；
- Next 生产构建通过；
- 桌面和 390×844 手机浏览器恢复 4 个链上项目，干净会话
  0 error / 0 warning。

部署地址、验证 URL、公开演示账户和全部交易哈希见
`youlin-contracts/deployments/` 与 `docs/部署记录.md`。生产 Sites
继续由独立的既有 Sites 源仓库维护。
