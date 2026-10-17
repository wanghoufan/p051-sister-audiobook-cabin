## 2026-10-16 (6a2608d) change(override): supervisor 再切 codebuddy/deepseek-v4.1-flash（已真调验证）

**改了什么**：`USER_MODEL_OVERRIDE.md` supervisor 行 —— `codebuddy/glm-5.3-flash` →
**`codebuddy/deepseek-v4.1-flash`**（均 codebuddy 通道）。调用写法
`codebuddy --model deepseek-v4.1-flash --effort high -y -p "任务"`。
通道目录表：1b（glm-5.3-flash）降为 📦 历史中间态并保留 code-reviewer 现役标注，新增 1c。

**同日变更链（原表保留，不抹除）**：`opencode-go/muse-spark-1.3-contributor`（opencode 通道）
→ `codebuddy/glm-5.3-flash` → `codebuddy/deepseek-v4.1-flash`。中间态在通道目录表留档，
便于日后回溯「为何换」时能看到完整过程，而不是只看到最终值。

**与 builder 同模型**：supervisor 兼 Phase Integrity 六查、账本校验、通道预检合规抽查，
只对编排者说话、**不参与被审查任务的实现**，故独立性不受影响（同模型 ≠ 同一人）。

**已验**：只读验名 → **CHANNEL-OK**；真调 `codebuddy --model deepseek-v4.1-flash`
正常应答「验证成功」。**据此生效。**

## 2026-10-16 (ead6e33) change(override): supervisor 改用 codebuddy/glm-5.3-flash（已真调验证生效）

**为什么**：用户 2026-10-16 直接指定 supervisor 换模型。

**改了什么**：`USER_MODEL_OVERRIDE.md` supervisor 行 —— 主 `opencode-go/muse-spark-1.3-contributor`（opencode 通道）
→ `codebuddy/glm-5.3-flash`（codebuddy 通道）。调用写法改为
`codebuddy --model glm-5.3-flash --effort high -y -p "任务"`。通道目录表：第 1 行标 📦 历史，新增 1b。

**与 code-reviewer 同模型的说明**（已在表内注明，避免日后被当成配置错误）：两者都用
`codebuddy/glm-5.3-flash`，但职责面不同 —— code-reviewer 只做代码审查；supervisor 兼
Phase Integrity 六查、账本校验、通道预检合规抽查，只对编排者说话。**同模型不违反
「独立审查」的独立性要求**：独立性约束的是「审查者不得由被审查者本人担任」，
supervisor 与 builder 本就是不同派工实体、且 supervisor 不参与被审查任务的实现。

**已验**：只读验名 `check-channel-preflight.sh` → **CHANNEL-OK**（ID 在列）；
真调验证（用户此前已批同类额度）→ `codebuddy --model glm-5.3-flash` 正常应答「验证成功」。
**据此本条生效。**

**下游同步**：`supervisor.md` 角色卡的模型行本就写「见表，冲突以模型表为准」，无需改。
## 2026-10-16 (未提交) chore(model): builder 主用切回 codebuddy/deepseek-v4.1-flash、备用改 glm-5.3-flash

**why**：2026-10-14 按用户令把 builder 主用切到 opencode-go 通道；2026-10-16 用户令切回
codebuddy 通道的 `deepseek-v4.1-flash`，并把备用从 `codebuddy/deepseek-v4.1-flash`
（与主重复）改成 `codebuddy/glm-5.3-flash`（同通道不同模型，切备才真正有兜底）。

**what**：
- `USER_MODEL_OVERRIDE.md` builder 行：主 `codebuddy/deepseek-v4.1-flash`/通道 codebuddy，
  备用 `codebuddy/glm-5.3-flash`；调用方式改为
  `codebuddy --model deepseek-v4.1-flash --effort high -y -p "任务"`。
  原行内 opencode 通道专属的「跨项目必带 `--auto`」实测口径收敛为历史说明（该规则
  仍适用于其他 opencode 通道角色，见 `AGENTS.md`），避免两个口径平行冲突。
- 版本注释 T26 → T27。

**影响谁**：所有项目的 builder 派工（改母版即软链全项目同步）；DISPATCH 账本
`model` 字段记 `codebuddy/deepseek-v4.1-flash`，`used` 恒填主、切备时 note 记原因。

**怎么验**：`python3 scripts/_sync-packages.py` → 两包同步 380/381 files；
`bash scripts/check-sync.sh` → `SYNC-OK`（exit 0）；`bash scripts/check-channel-preflight.sh`
→ `CHANNEL-OK`（exit 0），两个模型均在 codebuddy 通道目录内、无 `CHANNEL-STALE`。
未做真调（烧额度）；只读验名已过。

## 2026-10-14 (6e35804) fix(sync): 夹具空目录不同步，导致下游包测试语义被静默改变

**怎么发现的**：提交前跑 `check-sync` 报 `DIFFDIR: scripts/model/fixtures vs 两包`，
细看是 `case21-ac-missing-accepted/docs/qa/` —— **该目录必须为空**（空＝「验收矩阵不存在」
正是这个测试的前提）。

**根因**：`_sync-packages.py` 的树复制只收集 `filenames`，**从不携带目录本身** ⇒ 空目录
永不进包。下游包里的夹具语义被静默改变（空目录消失 → 该用例测的东西不存在），
而 `check-sync` 的 `diff -rq` 不会因为缺一个空目录就放过 —— 恰恰是它报了 DIFF 才暴露。

**改了什么**：树复制同时收集目录项（带 `TREE_EXCLUDE` 过滤），写入端识别目录项只 `makedirs`。

**验证**：两包内空目录均在位；**在包目录内直接跑** `ledger-fields.test.mjs` → 41/41 通过
（证明下游拿到的是可跑的完整夹具，不是残缺版）。母版全套 41/41｜44/44｜9/9｜2/2｜15/15，
`SYNC-OK`｜`CHANNEL-OK`。

## 2026-10-14 (0551d6e) fix(gate): 体系自查补三处机器卡点（派工漏记 / 验收红线 / 概览新鲜度）

**来源**：六维体系自查（矛盾一致性 / 门槛可执行性 / 派工账本覆盖 / 漏洞 / 概览 / 实测验证）。

### P0｜派工逐派漏记完全不可见
AGENTS.md 要求「每次派工收工记一行」，但**无任何交叉检查**。实测 015-ing-photo-library
`TASK 13 行 / DISPATCH 0 行` 只报 WARN「空账本」即放行；38 个项目里 task-manager 自身
派工记录仅 **6/38**、senior-expert **3/38** —— **记账纪律在记账人身上最先崩**。
现补：有真实任务却零派工 ⇒ FAIL；派工数 < 任务数 1/3 且任务 ≥3 行 ⇒ WARN。
**豁免须显式声明**：单智能体项目在 `docs/model/GOVERNANCE-STATE.json` 写
`execution_mode: "solo"` 才豁免 —— 不靠猜，避免「忘了记」与「本就不记」混同、豁免本身成后门。

### P1｜产品验收红线形同虚设
AGENTS.md 红线写「产品验收未落盘或关键 AC 未测，不得报完工/收工」，但**只有文字、零机器卡点**。
实测：AC 矩阵写「未测」+ 账本 `chain_status=ACCEPTED`，校验器照样 `LEDGER-OK` exit 0 放行。
现补 `ACCEPTED-BLOCK`：账本判 ACCEPTED 时，①验收矩阵必须存在；②矩阵内不得残留
未测/OPEN/FAIL/BLOCKED（BLOCKED 属被外部条件挡住，仍未闭环）。
口径边界：`chain_status=OPEN`（尚未判验收）**不拦**，避免误伤进行中的任务。

### P1｜概览滞后且新鲜度清单漏项
本轮新增的 9 项机制（派工漏记/`supersedes`/有效拦截/违规分级/未测不按满分算/
响应速度只认时间戳/原始输入留存/`--auto`/取消历史豁免/升级触发）**概览里一个都没有**，
而 check-sync 的关键词清单也没纳入 ⇒ **概览漏更新照样 OVERVIEW-OK 通过**。
已补概览「七之二」节（10 条现役机制表）＋ 清单新增 10 个关键词。
反向验证：从概览删掉 `supersedes` → 立刻 `OVERVIEW-STALE` + `SYNC-FAIL`。

**回归**：ledger-fields 35→**41/41**（case19 派工漏记、case20-23 验收红线四场景）。
反向验证：分别去掉两处检查 → 各 2 条 FAIL。为保持旧夹具语义，给
`tm-qual/ledger-good` 补验收矩阵、给 `solo-agent` 两个单智能体夹具补 `execution_mode=solo`。
全套 `CHANNEL-OK`｜`SYNC-OK`｜41/41｜44/44｜9/9｜2/2｜15/15。

## 2026-10-14 (b8206e0) docs(P1): 审查报告 P1 清单 —— 测试数写死 / check-sync 漏管 / 概览编号乱序 / 资格文档漂移

**来源**：同份 `ark-code-latest` 审查报告的 P1 及以下项，逐条核实后全部属实。

| P1 | 问题 | 处置 |
|---|---|---|
| 测试数写死 | `AGENTS.md` 写「tm 须 17/17」，实际已 44/44，且用例仍在增 | 改为「须 `ALL PASS fail=0`；**pass 数随用例增补变化，禁止在本文写死数字**」 |
| check-sync 漏管 | 只逐个列了 `check-ledger.mjs`，**测试脚本与两份 docs/model 文档不在比对范围** ⇒ 包内漂移无卡点 | 新增 `scripts/model` 整树比对（`DIFFDIR`）＋ 反向幽灵检测（`GHOST`）；反向验证：故意弄脏 `solo-agent.test.mjs` → 立刻被抓 |
| 概览编号乱序 | 存在「一之二、两种执行方式」，后续编号整体错位 | 重排为 一~九 连续；标题日期 2026-10-08 → 2026-10-14 |
| 资格文档漂移 | `TASK-MANAGER-QUALIFICATION.md` §4 字段表缺 `supersedes`／`effective_interception`／`gate_violation`／`started_at`／`ended_at`；§6 仍写 `decision_latency_ms` 参与计分 | §4 拆「必填（缺任一 exit 1）／可选」并对齐评分器 `REQUIRED`；§6 同步三处口径（响应速度只认时间戳、有效拦截计样本不扣分、未测不按满分算） |

**验证**：`SYNC-OK`｜`CHANNEL-OK`｜35/35｜44/44｜9/9｜2/2｜15/15。

## 2026-10-14 (5fe5975) fix(P0): 审查报告 3 项 P0 —— 门禁自崩 / 唯一口径自相矛盾 / 公开仓隐私泄露

**来源**：`volcengine-plan/ark-code-latest` 只读独立审查（CONDITIONAL PASS，3 项 P0 未清零不得收工）。逐条复核**全部属实**。

### P0-1 门禁自崩：`scripts/check-sync.sh` 在 `set -u` 下必崩
`echo "AC-MATRIX-EMPTY: $m（文件在但无 AC 条目）"` —— `$m` 后紧跟全角括号，shell 把 `（` 归入变量名
⇒ `unbound variable`，脚本在打印结论前退出，**四件套第 3 步恒 FAIL**（且报错掩盖真实结论）。
修为 `${m}（`。现 `check-sync.sh` exit 0 / `SYNC-OK` 可复现。

