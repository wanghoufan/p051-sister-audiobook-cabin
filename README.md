# 妹妹的听书小屋（P051）

基于本地影音库项目的应用结构，改造为妹妹的听书小屋。

- 本地目录：`051-ing-妹妹的听书小屋`
- GitHub：`wanghoufan/p051-sister-audiobook-cabin`（private）
- 状态：SDD V1.1 可自动开发与自测已实施，最终 Human Gate 待签收（含 4 份源音频异常）

## 复用来源

本项目从 P038「keep 运动健身仓库」复制应用基础代码，作为听书产品的改造起点。已复用 React/Vite 前端、Node 本地服务结构、通用组件与可迁移测试；P038 的 Git 历史、ORCA 治理资料、运动视频目录与分类数据、真实数据夹具、生成产物和本地索引数据库均未复制。旧视频能力作为 LegacyVideoApp 保留并继续回归；P51 默认入口另有课程/音频专项用例。


## 本地运行

```sh
pnpm install --offline --frozen-lockfile
pnpm build
pnpm serve
```

默认访问 http://127.0.0.1:8792/；端口占用时设置空闲 APP_PORT，不关闭其他服务。已锁定 Android 手机可运行 `node scripts/android-preview.mjs`，自动核验目标、选择空闲端口、启动临时 USB 预览，Ctrl+C 清理。

- 原始音频放在 `兴趣测试/`；`pnpm audio:scan` 生成私有索引与完整性报告。
- 支持课程筛选/搜索、真实分集、共享播放器、睡眠/循环/断点、整课离线、中英与主题三态。
- 原音频不上传、不公开托管；当前 4 份源文件损坏，扫描退出码 2 是资源告警，不是自动测试失败。
- 操作与安装边界见 [运行与安装说明](docs/qa/P51-运行与安装说明.md)，验收证据见 [最终交付与 Human Gate](docs/qa/P51-最终交付与HumanGate.md)。
