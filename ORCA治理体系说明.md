# ORCA V2.1 治理体系说明（对外版，2026-10-14）

> 一页纸讲清：这套体系是什么、怎么运转、模型怎么分工、规范都在哪。
> 本文件是概览，不能替代真相源做合规审计（完整 Gate、精确派工、验证证据以 AGENTS.md、分工表、HANDOFF 为准）。版本真相以 Git 历史为准。

## 一、体系是什么

ORCA V2.1 是一套多智能体编程治理体系：固定 **9 常驻＋1 升级＋1 专项（9+1+1）**，不新增角色。
核心规矩：task-manager 是唯一对人说话的编排者；supervisor 只对编排者说话、独立复检
（编排者失联时替喊人一次）；
Human Gate 必须用户亲口放行；模型怎么切，用户说了算，任何智能体不得自作主张。
完成的判断来自用户看得见的部分有没有被逐条验过，不靠测试数量多、构建过、代码审查过。

## 二、两种执行方式（2026-10-10 用户定）

**怎么切换：一句话**——用户只需说 **`你是唯一开发者`**，不必复制任何长提示词；智能体自行读取规则并按项目当前阶段自行选用适用规范，用户不逐项指定。这一句**只决定执行方式**，不代表可以跳过产品方案确认、必要的 Human Gate 或授权要求。

**默认多智能体**，角色分工、独立审查、Supervisor 复检与编排者派工全部照旧。**用户明确指定单智能体时直接采用，不再询问**，也不会因为客户端支持子智能体就自动派工；**用户没有要求切换时，不得擅自改变既定执行方式**。

单智能体＝同一个智能体依次做产品设计、开发、代码自审、QA 与交付。角色卡里「禁止兼任／独立 Session／独立派工」**只约束多智能体**；单智能体可按阶段引用这些角色的质量标准，但结论**必须如实标注「自审」还是「独立审查」，不得伪造独立审查**。

**执行方式与治理强度分开判断**：减的是管理成本（不造派工记录、不逐个模拟角色、普通局部修改不重走完整规划、计划批准后可连续开发→自审→测试→修复），**不是质量成本**——产品简化、APP 基础能力（主题／中英双语／品牌资产／导航／信息分层）、安全、隐私、异常恢复、数据正确性、真机验收、首次发布用户签收、产品验收追踪矩阵**一条不减**；QA 必须真实运行应用并操作关键功能，没有实际验证不得直接标 `PASS`。

按阶段该读哪些规范见根 `README.md`「单智能体开发使用说明」。**触发口令「你是唯一开发者」写在 `AGENTS.md` 两种执行方式节首条**，规则与角色卡一致，用户不需另找入口。**两种方式共用同一套规范与模板包，体系内不存在单智能体专属 SOP／角色／Gate／模板包。**

## 三、运转流程

```text
用户说「第一阶段，计划」
  → Phase1（PLAN）：builder（deepseek-flash）拟稿 → product-reviewer 审 → planner（Sol）把关打分＋列缺项 → 打回 builder 改稿（planner 不执笔，省 Sol 额度）
  → Readiness ≥90 且 P0=0 且 blocking P1=0 且关键事实已验证且核心假设已合理验证且视觉与交互验收标准非空且逐条可测 → WAITING_HUMAN_APPROVAL（停下找人一次）
用户说「第二阶段，开发」
  → Phase2（DEVELOP，锁定计划基线）
  → Builder 写 → Code-Reviewer 复核 → QA 测 → Supervisor 复检 → 编排者收齐找人
  → 修/回归循环 → 完工
用户说「变更请求：……」
  → A小改留开发 / B局部改留开发 / C产品架构改走受控重开＋Human Approval
```

升级规则：同一 Task 被 supervisor 打回 2 次，当次升 senior-expert；senior 再被打回 2 次停线找人。