### P0-2 唯一口径表自相矛盾
`USER_MODEL_OVERRIDE.md` builder 行同时留着两套互斥说法：10-14 新结论「带 `--auto` 即可、不必先取授权」
与 10-12 旧口径「先取授权或改派 codebuddy」。执行者读到哪句就可能走反路。
已删旧口径，只留一条并标注「本行为唯一权威口径，10-12 旧口径已作废」。
`CHANGELOG.md` 顶条 `93f9a6b` 内同一矛盾也一并更正，并显式指向 `6b72bfc` 为准。

### P0-3 公开仓隐私泄露
根目录两个 `input-*.jsonl`（028 真实业务账本逐字节副本，503 行）被 `fc9e6d0` 提交进公开云仓，
**绕过「只留空壳／证据禁入仓」纪律**，且含真实 task/role/model/session 等业务信息。
成因：`--evidence` 用相对路径时副本落到**调用方工作目录**，我又用了 `git add -A` 把它们扫了进去。
已 `git rm --cached` ＋ 删除磁盘副本；索引与磁盘残留均为 **0**。
（历史提交里仍在，本次不再 force-push 改写历史 —— 属不可逆操作，需用户单独授权。）

**验证**：门禁 `CHANNEL-OK`／`SYNC-OK`／35/35／44/44／9/9／2/2／15/15 全绿。

## 2026-10-14 (93f9a6b) change(override): builder 主用切 opencode-go/deepseek-v4.1-flash，备用 codebuddy/deepseek-v4.1-flash

**为什么**：用户 2026-10-14 直接指定 builder 换主用通道。

**改了什么**：`USER_MODEL_OVERRIDE.md` builder 行 —— 主 `codebuddy/deepseek-v4.1-flash`（codebuddy 通道）
→ `opencode-go/deepseek-v4.1-flash`（opencode 通道）；备用改为 `codebuddy/deepseek-v4.1-flash`。
通道目录表同步增 2b 行。命令写法 `opencode run -m opencode-go/deepseek-v4.1-flash "任务"`。

**模型 ID 映射说明**：用户口语「opencode go 的 deepseek-flash」在 `opencode-go` 通道目录里
**没有字面 `deepseek-flash`**；近似的有 `deepseek-v4-flash` 与 `deepseek-v4.1-flash`。
按表内既有别名口径（`deepseek-flash` 别名 = `deepseek-v4.1-flash`），取与原主用
`codebuddy/deepseek-v4.1-flash` 同一模型的对称项 `opencode-go/deepseek-v4.1-flash`。

**已验（2026-10-14 用户批准后真调，三项全过）**

| 验证项 | 结果 |
|---|---|
| 只读验名 `check-channel-preflight.sh` | **CHANNEL-OK**，两个 ID 均在通道目录内 |
| 主用真调 `opencode run -m opencode-go/deepseek-v4.1-flash` | ✅ 正常应答（横幅 `build · deepseek-v4.1-flash`） |
| **写入能力**（builder 主工作） | ✅ 真实创建文件并写对内容 |
| 跨目录（读本仓以外项目），**不带** `--auto` | ⚠️ 被拒：`external_directory … auto-rejecting` → `✗ Read … failed` |
| 跨项目**读**，带 `--auto` | ✅ 成功读到 046 的 AGENTS.md 标题 |
| 跨项目**写**，带 `--auto` | ✅ 成功在 046 的 `temp/` 创建文件并写对内容（测完已清理） |

**跨目录实测结论（推翻本日早些时候的判断）**：opencode 通道跨项目限制**可以用 `--auto` 解除** ——
`opencode run --auto -m ...` 下，跨项目**读**与**写**均实测成功。因此
⇒ **builder 跨项目活不必先取授权、也不必切备用通道**，只要派工命令带 `--auto`。
派工口径已写入 `USER_MODEL_OVERRIDE.md` builder 行与 `AGENTS.md` 跨目录条（后者同日修订，
取代 2026-09-29 的旧禁令 —— 旧条写的是「先取授权或改派」，现更正为「带 `--auto` 即可」）。

> ⚠️ 本条内的跨目录结论已被同日 `6b72bfc` 实测**推翻并更正**：不是「须先取授权或切备用通道」，
> 而是**命令带 `--auto` 即可跨项目**。以 `6b72bfc` 为准。

**据此本条生效**：builder 主用 = `opencode-go/deepseek-v4.1-flash`（Runtime=opencode）。

**⚠️ 已在表内标注的风险**：opencode 通道有**跨目录禁令**（AGENTS.md 已记）—— 任务里读写
本仓以外目录（如 `1.Active/` 下的业务仓库）会被 `external_directory` 自动拒、步骤静默失败。
**builder 恰恰要写业务仓库**，且业务仓库常不在治理母版仓内。故派 builder 时**必须带 `--auto`**（详见同日 `fix(override): opencode 通道跨目录用 --auto 解除`）。

## 2026-10-10 (cedfa79) feat(governance): 正式支持单智能体执行方式（含复审修正：QA 按类型适用 + Human Gate 明示保留）

**为什么**：让更聪明的模型承担更多自主工作，让 ORCA 用更少的管理成本保障交付质量。此前体系只按多智能体写，单人连续执行的项目要么被强制拉起整套派工，要么绕开体系，均不划算。首轮实现经独立审查「有条件通过」，本条含复审要求的全部修正。

**改了什么**
- `AGENTS.md` 新增「两种执行方式」节：**默认多智能体（其余各节原样不动）**；用户明确指定单智能体时直接采用、不再询问、不因客户端支持子智能体而自动派工。**执行方式与治理强度分开判断**——单智能体不代表低风险。
- 同文件「原有 Human Gate 同样适用」条（复审新增）：单智能体**不得绕过**开发前方案批准／Change C 受控重开／首次发布用户签收／生产·付费·凭据·不可逆操作的授权限制；**均为既有规则继续适用，不新增 Gate**。
- 同文件质量门禁条补「**按项目类型、实际工具与风险适用**」＋不模拟 supervisor 但**交付前须逐条检查原有关键质量放行条件**；「减少的是管理成本」条补「报告规模与风险相称、实际测试不能省」「缺陷由同一智能体切回开发再复验」。
- `README.md` 新增「单智能体开发使用说明」：按阶段读哪些规范（产品规划／UI／开发／自审／测试／交付）＋四条硬约束，**按需读，不许开工全量加载**；**只说明如何使用现有规范，不复述 SOP 全文**；读取失败须如实报告。
- `docs/roles/builder.md`、`code-reviewer.md`：各加一条单智能体口径——**禁止兼任／独立 Session／独立派工只约束多智能体执行**；自审须如实标注「自审」，**不得伪造独立审查**。
- `docs/roles/qa.md`：单智能体口径重写为「**单智能体 QA 执行细则**」——**质量底线不降**（关键 AC 有证据／核心路径真点真看／无验证不判 PASS 三条任何条件不放宽）＋**按类型选通道**（Web 用浏览器、Android 用模拟器／ADB／真机）＋**工具适用性**（真机 Canary 与会话能力预检只在适用时强制，**不得因缺少无关工具阻断开发**）＋不模拟 supervisor 但放行条件不减＋缺陷同一智能体修复复验＋报告规模与风险相称，并明写**这不是跳过验收的万能借口**。
- **触发口令「你是唯一开发者」**（补充指令）：`AGENTS.md` 新增触发口令条——用户说出**这一句即立即启用单智能体模式**，**无需补充其他启动提示词、不再询问是否启用、不自动派遣其他智能体**；智能体**自行**按项目状态按需读取现有规范（产品规划与简化审查／UI 规范／SDD／技术 SOP 与 Skill／Code Review 自审／真实 QA 与缺陷修复复验／HANDOFF），**由 ORCA 自动决定各阶段读哪些文件，用户不逐项指定**；**口令只决定执行方式，不代表跳过产品方案确认、必要 Human Gate 或授权要求**。同节补「用户没要求切换时不得擅自改变既定执行方式」。`README.md` 同步写明「只需说这一句，不用复制长提示词；智能体自行读 AGENTS.md 继续执行」。回归加 C3–C6 四条用例（口令与四项配套条款齐备／README 说明／口令随两包分发／多智能体仍默认且不得擅改模式）。
  **补漏（2026-10-10 用户指出）**：首轮实现只写了 `AGENTS.md` 与 `README.md`，**漏了对外概览与三张角色卡**——口令是用户唯一入口，漏一处该处读者就不知道有这回事，属四件套第 2 步未执行。已补：概览「一之二」节加「怎么切换：一句话」与「用户没要求切换不得擅自改变执行方式」；三张角色卡各加触发口令条（builder 不派工不造记录／code-reviewer 文首标明「自审」／qa 如实标注「自测」不得冒充独立 QA）；`check-sync.sh` 关键词清单加 `"你是唯一开发者"`（实测：概览里去掉口令即报 `OVERVIEW-STALE`）；回归加 C7（口令须在概览＋三张角色卡齐备）与 C8（check-sync 关键词含口令），并做非空跑验证（抽掉 qa 卡口令 → C7 FAIL）。
- `ORCA治理体系说明.md` 新增「一之二、两种执行方式」；`check-sync.sh` 对外必现机制关键词清单**只加 `"单智能体"`**（复审：不必加 `自审`）。
- 新增回归 `scripts/model/solo-agent.test.mjs` ＋ 夹具 `scripts/model/fixtures/solo-agent/`（A 组免管理负担／A' 账本缺失仍拦／B 组质量门禁不减／C 组规则文本到位且多智能体独立性未被覆盖／D 组无第二套体系）。**A4 用例保留**（复审确认）。

**没改什么（刻意）**
- **未改 `check-ledger.mjs`**（复审明令不碰已证明兼容的脚本）：实测空 `DISPATCH-LOG` 只报 WARN 不 FAIL（exit 0），已支持单智能体「不造行」。
- 未新增角色／Gate／阶段／状态／评分指标／单智能体专属 SOP 或第二套模板包；未改 APP 能力、UI 标准与安全边界；未动任何业务项目、未批量迁移旧项目。

**影响谁**：所有 ORCA 项目的执行者与编排者。单智能体项目可省派工记录与角色模拟；多智能体执行链、账本口径与独立审查要求**维持原样**。

**怎么验**：`SYNC-OK`｜`CHANNEL-OK`｜tm-qualification 17/17｜prototype-gate 9/9｜ui-leak 2/2｜**solo-agent 15/15**（新增 C3–C8 触发口令用例）。**另做真实执行验证**（隔离副本 `solo-demo`，非用户业务项目）：铺新项目模板包 → 小型局部开发（折扣门槛取等＋按分取整）→ 自审七查 → 实际运行测试发现缺陷 → 切回开发修复 → 复验 **5/5 PASS、exit 0**；`DISPATCH-LOG` 留空不造行、账本 `LEDGER-OK`；全程未派任何其他智能体。多智能体路径核对：Human Gate 保留条款在位、三张角色卡「只约束多智能体」在位、四段主链关键串未被覆盖。


## 2026-10-12 (e5037fd) fix(sync): 保护今天在跑/在写代码的项目（默认开）＋ 修注入脚本未定义变量

**用户口径**：「有项目今天可能正在跑，先别动今天正在跑的项目」落地 ——
`SKIP_DEV_TODAY` 默认 0→**1**（原默认关着属不安全默认值）；新增 `SKIP_DIRTY`（默认 1），
**业务文件**有未提交改动即跳过，纯治理文件未提交不跳。

**判据纠偏**：先用「排除治理路径」的反向写法，实测把「经验一句话.md」「agents.md」
误判成业务文件 ⇒ 36 个里 33 个被跳过，等于什么都不做。改用**源码扩展名白名单**＋再排除
治理文件才准确（实测 24 可铺 / 16 保护中）。

