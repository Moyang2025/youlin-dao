# 部署记录

Monad Testnet 部署完成后，脚本写入 `monad-testnet.json`。文件必须包含 chain ID、三个合约地址、部署交易、验证状态、部署提交和 bootstrap 关闭交易；不得包含私钥、助记词或服务密钥。

部署前不得创建占位地址文件冒充已部署结果。标准顺序：

1. `npm run deploy:monad`
2. `npm run record:monad`
3. `npm run check:monad`
4. 在 Monadscan/Sourcify 验证三个合约并更新 verification 字段
5. `npm run bootstrap:demo`，确认 `bootstrap.closed = true`
6. `npm run seed:demo`
7. `npm run export:abi`

Ignition 的完整 journal 保存在 `ignition/deployments/chain-10143/`，公开
仓库保留该目录以便复核部署交易，但不得包含任何 `.env`。