Phase2 完工口径（不改主链、不新增 Gate）：完成＝角色交付＋`docs/qa/` 产品验收追踪矩阵关键 AC 全有证据；产品验收走已冻结的 Web QA 通道。
- 验收标准写在计划里：计划阶段就要给每条用户可见要求编一条可观察、可测的验收条目（AC），并标出哪些是"关键的"（关键 AC 集合不得为空）。
- 证据落在哪：验收结果逐条记进 `docs/qa/` 的产品验收追踪矩阵（对象、步骤、预期、实际、状态、证据位置）。
- 什么情况不许放行：关键项没测、核心路径上的控件没真点过并观察到变化、证据缺失——三者任一即不得判通过。
- 用户签收：发布类型为**首次发布**的，用户签收通过才算完成（签收前状态记未完成）；迭代更新与局部修复不强制签收。这是用户参与的那一步，不是新加的关卡。

全程账本：每次派工记 `docs/model/DISPATCH-LOG.jsonl`、每任务记 `TASK-MODEL-LOG.jsonl`（`model` 用 `provider/model` 精确写法；含可选 `executed_by`=实际执行者、`chain_status`=角色交付/已验收/未完）；校验 `scripts/model/check-ledger.mjs`（结构错=FAIL、写法不规范=WARN）。老项目迁移后须过**登记检查**（该脚本得 `LEDGER-OK`）才算迁移完成——迁移即登记。产品验收结论落 `docs/qa/产品验收追踪矩阵.md`（模板 `docs/qa/产品验收追踪矩阵.template.md`），`check-sync.sh` 巡检缺失并报 `AC-MATRIX-MISSING`。　**APP 基线硬门**（2026-10-08）：`APP-BASELINE-MISSING`（缺声明）/`APP-CRITICAL-AC-EMPTY`（关键 AC 集合空）/`APP-CRITICAL-AC-INCOMPLETE`（六类未全进关键 AC）一律 **FAIL**，非 WARN；母版/分发包自检用 `--allow-example`（真实项目禁用）。

体系不绑定 Orca 或任何特定客户端，也不按客户端分裂模板包：**每轮开工跑 `scripts/detect-client.sh` 自动认当前客户端并选派工口**：有原生子代理判 `mode=window_subagent`，在该客户端窗口内直派（享真 resume／并行／worktree 隔离）；没有或认不出判 `mode=channel_cli`，走通道 CLI 直调（认不出时只在汇报带一句，不找用户填）。**一份模板包通用于任何客户端**；多阶段需人点头／要产品验收留痕／跨周或会交接／要发布留回执／多角色并行——这套「何时起体系」的判据是：命中任一才算大项目、按包内 README 铺包开工，都不命中就是小活直接干、不铺包不起 Gate（半套最差，按红线打回）。

编排者怎么汇报（2026-10-03 定，写在 AGENTS.md「汇报与自决」节）：只报三件事——目标完成没、用户安排的工作完成没、大影响（上线/回滚、线上故障、数据或备份丢失、生产或他项目改动、要用户本人操作的授权、不可逆删除）。其余小事**自决自做、不问不报**：残留清理、备份与旧文件（不影响继续开发就删，影响的留到大阶段开发完再删）、调试密钥文件（不入库、自动 gitignore）、既有 lint/测试 warning。只有 secrets、删用户数据、生产·数据库·他项目、commit/push 授权四类红线才找用户，且一次问全；单次汇报 ≤10 行，禁把 pending/遗留全量倾倒。啰嗦按违规打回。

## 四、Jev 决策侧车怎么接入

Jev 不是第 12 个角色，不进主链，是编排者旁边的机器判定器：

```text
用户 ──→ Task Manager / 编排者 ──→ Builder → Reviewer → QA → Supervisor → TM
                    │
                    │ 仅规则无唯一答案的分叉点
                    ↓
              orca-decide（scripts/decision/）
                    ↓
              Jev（TypeSafe直调，4类有限判断）
```