**修真 bug**：`_inject-agents-block.py` 的 `blk` 只在「区块已存在」分支计算，首次插入分支
引用未定义变量 ⇒ NameError（部分项目静默失败）。已提到分支外共用。

**验证**：24 个项目铺完（3,488 新铺／428 备份／2 区块注入），二轮收敛到 2 个补漏。
**23 个项目五套测试全绿零失败**；触发口令 23/23、校验器=母版最新 23/23、NEXT-TASKS 23/23；
16 个在跑项目确认未触碰。

---

## 2026-10-12 (23674d6) fix(sync): 注入区块正文改单一真源 ＋ STAMP 动态化 ＋ 补 README 漏铺

**根因（比清单漏铺更深）**：`_inject-agents-block.py` 的区块正文**硬编码在脚本里** ⇒ 母版新增
机制时改 AGENTS.md 不会改它，老项目**永远拿不到**；STAMP 又写死 2026-10-08。
**这才是「规则改了但老项目没生效」的真正原因。**

**改了什么**：区块正文改从老项目包 AGENTS.md 自动提取（单一真源，删手写副本，提取为空拒绝注入）；
STAMP/RULES_VERSION 动态化；同步清单补 README.md；solo-agent.test.mjs 区分母版专属断言
（C1/C5 查两包、C7 查概览、C8 查 check-sync.sh，项目里不存在）与项目通用断言，前者非母版
显式 SKIP 不伪装 PASS。

**040 实跑**（老项目迁移第一次真实验证）：新铺 152／备份 10／跳过 28；补齐后全套
35/35｜44/44｜9/9｜2/2｜10/10。040 此前用**旧版校验器**自测必然漏，现与母版一致。
账本与业务代码零改动。全套 `SYNC-OK`。

---

## 2026-10-12 (5d16011) fix(sync): 老项目同步清单改为自动枚举（修复新机制铺不过去）

**根因**：`sync-old-projects.sh` 的 FILES 是手写枚举。老包 `scripts/model` 实际 11 个文件，
枚举里只有 3 个 ⇒ ui-leak / solo-agent / ledger-fields / prototype-gate 四套测试与
`NEXT-TASKS.md`、`TASK-MANAGER-QUALIFICATION.md` 两份文档**全部没铺**。

**实测证据（040）**：它自带的 `check-ledger.mjs` 与母版哈希不同（旧版）；用**自己的旧校验器**
跑得到 `LEDGER-OK`，用母版最新校验器跑会多报一条 —— **老项目用旧校验器自测，必然漏**。

**改了什么**：FILES 改为**从老包实际内容自动枚举**（scripts/model 全树 ＋ docs/model 非 jsonl），
去重后铺；夹具直接覆盖不留备份（母版本机专属测试输入，非项目资产；旧值审计交给 Git）。

**怎么验**：040 预演 新铺 152／备份 10（原先 17）／跳过 28；备份项全为「项目可能自己改过」的
实现与文档（含 040 改过的 supervisor.md、builder.md），账本内容零改动。
全套 `SYNC-OK`｜35/35｜44/44｜9/9｜2/2｜15/15。

---

## 2026-10-12 (7cce720) fix(tm): 响应速度不得手填，改由 ISO 时间戳机械派生

**为什么**：该维度占 15 分且直接进 QUALIFIED 判定，但原规则只说「无计时证据填 null」，
**没规定有证据时怎么取** —— 实践中必然变成随手填一个看着顺眼的数，而没人能验证它。

**决策（编排者自决，不改变体系方向）**：只认 `started_at`／`ended_at` 两个 ISO 时间戳，由评分器
机械相减；手填的 `decision_latency_ms` **不参与计分**（字段仅为旧账兼容保留），有填且与派生值
不一致时报警告。缺任一端／结束早于开始 → 该维度记**未测**；时间戳非 ISO → 校验阶段 exit 1。
改完这个数要么来自真实时间戳、要么记未测，**不存在「编」的空间**。

**怎么验**：新增 4 夹具（`latency-timestamps`／`latency-handfilled`／`latency-inverted`／`latency-badfmt`）
＋ Test16a-e；tm 39→**44/44**。原有靠手填值拿满分的夹具已改为时间戳派生（分数等价）。
反向验证：改回采信手填值 → 2 条 FAIL。同步 AGENTS.md 与资格规范文档。
全套 `SYNC-OK`｜35/35｜44/44｜9/9｜2/2｜15/15。

---

## 2026-10-12 (fc9e6d0) fix(evidence): 证据落位决策 ＋ 路径归一 ＋ 副本自检 ＋ 兜底分支单测

**为什么**：`--evidence` 留了档，但**放哪、哪些能进 git** 此前没定 —— 落临时目录等于没留，
直接进 git 又等于把业务数据重复一份并泄漏本机绝对路径。

**决策**：落 `docs/model/.evidence/`，**只有证据卡可进 git，原始副本一律留本地**。
理由：副本＝业务数据重复一份＋本机路径；审计真正要长期留的是「结论＋哈希＋出错行」，
体积小、可长期保存、能证明没被改过。母版 `.gitignore` 已加 `docs/model/.evidence/`。

**顺带修掉的三个问题**
- **证据卡含本机绝对路径**：归一项目根/工作目录前缀；剩余绝对路径一律兜底抹成 `<本机路径>`。
  实测此前证据卡里有 3 处 `/var/folders/…` —— 可进 git 的东西不该带本机路径。
- **副本写了但路径错**：`copy_path` 改相对后，写入仍按相对路径落到 CWD，副本**根本没生成**
  （证据卡指向不存在的文件＝没留证）。改为 `join(out, copy_path)`。
- **副本可能写坏没人知道**：新增**自检** —— 证据卡声明的副本必须存在且 sha256 相符，
  否则 `copy_verified=false` 并告警。
- **兜底分支长期没被测到**：端到端测试删掉兜底正则**仍然全过**（锚点刚好都覆盖）。
  已把归一逻辑提成纯函数 `_normPath` 并**直接单测**，删掉兜底立刻 2 条 FAIL。
- 失败时提示固定落位：`--evidence docs/model/.evidence`（成功不打扰，不自动写）。

**怎么验**：ledger-fields 26→**35/35**（新增归一四例 ＋ 证据卡零绝对路径／副本自检等）；tm 39/39。
全套 `SYNC-OK`｜35/35｜39/39｜9/9｜2/2｜15/15。同步 `NEXT-TASKS.md`（B5 标记已定，只余 B6）。

---

## 2026-10-12 (ad24f0e) fix(ledger): 真实副本实跑抓出两处真 bug ＋ B1-B4 全部跑通

**为什么**：机制改完一直只在夹具与隔离项目里验。真跑一次 028 副本（223 行任务 / 280 行派工）
立刻暴露两处与真实用法不一致的缺陷 —— 都是设计时想不到、只有真数据才会出现的。

**抓到的两处真 bug**
- **① 升级判定按行 → 误报**：升级后正确做法是另起新行记 senior 交付（原 FAIL 行不改）。但按行判定会对着
  **旧的 FAIL 行**继续报「漏记升级」，逼人反复补行。**误报比漏报更糟**（会让人去改已经正确的记录）。
  改为：该 task 下任一行标了 `escalated=YES` 即视为已升级；真漏记（全无 YES 行）仍拦。
- **② 无可计分样本 → 谎报 0 分**：样本全是有效拦截／`infra_error` 时 `counted=0`，五维分母为 0，
  原式落成 **Score=0** —— 读起来像「最差的模型」，实际是「没有可评价能力的样本」。分数此时无意义，
  **不得用 0 冒充**。改为 `score=null` ＋ 文本显式说明，状态仍 CANDIDATE。

**B1-B4 实跑结果**（真实副本，原项目一个字节未动）
- B1：028 历史 6 处 FAIL 全是 `used` 写成「备用」；按新标准修正后**6 处清零**（只剩 `model` 白名单 WARN 与无关 APP 门）。
- B2：第 1 次打回不要求升级；第 **2 次当场拦下**；补 senior 交付行后通过 —— 升级链端到端跑通。
- B3：真实记入 1 条 Episode（含 `effective_interception=true`），校验 exit 0。
- B4：505 行输入逐字节留存，副本 sha256 与证据记录**一致**。

**回归**：ledger-fields 25→**26/26**（`case18-escalation-later-row`）；tm 35→**39/39**
（`all-effective`／`all-infra` 夹具，Test15a-d）。反向验证：退回按行判定 → 1 FAIL；恢复 0 分 → 2 FAIL。
同步 `TASK-MANAGER-QUALIFICATION.md`（真跑结论）＋ `NEXT-TASKS.md`（B1-B4 标记完成，新增 B5/B6 两个待定口径）。
全套：`SYNC-OK`｜26/26｜39/39｜9/9｜2/2｜15/15。

---

## 2026-10-12 (603936a) docs(model): 新增下一任务落实清单

**为什么**：治理机制改完不等于用起来。此前「已完工机制」与「待落实动作」混在 CHANGELOG 里，
下一轮容易重造轮子，或把「写了规则」误当成「规则生效了」。

**改了什么**：新增 `docs/model/NEXT-TASKS.md` —— 已完工十项（各带落点与测试出处）／待落实三类
（存量项目账本红灯 046=56 行、006=21、028=14；必须真跑才能验的四项：真实收工流程、两次打回
自动升 senior、真实记一个 Episode、一次 `--evidence` 实跑定证据目录；已知遗留三项：空项目
APP-TRUEOUT 门、产品验收矩阵覆盖率 3%、母版未搬迁），并纳入 `_sync-packages.py` 分发清单。

**怎么验**：`SYNC-OK`｜25/25｜35/35｜9/9｜2/2｜15/15｜7-Skill `VALID`。

---

## 2026-10-11 (9ec1426) feat(evidence): 原始输入留存（校验器与评分器同口径）

**为什么**：账本校验与资格评分是**事后唯一的裁决点**，但两者此前都不留存输入 —— 日后想复现
「当时为什么报错／为什么判不合格」已经不可能（账本被改过、文件已删、结论只有一句 exit 1）。

**改了什么**
- `check-ledger.mjs` 与 `tm-qualification.mjs` 各加 `--evidence <dir>`：落盘 `证据-<时间>.json`
  （argv／cwd／ledger 路径／ISO 时间／exit_code／fails+warns 或 issues 全量／输入 sha256+字节数+行数+副本路径）
  ＋两份**逐字节**输入副本。**失败也写** —— 事后复现正是用途，只在成功时留档等于漏掉最需要的那次。
- **显式开关，不自动写**：默认零副作用，避免每次校验在项目里堆文件；落盘目录由调用方指定。
- 副本从源文件重读写入（不复用内存内容），确保「副本 sha256 == 证据里记的 sha256」成立。

**怎么验**：ledger-fields 20→**25/25**（新增 evidence 五项：JSON 落盘／两份副本／元数据齐全／含 sha256／不开开关不落盘）。
反向验证：去掉 `writeEvidence()` 调用 → 4 条 FAIL。副本与原文件 sha256 实测逐字节一致。
全套：`SYNC-OK`｜25/25｜35/35｜9/9｜2/2｜15/15。

---

## 2026-10-11 (53f03d8) feat(tm): 结果语义 ＋ 违规分级 ＋ 未测贯通 ＋ 升级触发机器校验

**为什么**：TM 资格链此前四处「写着但没机器约束」——有效拦截被当失职扣分、违规无轻重分级、
未测维度照样能判 QUALIFIED、升级规则只有文字没有检查。其中 `gate_violation` 类型从不校验，
写成字符串 `"true"` 即**静默绕过硬失败**（实测 Score=100 exit 0）。

