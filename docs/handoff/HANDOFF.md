# HANDOFF｜P51 妹妹的听书小屋

更新时间：2026-10-17。用户明确要求本次开发暂时结束，等待后续恢复。本文件为恢复入口，已合并夜间开发和上午有声续测的最新状态。

## 一、当前进度

- 项目目录：`/Users/zzymima0000/Developer/coding/1.Active/051-ing-妹妹的听书小屋`。
- 当前分支：`codex/p51-audiobook-v1`（远端 `origin/main` 已由本轮 `commit + push` 追平）。仓库为**私有仓**，治理脚手架随项目入库（非公开仓，不做 ORCA 索引摘除）。仍有未追踪治理文件，不得清理或覆盖。
- 开发基线：`docs/plan/P51-SDD-开发交付包-V1.1/`。此前已读取包内开发者提示词和全部 SDD 文档，并参照 HTML 交互原型实现。恢复后先复核交付包的任务、验收和原型，不另起产品设计。
- PLAN_VERSION：以 `docs/plan/P51-SDD-开发交付包-V1.1/03-PLAN.md` 为需求真源（SDD V1.1，用户已明确要求执行）。
- 执行方式：唯一开发者实施、自审、自测，未使用其他智能体或独立 reviewer。软件开发与自动回归已完成，产品验收仍为 **OPEN**，用户尚未首次签收；无已知未修复 P0 程序缺陷，不代表所有资源及硬件验收通过。

### 已实现

沿用现有 React 19、Router 7、Vite 7 与 Node 项目，增量增加音频产品；旧视频入口保留于 `src/LegacyVideoApp.tsx`，原回归保留。

30 门真实课程、7 学科、L1/L2/L3 组合筛选和范围搜索；真实分集及稳定 ID；迷你/全屏共用单音频节点；播放暂停、上下集、拖动、倍速、顺序/单集/列表循环；15/30/60 分钟和本集结束睡眠定时；断点与历史；单集/整课下载、取消、删除、重试及空间错误；PWA shell/目录缓存、完整音频缓存和离线 Range。主题 LIGHT/DARK/SYSTEM、语言 FOLLOW_SYSTEM/zh-CN/en 均持久化，不支持的系统语言回退 zh-CN。

主要代码：

- `src/audio/`：界面、播放引擎、离线库、i18n、样式。
- `server/audio-catalog.mjs`、`audiobook-server.mjs`：只读目录、音频和 Range 服务。
- `scripts/scan-audio.mjs`、`scripts/build-pwa.mjs`、`scripts/android-preview.mjs`。
- `public/sw.js`、`public/offline-range.js`、manifest 与图标。
- `tests/unit/audio-engine.test.ts` 等新增测试及保留的旧视频回归。

### 最新验证与修复

- 最终 `pnpm test`：**26 文件、464 测试通过**；`pnpm build`、`pnpm lint`、`git diff --check` 均通过。
- 夜间阶段未手机外放。上午用户明确授权有声，并亲自回复“听到了，声音正常”；原系统媒体音量 9/15 未主动调整。
- Redmi Note 11T Pro+ 实测：可听播放、1.5×、拖动；通知栏实际暂停、上下集、seek；后台33秒及约一分钟短时锁屏持续播放。锁屏后输入受系统限制，用户手动解锁后恢复可见，未绕过锁屏。
- 三种模式通过真实音频 ended 验证：单集重新播放、顺序末集停止、列表末集回首；本集结束定时优先于循环停止。
- 15/30/60 分钟预设截止值已核对；另以明确标注的约18秒时钟注入验证后台到点暂停，**不等于完整15/30/60分钟实测**。
- 手机整课10集、51,280,023字节下载；移除USB源通道、重新加载后实际播放推进并返回206；删除后503、历史保留；恢复通道后10集重下成功。未更改手机Wi-Fi/移动网络，不能称飞行模式全长试听。最终保留这门〔已脱敏〕测试课程缓存，可通过界面删除，未清空用户历史。
- 真机发现并修复：Chrome load 重置实际倍速；切集媒体位置/时长不同步；刷新恢复断点未重绑Media Session标题和actions。均补RED→GREEN测试，并重建后在真机复验。
- 全量回归曾发现旧视频比例设置被延迟effect清除的竞争，改用useLayoutEffect在布局阶段重置；首轮失败日志保留，最终全部464项通过，未跳过失败。

### 资源状态

