# P51 BUGS 与操作证据

执行方式：唯一开发者自测，非独立 QA。日期：2026-10-17。AC 结论仅记录在 `产品验收追踪矩阵.md`。

| Bug ID | Priority | Stage P0 Blocking? | Repro | Status | Current Task | 备注 |
|---|---|---:|---|---|---|---|
| P51-01 | P1 | 否 | 睡眠截止后立即请求播放 | FIXED | T09 | sleep-guard-red/green.log |
| P51-02 | P1 | 否 | 待完成 play promise 时暂停 | FIXED | T07/T09 | pause-race-red/green.log |
| P51-03 | P1 | 否 | 解码失败后点重试 | FIXED | T07 | recovery-red/green.log |
| P51-04 | P1 | 否 | cache.put 期间取消下载 | FIXED | T12 | recovery-red/green.log；提交后撤销 |
| P51-05 | P1 | 否 | head 执行看门狗时 body root 尚不存在 | FIXED | T13 | bootstrap-red/green.log；实际执行复现 |
| P51-06 | P1 | 否 | 目录先 fetch，之后才安装 SW | FIXED | T12 | browser-first-install.json 全新来源 RED→GREEN；含停服务器复验 |
| P51-07 | P1 | 否 | Media Session 状态未同步 | FIXED | T11 | media-session-red/green.log；硬件另待验 |
| P51-08 | P2 | 否 | 刚听一部分但未完集，卡片没进度 | FIXED | T05/T10 | progress-level-red/green.log |
| P51-09 | P2 | 否 | 未来 L4 有内容仍不显示 | FIXED | T05 | progress-level-red/green.log；空 L5 隐藏 |
| P51-SOURCE-01 | P1 | 资产验收阻塞 | 〔已脱敏〕 12/13/16/17 源文件无法读取 | BLOCKED_SOURCE | T02/T14 | 扫描 4 份损坏；禁播，原文件保留；待可用副本 |
| P51-HW-01 | P1 | 最终用户验收待办 | 长期后台与全长计时 | PARTIAL | T11/T16 | 上午有声授权后，用户听音确认；通知栏、短时后台锁屏及离线已实测；**2026-10-17 锁屏后台 15 分钟睡眠定时实测 PASS**（约 13.8 分钟平滑推进、到期 +225 ms 准时暂停，见 `p51-sound-2026-10-17/sleep-15min.json`）；用户 2026-10-17 决定**耳机线控不做（范围豁免）**；30/60 分钟全长未测 |
| P51-INSTALL-01 | P2 | 环境阻塞（非应用缺陷） | 接受 Chrome 安装确认后从桌面启动 | BLOCKED_ENV | T11/T16 | 2026-10-17 复测定位根因：WebAPK 铸造 60 秒超时，无包/无快捷方式/桌面无入口；Google 铸造服务在本机网络不可达，见下方诊断。**2026-10-17 新增**：服务已 Docker 常驻且局域网可达（`http://192.168.31.42:8792`），**2026-10-17 用户授权后已完成**桌面图标改用局域网地址重建：新图标名「妹妹的听书小屋」指向 `http://192.168.31.42:8792/`（桌面第二页），强停浏览器后点击仍能新开并正常加载小屋首页；指向 localhost 的旧图标已长按移除（`dumpsys shortcut` 现仅剩 id=妹妹的听书小屋） |

## 真机会话能力预检（适用通道自测）

