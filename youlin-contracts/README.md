# 有邻 DAO 智能合约

Solidity 0.8.28 / EVM Prague / Hardhat 3 项目，包含：

- `YoulinReputation`：不可转让的统一声誉 R，支持协议铸造、锁定、消耗和重新分配；
- `YoulinParticipation`：不可转让、每地址每项目至多一枚的参与凭证 P；
- `YoulinProtocol`：开放共同发起与 R 质押、两轮募捐、中期/结项对数加权评分、挑战、争议投票和结算；项目草案公开进入广场，不维护受邀钱包名单；
- `YoulinGenesisTreasury`：新用户创世捐款入口与不可绕过投票的社区金库。
- `YoulinProfileRegistry`：每个钱包自行维护公开的链上昵称、头像 URI 与自我描述；无管理员代改入口。

## 链上个人资料

- 资料与钱包地址一一对应，只能由该地址调用 `setProfile` 或 `clearProfile`；
- 昵称允许重复，昵称、头像 URI、自我描述均可选，但不能全部为空；
- UTF-8 字节上限依次为 64、512、512；头像只保存 URI，不把图片字节写入链上；
- 所有字段都是公开链上数据，不应填写手机号、住址等隐私信息。

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

测试结果：59/59 通过，整体行覆盖率 92.56%，个人资料合约行覆盖率 100%，创世金库行覆盖率 96.91%。

Monad Testnet 部署、源码验证、真实演示交易与公开地址见 `deployments/monad-testnet.json`、`deployments/genesis-demo.json` 和公开仓库 `docs/部署记录.md`。本地 `.env` 与测试账户私钥受到 `.gitignore` 保护，禁止提交或打印。
