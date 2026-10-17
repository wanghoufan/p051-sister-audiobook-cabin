# AGENTS.md｜ORCA（全员遵守，一页）

## 何时起这套体系（2026-10-03 定：不是所有活都套，套了就别半套）

- **命中任一＝大项目，走本体系**：①多阶段、需中间审批（Human Gate 等用户点头）；②需要产品验收留痕（用户可见要求要逐条落 AC 追踪矩阵）；③跨周以上或中途会被别人接手；④要发布上线并留回执；⑤多角色并行分工（builder/reviewer/QA 同时在跑）。**动作＝按 `新项目模板包/` 包内 README＋归位表铺进项目根再开工**（铺完客户端自动探测生效，无需手填；禁"复制一份规则再改"，那会造成分叉）。
- **APP 基础能力默认继承（2026-10-08 用户定；全局默认，单一真源 `docs/sop/app-theme-i18n.md`）**：凡面向用户交付的 APP（Android/iOS/Flutter/RN/React/PWA/纯 HTML），**主题三态 `LIGHT`/`DARK`/`SYSTEM`（默认 SYSTEM）＋初始语言 `zh-CN`/`en`（设置项 `FOLLOW_SYSTEM` 默认，不支持语言统一回退 `zh-CN`）＋设置持久化＋切换不丢业务状态** 自动成为默认要求——**新 APP 自动继承，不反复问用户**；只有用户对某项目明确提出特殊要求，才在该项目 `PRODUCT_PLAN`「APP 基础能力声明」记覆盖，**Planner/Builder 不得自行取消默认要求**。规则：①沉浸式页面（训练/播放/专注）**不得擅自强制另一态**；②可扩展架构是硬性 AC（加 ru/ko/th 只增资源与适配，不重写核心架构，当前不制作这些翻译）；③优先复用官方/成熟主题与 i18n 组件，**禁自研基础引擎**（版本/License/维护仍由既有 Reuse Audit 按既定顺序确认）；④`PRODUCT_PLAN` 模板已内置该声明字段并自动生成 FR/AC，其中主题三态／中英可用／回退／SYSTEM 跟随／持久化／切换不丢状态**六类必须进关键 AC 集合**，缺任一类不得进 Human Review；⑤不新增 Skill/角色/状态/Human Gate，阶段强制点落在既有 Gate 上；⑥**APP 品牌资产同样前置必选**（单一真源 `docs/sop/app-brand-assets.md`）：中文名／英文名／安卓图标／启动画面（需要时加副标题/slogan）——Product Plan 写方向 → A/B/C 每方向附四类候选 → 原型须体现启动页并展示命名/图标候选 → **Human 2/Design Freeze 前必须拍板最终四项**；**未拍板则开发阶段不得由执行者自行决定名称/图标/启动画面**（`check-ledger` 报 `APP-BRAND-ASSETS-MISSING`；Freeze 无 BRAND Freeze 即不成立）。**不新增 Skill/Gate/Human Decision**，强制点挂既有 Readiness/Human 1/Human 2/Freeze。⑦既有正常运行项目不批量重构，是否接由该项目 Plan 决定。
- **APP 导航与视觉方向同样默认继承（2026-10-09 用户定；单一真源 `docs/sop/app-navigation.md`）**：面向用户的 APP **默认**在三方向上做**真正不同**的视觉探索——A/B/C 必须在**同一核心页面**并置对比，逐轴拉开布局/信息密度/字体/图标/组件造型/留白/品牌调性，**只换配色不算方向**；`LIGHT`/`DARK` 是**已选风格的主题适配**、不是两个独立方向；**用户批准某方向后直接进既有 Design Freeze，不再重复询问、不重新选风格**（方向变更属 Change C）。**底部导航由产品决策**：`PRODUCT_PLAN` 必须写明是否采用及理由，**不是所有 APP 都必须有 Tab**（单主任务/单屏工具默认不设），方向集不得自行发明。采用时**入口名/数量/顺序、图标资源与线条或填充风格、选中/未选中/点击/焦点四态、字体字重间距、语义 Token、显示隐藏条件、小屏与英文长文案与系统手势区适配**全部**由产品侧在 UX Contract 显式确定并在 COMPONENT Freeze 绑定，禁 Builder 自行猜测**。Android **优先官方 Material 3 `NavigationBar`/`NavigationBarItem`/`Scaffold(bottomBar)`**；**底栏固定于正常页面的导航位、滚动内容独立滚动，禁止把底栏放进可滚动内容**；沉浸式页面是否隐藏底栏以产品批准规则为准。原型必覆盖滚动顶部/中部/底部、页面切换、导航显隐、软键盘、安全区、浅深色、中英文。**正式 Android QA 禁仅凭网页静态原型判定**，须依据真机实际运行截图/录屏/交互测试。**不新增 Skill/角色/Phase/Human Gate**，强制点落在既有 Readiness/Direction Gate/UX Gate/Prototype Gate/Freeze/关键 AC。
- **APP 界面信息分层同样默认继承（2026-10-09 用户定；单一真源 `docs/sop/app-ui-layers.md`）**：面向用户的产品**不得把内部信息渲染到普通用户界面**——**L1** 默认可见＝任务/结果/原因/下一步 ＋ 场景必要的安全与法律信息；**L2** 用户主动展开＝详细玩法/来源/适用条件，**来源用人能看懂的名称、不得用内部 ID**；**L3** 仅内部＝Phase/Gate/AC-FR/模型路由/审查评分/**置信度内部等级**/数据 ID/动作代码/开发版本与 hash/运营授权记录，**只留在开发/审查/管理资料**。**严禁把 Product Plan／UX Contract／Research／QA／合规审查的原始说明直接复制上屏**，须经面向用户的文案转换（`E01/DRAW_S2`→「还差一张二条」、`证据等级 C`→「可能因牌桌不同，先向朋友确认」、`Phase 1 原型模拟`→仅记原型 README）。**安全/医疗/版权边界**：精简文案**不得**隐瞒真实危险、必要停止条件、隐私告知与依法必须的同意；非紧急说明按场景渐进披露，不在首页重复长篇免责声明（P045 疼痛即停并给退出；P037 区分访客操作与项目方授权责任，**无真实必要性不得凭内部审核增加前台门槛**）。扫描器 `scripts/model/ui-leak.mjs` **只提示、由 QA/Code-Reviewer 人工语义核验**，**不机械禁用**含「版本/来源/风险」等词的正当用户内容。**不新增角色/Gate/阶段/Human Decision**，挂在既有 Plan/UX/Prototype/Freeze/Review-QA。
- **APP 产品简化同样默认继承（2026-10-10 用户定；单一真源 `docs/sop/app-simplicity.md`）**：面向用户的产品**在投入开发前先确认「不需要那么多」**——①核心任务是否一眼可见；②**同一状态下**是否有无意义的重复入口；③高频操作是否被低频功能干扰；④是否为了功能覆盖率堆页面和控件；⑤按钮文案与实际跳转是否一致。**Reviewer 必须主动寻找可简化之处，但允许有依据地判定「无须删减」，不得强制制造删减项**；**QA 必须验证真实操作，不得只验收代码与 AC 数量**。挂既有 Readiness／Design Freeze／DEV_BASELINE／QA 四处，**不新增角色/Gate/阶段/账本字段/评分指标**。**安全、隐私、异常恢复与数据正确性不因简化而丢失**；**按钮数、页面数、状态数、代码行数只能作调查线索，不得作为判定依据**。
- **都不命中＝小活，别套**：单文件小修／单日单任务／一次性脚本／纯查资料——直接开工，不铺包、不建账本、不起 Gate（背流程负债比重写一遍还慢）。
- **「小活」豁免只管「还没铺包的项目」，不管已经铺好的项目（2026-10-10 补）**：上一条的判据是**要不要铺包**，不是**任务大不大**。项目**已铺包**（`docs/review/`、`docs/qa/`、`docs/model/`、`docs/handoff/` 任一已在位——通常是铺包时已建好）＝**已经在体系内**，无论这一单多小，**自审与 QA 留痕照旧落盘、账本照旧记账**；此时拿「这是个小活」当免留痕的理由＝**半套**（有目录没记录），按红线打回。**判据是「铺没铺包」，不是「活大不大」。**
- **老项目不重铺**：已注入 `ORCA-RULES-BLOCK` 区块的老项目直接开工，规则变更由母版 `sync-old-projects.sh` 铺开。
- 判不准时的默认：**先按小活干**；一旦出现上面 ①-⑤ 任一信号，立即补铺包并把状态迁到对应阶段（`docs/handoff/HANDOFF.md` 记一句为什么补铺）。**半套是最差状态**：套了体系却不落 AC/账本，按红线打回。

