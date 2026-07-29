# 有邻 DAO 合约

有邻 DAO 是部署在 Monad Testnet 的公益协作协议。本目录实现三个不可升级合约：

- `YoulinReputation`：唯一、不可转让的 18 位声誉 R；
- `YoulinParticipation`：`tokenId = projectId` 的不可转让 ERC-1155 参与凭证 P；
- `YoulinProtocol`：项目发起、两轮资金、评分、挑战和最终结算状态机。

## 冻结规则

- `round1Cap = floor(targetAmount / 2)`，一轮成功前不发捐款 R；失败后逐人退款且 P 保留。
- `round2Cap = targetAmount - round1Cap`，二轮必须经过协议并在同笔交易转入固定项目钱包，不可退款。
- `MIN_INITIATORS = max(3, ceil(targetMON / 1000))`。
- `MAX_INITIATORS = max(MIN_INITIATORS, min(10, floor(targetMON / 10)))`。
- 发起质押总量至少等于目标 MON；每位发起人必须用自己的钱包确认和锁定 R。
- 发起人自捐计入筹款，但不产捐款 R，并且不能参加本项目中期或结项评分。
- 中期截止为一轮完成时间加 `floor(expectedDuration * 2 / 3)`。
- 结项截止为中期提交时间加实际第一阶段用时。
- 捐款评分权重为 `ln(1 + donationMON)`，总分为 `floor(10 * Σ(weight * rawScore) / Σweight)`。
- 中期分达到 60 才开放二轮；最终分低于 60 直接销毁全部发起质押且不进入挑战。
- 正常结算按 `stake * finalScore / 80`：60/80/85/100 分对应 75%/100%/106.25%/125%。
- 挑战投票权重为 `sqrt(stakedR)`，至少 3 位争议投票者且支持权重达到 60% 才成立。
- 所有时间来自 `block.timestamp`；所有退款和挑战奖励均由账户主动领取。

测试网使用分钟级窗口，前端必须显示“Demo 时间缩放”。测试资产不构成真实公益募捐。

## 本地开发

```powershell
npm install
npm run compile
npm test
npm run test:coverage
npm run deploy:local
npm run export:abi
```

当前测试基线：41 条 Node Test Runner 用例全部通过；合约包行覆盖率
91.11%，`YoulinProtocol` 行覆盖率 90.23%，P/R 合约均为 100%。覆盖范围
包含四条端到端生命周期、59/60 分边界、60/80/85/100 结算公式、精确
60% 争议门槛、退款、超时、拒绝收款、权限与重复领取保护。

Hardhat 3 同时配置 `default` 与 `production` 编译 profile，均使用 Solidity
0.8.28、`evmVersion = prague`、优化器和 `viaIR`。Ignition 会使用
`production` profile；不要删除该 profile。

## Monad Testnet

当前官方配置：

- Chain ID：`10143`
- RPC：`https://testnet-rpc.monad.xyz`
- Explorer：`https://testnet.monadscan.com`
- 编译 EVM：`prague`

复制 `.env.example` 为 `.env`，只使用不持有真实资产的测试钱包。不要把私钥、助记词或 API 密钥提交到 Git、命令日志或前端。

```powershell
npm run deploy:monad
npm run record:monad
npm run check:monad
npm run export:abi
```

`record:monad` 从 Ignition 的 `chain-10143/deployed_addresses.json` 生成
`deployments/monad-testnet.json`；前端地址和 ABI 只能由 `export:abi` 生成，
不得手工维护第二份。

部署后，使用本机测试钱包运行：

```powershell
npm run bootstrap:demo
npm run seed:demo
```

`bootstrap:demo` 为公开演示地址铸造测试 R 后永久关闭 bootstrap。
`seed:demo` 由真实 Monad Testnet 交易创建草案、募捐中、首轮失败退款和
完整结算项目，并把公开地址、项目 ID、交易哈希写入
`deployments/demo-projects.json`。脚本从 `.env` 读取至少 12 个独立演示
测试钱包私钥，但永不输出或写回私钥。

## 安全与部署边界

- 协议不可升级；管理员只有 AccessControl 与紧急暂停能力，不能修改项目
  资金、评分或结算结果。
- 所有原生币转账使用 checks-effects-interactions 与 `nonReentrant`；首轮
  退款和奖励使用 pull claim。
- 挑战支持者最多 64 个，避免成功挑战结算时出现无界 gas 循环；发起人
  数量由动态上限限制为最多 10。
- `YoulinProtocol` 优化后运行时代码约 29 KB，超过以太坊 24 KB 限制，
  但低于 Monad 当前 128 KB 合约大小上限。本部署工件只面向 Monad
  Testnet，不应原样部署到仍执行 24 KB 上限的网络。
- 测试网窗口为 2–3 分钟，页面必须显示 Demo 时间缩放；真实产品应使用
  天/月级参数重新部署。
- bootstrap 关闭是正式验收项。在关闭交易确认前，不得对外宣称 R 供应
  初始化完成。