- 只判七类：CHANGE_CLASS（A/B/C）、ISSUE_OWNER（6角色）、USER_REQUIRED（5枚举）、P0_HARD（bool＋风险）
  ＋ Shadow 三类（TASK_PROFILE／BUILDER_CLASS／SKILL_ROUTE，阈值 null，只记录不派工）。
- 只做建议（advisory），规则冲突听规则，失败回原逻辑；Human Gate/删除/不可逆/付费/换模型永不自动批。
- 现态（2026-09-23）：TypeSafe 直调（jev-1.13.0），旧四 Contract 回归 10/10，新 Shadow 6/6，
  注入/故障矩阵全过；运行模式 ADVISORY（自动路由禁，Sol 终审通过）。
- 确定性短路：supervisor 打回≥2 次、Human Gate 明确、不可逆删除，一律不问 Jev 直接走规则。
- 发送前门禁：可信 data_class 由调用方给（任务 JSON 自带忽略），SECRET/未知等级拒发；密钥正则 16 类。
- 不每个 Task 都调；supervisor 打回计数、watchdog 等确定性逻辑不经 Jev。
- 决策流水（2026-09-26）：每次调用 best-effort 落项目内 `docs/model/JEV-DECISION-LOG.jsonl`（只非敏感元数据 mode/decision/confidence/model/policy_version/input_digest/latency；**不记 state 原文/Key；不改 Jev 权限与 Contract**）。

## 五、Web QA 通道怎么运转

```text
QA Agent ──调用──→ MCP ──驱动──→ BrowserOS neo（独立后台浏览器）──→ Web/localhost
（调用方向；数据回流反向。桥接：Orca → OpenCode CLI → BrowserOS MCP，Orca 无原生 MCP 面）
Android真机：规范已入（每 session 先过能力预检 PASS 才进正式，本窗口 bash 直驱 adb/Expo，Maestro 备用、scrcpy 只看屏）；
2026-09-21/23 双在线实测通。
```

铁律：后台静默，不弹前台抢焦点；不用系统鼠标键盘；不碰用户主 Chrome；
Google 登录等 Agent 不碰密码/MFA，登录异常交人工处理（认证可能失效，需复登不算异常）；MCP 端口重启会变，每次重读配置。

网页／本地页面的**产品验收就走这条已冻结通道**，不另起浏览器基础设施；视觉验收要覆盖关键用户任务逐条走通、桌面与窄屏、边界样本（奇偶条目数、长标题、空状态）下的对齐／换行／裁切／溢出／可读性，并留真实浏览器截图。

codex 派工带 `-s danger-full-access` 关闭沙箱（历史“沙箱禁端口/EPERM”经查为假失败）；**2026-10-07 用户令由「仅限 QA」放宽到 QA＋planner＋senior-expert**：QA 解端口/网络限制，planner 解「默认沙箱写不了文件致汇总落不了盘」，senior-expert 升级任务需写业务仓库。**只解沙箱、不解职责边界**（planner 在 Phase1 仍禁改业务代码与改 Plan）；须在账本 note 记账。

- 派工通道纪律：派工前必跑 `bash scripts/check-channel-preflight.sh`，须 `CHANNEL-OK`（报 `CHANNEL-STALE` 该角色禁派）；表定通道角色走通道直调，禁套娃；禁自动升级客户端。

## 六、模型与分工（11 行，以根 `USER_MODEL_OVERRIDE.md` 表为准）

模型／通道／调用方式**一律以根 `USER_MODEL_OVERRIDE.md` 表为准**（该表即唯一口径，改表必真调）；本说明**不复述模型 ID**，避免与表漂移。角色清单见 `docs/roles/` 11 张卡；task-manager 行模型开窗口时定。

## 七、Task Manager Qualification｜Task Manager 资格测试（增量，2026-09-26）