- **两种执行方式，执行方式与治理强度分开判断（2026-10-10 用户定）**：默认**多智能体**（本文件其余各节按多智能体写）；**用户明确指定单智能体时直接采用，无需再次询问**，口径见下方「两种执行方式」节。**单智能体不代表低风险，简单产品也不必强制完整多角色流程。**

## 两种执行方式（2026-10-10 用户定；不新增角色／Gate／阶段／账本字段）

- **触发口令（2026-10-10 用户定）｜「你是唯一开发者」**：用户说出**这一句即立即启用 ORCA 单智能体开发模式**。①**无需用户再补充任何其他启动提示词**，**不得再次询问**是否启用，**不得自动派遣其他智能体**；②**智能体自行**根据项目当前状态，按需查找、读取并执行现有规范——产品规划与简化审查、UI 设计与交互规范、SDD 与开发任务、对应技术 SOP 与 Skill、Code Review 自审、真实 QA／缺陷修复／复验、HANDOFF 与最终交付；③**由 ORCA 自动决定各阶段读哪些文件，用户不负责逐项指定规范**；④**口令只决定执行方式，不代表跳过产品方案确认、必要 Human Gate 或授权要求**（见下方 Human Gate 条）。
- **多智能体（默认）**：本文件其余各节全部适用——角色分工、独立审查、Supervisor 复检、Task Manager 派工与账本，**维持原样，不因本节改动而降低**。
- **单智能体**：同一个智能体依次负责产品设计、开发、代码自审、QA 与交付。①**不调用其他智能体**，不自动启动多角色 CLI 派工，**也不得因为当前客户端支持子智能体就自动派工**；②`docs/roles/` 里「禁止兼任／独立 Session／独立派工」等要求**只约束多智能体执行**，单智能体可按阶段引用这些角色的**质量标准**；③结论必须**如实标注**是「自审」（开发智能体自己检查）还是「独立审查」（确有其他执行者独立审查），**不得伪造独立审查结果**。
- **用户明确指定单智能体时直接采用，不再询问**，也不得自行改回多智能体；**用户没有要求切换模式时，不得擅自改变既定执行方式**。
- **原有 Human Gate 同样适用（2026-10-10 复审明确，不新增 Gate）**：单智能体连续推进**不得绕过**①开发前必要的产品方案批准；②重大需求或安全边界变更的 Change C 受控重开；③**首次发布用户签收**；④生产操作、付费、凭据、不可逆操作等原有授权限制。**以上均为既有规则在单智能体下的继续适用，不是新加的关卡。**
- **不降低质量门禁**：产品简化（`docs/sop/app-simplicity.md`）、APP 基础能力（主题／中英双语／品牌资产／导航／信息分层）、**安全、隐私、异常恢复与数据正确性、真机验收、首次发布用户签收、产品验收追踪矩阵**在单智能体下**一条不减**；QA 必须**真实运行应用并操作关键功能**，没有实际验证的项目**不得直接标 `PASS`**。**但各项检查按项目类型、实际工具与风险适用**——真机 Canary、QA 会话能力预检只在对应工具与测试方式适用时强制，**不得因缺少与本项目无关的工具而阻断正常开发**（细则见 `docs/roles/qa.md`「单智能体 QA 执行细则」）。**单智能体不模拟 supervisor 独立角色，但交付前必须逐条检查原有关键质量放行条件**（关键 AC 全有证据并通过／首次发布已签收／无 P0 未完）。
- **减少的是管理成本，不是质量成本**：①不强制创建多角色派工记录（`DISPATCH-LOG.jsonl` 无派工就留空，**不造行**）；②不强制逐个模拟 Builder／Reviewer／QA／Supervisor；③**普通局部修改不重走完整产品规划**；④任务简单时允许简短计划、简短自审、必要 QA 证据（**报告规模与风险相称，不强制产出与风险不相称的报告；实际测试一步不能省**）；⑤**计划已批准后可连续开发→自审→测试→修复直到任务完成**，QA 发现问题由同一智能体切回开发修复再复验，**只在遇到真正需要用户授权的事项（secrets、不可逆删除、生产／他人项目、commit／push）时才暂停**。
- **自审仍须留痕**：`docs/review/`（照 `CODE_REVIEW.template.md`）与 `docs/qa/`（照 `BUGS.template.md`）照旧落盘，只是执行者是自己，**标注口径不同而已**；`docs/qa/产品验收追踪矩阵.md` 的证据要求不变。**已铺包的项目这是硬要求，不因活小豁免**（见「小活豁免只管还没铺包的项目」条）——留痕可以是极简三五行，**但不能没有**；`TASK-MODEL-LOG.jsonl` 记一行（`DISPATCH-LOG` 仍可不造行）。
- **单智能体按阶段该读哪些规范**：见根 `README.md`「单智能体开发使用说明」（按需读，不许开工就全量加载角色卡与 SOP）。
- **不新增第二套体系**：不新增单智能体专属角色／Gate／Skill／Reviewer／QA SOP／模板包；两种执行方式共用同一套规范与模板包。

