# 部署与演示记录

- `monad-testnet.json`：五份合约地址、部署/授权交易、Sourcify 验证链接与冻结配置；
- `demo-projects.json`：四个由真实交易创建的协议项目和完整生命周期交易；
- `genesis-demo.json`：三名真实捐赠者、创世提案、三票赞成、结算与执行交易；
- `profile-demo.json`：部署账户写入公开昵称、头像 URI 与自我描述的真实交易；
- `demo-wallets.public.json`：只包含公开地址和演示角色，不包含私钥。

`demo-wallets.private.json`、`.env`、助记词和任何服务密钥均不得提交。链上核验：

```powershell
npm run check:monad
npm run check:demo
```