把 TM（编排者）正式纳入模型资格测试；**不新增第 12 角色**，不重做两阶段治理。
- **Phase1 拟稿分工（2026-10-08 用户定）**：**plan 正文由 builder（`codebuddy/deepseek-v4.1-flash`）拟制与修改，planner（`codex/gpt-6.1-sol`）改为把关者/审查者**——对照 Readiness 清单逐项核、给分、一次列全缺项，**不合格打回 builder 改稿，planner 不亲手写**。目的是把反复重写 plan 的 Sol 调用降下来（省额度）。builder 在 Phase1 **仅开 plan 正文一个口子**，禁碰业务代码；禁自行提分或改 `PLAN_GATE`。
- 最小评价单位＝**Orchestration Episode**（TM 接有效状态→判下一步→派对 Worker→收结果→推进到下一合法态；聊天轮数不计）。
- 监督：supervisor 兼 **Task Manager Observer**（只标记异常、按现有机制提醒/唤醒/替喊一次；不评分/不接管/不改表/不跨 Gate）；评分汇总由 **Governance Steward**（治理管理层，非 9+1+1 角色，周期审计）做，只出主备**建议**；**主备由用户最终决定**，Steward 不自动改表。
- 五维评分 100：派工/下一步 30＋持续推进 25＋治理遵守 20＋响应 15＋资源 10；响应阈值据 watchdog（`CONSUME_STALE_SEC=300`/`COOLDOWN_SEC=900`）分 NORMAL/SLOW/STALL；`infra_error` 不计入能力分。
- Gate：`Score≥90 且 P0 治理违规=0 且 Human Gate 违规=0 → QUALIFIED`；**采样门槛**（有效 Episode <30 或项目 <3 保持 CANDIDATE，不得凭少量样本判通过）。
- **产品审查链（2026-10-07 用户定）**：口令「第三阶段产品审查」触发（**「第三阶段」仅为口令字面，不代表新增 Phase**），位置在 Phase1 末尾、Develop Approval Gate 之前，**不新增角色/Phase/Gate**。planner（`codex/gpt-6.1-sol`）任组织者并冻结 Plan 版本→**串行**派两份互不可见的独立审查（实测 codebuddy 双实例并发会互相干扰、且失败是静默 exit 0，故必须串行＋校验产出文件非空；planner 已带 `-s danger-full-access` 可直接写盘（解禁失效时才退回 stdout））（`product-reviewer` × `codebuddy/glm-5.3-flash` 与 `codebuddy/deepseek-v4-pro`，只读）→交回 planner 参考/比较/汇总/裁决→产出 `docs/review/PRODUCT_REVIEW_<plan版本>_<日期>.md`（一致项／分歧＋裁决／仅A／仅B／体验改进／交互顺序／功能候选／**明确不采纳项**）→用户 Human Gate → 说「第二阶段，开发」才进 DEVELOP。审查维度限**用户使用体验／交互逻辑与流程顺序／新增或优化功能**，非代码层面；代码类意见判 `WRONG_ROUTE`。
- **APP 基础能力前置（2026-10-08 用户定）**：面向用户的 APP **自动继承**主题三态（`LIGHT`/`DARK`/`SYSTEM`，默认 SYSTEM）＋初始中英双语（默认跟随系统，不支持语言回退 `zh-CN`）＋设置持久化＋切换不丢状态；单一真源 `docs/sop/app-theme-i18n.md`。用户不提也会在 Product Plan／三方向／原型／SDD／QA 全链覆盖；**只有用户对某项目明确提特殊要求才允许在 Plan 记覆盖**，Planner/Builder 不得自行取消。沉浸式页面禁擅自强制另一态；可扩展架构（加 ru/ko/th 只增资源不重写核心）是硬性 AC；优先复用官方成熟主题与 i18n 组件。**`-s danger-full-access` 解禁口径以 `AGENTS.md` 为准**（2026-10-07 用户令已放宽到 QA＋planner＋senior-expert，模型表行内旧「仅限 QA」表述以此为准）。**Episode 记账三条**（AGENTS「Task Manager Qualification」节）：①编排者每轮收工必自记一行，构成 Episode 才记，**非 Episode 不记、禁凑数硬记**；②写后必跑 `tm-qualification.mjs` 校验，**不得改写历史行**；③**母版与两包账本只留 `_example` 空壳**，真实 Episode 落各项目自己账本。**APP 主题/多语言与品牌资产的机器门差异**：两者的**阶段级拦截都依赖七颗 Design Pipeline Skill**（不随本模板包分发）；只用本模板包时机器强制点仅 `PRODUCT_PLAN` 声明字段＋`check-ledger` 的 APP/品牌各码，装了七颗 Skill 才额外有各阶段 `BLOCKED`。**APP 品牌资产同样前置必选**（单一真源 `docs/sop/app-brand-assets.md`）：中文名／英文名／安卓图标／启动画面——Product Plan 写方向 → A/B/C 每方向附四类候选 → 原型须体现启动页与命名/图标候选 → **Human 2/Design Freeze 前拍板最终四项**；**未拍板开发阶段不得自行决定**（`check-ledger` 报 `APP-BRAND-ASSETS-MISSING`，Freeze 无 BRAND Freeze 即不成立）。**不新增 Skill/角色/状态/Human Gate**，强制点落在既有 Gate。
- 证据（**不改现有账本 schema**）：事件日志 `docs/model/TASK-MANAGER-QUALIFICATION-EVENTS.jsonl`；评分 `scripts/model/tm-qualification.mjs`；测试 `scripts/model/tm-qualification.test.mjs`；规范 `docs/model/TASK-MANAGER-QUALIFICATION.md`。
- **Episode 记账（2026-10-07 定）**：编排者**每轮收工必自记一行**，一 Episode 一行；非 Episode 的轮次不记也不硬凑。写后必跑 `scripts/model/tm-qualification.mjs` 校验；无计时证据的 `decision_latency_ms` 填 `null` 不许编；历史行不得改写。**母版与两包的 `docs/model/*.jsonl` 永远只留 `_example` 空壳**（母版是分发源，写真实行会致 check-sync `SYNC-FAIL`），真实 Episode 记到各项目自己的账本。**supervisor 抽查对账**（拿 DISPATCH-LOG 真实派工逐条核是否漏记，漏记/对不上打回，补记由编排者执行）。Episode 层证据不替代 DISPATCH-LOG/TASK-MODEL-LOG 派工账。
- 候选（真调已过）：`opencode-go/deepseek-v4.1-flash`、`opencode-go/mimo-v2.6-flash`（Runtime=opencode）；真实多项目 A/B 数据由用户后续在真实项目跑。