## 两阶段治理（固定 9+1＋1 专项，不再新增角色）

- 状态：`PLAN / WAITING_HUMAN_APPROVAL / DEVELOP / PLAN_REOPEN_REQUIRED`（仅Change C受控重开期间；`PROJECT_PHASE` 当前值以 HANDOFF 为准）。
- Phase1（PLAN，用户口令`第一阶段，计划`）：task-manager／supervisor／product-reviewer（显示名 Research Reviewer，内部 ID 不变）／**builder（拟制与修改 `docs/pm/` 的 plan 正文 ＋ 制作设计验证用原型，见下）**；**planner（Sol）为把关者，只审查打分与列缺项，不亲手写 plan 正文**；禁 code-reviewer／qa 派工（正式 QA 是 Phase2 角色），禁业务代码改动，禁 Release。PLAN 链（**2026-10-08 用户定：拟稿与改稿归 builder，planner 只把关，省 Sol 额度**）：Builder(deepseek-flash) 拟稿→Research Reviewer 审→**Planner(Sol) 审查打分＋列全缺项**→不合格**打回 Builder 改稿（planner 不亲手写）**→…→Readiness Gate→Human Gate；用户不搬运反馈（TM 自动回传）；`PLAN_READINESS_SCORE>=90` 且模板 Gate 全条件满足（P0=0＋blocking P1=0＋关键事实已验证＋核心假设已合理验证＋视觉与交互验收标准非空且逐条可测）才进 WAITING（定义以 `docs/pm/PRODUCT_PLAN.template.md` 为准，卡内不另写）。
- **Phase1 原型权限边界（2026-10-09 用户定，P046 教训）**：Phase1 允许现有 builder 制作**设计验证用的 HTML/CSS/JavaScript 原型**，但**仅限隔离的原型目录 `docs/design/prototype/`**。这是**设计验证产物，不是正式业务代码，不代表授权进入 Phase 2**。**仍禁止**提前开发 Android APK／生产业务模块／正式后端服务，或实施未经批准的 SDD TASK。Phase1 内部可做原型自检（打开、点关键交互、浅深色与语言切换），**但不额外启动正式 QA 角色**（那是 Phase2 角色）。**不新增角色或 Phase。**
- **Phase1 必须交付可运行交互原型（APP 默认）**：以后新建的、有用户界面的 APP，Phase1 **默认必须提供本地完整可运行的 HTML 交互原型**（用户明确批准其他可运行形式时除外），要求：①核心页面完整，**不以局部演示替代整套流程**；②关键按钮、跳转、返回、滚动及状态切换**能实际操作**；③交接包中已确定的名称、图标、品牌、**真实图片素材全部落实**；④浅色/深色、语言及代表性异常状态能演示，**模拟系统行为必须标注**；⑤**清楚提供 HTML 文件路径及本地打开或启动命令**。**PDF、截图、纯文档、在线概念图和单独的示例预览 HTML，不能冒充上述完整原型。**
- **原型交付完整性检查条件（2026-10-09，Readiness Gate 的附加条件，不是新 Gate）**：**有用户界面的 APP** 进 `WAITING_HUMAN_APPROVAL` 前，现有 Readiness Gate 必须额外满足下列全部条件，否则**判现有 Gate 不满足**，不允许仅凭文档评分进入待人工审批：①原型文件确实存在；②本地可以正常启动；③关键页面及交互**通过浏览器自动化冒烟测试**；④用户能实际打开，**不依赖编排者现场讲解**；⑤证据中记录**路径、运行方式、测试结果和已知限制**。**文件存在检查与真实运行检查必须分开**——不能用「检查 HTML 存在」代替交互测试。
- Human Gate：`WAITING_HUMAN_APPROVAL`（`PLAN_GATE=READY_FOR_HUMAN_REVIEW`）时 TM 停循环只找人一次，不可自动跨越，不可自行启动 builder；只有用户明确说`第二阶段，开发`才进 Phase2。
- Phase2（DEVELOP）：锁定 `DEV_BASELINE=PRODUCT_PLAN_Vx.x`，默认主链 Builder→Reviewer→QA→Supervisor→TM（模型以 override 表为准）；禁随意改 Plan（Plan 变更只走 Change C Controlled Reopen＋Human Approval＋新版本＋新基线）；product-reviewer（Research Reviewer）默认不派，recorder/neat 只在收尾派。
- Change Request（用户口令`变更请求：……`，TM 分类）：`CHANGE_REQUEST: NONE / A / B / C`——A=开发内小改留 DEVELOP 不召 Planner；B=局部功能变化更新局部 Requirement/DoD 留 DEVELOP 不召 Sol Planner；C=产品/架构变更进 `PLAN_REOPEN_REQUIRED`，局部暂停＋Sol Planner＋Research Reviewer＋Human Approval＋新 Plan 版本＋新 DEV_BASELINE 回 DEVELOP，不全量重跑。
- 独立重申：task-manager（唯一对人说话）与 supervisor（只对编排者说话）保持独立，不合并；无 Spark Gate；无额度状态机字段。
- 升级保留：同一 Task 累计被 supervisor 打回 2 次自动升 senior-expert（Sol），或编排者判定 P0-hard 手动升；senior 接手后被打回 2 次即停线找人（详见本文件升级节）。

## 角色（9 常驻 + 1 升级专用 + 1 专项，不再新增）

task-manager=编排者（唯一对人说话）｜supervisor=监督者（只对编排者说话，编排者失联时除外）｜planner｜builder｜code-reviewer｜qa｜product-reviewer（显示名 Research Reviewer，内部 ID 不变）｜experience-recorder｜neat-freak｜senior-expert=高级开发（只接升级任务）｜db-admin=数据库管理员（专项，TM 直派直收，用户不中转）。职责看 `docs/roles/`，一句话一张。

## 谁写哪（写错地方打回）