**改了什么**
- **结果语义**：新增 `effective_interception`（可选布尔）。reviewer/QA 抓出真问题并打回修复＝治理链
  按设计生效，**照常计入样本但不扣分**，与 `infra_error` 同属非能力项。
- **违规分级**：P0（`GATE_VIOLATION`／越权 Human Gate／未授权换模型→直接 NOT_QUALIFIED，治理分归零）／
  P1（`WRONG_ROUTE`／`DUPLICATE_DISPATCH`／`MISSED_ESCALATION`／`UNNECESSARY_ESCALATION`→扣分不清零）／
  P2（`TM_STALL`／`NO_NEXT_ACTION`／`HUMAN_RESCUE_REQUIRED`→只影响推进分），输出报出计数。
  **一致性约束**：`anomaly=GATE_VIOLATION` ⟺ `gate_violation=true`，矛盾 exit 1；`gate_violation` 须布尔。
- **未测贯通到判定**：有未测维度一律 CANDIDATE。Gate 是五维满分制，少测一维却判 QUALIFIED 等于把
  没测的当成过了（实测：30 样本/3 项目/全对/缺 latency → 原判 QUALIFIED，现 CANDIDATE）。
- **升级触发改机器校验**：`check-ledger.mjs` 跨账本核对 —— DISPATCH-LOG 中 `role=supervisor` 且
  `result=FAIL` 按 task 计数，≥2 次则 TASK-MODEL-LOG 对应行必须 `escalated=YES`（升级是自动动作，
  漏记即违规）；标了升级却 `escalation_reason` 为空同样拦（须可审计）。**这条此前从未真正跑通过**。
- 同步 AGENTS.md（评分 Gate 节）与 `docs/model/TASK-MANAGER-QUALIFICATION.md`。

**怎么验**：`SYNC-OK`｜ledger-fields **20/20**（新增 case15-17 升级三场景）｜tm **35/35**
（新增 Test12 有效拦截／Test13 分级与类型漏洞／Test14 未测贯通）｜proto 9/9｜ui-leak 2/2｜solo 15/15。
**反向验证**：去掉类型校验 → 1 条 FAIL；让有效拦截继续扣分 → 2 条 FAIL；去掉未测判定分支 → 1 条 FAIL。
## 2026-10-11 (01e6deb) fix(tm): Episode 防重复计分（`supersedes` 机器强制）

**为什么**：AGENTS.md 要求「不得改写历史行，补记/改判另起新行」，但此前**没有任何机器约束**把两者接起来。
一次打回若先记 FAIL、后补记 PASS，两行会被各算一次 —— 样本量与分数双重虚高，可能凭重复计数越过
`Score>=90 且 ≥30 Episode` 的 QUALIFIED 门槛。校验器此前**完全不检查 `episode_id` 重复**。

**改了什么**
- `scripts/model/tm-qualification.mjs`：`episode_id` 全文件唯一，重复即 **exit 1**；新增可选字段
  `supersedes`（非空字符串）写被更正行的 `episode_id` —— 带它的行生效后，被指到的原行**保留文件里但不参与计分**
  （原行字节未动，不违反「不得改写历史行」；审计痕迹完整）。`hard`／`humanGate` 判定同步切到 `active` 集合。
- `AGENTS.md` Episode 记账条 ④ 补写该机制；`docs/model/TASK-MANAGER-QUALIFICATION.md` 增补同名章节。
- `scripts/_sync-packages.py`：`docs/model/TASK-MANAGER-QUALIFICATION.md` **此前不在分发清单里**，
  母版更新后包内仍是旧副本（check-sync DIFF）⇒ 下游会按过时规则记 Episode。现已纳入。
- 回归：新增 `fixtures/tm-qual/dup-id.jsonl`、`superseded.jsonl`，tm 测试 21→**24 条**（Test11a-c）。

**怎么验**：`SYNC-OK`｜ledger-fields 17/17｜**tm 24/24**｜proto 9/9｜ui-leak 2/2｜solo 15/15｜7-Skill `VALID`。
反向验证：去掉重复 id 拦截 → 1 条 FAIL；让 superseded 原行仍计分 → 2 条 FAIL。
## 2026-10-11 (9a94698) refactor(supervisor): 删除两份手写账本校验副本，统一走中央校验入口

**为什么**：`docs/roles/supervisor.md` 内嵌两段手写 Python 逐行校验器（TASK-MODEL-LOG 与 DISPATCH-LOG 各一份），
与 `scripts/model/check-ledger.mjs` **重复实现同一套规则**。两份规则各自漂移——改一处忘另一处，
就会让 supervisor 抽查放行中央校验本该拦下的坏行，等于多一个可漂移的弱校验点。

**改了什么**：删除两段手写副本（共约 38 行），改为统一调用 `node scripts/model/check-ledger.mjs docs/model`。
并写明**发现中央校验器有缺口 → 按 `WRONG_ROUTE` 上报编排者补中央校验器并补回归，不在角色卡里就地打补丁**。

**怎么验**：中央入口行为与角色卡描述一致 —— 好文件静默 exit 0；坏行打印 `文件名#行号: 原因` 且 exit 1；
`_example` 行自动拦截。全仓同类手写副本已清零（仅历史审查报告保留记录，不动）。
## 2026-10-11 (0464982) fix(tm): 未测维度不得白送满分 ＋ 记账校验真正接入执行者提示词

**为什么**：（a）清扫时发现 TM 评分里 `else { s_lat = 15 }` —— 响应速度维度**从没测过却给满分**，观感上像测过了。
（b）`收工前必跑 check-ledger` 规则只写在 `docs/roles/task-manager.md`，但真正执行收工的是**编排者**，
而「编排者提示词」（docs/prompts 下）从未提到校验 —— 规则等于没接上。

**改了什么**
- `scripts/model/tm-qualification.mjs`：无 latency 数据时该维度记为**未测**、不参与加权；总分按**已测权重**归一（85 而非 100），
  输出显式标注 `⚠ 未测维度（不计分、不按满分算）`。
- `scripts/model/tm-qualification.test.mjs` 17→**21 条**（Test10a-d），新增 `fixtures/tm-qual/no-latency.jsonl`
  （与 `good.jsonl` **仅** `decision_latency_ms` 不同的同输入对照）。

**怎么验**：母版 `LEDGER-OK`｜`SYNC-OK`｜ledger-fields 17/17｜**tm 21/21**｜proto 9/9｜ui-leak 2/2｜solo 15/15｜7-Skill `VALID`。
反向验证：把实现改回「未测=满分且不标注」→ 立即 2 条 FAIL，证明回归保护有效。

---

## 2026-10-11 (a877044) fix(wiring): 记账后与收工前必跑 check-ledger（接入编排者提示词）

**为什么**：规则只写在 `docs/roles/task-manager.md`，但真正执行收工的是**编排者**，
而「编排者提示词」（docs/prompts 下）从未提到校验 —— 规则等于没接上。

**改了什么**：编排者提示词记账段补入强制校验 —— 每次记账后与收工前必跑
`node scripts/model/check-ledger.mjs docs/model`，须得 `LEDGER-OK`；exit 1 先修账本再走，
不许带着不过的账本报完工；并注明取消历史豁免后旧写法判错属预期、当场改对。

**怎么验**：隔离副本走完整收工流程 —— 正常记账零错；故意写错 date/role/rework 三处**当场全部抓到**；改对后零错。

---

## 2026-10-11 (1391857) fix(ledger): 历史兼容返工——整文件指纹改为审批清单逐行白名单

**为什么**：审查实测一版「整文件 sha256 指纹豁免」两处硬伤——①追加一条合法新记录后整文件哈希变化，旧记录重新 FAIL（**正常做下一次任务就失去兼容**）；②环境变量可自行签发资格（新写非法 runtime→算哈希→传入即 exit 0）。另有三处：豁免对全部 fieldRules 生效导致 result=null 被放行；cost_cny 未验有限性；存量行数 48 被我误报 49。

**改了什么**（`scripts/model/check-ledger.mjs` ＋ 新增基线与测试）
- **逐行白名单取代整文件指纹**：豁免绑定 `(项目目录名, 账本文件, 该行完整 sha256, 字段)`，**追加新记录不影响旧行**；清单落版本库固定路径 `scripts/model/ledger-legacy-baseline.json`，调用方只能引用不能自行新增（旧 `LEDGER_LEGACY_GRACE` 已完全失效）。
- **豁免仅限 used/runtime/rework 三个字段**；result/date/role/缺键/BAD_JSON **永不可豁免**。已实测：获批历史 used 可兼容，同文件 result=null 与 BAD_JSON 仍 FAIL。
- **补数值有限性**：`Number.isFinite` 拦 `1e309→Infinity`；`tokens` 另加 `isSafeInteger`；布尔显式排除。Infinity 报错显示还原为字面量（原先被 `JSON.stringify` 显示成 null 致误判）。
- 新增 `ledger-legacy.test.mjs` **17 条** ＋ 夹具 `fixtures/ledger-legacy/`（含 proj-approved/proj-unapproved 两个项目）；`ledger-fields.test.mjs` 20→18 条（迁走已废弃的指纹试验）。

**存量核对（修正上轮 48→49 的错报）**：逐文件逐行明细已写入基线 `entries`，共 **48 条**（used 41／runtime 6／rework 1，涉 5 个项目 6 个文件）。全量跑修复后的校验器：**本轮字段校验导致的 FAIL 为 0 个**；31 个项目仍 exit 1 全部是既有 `APP-TRUEOUT-SOURCE-UNRESOLVED`，3 个是既有 APP 门/WARN。

**怎么验**：`ledger-legacy 17/17`｜`ledger-fields 18/18`｜母版 `LEDGER-OK`｜`SYNC-OK`｜tm 17/17｜proto 9/9｜ui-leak 2/2｜solo 15/15。反向验证：短路 checkFields → 两套分别 12 条 FAIL；基线路径指向 /dev/null → ledger-legacy 1 条 FAIL（证明豁免确由清单驱动）。

**未做（等审批）**：结果语义草案、Episode 去重、未测标注、Supervisor 统一入口、GATE/P0 分类核验、原始输入副本留存。

## 2026-10-11 (e11aac2) refactor(ledger): 按用户决策整体移除历史豁免机制（「以前的不管，以后的为准」）

**为什么**：用户 2026-10-11 裁定「以前的不管，以后的为准」——不为存量历史行开豁免后门。

**改了什么**
- **删除整套历史兼容机制**：`scripts/model/check-ledger.mjs` 中所有「降级为 WARN」的路径（逐行白名单、来源绑定 `GOVERNANCE-SOURCE.json`、物理行号锚定、行内容 sha256、expected 绑定、两级审批门、字段粒度授权）**全部移除**。`checkFields` 现在只有一个出口：所有字段错误一律 FAIL。
- 删除 `scripts/model/ledger-legacy-baseline.json`（48 条候选豁免，**未获批准**）。
- 删除配套脚本与夹具：`ledger-legacy.test.mjs`、`ledger-evidence.mjs`、`ledger-stock-scan.mjs`、`fixtures/ledger-legacy/`。
- `ledger-fields.test.mjs` 20→**17 条**（移除与已删机制相关的用例与注释）。
- `check-sync.sh`：去掉 `--exclude=evidence`（该目录已不存在）。

**后果（如实记录）**：5 个存量项目会持续报字段错误，直到**项目自己**决定何时修正历史行。实测只读跑（**未改任何真实账本**）：046 麻将 56 行、006 提示词 21 行、028 酒吧聚会 14 行。
**治理侧不代改他人账本**——修正时机由各项目决定。