## 七之二、账本与证据的现役机制（2026-10-14 体系自查后补齐）

概览此前滞后于本轮改造，以下为**现役口径**（细节见 `docs/model/TASK-MANAGER-QUALIFICATION.md` 与 `AGENTS.md`）：

| 机制 | 一句话 |
|---|---|
| **取消历史豁免** | 「以前的不管，以后的为准」——所有字段错误一律 FAIL，旧写法也判错，需当场改对 |
| **升级触发机器校验** | 同一 Task 被 supervisor 打回 ≥2 次，中央校验器**当场拦下**漏记升级（原为纸面规则，从未真跑通过） |
| **派工逐派不漏记** | 有真实任务记录却零派工记录 ⇒ FAIL；单智能体项目须在 `docs/model/GOVERNANCE-STATE.json` 显式写 `execution_mode: "solo"` 才豁免（不靠猜） |
| **Episode 防重复计分** | `episode_id` 全文件唯一（重复即 exit 1）；更正另起新行并带 `supersedes` 指向被更正行，被指到的原行**保留但不参与计分** |
| **有效拦截不扣分** | reviewer/QA 抓出真问题并打回修复＝治理链生效，**计样本但不扣分**，与基础设施错误同属非能力项 |
| **违规分级 P0/P1/P2** | P0 直接 NOT_QUALIFIED；P1 扣分不清零；P2 只影响推进分。`gate_violation` 须为布尔（此前字符串 `"true"` 可静默绕过硬失败） |
| **未测不按满分算** | 无数据即未测，总分按已测权重归一；**有未测维度一律 CANDIDATE**，不得判 QUALIFIED |
| **响应速度只认时间戳** | 由 `started_at`→`ended_at` 机械相减；手填的 `decision_latency_ms` **不采信** |
| **原始输入留存** | `--evidence <dir>` 显式开关（失败也留），证据卡可进 git（路径已归一、零本机路径），原始副本**禁入仓**；另有 pre-commit 卡点拦截误提交 |
| **opencode 通道跨目录** | 派 opencode 通道角色**必须带 `--auto`**，否则 `external_directory` 被拒且**静默失败** |

