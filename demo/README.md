# 有邻 DAO · Monad Testnet A→B Demo

本目录保存黑客松展示成片和可独立核验的链上证据。

- `有邻DAO_Demo_3分10秒_中文字幕.mp4`：1920×1080、190 秒、H.264/AAC 成片；
- `有邻DAO_Demo_中文字幕.srt`：独立中文字幕；
- `有邻DAO_Demo_旁白全文.txt`：合成旁白原文，可替换为真人配音；
- `有邻DAO_Demo_交易证明.json`：合约、项目、账户和全部交易哈希；
- `demo-video-lifecycle.json`：A→B 真实交易执行记录与最终状态；
- `demo-video-history.json`：在各确认区块执行历史 `eth_call` 得到的阶段快照；
- `build_demo_video.py`：可重复生成视频的脚本；
- `有邻DAO_3分钟黑客松Demo设计方案.md`：逐秒分镜、旁白和规则说明。

## 链上结果

- Project A `#5`：乡村校园安全饮水计划；第一轮 15 MON、第二轮 15 MON、中期 80 分、结项 90 分，状态 `Settled`；
- Project B `#6`：视频录制时由 A 的三位捐款者各锁定 10 R 后激活；其一小时演示窗口结束后，因 0 MON 未达首轮目标而标记为 `Round1Failed`；
- 实时问答 Project B `#7`：同名项目，由原三位账户重新锁定 30 R，状态 `Round1Funding`，第一轮截止北京时间 `2026-08-10 22:00`；
- Project #7 激活交易：`0xd6bd033d19df49cd7ec526a787a0115ff258a72343fbaa0af79ff7386a885761`；
- `demo-live-project-b.json` 保存 #6 结束与 #7 重建的 6 笔交易证明。

演示项目、材料和 MON 均为 Monad Testnet 测试用途，不代表现实公益项目已经实施。