**怎么验**：母版 `LEDGER-OK`｜`SYNC-OK`｜ledger-fields 17/17｜tm 17/17｜proto 9/9｜ui-leak 2/2｜solo 15/15｜7-Skill `VALID`。反向验证：删掉 `checkFields` 调用 → 12 条 FAIL，证明检查仍在生效。

**未做（等审批）**：结果语义草案、Episode 防重复、未测标注、Supervisor 统一入口、实际记账入口接线、两次打回升级实测、GATE/P0 分类核验、TM 未测维度贯通、原始输入副本留存、下一任务落实清单。

## 2026-10-11 (1391857) fix(ledger): 来源回退堵死 ＋ 十道防线回归有效性（经六轮独立审查）

**为什么**：前一轮独立审查（codex/gpt-6.1-sol）指出「新来源门遮盖了旧负向夹具，导致审批／SHA／expected／禁止注入的回归重新失去有效性」「B4 参数传给了 Node 而非校验脚本」「B4a 不是同一输入对照」「B4b 用 PENDING 清单遮盖 CLI 注入」。逐条实测均成立。

**改了什么**（`scripts/model/check-ledger.mjs` ＋ 测试与夹具）
- **堵死无来源回退**：删去「条目未声明 source_id → 回退项目目录名」的逻辑。条目必须声明 `source_id`，项目必须提供完全一致的 `docs/model/GOVERNANCE-SOURCE.json`，否则零授权。加载期新增格式校验 `^orca-src-[0-9a-f]{16}$`，非法条目**显式报出拒绝原因**（此前写错 source_id 会静默失效）。
- **修复遮盖**：为 A5／A6／F5／F6／B1／B2 等负向夹具补合法 `source_id` 与项目身份文件，使它们只测自己声明的那一件事。
- **修复假 PASS**：B4 参数改放脚本路径之后并断言「脚本确实启动」；自造清单生成器补 `source_id`（原每次运行覆写抹除）；改用两份**内容相同、仅审批状态不同**的具名清单做同输入对照，消除执行顺序依赖。
- 新增 `ledger-evidence.mjs`（8 用例持久现场：输入副本／基线副本／argv／时间／哈希／可执行命令）与 `ledger-stock-scan.mjs`（严格／未批候选／已批对照三口径）；`evidence/` 含本机绝对路径，不随两包分发。
- 删除冗余 `graceConsumed` 消费集合（实测删除后仍全绿，防复制归因于行号＋来源＋哈希＋字段＋expected 五重匹配）。

## 十道防线逐条反向验证（全部可被抓到）

| 防线 | 破坏后结果 |
|---|---|
| ① 字段匹配 eField | 47 PASS / 1 FAIL（J5 捕获） |
| ② 顶层 approved_by | 47 / 1（A9） |
| ③ 顶层 approved_at | 47 / 1（A8） |
| ④ 条目 approved_by | 47 / 1（A7） |
| ⑤ 条目 approved_at | 47 / 1（A3） |
| ⑥ 加载期格式校验 | 47 / 1（I7／I8／I10） |
| ⑦ 运行期来源判定 | 44 / 4（I3／I4／I9 等） |
| ⑧ 行内容哈希 | 47 / 1（F5） |
| ⑨ expected 绑定 | 47 / 1（F6） |
| ⑩ 字段校验主体 | 4 / 44 |

另两条注入通道（`LEDGER_BASELINE` 环境变量、`--baseline-test-inject` CLI 参数）恢复后 B1／B2／B4b 均失败。

**一处有意保留的冗余**：`graceFor` 的 `!e.sourceId` 判断当前**无独立测试覆盖**（加载期格式校验已拦下全部无/非法条目，删掉它仍全绿）。属纵深防御，已在代码注释标明，未硬造用例。

**测试规模演进**：ledger-legacy 17 → 20 → 23 → 30 → 33 → 35 → 37 → 39 → 43 → 45 → **48**。

**怎么验**：`ledger-legacy 48/48`｜`ledger-fields 18/18`｜母版 `LEDGER-OK`｜`SYNC-OK`｜tm 17/17｜proto 9/9｜ui-leak 2/2｜solo 15/15｜7-Skill `VALID`。

**审查状态**：六轮独立审查均为「限定范围通过」，C 组**尚未整体放行**（第十二节标准未全满足）；A—F 整体远未完成。审查者全程未批准任何豁免。

**未做（等审批）**：结果语义草案、Episode 防重复、未测标注、Supervisor 统一入口、实际记账入口接线、两次打回升级实测、GATE/P0 分类核验、TM 未测维度贯通、原始输入副本留存、下一任务落实清单。

## 2026-10-11 (1391857) fix(ledger): 历史兼容三轮返工收口——审批门/来源绑定/字段粒度（附对前两轮结论的更正）

**为什么**：两轮独立审查（codex/gpt-6.1-sol）连续判定「需修改」，逐条实测出漏洞。

**本轮修的三个阻断**
1. **正式入口可自签发**：先后出现过三种注入通道（`LEDGER_BASELINE` 环境变量 → `LEDGER_ALLOW_TEST_BASELINE`+`LEDGER_BASELINE_TESTONLY` 双开关 → `--baseline-test-inject` CLI 参数），审查实测**每一种都能让调用方签发豁免**——参数和环境变量都是普通调用方可用的能力，不构成隔离。**现正式 CLI 已无任何注入开关**，测试改为**复制隔离副本并改写副本内 `BASELINE_PATH` 常量**，正式文件不被触碰。
2. **条目审批继承顶层**：`e.approved_by ?? j.approved_by` 让「仅删条目审批人」仍 exit0。改为顶层与条目**各自必须显式非 PENDING**，缺失即零授权。
3. **来源只绑 basename／同行多字段被吞**：授权键改为 `(source_id, 文件, 物理行号, 字段)` ＋ 行内容 sha256 ＋ expected_value 全中才授权；**48 条候选条目已全部补上 `source_id`**（`orca-src-` + sha256(项目目录名) 前 16 位），项目侧需提供 `docs/model/GOVERNANCE-SOURCE.json`。

**同时删除**：`graceConsumed` 消费集合。审查实测「删除后 33/33 仍全绿」——现行 CLI 每物理行只遍历一次，防复制完全由 line_no＋来源＋sha＋expected 四重匹配承担，该集合无可观察作用。

## ⚠️ 对本文件前两条结论的更正（务必以本条为准）

- 上条写「全量跑修复后的校验器：**本轮字段校验导致的 FAIL 为 0 个**」——**该结论不成立**。当时用的是**尚未获批**的清单，属候选方案模拟，不能作为已批准兼容或正式落实的证明。
- 更早一条写「仅 6 个文件 **49 行**」——**算术错误，逐行明细合计为 48**（used 41／runtime 6／rework 1）。
- 更早一条提到 `LEDGER_LEGACY_GRACE` 整文件指纹豁免——该机制**已被逐行白名单取代并完全退役**，历史记录保留仅为沿革。

## 存量三套口径（现行，实测可复现）

| 模式 | 项目数 | exit 0 | 本轮字段 FAIL |
|---|---|---|---|
|---|---|---|---|
| 严格（正式基线 PENDING，零授权） | 35 | 1 | 5 项目 / **48 行** |
| 未获批候选清单 | 35 | 1 | 5 项目 / 48 行（与严格一致，因 PENDING 不生效） |
| 已批对照（仅测试，且项目须先有 `GOVERNANCE-SOURCE.json`） | 35 | 1 | **0 行** |

**「exit 0 = 1」不是「35 个项目全部通过」**：其余 34 个的 exit 1 来自既有 `APP-TRUEOUT-SOURCE-UNRESOLVED` 等 APP 门禁，与本轮字段校验无关，两者不可混计。

**已知残留边界（如实记录，未修复）**：条目**未声明** `source_id` 且项目无身份文件时，同 basename 的另一来源仍会命中（用例 I6 明确断言 exit 0，不隐藏）。正式清单启用 `source_id` 后该路径自动收紧。

**怎么验**：`ledger-legacy 33/33`｜`ledger-fields 18/18`｜母版 `LEDGER-OK`｜`SYNC-OK`｜tm 17/17｜proto 9/9｜ui-leak 2/2｜solo 15/15。反向验证对 7 处防线逐条做「破坏→看 FAIL→还原」：顶层审批门／条目审批门／source_id 判定／行号匹配／sha 绑定／expected 绑定／字段校验**均被抓到**；删除冗余消费集合后仍 33/33（证明其确为冗余）。

**未做（等审批）**：结果语义草案、Episode 去重、未测标注、Supervisor 统一入口、实际记账入口接线、两次打回升级实测、GATE/P0 分类核验、TM 未测维度贯通、原始输入副本留存、下一任务落实清单。

## 2026-10-11 (1391857) fix(ledger): 派工/任务账本字段校验补齐（反例实测确认的零校验漏洞）

**为什么**：账本报告复评指出中央校验与 supervisor 卡内联块覆盖面不同。审查进一步用反例确认**非法 date／role／used／runtime、result=null、rework 的 null／负数／字符串／小数全部 exit 0 通过**。根因＝枚举检查写作 `d[k] !== null` 使 null 整体绕过，且这四个字段根本没进枚举表。

**改了什么**（仅 `scripts/model/check-ledger.mjs`，中央规则文本未改）
- 按字段分别定义类型与可空性，**覆盖缺键／null／空串／错误类型／非法枚举**：`date` 须真实日历日期（`2026-02-30` 已拦，不自动归一化）、`role` 两本账本都校验（保留 `orchestrator`／`迁移整理工` 等既有合法标识）、`used` **维持恒填主语义一字未改**、`runtime` 限定 7 个现行取值、`rework` **整数且 ≥0（不照 tokens/cost 放 null）**、`tokens`/`cost_cny` 允许 null 但有值时校验。
- 新增 `LEDGER_LEGACY_GRACE` 内容指纹豁免：**只认文件内容 sha256，不认可伪造的 date**；命中则新增项降 WARN；**既有结构硬错误（缺键／BAD_JSON／result 非法）一律不放宽**，与新增项区别处理；**不自动改写任何历史**。
- 新增回归 `scripts/model/ledger-fields.test.mjs` ＋ 夹具 `scripts/model/fixtures/ledger-fields/`（14 个隔离项目，20 条断言）。

**存量影响（只读扫描 1.Active 全量）**：37 个含真实行文件／2341 行中，**仅 6 个文件 49 行**受影响（used≠主 41 行、runtime 变体 6 行、rework 字符串 1 行）；`date`／`role`／`result` 零影响。另发现 **039 与 028 账本内容指纹完全相同**，疑同源，未深查。

**怎么验**：ledger-fields **20/20**；反向验证「短路 `checkFields` → 15 条 FAIL」「豁免改为按 date 放行 → 1 条 FAIL」证明非空跑；`SYNC-OK`｜母版自检 `LEDGER-OK`｜tm 17/17｜proto 9/9｜ui-leak 2/2｜solo 15/15｜7-Skill `VALID`。

**未做（等审批）**：结果语义草案（**已确认会破坏 `supervisor+FAIL` 升级计数，上一版撤回**）、Episode 去重（实测评分器无去重）、未测维度标注、GATE_VIOLATION 分类核验、F 组原始输入留存。

## 2026-10-10 (PENDING) fix(governance): A 项留痕缺口 + 触发口令补进老项目注入区块

