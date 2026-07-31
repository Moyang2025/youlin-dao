# 有邻 DAO 智能合约

Solidity 0.8.28 / EVM Prague / Hardhat 3 项目，包含：

- `YoulinReputation`：不可转让的统一声誉 R，支持协议铸造、锁定、消耗和重新分配；
- `YoulinParticipation`：不可转让、每地址每项目至多一枚的参与凭证 P；
- `YoulinProtocol`：共同发起与 R 质押、两轮募捐、中期/结项对数加权评分、挑战、争议投票和结算；
- `YoulinGenesisTreasury`：新用户创世捐款入口与不可绕过投票的社区金库。

## 创世金库规则

- 不设置全局募捐上限；
- 每地址创世累计捐款上限为 100 MON，并即时获得等额的最多 100 R；
- 首次捐款铸造创世 P，MON 留在金库；
- 提案创建时快照各地址累计捐款；
- 权重为 `ln(1 + 累计捐款 MON)`；
- 至少 3 个地址实际投票；
- `赞成权重 / (赞成权重 + 反对权重) >= 66%` 才通过；
- 不投票不等于反对；
- 管理员不能提款；通过的提案只能向预先固定的收款地址转固定金额。

## 命令

```powershell
npm install
npm run typecheck
npm test
npm run test:coverage
npm run check:monad
npm run export:abi
```

测试结果：53/53 通过，整体行覆盖率 92.28%，创世金库行覆盖率 96.91%。

Monad Testnet 部署、源码验证、真实演示交易与公开地址见 `deployments/monad-testnet.json`、`deployments/genesis-demo.json` 和公开仓库 `docs/部署记录.md`。本地 `.env` 与测试账户私钥受到 `.gitignore` 保护，禁止提交或打印。