原音频位于项目根目录 `兴趣测试/`，私有索引为 `catalog/audio-index.json`，均排除Git。递归扫描1,905文件、8,850,730,200字节（含20份大写.MP3），30门均匹配、未匹配0；全部SHA-256，1,901份通过时长/前2秒解码检查，4份损坏，38组相同内容副本保留。重扫资源ID稳定。

《〔已脱敏〕》12「〔已脱敏〕」、13「〔已脱敏〕」、16「〔已脱敏〕」、17「〔已脱敏〕」不可解码，无本机有效替代。界面保留并禁播，未修改源文件。扫描仍生成可用索引，但退出码 **2** 表示资产异常，不可写全量资源通过。前2秒解码检查不等于逐秒全长试听。

### 2026-10-17 恢复会话新增

- 设备锁原固定为 Redmi Note 12 Pro（与本项目基线冲突）；经用户本次明确指定，已重新固定回 **Redmi Note 11T Pro+**（USB 在线），后续真机操作只用该机型。
- 桌面入口：在 Note 11T Pro+ 上用 `localhost:8792/` 完整复现安装流程并抓取系统日志，定位根因＝Chrome WebAPK 铸造所依赖的 Google 服务在本机网络不可达、铸造 **60 秒超时**，且 Chrome 153 已无可安装站点的桌面快捷方式回退 → **现有 PWA 路径不产生任何桌面入口**，属环境阻塞非应用缺陷；详见 `docs/qa/P51-BUGS.md`「桌面入口根因诊断」。结论已写入矩阵 FR12b（BLOCKED_ENV）与 P51-INSTALL-01。
- 复测后已清理：预览服务停止、8792 无监听、USB reverse 与 DevTools forward 均移除；未改系统权限/音量，未在手机上播放音频。
- **Docker 常驻部署完成并分层验收 PASS**（用户 2026-10-17 指令「部署在 Docker 上面！按照规范」）：按 `docs/sop/docker.md` V1.1 建 4 件产物（`Dockerfile`/`compose.yaml`/`.dockerignore`/`docker/env.template`），按 `docs/sop/background-services.md` **先登记（治理仓 `后台服务登记表.md` 的 `docker.audiobook-hut`）后创建**；镜像 `audiobook-hut:0.1.0` 多阶段 `node:22-alpine` 构建成功；停掉占用 8792 的临时前台服务（PID 78646）后 `docker compose --env-file .env.local up -d`，容器 `audiobook-hut-app-1` 为 `Up (healthy)`、`0.0.0.0:8792->8792`；验收：`/api/courses`=200、音频 `Range=206`、局域网 `http://192.168.31.42:8792/api/courses`=200。全程未新建 LaunchAgent；此前误建的 `com.p51.audiobook.plist` 已撤回、未回填。
- **15 分钟锁屏后台睡眠定时真机实测 PASS**：USB 通道＋Docker 常驻容器，选课「〔已脱敏〕／〔已脱敏〕」后设「15 分钟」定时、`adb keyevent 26` 锁屏；30s 采样器连续 28 次 `PLAYING`（约 13.8 分钟，position 每 30s 稳定推进），到期点 **+225 ms** 准时转 `PAUSED`（11:48:11 PLAYING 921477 → 11:48:42 PAUSED 934503 冻结），应用侧 `sleep=off`/`notice=sleep`、UI 显示「已按睡眠定时停止」。证据 `docs/qa/p51-sound-2026-10-17/sleep-15min.json`；矩阵 **FR12c 由 OPEN 转 PASS**。
- **桌面图标用局域网地址重建完成并真机验证**（用户 2026-10-17 授权「重建桌面图标」）：在小米浏览器对 `http://192.168.31.42:8792/` 执行「添加到桌面」，生成桌面第二页新图标「妹妹的听书小屋」（快捷方式 intent `dat=http://192.168.31.42:8792/`）；`am force-stop com.android.browser` 后点击仍能新开浏览器并正常加载小屋首页（证明不依赖 USB/adb reverse）；指向 `http://localhost:8792/` 的旧图标已长按移除，`dumpsys shortcut` 现仅剩 `id=妹妹的听书小屋` 一条。矩阵 **FR12b 由 OPEN 转 PASS**。
- **低龄可读性整改并部署**（用户 2026-10-17：「界面字体太小 妹妹看的费劲 他们还小 不能那么费眼」＋「4 个字都变成双行…把更多空间腾出来给右边」＋「字体不能居中，全部都要居左？」）：`.cabin` 基准 16px→19px（`font-size ≤22px` 统一 ×1.25、下限 14px、图标字号不动）；`.library-layout` 栏目列 `112px→78px`（＝每行正好 2 汉字，4 字分类自动双行）、`.cabin .subject-rail button` 由 `text-align:left` 改 `center`。390px 视口 CDP 实测 `overflow=false`、触控区仍 ≥44px。先出 before/after 四页原型给用户确认，确认后同步部署副本并 `docker compose --env-file .env.local up -d --build` 重建镜像重启（`Up (healthy)`），锁定真机（Redmi Note 11T Pro+）确认新 UI 生效。证据 `docs/qa/p51-evidence/ui-font-2026-10-17/`，矩阵 **FR15 补证据**，缺陷记 **P51-14 / P51-15**。
- **桌面图标换成小熊图案（用户完成）**：新 favicon（小熊 `icon-192.png`）上线后旧快捷方式仍显示小米浏览器默认「网页」图标（`icon=null` + 通用 bitmap），Chrome 路径在本机网络不可行（WebAPK 铸造 60s 超时）；改由用户在小米浏览器「添加到桌面」重加后，桌面图标已变为小熊，用户确认「没问题了，我已经添加到桌面上了」。缺陷记 **P51-16**，矩阵 **FR12b 补证据**。
- **残留清理（本轮）**：`temp/` 临时脚本与图标候选、`.trae/documents/font-prototype/` 过程稿已清；关键原型归档到 `docs/qa/p51-evidence/ui-font-2026-10-17/`；`.trae/` 加入 `.gitignore`；`temp/` 与 8792 预览服务已停。本轮改动已 `commit` 并 `push` 到 `origin/main`。