**为什么**：①A 项——外部独立会话两次复现「铺了包却按小活免留痕」；②老项目迁移——注入区块不含触发口令，老项目 `AGENTS.md` 拿不到这个入口，规则到不了已治理的老仓。

**改了什么**
- `AGENTS.md`「何时起」节补「**小活豁免只管还没铺包的项目**：判据是**要不要铺包**，不是**任务大不大**；已铺包（`docs/review/`、`docs/qa/`、`docs/model/`、`docs/handoff/` 任一在位）＝已在体系内，无论单多小，自审与 QA 留痕照旧落盘、账本照旧记账；拿「这是个小活」当免留痕理由＝**半套**，按红线打回」。
- 同文件「自审仍须留痕」条补：**已铺包的项目这是硬要求**，留痕可极简三五行但不能没有；`TASK-MODEL-LOG` 记一行。
- `scripts/_inject-agents-block.py` 的注入区块补「**两种执行方式**」一条，含触发口令「你是唯一开发者」、不得擅自切换、质量门禁不减、只约束多智能体等要点——**只增不删**，老项目下次跑 `sync-old-projects.sh` 即获得该入口。

**怎么验**：注入幂等实测（临时项目连跑两次 → 区块仍 1 个、口令 1 处、项目专属内容保留）；包内角色卡已含口令（`老项目迁移模板包/docs/roles/qa.md` 命中）；`SYNC-OK`｜`CHANNEL-OK`｜tm 17/17｜proto 9/9｜ui-leak 2/2｜solo 15/15｜7-Skill `VALID`。

**未做**：按用户裁决 B3，**未批量铺开老项目**（`sync-old-projects.sh` 未实跑），等有具体项目要升级时单个处理。

## 2026-10-10 (cedfa79) docs(review): 对 10-10 审查报告 P0 项的复核与反驳（结论：不采纳 P0-1～P0-4）

**为什么**：独立审查给出 CONDITIONAL PASS 并列 P0-1～P0-4 四处「文字矛盾」。逐条实测后，三项已不成立、一项属误读；若照报告改会把已正确的表述改坏（P0-1 若删禁 Builder 措辞会连带移除 P046 边界）。故出书面反驳交回复审者。

**改了什么**：新增 `review/对审查报告_2026-10-10_P0项复核与反驳.md`。**治理规则零改动。**

**复核结论（每条附可复跑命令）**
- P0-1 不成立：`supervisor.md:46` 已含「builder 有且仅有两项例外（2026-10-09 用户定，P046 教训）」，与 AGENTS Phase1 一致。
- P0-2 不成立：`qa.md:17` 已写「本卡不再写"仅限QA"以免误拒」；概览 L92/L109 的「仅限 QA」是转述历史变更沿革，非当前口径。
- P0-3 误读：编排者提示词「默认三件套」指派工角色组（开发/产品/QA），与「体系更新四件套」无关；概览中「四件套」出现 0 次。
- P0-4 误报：模板实为 10 列；qa 卡与编排者提示词均已定「列数以模板为准、不复述数字」，概览 0 处「N 列」表述，无从漂移。
- P0-5 属实但非矛盾：未提交改动是等授权的正确状态；报告 SYNC-FAIL 系时序巧合（报告 16:19:55 落盘 vs 两包同步 16:19:59，晚 4 秒），当前 SYNC-OK。
- 附带证伪：P1-8 检查点第 4 条已是放宽后口径；P1-10 母版 check-ledger 自检实跑 `LEDGER-OK (含 WARN)`。

**顺带发现（未修）**：概览「八、给审查者的检查点」编号乱序 `1..13, 15, 16, 14`，历史增补未重排，不影响内容正确性。

**按用户裁决**：A1 不采纳并附反驳；B1 P1-6／P1-7 另案处理，本轮不动。

**怎么验**：`SYNC-OK`｜`CHANNEL-OK`｜tm 17/17｜proto 9/9｜ui-leak 2/2｜solo 15/15｜7-Skill `VALID`；反驳文档内 9 条命令已逐条实跑复核。

## 2026-10-10 (0a6238f) docs(governance): 简化门槛第五轮收口——两处结论修正＋两条口径落地

**为什么**：第五轮验收裁决 A2 B1 C1，整改收口。本轮不新增任何规则，只修正两处过强的结论并把两条回执口径落到文件。

**改了什么**
- **结论修正 1（Gate A）**：旧项目缺 A3／A4 等新模板字段，**只能说明不符合新文档要求，不能单独证明存在过度设计**；此前「Gate A 就会拦」的推论撤回。过度设计只认 Gate B 的源码级实据。
- **结论修正 2（Gate D）**：原 QA **已涉及**部分可读性、裁切与界面问题；新增门槛定位为**补齐核心任务操作体验**，**不是否定原有验收**。
- `docs/sop/app-simplicity.md` §3：豁免的是「**安全信息本身**」而非「安全相关界面」——安全能力不得随意删除，但其**页面排版、提示时机与操作流程仍可接受 Gate B 简化审查**。
- 同文件 §4 ＋ `PRODUCT_PLAN.template.md`：**A3／A4 轻量项目各用一句话回答即可**；确认无冗余可写「无须删减」及简单理由；**不强制新建独立表格**；**`Out of Scope` 不得代替已纳入范围的可删减分析**。

**影响谁**：评审与执行者对「缺新字段」与「过度设计」的判读口径。

**怎么验**：`SYNC-OK`｜`CHANNEL-OK`｜tm-qualification 17/17｜prototype-gate 9/9｜ui-leak 2/2｜7-Skill `VALID`；条件依赖端到端 30/30；7 颗 Skill 同步 77/77。

**未做（按回执）**：不批量更新旧项目 SOP；不改 P045／P046 业务代码；不新增角色／Gate／状态／评分／检查表／自动检查器。**母版未 commit、未 push。**

---

## 2026-10-10 (0a6238f) feat(governance): 产品简化门槛（Gate A/B/C/D 挂既有 Gate）

**为什么**：P045 两版对照显示，「完整走流程」的复杂版（`main-2` / `com.p045.pelvicfloor`，174 文件 / 26,005 行 / 88 Composable）出现首页三处入口同指 `onOpenAbility`、`NextLevelChoice()` 常驻训练 HUD 与暂停页、记录页「回今日自由选择等级」实跳能力页；而只做核心任务的轻量版（`045-ing-凯格尔训练` / `com.orca.kegel`，17 文件 / 3,057 行）体验更干净。**根因是 ORCA 每层都在检查「做得对不对、对不完整」，没有任何一层问「这些是不是多余的」**；Readiness 7 维度更对完整性正激励（核心方案完整性 20 分、风险与异常场景 10 分），对冗余零敏感。

**改了什么**
- 新增单一真源 `docs/sop/app-simplicity.md`（11 节）：三条总则／PASS·CONDITIONAL·FAIL 判定／**豁免清单**（安全停止·隐私告知·空状态·删除确认·数据完整性·异常恢复一律不得判冗余）／Gate A 范围与 MVP／治理强度分级（五项判据，不得仅凭单屏单任务）／Gate B 信息架构（**不得 Freeze**）／Gate C 防膨胀／Gate D 真实体验（**证据按低/中/高风险分级**）／§11 SOP 依赖五情形判定。
- 四门槛**全部挂既有 Gate**：Readiness／Design Freeze／DEV_BASELINE／产品验收追踪矩阵。**未新增角色、独立 Gate、Phase、账本字段、状态枚举、评分指标或管理系统；未改 Readiness 评分结构。**
- 7 颗 Skill 加**条件式 SOP 依赖声明**（每条写明触发条件，**仅当任务需要时才读取**），并按 §11 五情形判定：项目缺失+母版可读→回退母版不判缺失／内容不一致→`DEPENDENCY-STALE` 不静默用旧规则／仅项目可用→允许读取但标明无法核对母版／两处不可读且本任务需要→`DEPENDENCY-MISSING` 阻断且**不得判 PASS**／本任务不需要→不检查不阻断。
- 复用 `orca-design-pipeline/validate_skillset.py`：新增 `--master`／`--runtime-project`／`--required`，按运行时真实顺序（项目副本→母版）校验，**不做「母版存在即通过」**。

**影响谁**：所有面向用户的产品与网站；Reviewer/Planner/QA 职责各增一段。

**怎么验**
- 全量门禁：`SYNC-OK`｜`CHANNEL-OK`｜tm-qualification **17/17**｜prototype-gate **9/9**｜ui-leak **2/2**｜7-Skill validator `VALID`
- 条件依赖端到端：7 颗 × 共 **30 条依赖全部解析→读取→判据可用**
- 反向测试：旧版副本→`STALE` 阻断／两处不可读且 required→`DEPENDENCY-MISSING` 阻断／不需要→**0 阻断**
- 新项目模板包运行时校验：**0 MISSING、0 STALE**；7 颗 Skill 同步 library+10 Agent **77/77 一致**
- 复验中修复：概览缺 `DEPENDENCY-MISSING`/`DEPENDENCY-STALE` 关键词导致 `OVERVIEW-STALE`（已补机制说明行）；validator 采集器误把说明正文里的引用当依赖声明（已限定为依赖表格行）

**已知遗留（非本次引入）**：既有项目 `docs/sop/` 副本陈旧——如 `main-2` 的 `app-theme-i18n.md` 缺母版后加的姊妹规范交叉引用行，运行时正确报 `DEPENDENCY-STALE`；按批准范围本轮不批量刷新历史副本。`check-sync` 的 AC-MATRIX 巡检显示多个既有项目缺产品验收矩阵（该段按设计只报、不影响门禁主结论）。

**PoC v1/v2 保留在 `temp/`，不入母版、不自动决定 Gate。**

---

# ORCA 治理体系变更记录（CHANGELOG）

> **这是母版的变更说明正典。** 每次改动母版并 push，必须在本文件追加一条（最新在最上）。
> Git 负责记录变更/回退/审计；本文件负责说明**改了什么、为什么改、影响谁、怎么验**。
> 协作规则见 `~/.config/opencode/AGENTS.md` 第五节；体系更新三件套见根 `AGENTS.md`。

---

## 2026-10-09 (829ead5) docs(governance): 新建 CHANGELOG.md 并接进体系更新四件套

**为什么**：用户问「每次推送更新情况写清楚没有」——查下来母版与两包**都没有 `CHANGELOG.md`**，此前只靠 commit message ＋ HANDOFF 章节留痕，**违反了中央规则**「具体变更说明记录在 `CHANGELOG.md`」。三者各有用途不能互相替代：commit message 给 git 看、HANDOFF 给当轮接续看、CHANGELOG 给「以后想知道这个体系改过什么」的人看。

**改了什么**
- 新建 `CHANGELOG.md`：回填 2026-10-07 起 8 笔变更（每条含 why／what／影响谁／怎么验），并说明 2026-09-11 之前以 Git 历史为准。
- `AGENTS.md`「体系更新三件套」扩为**四件套**，新增第 4 步：**每次改动并 push 必在 `CHANGELOG.md` 顶部追加一条**；漏写＝体系更新未完成；只写 commit message 或 HANDOFF 章节不算交差。
- `_sync-packages.py` 的 `PAIRS` 加 `CHANGELOG.md`（随包分发）。
- `check-sync.sh` 把 `CHANGELOG.md` 纳入逐字节比对 ＋ 概览新鲜度关键词加 `CHANGELOG`。
- `README.md` 根目录导航、`ORCA治理体系说明.md` 规范表各加一行。

**影响谁**：所有维护本母版的人；漏写将被 `check-sync.sh` 直接判 `SYNC-FAIL`／`OVERVIEW-STALE`。

