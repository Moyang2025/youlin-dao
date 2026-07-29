# 有邻 DAO · Monad 黑客松

有邻 DAO 是一个以参与者账户为中心的两轮公共项目协议。项目发起质押、
两轮资金、P/R、对数加权评分、挑战、争议投票和结算全部由 Monad
Testnet 智能合约执行。

## 目录

- `youlin-contracts/`：Solidity 合约、测试、Ignition 部署与演示脚本；
- `../youlin-interface/`：保留原视觉的 Wagmi/Viem/React Query 前端；
- `有邻DAO_黑客松开发与部署交接文档.md`：冲突裁决与最终验收标准；
- `部署记录.md`、`演示账户说明.md`、`黑客松演示路径.md`：交付记录。

## 仓库与站点安全组织

根目录不执行 `git init`。`../youlin-interface/.git` 继续绑定 ChatGPT
Sites 专用源，不修改其 `origin`。公开仓库
`Moyang2025/youlin-dao` 使用 `黑客松/youlin-dao-public/` 独立 clone，
同步以下冻结内容：

```text
README.md
youlin-interface/   # 排除内部 .git、构建目录、.env
youlin-contracts/   # 排除 node_modules、coverage HTML、.env
docs/
```

这样 GitHub 推送和 Sites 部署是两条独立链路，任何一条都不会覆盖另一条
的远端配置。

## 当前本地验收

- Solidity 0.8.28 / Prague / viaIR 编译通过；
- 41 条测试通过，总行覆盖率 91.11%；
- Ignition 本地三合约部署与角色授权通过；
- ABI 自动导出到现有前端；
- Next 生产静态构建与 Sites 打包通过；
- 桌面、390px 手机、空链状态、创建项目弹窗完成真实浏览器回归。

Monad Testnet 地址、源码验证、真实演示交易和生产 Sites 发布必须在测试
钱包签名后填写，未发生前保持明确的 pending 状态。