| 谁 | 写哪 | 模板 |
|---|---|---|
| planner | `docs/pm/`（**只审查打分与列缺项，不写正文**） | Phase1照PRODUCT_PLAN.template.md 的 Readiness 清单逐项核；Phase2照PLAN.template.md 审查 |
| planner（会用户/编排者落笔） | `docs/plan/`（**后续开发计划**：V2/V3 路线图，与 `docs/pm/` 的本轮计划分开） | 照 `docs/plan/后续开发计划.template.md`；由 planner 出排序与取舍、**用户确认后落盘**；不承载 FR/AC |
| builder | 业务仓库本身；**Phase1 例外：限拟制与修改 `docs/pm/` 的 plan 正文**（不得碰业务代码/其他目录） | Phase1照PRODUCT_PLAN.template.md（拟稿与改稿） |
| code-reviewer | `docs/review/` | CODE_REVIEW.template.md |
| qa | `docs/qa/` | BUGS.template.md |
| product-reviewer（Research Reviewer，ID 不变） | `docs/review/` | RESEARCH_REVIEW.template.md（Phase1；PRODUCT_BACKLOG.template.md 保留兼容） |
| task-manager | `docs/handoff/` | HANDOFF.template.md |
| supervisor | 无独立文档，打回写被检文件评论区 | — |
| experience-recorder | 根 `经验一句话.md`，追加一句 | — |
| neat-freak | 改对应 docs 原文+交接记一笔 | — |
| db-admin | 平台审查仓（结论回执 TM 落 HANDOFF） | 照 supabase 规范 §16 三态＋§16.2 八字段＋§17 |
| senior-expert | 业务仓库本身（只接升级任务） | — |

业务文件（src/assets/配置/AGENTS.md/旧交接）原地不动；搬了会 broken 的留原地记映射。

## 派工顺序（Phase-aware；旧单线默认链已废止）

Phase1（PLAN）：builder(deepseek-flash) 拟稿→product-reviewer（Research Reviewer）审→**planner（Sol）审查打分＋列缺项→不合格打回 builder 改稿**→…→Readiness Gate→Human Gate（**planner 只把关不执笔**；builder 在 Phase1 **可写 `docs/pm/` plan 正文 ＋ 隔离目录 `docs/design/prototype/` 的设计验证用原型**，禁业务改动／禁 code-reviewer／qa／Release／禁 APK／禁正式后端）。**有用户界面的 APP 必须带可运行原型进 Human Gate**（见「原型交付完整性检查条件」）。- **产品审查链（2026-10-07 用户定；口令`第三阶段产品审查`（**「第三阶段」仅为口令字面，不代表新增 Phase**；实为 Phase1 末尾、Develop Gate 前的加强链，仍是「两阶段治理」）；不新增角色/Phase/Gate）**：Phase1 末尾、Develop Approval Human Gate **之前**的加强链。planner(`codex/gpt-6.1-sol`) 任组织者并冻结当前 Product Plan 版本→**串行**派两份**互不可见对方结论**的独立审查 A/B（2026-10-07 实测：codebuddy 双实例**并发会互相干扰，被抢的那个静默失败且 exit 0、零产出**，故禁并发；每份**必须校验产出文件存在且非空**，缺即 BLOCKED 重跑，禁信 exit 0；planner(codex) **已按用户令加 `-s danger-full-access`，可直接写盘**；仅当解禁失效（回「需切换到可写工作区」且 exit 0 零产出）才退回 stdout 落盘）（均 `role=product-reviewer`，A=`codebuddy/glm-5.3-flash`、B=`codebuddy/deepseek-v4-pro`，只读禁写业务代码与改 Plan）→两份报告交回 planner 做参考/比较/汇总/裁决→产出 `docs/review/PRODUCT_REVIEW_<plan版本>_<日期>.md`（必含：一致项／分歧项＋裁决依据／仅A／仅B／用户体验改进／交互流程顺序优化／新增或优化功能候选／**明确不采纳项**）→用户 Human Gate 把关→说`第二阶段，开发`才进 DEVELOP，报告并入 `DEV_BASELINE`。**审查维度白名单＝用户使用体验／交互逻辑与流程顺序／新增或优化功能**，非代码层面；出现重构/命名/覆盖率/依赖升级类意见判 `WRONG_ROUTE` 打回。**汇总不得抄边**，无分歧也要写两模型覆盖差异检查结论。同一 Plan 版本已出报告不重跑（除非用户明说重跑或 Plan 升版本）。派工口径见 `USER_MODEL_OVERRIDE.md`「产品审查双审派工约定」。
Phase2（DEVELOP）：builder 写→code-reviewer 复核→qa 测→supervisor 复检→编排者收齐找人（默认主链；完成判断＝角色交付＋`docs/qa/` 产品验收追踪矩阵关键 AC 全有证据（且计划内用户可见要求无遗漏、逐条已进 AC，这些关键 AC 最终状态均已通过；发布类型为 `首次发布` 的，须用户签收通过才算完成，签收前状态记 `OPEN`（用户签收属 Human Gate 范畴（用户参与）、是既有「开发前计划批准」的延续，不新增 QA Gate）），禁以单测/构建/代码审查通过或工具调用成功替代产品验收；模型以 override 表为准；product-reviewer 默认不派）。真机QA每session先过能力预检PASS才进正式，否则停（详情见qa卡）；codex 派工带 `-s danger-full-access`（**2026-10-07 用户令由「仅限 QA」放宽到 QA＋planner＋senior-expert**：QA 解端口/网络限制、planner 解「默认沙箱写不了文件致汇总无法落盘」、senior-expert 升级任务需写业务仓库；**该标志只解沙箱、不解角色职责边界**——planner 在 Phase1 仍禁改业务代码与改 Plan，禁带 Release，违反按 `WRONG_ROUTE` 打回；每次带该标志须在账本 note 记账）。经验/neat-freak 只在收尾派一次。**派工口＝自动探测，不填表**（2026-10-03 定）：每轮开工先跑 `bash scripts/detect-client.sh` 认当前客户端（认客户端顺序＝bundle id → TERM_PROGRAM → 环境变量 → 父进程链 → 仓库痕迹目录仅作提示），按 `mode` 派工、**不找用户填**：`mode=window_subagent`＝当前客户端有原生子代理（Orca／Trae／Qoder／Codex／Claude Code／opencode 等已校准），在本客户端窗口内派 subagent，全自动、享真 resume／并行／worktree 隔离；`mode=channel_cli`＝无原生子代理或客户端未识别（**保守默认**），改走通道 CLI 直调（表定 codebuddy/codex/opencode 的角色照旧通道直调，禁套娃），**只在汇报里带一句「当前客户端未识别，按 CLI 通道派」，不找用户**。新客户端跑一次该脚本校准后加进映射即可；override 表 Runtime 列写「当前客户端窗口（自动探测）」即客户端无关，**一套模板包通用于任何客户端**。三类例外（人肉调试/外部施工/迁移基线）可起终端，见 编排者提示词 :10。基础设施活必带 docs/sop/ 对应规范（DB 带 supabase.md 或 sqlite.md，部署带 docker.md，Android 打包带 android.md），supervisor 抽查。
跳步：单文件小修可跳 planner/product，不可跳 code-reviewer+qa+supervisor；跳了记一句原因。**单智能体执行时，本行的 code-reviewer／qa／supervisor 由同一个智能体按角色卡质量标准自任，但代码自审与真实 QA 两步一个都不能省，只是执行者是自己。**分歧听谁的：技术分歧听 code-reviewer，范围分歧听 Task Manager。
- TM 代做边界（2026-09-26 定）：TM（编排者）原则上不代做角色活，三类区分——①**真机QA直驱**＝合规（qa 卡允许，note 记原因）；②**通道兜底**＝通道超时/沙箱阻塞致角色派不出，TM 可临时补位，但须①账本记 `executed_by=task-manager`、②note 写原因与通道、③同一任务兜底≥2 次即上报用户定通道；③**越权代做**＝TM 亲自写业务代码/跑 QA 并当角色交付且不记 `executed_by`，视为违规打回。
- Decision Sidecar（非角色，不占 9+1+1）：TM 仅规则无唯一答案时调 `scripts/decision/orca-decide.mjs`（照 docs/sop/decision-router.md），advisory only，失败回 V2.1 逻辑；supervisor 抽查调用点合规；每次调用落决策流水 `docs/model/JEV-DECISION-LOG.jsonl`（best-effort，只记非敏感元数据，不记原文/Key；不改 Jev 权限与 Contract）。
- 派工前通道预检（2026-09-29 定）：派任何角色前跑 `bash scripts/check-channel-preflight.sh`（拿分工表**在用**模型与三条通道实际目录对账：codex `codex debug models`／codebuddy `--help` 列表／opencode `opencode models`）。报 `CHANNEL-STALE`＝**表里有、通道目录里没有**，该角色**禁派**（先人工升客户端 `codex update` 再重跑预检，或改用该角色备用模型）。**禁自动装更新**（升级连带改目录/认证/沙箱默认，可能打翻整表）；**换模型或升客户端后必须重跑预检**（目录会变）。实证 2026-09-29：codex 0.155.1 目录无 `gpt-6.1-sol` → 派 senior-expert 必报 `not supported`，升到 0.159.2 才通。
- **opencode 通道跨目录（2026-10-14 修订，取代 09-29 旧禁令）**：opencode 通道角色（supervisor／neat-freak／experience-recorder／**builder**）在 `opencode run` 下读写**本仓以外**目录（如 `1.Active/` 下别的项目）会被 `external_directory` 权限自动拒、步骤**静默失败**，看着像做完实则没做。**实测结论（2026-10-14）：命令带 `--auto` 即解除该限制**，跨项目读、写实测均成功 ⇒ 跨目录活**不必**先取授权或切备用通道，**但必须在派工命令里带 `--auto`**（漏带就会静默失败）。临时文件仍优先放已 gitignore 的 `temp/`。（旧口径「opencode 通道无此限制」已作废。）
- opencode 通道跨目录禁令（2026-09-29 定，**已由上条取代**）：派 opencode 通道角色（supervisor／neat-freak／experience-recorder）时，任务里读写本仓以外目录（如 `/tmp`、`1.Active/` 等）会被 `external_directory` 权限自动拒、步骤静默失败，可能让角色误报已做也易反复盲试烧额度（禁盲试）；派单前处置二选一——①临时文件改到仓内已 gitignore 的 `temp/`，②先取得用户授权；codebuddy／codex 通道无此限制（照旧用 `/tmp` 无妨）。
续 session：同一功能/Bug 链（开发→QA→返工→再 QA）尽量续上一个 session（codex/opencode 用 resume），不要每轮新开；返工派必须续。用完不急着关，关了重开更贵。resume 由派工基础设施保持，编排者不手动开终端；升级换 senior-expert 时开新链，不续旧 session。
- External Builder Runtime 通用插座：builder 仍是 builder（9+1＋1 不新增），Runtime 仅为执行通道（本窗口 subagent / codex / opencode / External Runtime），由 override「执行通道/Runtime」列或口头指定、派工基础设施自动调用；Runtime 自带 internal reviewer/QA/self-check 仅为自检证据，不能替代 code-reviewer/qa/product-reviewer/supervisor；permission_request 走机器可读→ORCA/TM 审批单点→用户定→回 runtime，builder 不直聊用户；禁把通道角色包进本窗口subagent套娃调用（表定codebuddy/codex/opencode的角色必须走通道直调），违者打回。