## 二、下一步任务

按依赖执行，避免重复已通过的测试；新增修改后必须测试、构建并在锁定真机验证。

1. 阅读本文件及下列交付/缺陷/矩阵，检查Git工作区与设备锁，确认当前状态后恢复，不重新初始化项目。
2. 桌面入口：Chrome 路径已证实不可行（原因见 `docs/qa/P51-BUGS.md`「桌面入口根因诊断」）；**改走小米浏览器"添加到桌面"已成功**，图标可打开小屋（非独立窗口）。**①服务已按用户指令「部署在 Docker 上面」完成**：Docker 常驻且局域网可达（`http://192.168.31.42:8792/api/courses`=200）；**②已由用户 2026-10-17 授权并完成**：桌面图标已改用局域网地址重建（新图标「妹妹的听书小屋」指向 `http://192.168.31.42:8792/`，旧 localhost 图标已移除，强停浏览器后点击仍可正常加载）。用户先前"改做安装包"的决定待此路结论后确认是否仍需要。
3. 后台与耳机：用户 2026-10-17 决定**耳机线控不做（范围豁免）**；**15 分钟锁屏后台睡眠定时已实测 PASS**（见上）；30/60 分钟全长定时未测，待用户确认是否一并做。不以模拟替代物理验证；集中列出真正需要用户参与的项目，不伪造 PASS。
4. 坏源：用户 2026-10-17 决定**接受《〔已脱敏课程〕》12/13/16/17 四集暂时禁播（范围豁免）**；不改源文件、不伪造音频、不公开抓取。将来若取得合法副本再复扫恢复。
5. 集中完成最终Human Gate：触控滑动、课程名称/界面体验、未闭环硬件与桌面入口、坏源处置及首版签收。用户只确认了声音，尚未同意产品全量验收。按真实结果更新矩阵、BUGS、最终报告和本交接。

### 恢复运行

```sh
pnpm build
node scripts/android-preview.mjs
```

脚本使用设备锁，先检查端口，启动临时前台服务并建立目标手机USB reverse，输出准确地址。常规来源：手机 `http://localhost:8792/`；电脑 `http://127.0.0.1:8792/`。端口冲突不得关其他服务；换端口产生不同来源，旧缓存/历史/安装入口不会自动迁移，优先维持原8792来源。

> **注意（2026-10-17 Docker 部署后）**：8792 现由 Docker 容器 `audiobook-hut-app-1` 常驻监听，`android-preview.mjs` 的临时前台服务会端口冲突。真机预览二选一——①直接走容器（手机经 Wi-Fi 访问 `http://192.168.31.42:8792/`）；②临时 `docker compose --env-file .env.local stop` 释放 8792 后再跑预览脚本（测完 `up -d` 恢复）。