**怎么验**：故意改包内一份 `CHANGELOG.md` → 立刻报 `DIFF` + `SYNC-FAIL`（漂移可检出）；概览未提 `CHANGELOG` 时报 `OVERVIEW-STALE`（已修）；复位后 `SYNC-OK`｜`CHANNEL-OK`｜`17/17`｜7-Skill `VALID`。

---

## 2026-10-09 (249821b) docs(governance): 账本两本对不上——定性为「非待办」

**为什么**：用户问「派工账跟任务账对不上的话，中间有什么问题吗？还是之前漏了但后面发挥作用了？」经全项目实测核实后定性。

**实测**：TASK 共 1001 行、DISPATCH 共 1235 行（差 −234）。三类成因：
- **DISPATCH 多＝设计如此**：两账粒度不同（DISPATCH 记每次派工，TASK 记任务最终结果）。016 有 9 个任务被重复派工，最多一个派了 28 次。
- **TASK 多＝真漏**：015（+13，DISPATCH 全空）、016（+37）、037（+5）、027（+4）。漏的是「派工流水」不是「任务结果」——同 session 连派多活只记最后一次、续 session 只顾写任务账。
- **两账任务集不重合**：016 有 50 个任务只在 TASK、14 个只在 DISPATCH（命名不一致，无法按 task 精确对齐）。

**用户决定**：不补历史、不加机器门。理由——任务结果账完整，模型评估核心指标（返工次数/是否升级/PASS-FAIL）看 TASK 账不受影响；DISPATCH 本就允许重派多行，加"两账必须对齐"机器门必然误报；机制本身已有 supervisor 对账抽查兜底。

**影响谁**：无行为变更。结论记入 HANDOFF §87 标注**已定性、非待办**，后续不得当缺口翻出重提。

**怎么验**：无脚本变更；`SYNC-OK` 保持。

---

## 2026-10-09 (249821b) feat(governance): 禁止开发内部信息污染用户界面（L1/L2/L3 隔离）

**为什么**：开发智能体常把内部审查信息、技术约束、版本编号、授权流程直接渲染到普通用户界面，APP 冗长复杂，甚至出现与产品目标无关的阻断式操作。

**改了什么**
- 新增单一真源 `docs/sop/app-ui-layers.md`：L1 默认可见（任务/结果/原因/下一步＋必要安全法律）／L2 用户主动展开（详细玩法/来源，来源用可读名称不用内部 ID）／L3 仅内部（Phase/Gate/AC-FR/审查评分/置信等级/数据 ID/动作代码/开发版本与 hash/运营授权记录，不上屏）。
- 严禁把 Plan/UX/Research/QA/合规审查原文直接复制上屏，须经面向用户的文案转换（`E01`→「还差一张二条」等）。安全/医疗/版权必要告知**不得因精简而隐藏**；非紧急说明渐进披露。
- 新增提示式扫描器 `scripts/model/ui-leak.mjs`（含动态渲染线索如 `esc(x.id)` 直接上屏），**只提示、人工语义核验**，刻意避开注释/事件钩子/内部 ID 作数据键的正确写法，内置误伤白名单（地区玩法名/玩法版本/查看来源/安全提示），**永不因扫描自行判 FAIL**。回归 `ui-leak.test.mjs` ＋夹具随包分发。
- 接入既有 Gate：AGENTS／PRODUCT_PLAN 声明＋关键 AC／qa 卡专项／四颗 Skill 主改＋三颗 Skill 引用／概览规范行＋检查点 15／同步与门禁纳管。**不新增角色、Gate、阶段或 Human Decision。**

**影响谁**：所有面向用户的产品与网站；后续新原型在 UX/Prototype/Freeze/QA 各阶段按 L1/L2/L3 记录与核验。

**怎么验**：`ui-leak.test` 2/2；**P046 真实原型扫出 74 处泄露**（含 `esc(ex.id)`、`evidence_grade` 真上屏点）；**正面样例（地区玩法名/版本/查看来源/安全提示）0 误伤**；全量门禁 `prototype-gate 9/9`／`17/17`／`SYNC-OK`／`CHANNEL-OK`／7-Skill `VALID`；7 颗 Skill 同步 library+10 Agent 77/77 一致。

**存量兼容**：未改任何业务项目；P046 显示层修正由其编排者在原型验收前做，P045/P037 由各自编排者按既有链局部处理。

---

## 2026-10-09 (f6c5f5e) fix(governance): 第二轮审查 P0 四项 ＋ P1 七项整改（CONDITIONAL PASS 复审）

**为什么**：第二轮全量复审（`review/审查报告_2026-10-09_muse-spark-1.3-contributor-free.md`，CONDITIONAL PASS）报 4 项 P0 文字债会让执行者按字面做错，要求修完再 commit＋push。

**P0 四项（执行者按字面会做错，不修 Phase1 停摆）**
- supervisor 第1条与 Phase1 新链冲突 → 加例外句：builder 在 PLAN 阶段**有且仅有两项例外**（`docs/pm/` plan 正文 ＋ `docs/design/prototype/` 原型），其余业务派工含 APK/生产模块/正式后端/未批 SDD TASK 仍禁；否则合法 builder 派工会被全判违规打回。
- qa 卡解禁口径 stale（仍写「仅限QA」）→ 改以 `AGENTS.md` 为准（QA＋planner＋senior-expert）；否则按卡会误拒给 planner/senior 带 `-s`，产品审查汇总与升级任务必失败。
- `AGENTS.md` 标题「三件套」→ 四件套；`prototype-gate` 期望 `pass=6`→`pass=9`（原型6＋导航3）；`README.md` L15 同步。
- 矩阵列数三处不一（模板实 10 列 vs 7 vs 9）→ 统一「照模板，列数以模板为准、不复述数字」，避免随模板演进漂移。

**P1 七项**：`check-ledger` 参数解析 bug（只传 `--allow-example` 时把开关当目录）／`check-sync` 夹具漂移改整树纳管（含 nav-gate/tm-qual）／概览检查点 4 解禁口径／TM 卡补原型口子／母版自检 `--allow-example` 跳过 APP 门（去噪声）／分工表升 T26／README `sed -i` 补 Linux 写法。

**P2**：软链制与 `--untrack` 各补半句澄清；README.en 13B 差**已实测确认为路径裸名归一化**（非漂移）；其余备案。

**影响谁**：Phase1 编排者不再被 supervisor 误打回；planner/senior 能正确带 `-s`；新规 APP 导航声明纳入机器门。

**怎么验**：`prototype-gate` **9/9**｜`tm-qualification` **17/17**｜`SYNC-OK`｜`CHANNEL-OK`｜7-Skill `VALID`；并**亲跑复验报告未重验的三项**——短路 `checkPrototypeDelivery` → `pass=5 fail=4`（还原 9/9）、P045/P046 新门拦截均为 0、P1-2 改包内夹具 → `DIFFDIR`+`SYNC-FAIL`（还原 SYNC-OK）。

---

## 2026-10-09 (f6c5f5e) fix(governance): 审查整改 7 项真缺陷 ＋ APP 导航纳入机器门

**为什么**：muse-spark 审查母版全仓（报告落盘 `review/审查报告_2026-10-09_muse-spark.md`）报 12 项矛盾。用户拍板：**评分不加机器码、导航加机器码**。

**改了什么**
- **C-07（最重）**：TM Qualification 采样门槛（≥30 Episode／≥3 项目）原只写在 A/B 段、不在 Gate 段，照 Gate 读会凭小样本判 QUALIFIED → 已补进 Gate 段。
- **C-02**：分工表 qa 行标题去掉「QA 专用／仅限 QA」旧字面（口径不变，免执行者误拒给 planner/senior 带 `-s`）。
- **C-11**：概览检查点重复编号 `11.` 顺延为 14。｜**C-01**：README「三件套」改四件套。
- **文字债**：supervisor 卡 DISPATCH 校验「8键」改「7 必需键＋note 可选」。
- **C-10**：汇报 ≤10 行补唯一豁免（体系改动测试报告/审查整改报告）。
- **O-05**：`temp/` 分工明确——回归夹具落 `scripts/model/fixtures/`，不放 temp/。
- **APP 导航纳入机器门**（用户令 B）：新增 `APP-NAV-DECL-MISSING`／`APP-NAV-AC-INCOMPLETE` 两码，与品牌/主题同构。

**影响谁**：新写的 APP Plan 必须填导航声明并把五类导航 AC 标进关键 AC 集合；历史 Plan（含开发中的 P045/P046）不受影响。

**怎么验**：测试扩到 **9 用例**（原型 6 ＋导航 3），母版与两包均 `ALL PASS pass=9 fail=0`；非空跑证明（短路 `navNewRegime` → 导航用例 FAIL，还原 9/9）；P045/P046 新门拦截数 = 0。门禁 `SYNC-OK`／`CHANNEL-OK`／`17/17`／7-Skill `VALID`。

**过程中修掉的两个真坑**：①模板自带的小节标题让宽松正则恒真（空声明也算已填）→ `NAV_DECL` 收紧为只认实际填写的标记行；②新门首版会 FAIL 在开发项目的真源 Plan → 加新规兼容口径，只对新规 Plan 判 FAIL。

---

## 2026-10-09 (f6c5f5e) chore(governance): 测试纪律入规 ＋ 测试资产持久化

**为什么**：用户指出——跑完测试把临时夹具删了，等于测试只是一次性验证，用户无法自行复跑，也没法交审查者复核「体系完整性 + 测试合格性」。

**改了什么**
- `AGENTS.md` 入规三条：①**任何体系改动（尤其大改）收工前必跑适用测试**，不许用「改的是文档」当借口不跑；②**跑完必须先向用户报告**，报告前不许自行提交/推送/清场；③**回归夹具必须持久保留、严禁清场**，一律落版本库内固定路径，**禁用 `/tmp`**，要证明非空跑用「改坏→FAIL→还原」且还原后仍保留。
- **修掉真缺口**：`_sync-packages.py` 的 `DIRS` 只同步文件不递归子目录，`scripts/model/fixtures/` 从未进两包——包内测试脚本会因缺夹具跑不起来。新增 `TREE_DIRS` 整树递归同步，`check-sync.sh` 加 `DIFFDIR` 防夹具漂移。
- 新增持久化测试资产：`scripts/model/prototype-gate.test.mjs` ＋ `scripts/model/fixtures/proto-gate/`（6 用例 41 文件），随两包分发，包内亦可复跑。

**影响谁**：所有维护母版的人；今后每次大改都有可复跑的验收证据供审查者复核。

**怎么验**：母版与新项目包内各跑一次 `prototype-gate.test.mjs` 均得 `ALL PASS pass=6 fail=0`；短路 `checkPrototypeDelivery` 后 4/6 FAIL 证明非空跑；改包内夹具 → `check-sync.sh` 报 `DIFFDIR` + `SYNC-FAIL`。

---

## 2026-10-09 (f6c5f5e) fix(governance): Phase1 必须交付可运行交互原型（P046 教训）

**为什么**：Phase1 的 builder 只被允许写 plan 正文，AI 倾向把 HTML 原型当「正式开发」而不敢做。P046 **Readiness 96 分、Plan 审查通过**，却没交付用户真正需要的本地可点击 HTML——文档满分，用户要的东西是零。