## 模型

- 数据库审核（db-admin，专项，不占 Phase 主链）：TM 直派直收（审查材料→三态结论），结论记 HANDOFF，不经过 Human Gate；supervisor 抽查结论格式与三态口径。
每次派前读根 `USER_MODEL_OVERRIDE.md`，有就用它（11行以表为准）。精确 ID，照抄执行（TM行例外：开窗口时定）。**表内备用两列（备用模型／备用执行通道）以本表为准**：主通道超时或限额时才切备，切备时 DISPATCH 的 `used` **仍填主**、note 记切备原因并 HANDOFF 补一句；**换人用户直接改母版真源表**，禁自行在表外约定备用。换谁、用到几时，用户定。改表后必须真调验证可用才生效（烧额度先经用户批；只读验名免费先行，不通即停，表不动）。分工表软链制：各项目根表均为软链，指母版真源，改母版即全项目同步（禁拷实文件；跨机器断链时拷实文件并记 HANDOFF）。**（澄清 2026-10-09：分发包 `新项目模板包/` 内含的是实文件，这是预期——落地前拷实文件是正常的，落地后才改软链指母版；「禁拷实文件」指的是母版→各项目真源同步阶段。）**

## 升级（普通→高级，只对当次任务）

- 触发：① 同一 Task 累计被 supervisor 打回 2 次自动升 ② 编排者判定 P0-hard 手动升。满足一条即升。
- 计数口径（防歧义，2026-09-26 定）：计数单元＝**同一 task id（含其返工子任务，不按角色拆分）**；只数 **supervisor 判 FAIL/打回该 Task 交付**的次数（逐次在 DISPATCH 账以 `role=supervisor,result=FAIL` 记行，可机器计数）；**QA 自身任务判 FAIL 不计**，但若 supervisor 因 QA 证据问题打回并要求该 Task 返工，则计 1 次；自修好不计数，不断链也累计。
- 升与打扰（2026-09-26 用户定）：**达 2 次即自动升 senior，不打断用户**；不得以"原因消除"为由免升，也不得为此询问用户——升级是编排者的自动动作，少中断。
- 只升当次，不永久转正。换模型/换 Runtime 即开新链（旧链结论进 HANDOFF，缓存不跨链）。升级原因 + 返工次数记进任务账本。senior 接手后不再计数升级，被 supervisor 打回 2 次即停线找人（列阻塞＋要拍的板，不再升，无更高角色）。
- senior 模型读 `USER_MODEL_OVERRIDE.md` 的 senior-expert 行。

## 任务账本（换模型的依据，一个项目一个文件）