**直接运行Node，不用pnpm包裹预览脚本**：此前pnpm转发Ctrl+C曾残留reverse；直接Node的停止与清理已验证。结束时Ctrl+C，核实端口、reverse及临时DevTools forward清理。没有授权常驻后台、登录/开机、自重启或私有无线HTTPS服务。

当前收尾：手机暂停；**8792 现由 Docker 容器 `audiobook-hut-app-1` 常驻监听**（`Up (healthy)`，不再"无监听"）；本轮临时前台服务已停、USB reverse 与 DevTools forward 已清理。源码与dist保留，未commit/push、未公网部署。清理证据见 `docs/qa/p51-sound-2026-10-17/cleanup.json`。此后**不要**用"8792 无监听"判为收尾干净，容器常驻是有意为之（已登记）。

## 三、注意事项与适用规则

- 中文交流，唯一开发者，不派子智能体；连续完成可自动完成的工作，不中途逐项请求产品验收。用户 2026-10-17 已指示恢复开发，按本文件「下一步任务」继续；不得擅自开始需用户参与的验收动作。
- 遵守项目AGENTS及用户全局规则。Android任务读取 `~/.agents/rules/android.md`、`~/.agents/rules/android-machine-profile.md`；涉及SQLite、Web QA、后台服务时才按需读取用户指定对应专项规则，不泛读其他中央规则。
- 使用 `~/.codex/skills/android-device-target-lock-local-zh/SKILL.md`；目标为用户确认的 **Redmi Note 11T Pro+**。每次ADB操作前共享脚本 `status`、`resolve`，随后显式 `adb -s`；不打印serial或AndroidID，不切换或操作另一台Note12Pro。目标不可用时只暂停依赖手机的操作，继续独立工作。
- 上午有声授权与听感确认已有证据，无需重复问同一授权；夜间禁止手机外放的原约束仍需遵守，不能把一次白天测试授权解释为今后夜间可任意外放。不擅调用户系统音量。
- 优先REUSE→ADAPT→REVIEW_FOR_REUSE→BUILD；保持既有技术栈、主题及成熟i18next资源架构，不另建治理体系或重做产品。
- 音频源只读、私有，不公开第三方音频、不提交媒体、索引、密钥或隐私数据。不可删除用户已有文件和原有未追踪治理材料。
- **未经明确要求不执行git commit/push**，不因“默认部署”条款越过用户更具体的Git限制。没有公网发布或常驻服务授权。
- 启动先查端口，不关闭其他项目服务；不得留下未经授权的后台进程。依赖先用有效本地缓存，必要时可信国内镜像并保留版本与完整性校验。
- UI只按真实可观察变化记通过：命令exit0不等于操作成功。注入/模拟、短时、桌面、真机和人工确认分别记录；不要用短时锁屏或注入截止替代长期/物理验证。
- 用户审阅Markdown用系统默认 `open`，不使用内置预览；网页默认系统已安装桌面浏览器。

## 四、恢复阅读与证据索引

- `docs/qa/P51-最终交付与HumanGate.md`：最终报告、能力与签收边界。
- `docs/qa/产品验收追踪矩阵.md`：逐条AC；**FR12c 已由 OPEN 转 PASS**（15 分钟锁屏后台睡眠定时实测），**FR12b 已由 OPEN 转 PASS**（局域网地址桌面图标已重建并验证，旧 localhost 图标已移除），FR13c 已有真机离线实测PASS，FR14b坏源 EXEMPT_USER，FR18b首次签收OPEN。
- `docs/qa/P51-BUGS.md`：P51-01至13修复与源/硬件/安装未闭环项。
- `docs/qa/P51-运行与安装说明.md`：启动、扫描、安装和离线方法。
- `docs/review/P51-自审工作记录.md`、`docs/handoff/P51-开发进度.md`：实施与自审记录。
- `docs/qa/p51-evidence/`：夜间扫描、静音浏览器、首访SW竞态、原真机UI及历史461项回归。
- `docs/qa/p51-sound-2026-10-17/测试记录.md`：上午有声续测完整过程；同目录 `regression.log`（最终464项）、`build.log`、`lint.log`、`session-restore-red/green.log`、通知栏截图、离线JSON、`final-runtime.json`与`cleanup.json`。

部分旧交付文档保留夜间“未触发手机播放”的历史记录；以本文件和其上午更新为当前事实，不能据旧段落重复宣布尚未测有声，也不能把旧461项当最新结果。