## 八、规范在哪

| 变更说明 | `CHANGELOG.md` | **变更说明正典**——每次改动并 push 必在顶部追加一条（改了什么／为什么改／影响谁／怎么验）；只写 commit message 或 HANDOFF 章节不算交差；随 `PAIRS` 分发到两包，`check-sync.sh` 纳管漂移 |

| 规范 | 位置 | 说明 |
|---|---|---|
| 总纲 | `AGENTS.md` | 两阶段、派工顺序、升级、账本、红线（全员遵守一页） |
| 产品验收 | `docs/qa/BUGS.template.md`（产品验收追踪矩阵节）＋`docs/roles/qa.md`（第八查/不可放行情形/视觉验收最小覆盖）＋`docs/pm/PRODUCT_PLAN.template.md`（验收标准与关键 AC 集合） | 用户可见要求的验收标准写在计划，证据落矩阵，QA 与 Supervisor 同源判放行 |
| 模型分工真相源 | `USER_MODEL_OVERRIDE.md` | 11 行精确ID；改表必真调；现势以本表内容为准（历史快照在 `temp/`，回退由用户口头指定编号、按改表规则执行） |
| 角色卡×11 | `docs/roles/` | 每角色职责＋写入位置；适用角色附输出模板 |
| 开工提示词 | `编排者提示词.md` | 一句话开工全文 |
| 基础设施规范 | `docs/sop/` | docker/supabase/sqlite/android（＋android-machine-profile）/webqa/decision-router/**app-theme-i18n（APP 主题三态＋中英双语基线）**/**app-brand-assets（APP 品牌资产：中文名／英文名／图标／启动画面）**/background-services（去版本号引用） |
| 中央规则（散兵读） | `~/.agents/rules/`＋`~/.agents/AGENTS.md` | docker 等为软链指本仓库 sop；散兵按任务按需读 |
| 账本 | `docs/model/TASK-MODEL-LOG.jsonl`、`DISPATCH-LOG.jsonl` | 换模型决策的重要依据（先读账本，最终用户定）；`model` 精确写法，含可选 `executed_by`/`chain_status`；校验 `scripts/model/check-ledger.mjs`（FAIL 拦、WARN 供抽查） |
| TM 资格 | `docs/model/TASK-MANAGER-QUALIFICATION.md`＋`TASK-MANAGER-QUALIFICATION-EVENTS.jsonl`；评分 `scripts/model/tm-qualification.mjs` | Episode/五维评分/Gate＋采样门槛；证据不改账本；主备由用户批准 |
| Jev 决策流水 | `docs/model/JEV-DECISION-LOG.jsonl` | 每次 orca-decide 调用一行（非敏感元数据；不记原文/Key） |
| 交接 | `docs/handoff/HANDOFF.md` | 状态源（新节顺延，现至 §71；旧号冻结不重排；新节自 §72 起顺延，勿撞旧号） |
| 迁移入口 | `迁移整理提示词.md`（老包根同名） | 自举取包＋冲突处理＋5.7 登记检查（迁移即登记，`LEDGER-OK` 才算完成） |
| 新项目脚手架 | `新项目模板包/`（目录**空**→整包拷 `cp -R "<母版>/新项目模板包/." <项目根>/`，快且不漏文件；目录**非空**→只覆盖规则层＋补新增，实例层不碰，因整包拷会把计划/BUGS/HANDOFF/账本真实行静默顶成空模板且不报错；规则文件不挑行合并） | 老项目用 `老项目迁移模板包/`＋【迁移整理】提示词（同规则＋冲突改名铁律），不要用新项目这套 |
| Phase1 可运行原型 | AGENTS.md「Phase1 必须交付可运行交互原型」＋`PRODUCT_PLAN.template.md` Gate 的「原型交付完整性检查条件」 | 有用户界面的 APP，Phase1 默认须交付 `docs/design/prototype/` 下本地可运行原型（核心页面完整／关键交互可操作／品牌与真实素材落实／浅深色与语言及异常状态可演示／给出路径与打开命令）；PDF、截图、纯文档、在线概念图、单张示例预览 HTML 都不算。**文件存在与真实运行分开判定**，五项须全过才进 WAITING，缺则判现有 Gate 不满足；`check-ledger` 报 `PROTO-MISSING`／`PROTO-NO-RUNTIME-EVIDENCE` |
| Skill 的 SOP 依赖判定 | `docs/sop/app-simplicity.md` §11 ＋各 Skill 依赖声明 | **仅当当前任务确实需要该 SOP 时才触发读取**：项目副本缺失但母版可读 → **回退母版，不判缺失**；项目副本与母版内容不一致 → `DEPENDENCY-STALE`，按单一真源与版本冻结处理，**不静默用旧规则**；仅项目副本可用 → 允许读取但**标明无法核对母版**；**两处都不可读且本任务需要该 SOP** → `DEPENDENCY-MISSING`，**阻断相应审查、不得判 PASS**；**本任务不需要的 SOP 一律不检查、不阻断**。SOP 全文只存母版，项目副本不构成第二真源 |
| APP 产品简化门槛 | `docs/sop/app-simplicity.md` | **投入开发前先确认「不需要那么多」**：核心任务一眼可见／**同一状态下**无无意义重复入口／高频操作不被低频功能干扰／不为覆盖率堆页面控件／按钮文案与实际跳转一致。**Reviewer 必须主动找可简化处，但允许有依据判定「无须删减」，不得强制制造删减项**；**QA 必须验真实操作，不得只验收代码与 AC 数量**。**安全、隐私、异常恢复与数据正确性不因简化而丢失**；**按钮数／页面数／状态数／代码行数只作调查线索，不作判据**。挂既有 Readiness／Design Freeze／DEV_BASELINE／QA，**不新增 Gate／角色／阶段／账本字段／评分指标** |
| APP 界面信息分层 | `docs/sop/app-ui-layers.md` | **内部信息不上屏**：L1 默认可见＝任务/结果/原因/下一步＋必要安全法律；L2 用户主动展开＝详细玩法/来源（来源用可读名称、**不用内部 ID**）；L3 仅内部＝Phase/Gate/AC-FR/审查评分/置信等级/数据 ID/动作代码/开发版本与 hash/运营授权记录。严禁把 Plan/UX/Research/QA/合规审查原文直接上屏，须文案转换。安全/医疗/版权必要告知**不得因精简而隐藏**。扫描器 `scripts/model/ui-leak.mjs` **只提示、人工语义核验**，**不机械禁用**含「版本/来源/风险」的正当内容。挂既有 Plan/UX/Prototype/Freeze/Review-QA，**不新增 Gate** |
| APP 导航与视觉方向 | `docs/sop/app-navigation.md` | 三方向须在**同一核心页面**并置对比且逐轴不同（**只换配色不算方向**）；`LIGHT`/`DARK` 是主题适配非独立方向；批准后直接进 Freeze 不重复询问；**底部导航由产品决策**（不是所有 APP 都要 Tab），入口/图标/四态/排版/Token/显隐/适配由产品侧在 UX Contract 确定并在 COMPONENT Freeze 绑定；Android 优先 M3 `NavigationBar`/`Scaffold(bottomBar)`，**底栏固定不随内容滚动**；正式 Android QA 禁仅凭网页原型判定 |
| 公开仓不带 ORCA | `scripts/orca-gitignore.sh`＋`scripts/orca-public-ignore.txt`（忽略清单单一真源）＋`scripts/restore-framework.sh` | 仅作品对外公开时启用一次：注入托管忽略块＋摘除已提交 ORCA 脚手架，**此后推送零操作**；只隐藏通用脚手架，本项目计划/评审/交接/账本保留作云备份，应用 README 不受影响；clone 回来用 restore 补框架（不覆盖任何自有文件）。私有仓跳过 |