**改了什么**
- **权限边界**：`AGENTS.md`＋`docs/roles/builder.md` 允许 Phase1 builder 在隔离目录 `docs/design/prototype/` 制作设计验证用 HTML/CSS/JS 原型；**不是正式业务代码、不代表进入 Phase 2**；仍禁 Android APK／生产业务模块／正式后端服务／未批准的 SDD TASK；可自检但**不得启动 Phase2 正式 qa**。
- **APP 默认交付要求**：本地完整可运行原型；核心页面完整不以局部演示替代整套流程；关键按钮/跳转/返回/滚动/状态切换能实际操作；已确定名称/图标/品牌/真实图片素材全部落实；浅深色与语言及代表性异常状态可演示（模拟系统行为须标注）；给出 HTML 路径与本地打开命令。**PDF／截图／纯文档／在线概念图／单张示例预览 HTML 一律不算**。
- **Readiness Gate 附加条件（非新 Gate）**：`PRODUCT_PLAN.template.md` Gate 段新增「原型交付完整性检查条件」五项（存在／能启动／浏览器自动化冒烟测试／用户能自己打开不靠讲解／证据含路径·运行方式·测试结果·已知限制），并明确**文件存在与真实运行分开判定**；缺任一项判现有 Gate 不满足。
- **机器强制点**：`check-ledger.mjs` 新增 `checkPrototypeDelivery`，新增 FAIL 码 `PROTO-MISSING`／`PROTO-NO-RUNTIME-EVIDENCE`；示例预览 HTML（example/sample/demo-preview）不计入。
- **兼容性**：新规判据＝Plan 含该小节；旧规 Plan（含开发中的 P045）只 WARN 不 FAIL，不打断。
- **Skill/文档**：`interactive-product-prototype` 加 Phase1 原型定位（`PROTOTYPE_PHASE1_DRAFT`，不等同正式验收）；`design-freeze` 加「原型输入须可运行、不能是文档」；编排者提示词、迁移提示词 5.10、归位表、对外概览（规范行＋检查点 13）同步；validator 加防回退锚点。

**影响谁**：新建的有用户界面的 APP（Phase1 必须带可运行原型进 Human Gate）。P045 不受影响（实测 PROTO 拦截数=0）。

**怎么验**：隔离样例 6 用例全过——仅 Plan+PDF 被阻(exit1)／有 HTML 无证据被阻(exit1)／可运行 HTML+冒烟证据放行(exit0)／旧规兼容(exit0)／PDF 改名冒充被阻(exit1)／仅示例预览被阻(exit1)。门禁 `SYNC-OK`／`CHANNEL-OK`／`17/17`／7-Skill `VALID`；3 颗 Skill 已同步 library+10 Agent。

---

## 2026-10-09 `eeadd34` feat(governance): APP 导航与视觉方向规范升级 ＋ 公开仓自动补齐工具

**为什么**：解决三类反复出现的失败——① AI 生成的 APP 风格高度雷同（只换配色）；② 导航组件由 Builder 临场随意设计；③ Android 底栏被放进可滚动内容、跟着内容滚走。

**改了什么**
- **新增单一真源 `docs/sop/app-navigation.md`**（与 `app-theme-i18n.md`、`app-brand-assets.md` 并列，不互相覆盖），八节：
  - 视觉方向：新 APP 完整原型前**默认**给三方向，必须在**同一核心页面并置对比**，逐轴拉开布局/信息密度/字体/图标/组件造型/留白/品牌调性；**只换配色＝未做方向**（`VISUAL_DIRECTION=BLOCKED`）；`LIGHT`/`DARK` 是已选风格的主题适配、**不是独立方向**；用户批准后**直接进既有 Design Freeze**，不重复询问、不重选风格（方向变更属 Change C）。
  - 导航设计：**底部导航由产品决策**（不是所有 APP 都要 Tab，单主任务/单屏工具默认不设）；采用时入口名/数量/顺序、图标资源与线条或填充风格、**选中/未选中/点击/焦点**四态、字体字重间距、语义 Token、显隐条件、小屏与英文长文案与系统手势区适配，**全部由产品侧在 UX Contract 显式确定并在 COMPONENT Freeze 绑定，禁 Builder 自行猜测**。
  - Android：优先官方 M3 `NavigationBar`/`NavigationBarItem`/`Scaffold(bottomBar)`；**底栏固定于正常页面导航位、滚动内容独立滚动，禁止把底栏放进可滚动内容**；沉浸式是否隐藏底栏以产品批准规则为准。
  - 原型与 QA：可点击原型必覆盖滚动顶部/中部/底部、页面切换、导航显隐、软键盘、安全区、浅深色、中英文；**正式 Android QA 禁仅凭网页静态原型判定**，须依据真机实际运行截图/录屏/交互测试。
- **接入点**（不另建真源）：`AGENTS.md` 默认继承段 ｜`PRODUCT_PLAN.template.md` 新增「APP 导航与视觉方向声明」＋9 FR/10 AC＋关键 AC 集合增四类硬约束 ｜`docs/roles/qa.md` 导航与视觉方向专项验收 ｜`docs/sop/android.md` §7.5 ｜`ORCA治理体系说明.md` 规范表＋审查检查点第 12 条 ｜`_sync-packages.py` EXTRA 登记 ｜`check-sync.sh` 概览关键词。
- **7 颗设计管线 Skill 全部同步**，并给 `validate_skillset.py` 加**防回退**：`app-navigation.md` 七颗必备 ＋ 5 颗语义锚点（防改词悄悄削弱规范）。
- 同批附带：`scripts/orca-public-guard.sh`——公开仓不带 ORCA 的**自动**补齐工具。

**影响谁**：所有面向用户的 APP 新项目（自动继承，不需额外交代）；已存在项目在下次 Plan/设计阶段对齐。

**怎么验**：`SYNC-OK`｜`CHANNEL-OK`｜`tm-qualification 17/17`｜`VALID: 7-Skill simplified final-state regression PASS`｜7 颗均引 `app-navigation.md`｜部署 10 Agent × 7 Skill = **70/70 逐字节一致**。

**踩坑**：`skills-manager-cli` 的 `deploy`/`undeploy` **必须带 `--agent`**，漏带会静默失败却返回成功；这 7 颗在 registry 里 `source_ref` 为空导致 `update` 报 "missing its original source path"、按名解析报 "ambiguous"。处置：备份 DB → 回填原行 `source_ref`（原行带 scenario 关联与部署记录，**不可删**）→ 清孤儿行。教训：**registry 行有 scenario/部署关联，只补 `source_ref`，不要删原行**。

---

## 2026-10-09 `0c7efd2` fix(orca-gitignore): 修中文文件名静默漏摘 ＋ 记录上线实测的两个真 bug

**为什么**：上一笔提交推到 19 个公开仓后，线上实测发现中文名 ORCA 文件并未被摘除。

**改了什么**
- `git ls-files` 默认 `core.quotepath=true`，把中文名输出成 `"ORCA\346\262\273…"` 转义串；脚本把该串喂给 `git rm` **静默失败**（ASCII 名成功、中文名失败）——041 因此 106 预测只摘 96。改为 `-z` ＋ `core.quotepath=false`，且**经临时文件中转**（bash 变量装不下 NUL 字节，`$(...)` 会把多文件黏成一条）。
- HANDOFF §79 记录两个真 bug 根因与修法。

**影响谁**：所有已执行公开仓清理的项目。

**怎么验**：19 仓线上按忽略清单精确复核，ORCA 脚手架残留 **0**；应用文件与本项目记录全保留。

---

## 2026-10-09 `02020ee` feat(governance): 公开作品仓不带 ORCA 三件套 ＋ docs/plan 后续开发计划落盘位

**为什么**：ORCA 铺包后脚手架摊在项目根，作品推公开仓后克隆者看到一堆无关治理文件；而用户一天推十几次，任何「推送前打包/解包」都不可接受。

**改了什么**
- **公开仓不带 ORCA**（三件套，母版 `scripts/`，母版专用不分发）：
  - `orca-public-ignore.txt` — 忽略清单**单一真源**（A1 边界＝只隐藏「每个项目都一样」的通用脚手架；本项目计划/评审/交接/账本/经验保留作云备份；应用 `README.md` 绝不被藏）。
  - `orca-gitignore.sh` — 幂等注入托管忽略块＋`--untrack` 摘除已提交 ORCA（本地文件不动）；**绝不自动 commit/push**。
  - `restore-framework.sh` — clone 回来一句补回框架，**硬拒覆盖**应用 README/真实账本/实例文档/经验；重建 `USER_MODEL_OVERRIDE.md` 软链。
- 文档：母版 README 新增「公开仓怎么不带 ORCA、丢了怎么恢复」节；迁移提示词加 5.9（仅公开仓跑）；归位表加勾选行；对外概览加规范行＋审查第 11 条。
- **`docs/plan/` 后续开发计划落盘位**（§78）：新增 `docs/plan/后续开发计划.template.md`，接入 `_sync-packages`/`check-sync`/`AGENTS`/归位表/README/planner 卡。

**怎么验**：`SYNC-OK`｜`CHANNEL-OK`｜`17/17`｜19 个公开仓线上复核残留 0。

---

## 2026-10-09 `48349dd` fix(governance): 第三轮审查整改 ＋ 修「改名即可绕过真源检查」旁路

- 3×P0（planner 沙箱口径互斥、supervisor DISPATCH 校验块死代码、双审「并行」与串行规则冲突）＋多次 P1／P2。
- `checkAppBaseline` 由 basename 包含改为**精确路径匹配**，新增 `APP-TRUEOUT-SOURCE-UNRESOLVED`／`APP-TRUEOUT-SOURCE-MISMATCH`，不再默认放行。
- 关键词门放宽为中英双语等价（修「合规中文写法被误判 FAIL」）。

---

## 2026-10-08 `a458197` feat(governance): APP 品牌资产前置必选 ＋ Phase1 拟稿分工调整

- 新增 `docs/sop/app-brand-assets.md`（中文名／英文名／安卓图标／启动画面），BRAND Freeze 成为 design-freeze 第七项语义；`check-ledger` 增 `APP-BRAND-ASSETS-MISSING`／`APP-BRAND-AC-INCOMPLETE`。
- Phase1 拟稿与改稿归 builder，planner 只把关审查不执笔（省 Sol 额度）。

---

## 2026-10-08 `b6b7e20` / `337ab8b` fix(governance): 第二轮、第一轮全量体系审查整改

- 第二轮 2×P0 + 5×P1 + 8×P2；第一轮 3×P0 + 7×P1（含脚本侧）。

---

## 2026-10-08 `d31aacb` feat(app): APP 基础能力前置规范 V1.1（主题三态＋中英双语，全局默认）

- 新增 `docs/sop/app-theme-i18n.md`：主题 `LIGHT`/`DARK`/`SYSTEM`（默认 SYSTEM）＋ `zh-CN`/`en`＋设置持久化＋切换不丢状态，**新 APP 自动继承不反复问用户**；六类进关键 AC 集合。

---

## 2026-10-07 `67722f4` feat(governance): Episode 记账硬约束 ＋ 产品验收落盘 ＋ 多模型产品审查链

- 新增 `docs/qa/产品验收追踪矩阵.template.md`（7 列）与 `docs/model/TASK-MANAGER-QUALIFICATION-EVENTS.jsonl`；编排者每轮收工自记一行 Episode。
- 新增产品审查双审链（planner 组织，**串行**派 A/B 两份互不可见审查）。

---

## 更早的变更

2026-09-11 之前的变更（含两阶段治理成型、角色扩到 9+1+1、三道门禁建立）未逐条回填，以 Git 历史为准：
`git log --oneline`（共 77 次提交）。需要补全时用
`git log --date=short --pretty="%ad %h %s"` 自 2026-09-11 往前读。