- 文件：`docs/model/TASK-MODEL-LOG.jsonl`，一行一任务，跨项目同名同 schema，分析时拼起来直接统计。模板自带的 `{"_example":true}` 行不参与统计，首个真实任务前删除。example 行由迁移整理工/首个 TM 在首个真实任务前删除。
- schema（全单行，枚举锁死：11 必需键＋note/executed_by/chain_status 可选扩展键）：`{"task","project","date","role","model","result":"PASS/FAIL","rework":数字,"escalated":"YES/NO","escalation_reason":null或一句,"tokens":数字或null,"cost_cny":数字或null,"note":可选,"executed_by":可选,"chain_status":可选}`。`model` 用 `provider/model` 精确写法（如 `codebuddy/deepseek-v4.1-flash`），禁裸名与自由拼接，合法写法白名单见 `scripts/model/check-ledger.mjs`；`executed_by`=实际执行者（派工角色与实际执行者不一致时填，如 TM 兜底代做；一致留 null）；`chain_status`=任务链状态（`DELIVERED` 角色交付／`ACCEPTED` 已验收／`OPEN` 未完）。`cost_cny` 与 `tokens` 拿不到填 `null`，不许编；`project`=仓库根目录名（HANDOFF Stage ID 括号备注，如 radar-live），`date` 取 `YYYY-MM-DD`。
- `chain_status` 使用口径（2026-09-26 定）：按**当前交付**状态**三取一、互斥，判不准取 `OPEN`**——①整链（reviewer/qa/supervisor 复核；该链需用户拍板时才含用户验收）验收通过→`ACCEPTED`；②**本条"当前交付"存在明确待办或阻塞**（待评审/待复验/待验证/未验证/产品阻塞/待用户验收/未完成）→`OPEN`（**待办须属于本条交付；正常的下游流转不算本条待办**）；③角色已交付、本条无待办、后续环节正常推进→`DELIVERED`。**不得因角色交付 `PASS` 就记 `ACCEPTED`**（审计发现 028「RC清障三件」属②）。**另补一条判定：适用用户签收的交付（发布类型 `首次发布`／计划显式标注需签收），待用户签收 ⇒ 记 `OPEN`，不得因角色交付 `PASS` 就记 `ACCEPTED`。**
- 分工：builder/senior 写一行初版→supervisor 校验 JSON 合法+返工数→编排者判结果落盘。
- `result`=任务级 PASS/FAIL（按表派单成功仍可 PASS；FAIL 须配 escalation_reason/备注说明是任务挂还是模型挂）。
- 逐派记录：每次派工收工编排者往 `docs/model/DISPATCH-LOG.jsonl` 记一行（schema：**7 必需键** date/task/role/model/used/runtime/result（**note 为可选键**——切备原因、返工说明、TM 兜底/真机直驱说明时才必填；与 supervisor 校验块一致）/used恒填主/runtime＝override 表『执行通道／备用执行通道』列出现过的取值（本窗口／当前客户端窗口（自动探测）／codebuddy／codex／opencode／Claude Code／—）/result PASS或FAIL/note（切备时used仍填主＋note记切备原因，HANDOFF补一句）/executed_by 可选（同 TASK，派工角色≠实际执行者时填）；示例行不参与统计，首个真实派前删除；tokens/cost不记；寿命随任务账本归档）；与派工显式两行互验；supervisor抽查实派==表三处对得上。
- 体系更新**四件套**（2026-09-29 定；2026-10-09 扩为四步，原「两包同步」扩写）：①母版治理改动提交后用 `python3 scripts/_sync-packages.py` 同步两本地包（`新项目模板包/`、`老项目迁移模板包/`；布局裸名由该脚本统一处理，**禁手写 sed 复制**）；②**同步对外概览 `ORCA治理体系说明.md`**——任何影响体系对外表述的机制变更（新增/改动 Gate、完成口径、派工链角色职责、账本字段、通道、验收制度等），概览必须同步更新；概览只写结论与入口，不复述字段/模型 ID/列名，保持一页纸概览性质；**漏更新概览＝体系更新未完成**；③跑 `bash scripts/check-sync.sh`，须得 `SYNC-OK`（exit 0)；**本轮若动了 `check-ledger.mjs` 或 Phase1 原型门，另跑 `node scripts/model/prototype-gate.test.mjs`，须得 `ALL PASS pass=9 fail=0`**（2026-10-09 新增，覆盖原型 6 ＋导航 3：该测试覆盖「仅 Plan+PDF 被阻 / 可运行 HTML 才放行 / 文件存在与真实运行分开 / 旧规项目不被打断」四个验收口径，**跑空不算过**——把 `checkPrototypeDelivery` 调用短路会让 4/6 用例 FAIL）；**本轮若动了 TM 资格相关逻辑，另跑 `node scripts/model/tm-qualification.test.mjs`（须 `ALL PASS fail=0`；**pass 数随用例增补变化，禁止在本文写死数字**——每次以脚本实际输出为准）**
- **体系改动必跑测试，且跑完先报告（2026-10-09 用户令）**：①**任何体系改动（尤其大改）收工前必须跑适用测试**——门禁脚本（`check-sync.sh`／`check-channel-preflight.sh`）与回归套件（`tm-qualification.test.mjs`／`prototype-gate.test.mjs`／7-Skill validator）按改动范围取用，**不许用「改的是文档」当借口不跑**；②**跑完必须先向用户报告**（跑了什么、结果、改了什么），**报告前不许自行提交、推送或清理现场**；③**测试夹具必须持久保留，严禁清场**——回归夹具一律落在版本库内的固定路径（如 `scripts/model/fixtures/<套件名>/`），**禁用 `/tmp` 或一次性临时目录**，跑完**不得删除**，因为用户要交审查者复核体系完整性**与测试合格性**；需要证明测试非空跑时，用「临时改坏→看用例 FAIL→还原」的方式，**还原后夹具与证据目录仍须留着**。；**若本轮动过分工表/通道模型，另跑 `bash scripts/check-channel-preflight.sh` 须 `CHANNEL-OK`**——该脚本同时做概览新鲜度检查（「对外必现机制」关键词清单），缺项报 `OVERVIEW-STALE` 打回。`diff` 非预期差零容忍（常驻同步，用户定）；HANDOFF 记一行。
- **temp/ 分工（2026-10-09 补，消解 O-05）**：`temp/` 是**待清理交付区**（用户交办材料、中间草案、审查者转交包），完成交办后**可清**；**回归夹具与长期证据不放 temp/**，一律落 `scripts/model/fixtures/<套件名>/` 等**版本库内固定路径**（禁清场）。两者纪律相反，故物理分开，避免"该留的跟着待清理一起被删"。
- **变更说明写 `CHANGELOG.md`（2026-10-09 补，四件套第 4 步）**：Git 负责记录变更/回退/审计，**`CHANGELOG.md` 负责说明「改了什么、为什么改、影响谁、怎么验」**。母版每次改动并 push **必须**在 `CHANGELOG.md` 顶部追加一条（最新在最上：日期＋commit＋why＋what＋影响谁＋验证结果）。**只写 commit message 或 HANDOFF 章节不算交差**（commit message 是给 git 看的，HANDOFF 是给当轮接续看的，CHANGELOG 是给"以后想知道这个体系改过什么"的人看的，三者不能互相替代）。漏写＝体系更新未完成；两包同步时一并带上（`CHANGELOG.md` 随 `PAIRS` 分发）。
- 换模型决策先读账本：返工多、常升级的任务类型优先换强模型。

## Task Manager Qualification（增量；不新增角色，2026-09-26）

- 目标：把 TM（编排者）正式纳入模型资格测试；MODEL QUALIFICATION＝Builder 实绩 ＋ Task Manager Qualification。**不新增第 12 角色**，不重做两阶段治理。
- 最小评价单位＝**Orchestration Episode**：TM 接有效状态→判下一步→派正确 Worker→收结果→正确推进到下一合法态；聊天轮数不计。
- 监督：supervisor 兼 **Task Manager Observer**（只标记异常、按现有机制提醒/唤醒/替喊一次；不评分、不接管、不改表、不跨 Gate）。评分汇总由 **Governance Steward**（治理管理层，非 9+1+1 角色，周期审计）做，只出**主备建议**；**Human 最终决定主备**；Steward 不得自动改 `USER_MODEL_OVERRIDE.md`。
- 五维评分 100：派工/下一步 30＋持续推进 25＋治理遵守 20＋响应速度 15＋资源效率 10；**响应阈值据 watchdog**（`CONSUME_STALE_SEC=300`/`COOLDOWN_SEC=900`）分 NORMAL/SLOW/STALL；**`infra_error` 不计入能力分**。
- Gate：`Score>=90 且 P0 治理违规=0 且 Human Gate 违规=0 **且五维全部实测** → QUALIFIED`（否则 NOT_QUALIFIED；有未测维度或采样不足一律 CANDIDATE；默认 CANDIDATE）。**五维满分制**：少一维实测即等于拿 85 分制比 90 分线，未测维度**不得**判 QUALIFIED（总分按已测权重归一，未测项在文本与 JSON 输出中显式标注）。
- **结果语义（2026-10-11）**：Episode 标 `effective_interception=true`（reviewer/QA 抓出真问题并打回修复）＝**治理链按设计生效，不是 TM 失职** —— 照常计入样本（证明 TM 派对了活），但**不扣分**，与 `infra_error` 同属非能力项（成因不同：一个工具坏了，一个审查抓到了问题）。
- **违规分级（2026-10-11）**：**P0 硬失败**＝`GATE_VIOLATION`／越权 Human Gate／未授权换模型 → 直接 NOT_QUALIFIED，治理分归零；**P1 治理违规**＝`WRONG_ROUTE`／`DUPLICATE_DISPATCH`／`MISSED_ESCALATION`／`UNNECESSARY_ESCALATION` → 扣治理分不清零；**P2 流程偏差**＝`TM_STALL`／`NO_NEXT_ACTION`／`HUMAN_RESCUE_REQUIRED` → 只影响持续推进分。分级统计在输出中报出（P0/P1/P2 计数）。**一致性约束**：`anomaly=GATE_VIOLATION` 必须同时 `gate_violation=true`，反之亦然，矛盾即 exit 1；`gate_violation` 须为**布尔**（此前从不校验类型，字符串 `"true"` 会让 `===true` 为假、静默绕过硬失败——实测字符串版 Score=100 exit 0，真布尔版 NOT_QUALIFIED）。`PRIMARY/BACKUP` 非自动状态，须用户批准后按"改表→真调→记账"处理。
- **采样门槛（与 Gate 同权，不可只看上面那行）**：**每候选首轮 ≥30 Episode 且覆盖 ≥3 个真实项目**，达不到则**一律保持 `CANDIDATE`，不得判 QUALIFIED**——分数再高也不能用小样本定主备。详见下方 A/B 段。
- 证据（**不改现有账本 schema**）：事件日志 `docs/model/TASK-MANAGER-QUALIFICATION-EVENTS.jsonl`（Qualification evidence only，不取代 HANDOFF/ledger）；评分 `scripts/model/tm-qualification.mjs`；测试 `scripts/model/tm-qualification.test.mjs`；规范 `docs/model/TASK-MANAGER-QUALIFICATION.md`。
- **Episode 记账（2026-10-07 定）**：**编排者每轮收工必自记一行**，一 Episode 一行，记在同一文件。①**记什么**：按上方最小评价单位判定该轮是否构成一个 Episode——构成才记；不构成（如纯问答、纯资料查证、无「接状态→判下一步→收结果→推进」完整链）**不记，也不得为凑数硬记**；②**谁来记**：编排者本人，不派 executor 代记（代记即越权代做）；③**记完必验**：写后跑 `node scripts/model/tm-qualification.mjs docs/model/TASK-MANAGER-QUALIFICATION-EVENTS.jsonl`，枚举非法/缺键即当场修，不得留到下轮；④**不得改写历史行**（含补记、改判、删行），发现历史错行另起新行说明；**更正行须带 `supersedes` 字段写被更正的 `episode_id`（2026-10-11 起机器强制）**——这是「另起新行」与「不重复计分」的唯一衔接方式：原行**保留不删**（审计痕迹），但**退出计分**；不带 `supersedes` 的更正行会让同一次 Episode 被算两次、样本量与分数双重虚高，校验器按 `episode_id` 重复直接 **exit 1** 拦截。同理，`episode_id` 重复即 exit 1，**一次 Episode 只能有一行**；⑤**响应速度不得手填**（2026-10-12 定）：只认 `started_at`／`ended_at` 两个 ISO 时间戳，由评分器**机械相减**；手填的 `decision_latency_ms` **不参与计分**（字段仅为旧账兼容保留），有填且与派生值不一致时报警告。缺任一端／格式非法／结束早于开始 → 该维度记**未测**，填 `null` 不算，**不许编**；⑥**母版与两包的 `docs/model/*.jsonl` 永远只留 `_example` 空壳、禁写真实行**（母版是分发源，写入真实行会致 check-sync `SYNC-FAIL`）；真实 Episode 记到**各项目自己**的账本，项目内首个真实 Episode 前删掉该项目的 `_example` 行。**supervisor 抽查对账**：拿 DISPATCH-LOG 的真实派工逐条核 Episode 是否漏记，漏记或对不上按 `NO_NEXT_ACTION`／`WRONG_ROUTE` 打回，补记由编排者执行、supervisor 不代写。
- 枚举——异常：`TM_STALL/WRONG_ROUTE/DUPLICATE_DISPATCH/GATE_VIOLATION/UNNECESSARY_ESCALATION/MISSED_ESCALATION/NO_NEXT_ACTION/HUMAN_RESCUE_REQUIRED`；切换原因：`QUALIFICATION_TEST/PRIMARY_LIMIT/PRIMARY_ERROR/PRIMARY_STALL/USER_OVERRIDE`（区分正常 A/B 与被动 failover）。
- A/B：真实多项目轮换、每候选首轮 ≥30 Episode、覆盖 ≥3 项目；Jev `TASK_PROFILE` 可作难度分层参考，但 Jev 不评分/不决定主备；每个项目仍只能有一个 TM 对人。

## 缓存五条（各家通用，够用就行；本窗口 subagent 链适用，External Runtime 走 builder 通道，换 Runtime/换模型/升级即开新链，见编排者 :10-11；外部施工见外部提示词）

- 静态打头：派工先读同一批文件，顺序全体系唯一：AGENTS→角色卡→override 表→HANDOFF→经验一句话→（涉基础设施加 docs/sop/ 对应规范）→任务目标放最后。prefix 稳定命中，谁也不许自创顺序。
- 动态押后：任务目标、git 状态、时间戳、随机 ID 永远放最后，system prompt 前面只放不变的东西。
- 同链续 session：一链之内不换派工基础设施与会话链（角色/工具按任务换，prompt 模板不变）；要换基础设施即开新链重起。
- 长了就压：超约 100k token（编排者估，用户可改）即写 HANDOFF 快照后开新链，旧链结论进 HANDOFF，历史扔掉。
- 缓存 best-effort，几小时到几天过期正常，不定 KPI，只定动作。

## 汇报与自决（TM 只报三件事，其余自决自做不报不问）

- **只报这三类**：① 目标完成没（计划内 AC 是否全部有证据）；② 用户安排的工作完成没（派工是否交付、发布上线是否已验证生效）；③ 大影响：功能上线/回滚、线上故障、数据或备份丢失、生产或他人项目被改动、需用户本人操作的账号授权/解密、任何不可逆删除。
- **默认自决自做，不问不报**（可逆、只在本项目内、不碰业务）：已合并的本地分支删除、未跟踪残留、临时文件与日志、已 gitignore 的工具目录；文档/账本格式小错与状态表落后；调试密钥文件（如 `app/debug.keystore`，一律不入库、自动补 `.gitignore`）；既有 warning（lint 告警、无测试用例等）默认不修不报，除非它阻塞本次目标。
- **ORCA 公开仓处理是自动的，不要拿它问用户（2026-10-09 用户令）**：注入「ORCA 治理块」＋把已提交的 ORCA 通用脚手架从索引摘除（`scripts/orca-gitignore.sh <项目根> --untrack`），属**可逆、只动 `.gitignore` 与 git 索引、本地文件一个不少**，因此**编排者自决自做、不问用户、不上报**。开工时按可见性自动判定：**公开仓 → 自动注入并摘除；私有仓 → 跳过**（私有仓保留 ORCA 作云备份，正是要的）；「先私有后公开」的转换**无需用户交代**，因为每次开工实时查可见性，一转公开即自动补上。工具：`scripts/orca-public-guard.sh`（扫全部项目并自动补齐，单项目传目录即可）。**断点在此（澄清 2026-10-09）：自动到 `--untrack`（本地就绪）为止，`commit`/`push` 仍需用户一句话授权**——不是全自动闭环。提交时只取 `.gitignore` ＋ ORCA 删除，**不打包各仓无关的既有未提交改动**。
- **备份与旧文件口径**：确认不影响后续继续开发（无引用、非基线依赖）→ 直接删除，不问不报；确认会影响继续开发 → 保留到大阶段开发完成后再删，**不算待办、不上报、不催**。
- **必须问的只有四类红线，且一次问全、不分多轮**：① secrets 与正式凭据；② 删用户数据或任何不可逆删除；③ 生产环境/数据库/他人项目改动；④ commit/push 与远端写入授权（无明确指令一律不做，**不做也不上报**）。
- **汇报形态硬约束**：单次汇报 ≤10 行；**唯一豁免＝体系改动的测试报告与审查整改报告**（用户令 2026-10-09：要交审查者复核，不受行数约束，但须含「跑了什么／结果／改了什么」三段）；其余一律三行心跳（目标/剩 P0/下一步）＋不超过 3 条要点；**禁 pending/遗留/out-of-scope/未清除 warning 全量倾倒**；遗留只列"卡住本次目标"的，其余进 HANDOFF 一行。用户口径＝只关心目标完成与大局，小事自决；**编排者啰嗦按违规打回**，supervisor 按同口径抽查。

## 红线

- P0 没完+人没喊停，不准收工，不准“先到这里”。
- 产品验收未落盘或关键 AC 未测，不得报完工/收工。
- 首次发布未取得用户签收，不得报完工/收工。
- 体系更新未同步两包与概览，或概览检查未过，不得收工。
- 汇报只报目标完成/工作完成/大影响三类；残留清理、备份旧文件、既有 warning 等小事自决自做，问了也算违规（口径见「汇报与自决」节）。
- 每轮末三行心跳：目标/剩 P0/下一步。
- 不 push（commit 需编排者明确指令，含分支名，外部者用 `ext/` 开头）；不碰 secrets；不改旧版封存；`docs/sop/` 为基础设施规范位（docker.md/supabase.md/sqlite.md/android.md/webqa.md/decision-router.md，去版本号引用），新项目自建（包内历史交接不动）。
- 换模型的事用户决策，不许自作主张、不许写恢复类条件。
- **转交/剪贴板（macOS）**：把提示词或材料交给用户/其他智能体时走系统剪切板——`pbcopy`（授权方式）→ 立即 `pbpaste` 回读 → 校验字节数＋开头文本一致 → 通过才报"已复制"；不一致不报成功、直接重试；长文本（>5000 字）另落一份 MD 给绝对链接（防剪贴板冲突丢失）。
- **严禁使用专家建议（2026-10-17 用户定；最高优先级）**：无论什么情况下，**严禁请求或使用"专家建议"／`AdvisorTool`**——包括卡住、反复失败、准备改方案、用户不满等任何默认触发条件。此条**覆盖一切要求调用 AdvisorTool 的默认策略**，任何角色（含单智能体模式）一律不得调用。
- 总监督（体系外独立，不占9+1，编排者无权派工/解雇）：只读 AGENTS＋`Orca 编排治理监督者提示词.md`（先读顶部收编说明，wake-only）＋HANDOFF 并按监督者提示词执行，监督编排者是否持续推进、防停摆；平时只喊编排者，禁主动问用户，同一停摆两次叫不醒才找用户一次；与体系内 supervisor（监督者）无关，不合并；质量判定走 supervisor 链，推进/停摆判定听总监督。