## 九、给审查者的检查点

1. 进 WAITING 条件全满足：Readiness≥90、P0=0、blocking P1=0、关键事实已验证、核心假设已合理验证；Human Gate 是否被绕过。
2. 派工实绩是否与分工表一致（supervisor 抽查三处对账）。
3. Jev 是否只出现在模糊分叉、有无越权自动批；决策流水是否落盘且不含密。
4. QA 是否后台静默、有无碰主 Chrome；沙箱解禁是否按 `AGENTS.md` 口径（QA＋planner＋senior-expert，只解沙箱不解职责边界）且已记账。
5. Secret（API Key、Cookie、Token）有无入仓。
6. 账本是否记全（`model` 精确写法、新字段；无账本项目是否按要求记账）。
7. 老项目迁移是否过登记检查（`check-ledger.mjs` 得 `LEDGER-OK`）。
8. TM 资格：Episode 是否记账、采样门槛/Gate 是否遵守、主备是否经用户批准（未自动改表）。
9. 产品验收：追踪矩阵是否落盘、关键 AC 是否都有证据、核心路径上的控件是否真点过并观察到变化、首次发布类交付是否已取得用户签收。
10. 客户端无关：派工口是否由探测决定而非人工填表；同一套包在别的客户端能否直接开工（不应出现 Orca 专属硬依赖）；小活有没有被硬套上体系。
11. 公开作品仓：ORCA 通用脚手架是否已从公开仓摘除（`orca-gitignore.sh --untrack`，推送零操作）；应用 `README.md`/首页是否完好；本项目计划/评审/交接/账本是否仍留作云备份。
12. APP 导航与视觉方向：三方向是否在**同一核心页面**并置且**非只换配色**；`LIGHT`/`DARK` 是否被误当独立方向；批准后是否重复询问风格；**底部导航是否由 Product Plan 决策（而非方向集自造）**；底栏是否固定不随内容滚动；Android 验收是否用了真机证据而非网页原型。
13. Phase1 可运行原型：有用户界面的 APP 是否带**可运行**原型进 Human Gate（而非 PDF/截图/纯文档）；**文件存在与真实运行是否分开判定**；用户能否自行打开而不靠编排者讲解。
15. 界面信息分层：L3 内部信息（Phase/Gate/AC-FR/证据等级/内部 ID/动作代码/开发版本与 hash）是否漏上屏；来源是否用可读名称；必要安全/法律/停止条件是否被精简掉。
16. 产品简化门槛：同一状态下是否有无意义重复入口；高频操作是否被低频功能挤占；是否为覆盖率堆页面控件；按钮文案与实际跳转是否一致；**必要的安全停止／空状态／删除确认有无被误删**；Reviewer 是否给了有依据的「无须删减」而非凑数删减；QA 是否用真实截图录屏取证而非用通过率替代。
14. 汇报纪律：编排者是否只报目标完成/工作完成/大影响三类，是否 ≤10 行，残留清理/备份旧文件/既有 warning 有没有被拿来反复问用户（发现即打回）。