- Runtime：本窗口 Codex 本地执行，`functions.exec → exec_command → adb -s 已解析目标`；Android Chrome DOM 检查使用临时 USB DevTools forward，结束即移除。
- 目标：每次 ADB 命令前运行共享锁定脚本 status / resolve，只操作本会话用户确认的 Redmi Note 11T Pro+（USB）；未操作 Note 12 Pro。
- 模型精确 ID：当前运行时未暴露可核实值，未编造。原生 CUA 工具虽存在，本次未使用；Orca 主机 Accessibility/Orca 状态为不适用，未伪造探测。
- 设备在线、Android Chrome 可用、真实截图 1080×2460；localhost 安全上下文、SW 控制、392px 宽、无横向溢出、audio paused=true，见 `android-runtime.json`。
- 读屏：实际出现品牌、全部课程、L1/L2/L3、10 门课程；XML 与截图一致。
- 点击：L3→L1，实际列表变为〔已脱敏〕、〔已脱敏〕等 L1 课程，见 `android-canary-level.xml`。
- 输入：ADB 原生键注入大写连字符受本机 IME 影响，未据此判通过；改用同设备 Chrome 的 Input.insertText，实际可见输入 `QA-CUA-CANARY`，见 `android-input-runtime.json`（visible=visible）及 `android-canary-input.png/xml`。随后通过清除按钮恢复，见 `android-canary-restored.png`。
- 滚动：ADB swipe 本次未观察到像素变化，因此该手势路径为 NOT_VERIFIED；没有将调用成功写作成功。改用实际 PAGE_DOWN 后内容位置发生变化，见 `android-scroll-key.xml`、`android-scroll-confirmed.png`，再 PAGE_UP 恢复。真实手指滑动留最终用户检查。
- 无声流程：从首页进入真实 155 集课程详情，再返回列表，见 `android-detail.png/xml`、`android-canary-return.xml`。
- 能力预检：PASS（已验证的读取、截图、点击、Chrome 文本输入、键盘页面滚动、界面状态判断、无声浏览流程）；只允许进入这些已验证操作的正式用例，不扩张成未验证手势或有声能力。

## 浏览器真实操作证据

BrowserOS neo MCP，390px 与 320px 视口；不触碰用户主 Chrome。每次实际播放前设置音频元素 muted/defaultMuted=true，未操作系统音量。

- 点击真实分集→全屏→暂停→倍速 1.5→单集循环→本集结束→下载完成；媒体真实时长 512.084256 秒，单音频节点、静音为 true，见 `browser-e2e.json`。
- 真实下载 10 集课程 51,280,023 字节，再整课删除；完成状态 10/10→0/10，已有历史条目保留。
- 停止自己创建的服务后重新导航：已下载资源返回 206、精确 Range 与字节数；未下载资源 503 + “这集尚未下载，请联网后重试”。网络模拟结果单列，不替代停服务的实测。
- 全新来源 28951 延迟注册时复现目录未缓存；修复后全新来源 28952 首次安装即缓存 30 门，并在服务停止后打开真实 10 集详情。
- SYSTEM 浅深变化、英文深色 320px、回到中文并重启，音频状态仍暂停且恢复同一分集；见 JSON 与截图。
- 8793 曾有其他项目 worker/cache，实验结果不采用；未清除其缓存。可靠的首访证据来自全新 28951/28952，常规离线 8792 由 P51 自身命名缓存与 worker 实证。

## 音频完整性证据

- ffprobe 检查全部 1,905 份时长；ffmpeg `-t 2 -f null -` 验证每份可解码关键帧，不打开声音设备；SHA-256 对所有原文件计算。
- 1,901 份有效、4 份损坏、38 组相同内容副本；缺失课程 0、未匹配文件 0。
- 重扫公开课程与资源映射逐字保持一致（`rescan-consistency.json`）。关键帧检测与哈希不等同于逐秒完整听音；没有冒充全长有声验收。

## 上午有声测试新增修复

| Bug ID | Priority | Repro | Status | 验证 |
|---|---|---|---|---|
| P51-10 | P1 | 1.5×切集后 Chrome load 将实际速度重置为1，UI仍1.5 | FIXED | defaultPlaybackRate+load/metadata重施；单测RED→GREEN、真机跨集actual/default/UI=1.5 |
| P51-11 | P2 | 跨集后系统媒体时长/位置残留前一集 | FIXED | metadata/timeupdate/pause同步；单测RED→GREEN、真机positionState与实际时长一致 |

证据位于 `p51-sound-2026-10-17/`。桌面安装与创建快捷方式请求均执行，系统仍无P51快捷方式引用、未观察到入口，保持OPEN，不通过修改系统权限制造通过结果。

| P51-12 | P1 | 刷新恢复后通知栏丢失曲名与上下集actions | FIXED | 恢复setCourses时重绑；单测RED→GREEN；真机通知栏上一集/seek复验 |
| P51-13 | P2 | 旧视频metadata写入比例后被被动effect清除，回归偶发失败 | FIXED | 布局阶段重置；保留首轮失败、独立和全量验证日志 |

## 桌面入口根因诊断（2026-10-17 复测，P51-INSTALL-01）

目标机：用户本次确认的 Redmi Note 11T Pro+（USB，设备锁已按用户指定重新固定到该机型）；Chrome 153.0.8010.52。来源：`http://localhost:8792/`。

实测步骤与观察：

1. 打开 `localhost:8792/settings`，uiautomator 读到安装按钮"安装小屋"**存在** → 说明 Chrome 已触发 `beforeinstallprompt`，该来源满足安装条件，非 manifest/SW/安全上下文问题。
2. 点击安装按钮 → Chrome 原生安装框正常出现（"安装应用 / 妹妹的听书小屋 / http://localhost:8792"）；点"安装"。
3. Chrome 随即发出 WebAPK 安装通知：tag `webapk_install_notification_tag_prefix.http://localhost:8792/`、文本"正在安装"听书小屋"…"、`android.progress=0`。
4. 通知于 **10:34:55 出现、10:35:55（整 60 秒）被系统移除**，即铸造请求超时结束。
5. 结果核对：`pm list packages` 无任何 `org.chromium.webapk.*`；`dumpsys shortcut` 中 `com.android.chrome` 仍只有 `new-tab` / `dynamic-new-incognito-tab` 两条，**无 P51 快捷方式**；按 HOME 后桌面 uiautomator dump 无"听书小屋"节点。
6. 旁证：手机 `ping webapk-server.googleapis.com` 与 `www.google.com` 均 **100% packet loss**（DNS 可解析，ICMP 被拦）。

结论：Chrome 153 对"可安装 PWA"只走 **WebAPK 铸造**路径（旧版面向可安装站点的"桌面快捷方式"回退已移除），而铸造依赖 Google 的 WebAPK 服务；该服务在本机网络下不可达 → 铸造超时 → **系统不会生成任何桌面入口**。此现象为**运行环境阻塞，不是应用侧缺陷，也不是权限问题**，在现有 PWA 安装路径内无法修复。

处置选项（需用户拍板，未擅改）：①接受无桌面图标的现状（从 Chrome 书签/最近标签进入）；②改走打包安装包（TWA/Bubblewrap 或 Capacitor）获得原生启动图标——属产品/架构变更，须按 Change C 重新评估后再实施。

本次复测后已清理：预览服务停止、8792 无监听、USB reverse 与 DevTools forward 均移除；未修改系统权限或音量；未与手机交互播放音频。

## 2026-10-17 低龄可读性整改（字体 / 栏目 / 图标）

用户反馈「界面字体太小 妹妹看的费劲 他们还小 不能那么费眼」，并要求左侧 4 字分类改双行以腾出内容区宽度、文字改为居中。处置顺序：先出 before/after 原型供用户确认，确认后再同步部署副本、重建镜像重启容器，并在锁定真机复验。

| Bug ID | Priority | Repro | Status | 验证 |
|---|---|---|---|---|
| P51-14 | P1 | 界面基准字号 16px，低龄用户阅读费眼 | FIXED | `.cabin` 16px→19px，`font-size ≤22px` 的文本统一 ×1.25（下限 14px，图标字号不动）；首页/课程/播放/设置四页原型前后逐页核对无溢出，触控区仍 ≥44px |
| P51-15 | P1 | 左侧学科栏目占宽过大且文字左对齐，内容区被挤压 | FIXED | 栏目 112px→78px（内容宽 48px＝每行正好 2 个汉字，4 字分类自动折双行，按键高 74px），`text-align:center` 居中；右侧净多 34px，课程标题由 3 行回落 2 行 |
| P51-16 | P2 | 桌面快捷方式显示小米浏览器默认「网页」图标，非站点小熊图标 | FIXED | 新 favicon（小熊 `icon-192.png`，`rel=icon`＋manifest 双声明）上线后由用户经小米浏览器「添加到桌面」重加，桌面图标变为小熊图案；用户确认「没问题了，我已经添加到桌面上了」 |

**真机复验**：`docker compose --env-file .env.local up -d --build` 重建镜像后容器 `audiobook-hut-app-1` 为 `Up (healthy)`，`/`=200、`/api/courses`=200、`/icon-512.png`=150682 字节；Redmi Note 11T Pro+ 打开 `http://192.168.31.42:8792/` 可见栏目 78px、4 字双行居中、字号变大后的新 UI。

证据：`docs/qa/p51-evidence/ui-font-2026-10-17/`（`before_*`／`after_*` 十张原型、`prev78_rail.png` 与 `new_rail.png` 栏目对比、`android-desktop-icon-bear.png` 桌面小熊图标实拍）。
