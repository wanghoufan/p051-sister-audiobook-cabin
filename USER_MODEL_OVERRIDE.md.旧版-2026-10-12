# USER_MODEL_OVERRIDE｜一句话切模型

| 角色 | 模型（精确ID，照抄执行） | 执行通道 | 备用模型 | 备用执行通道 | 调用方式 |
|---|---|---|---|---|---|
| task-manager | 开窗口时定 | 当前客户端窗口（自动探测） | — | — | 按 `bash scripts/detect-client.sh` 探测结果派工：`mode=window_subagent` 即当前客户端窗口内 subagent 直派（按开窗口时模型执行），`mode=channel_cli` 即无原生子代理、走通道 CLI |
| supervisor | codebuddy/deepseek-v4.1-flash | codebuddy | — | — | 派工基础设施走 codebuddy 直调：`codebuddy --model deepseek-v4.1-flash --effort high -y -p "任务"`（2026-10-16 用户令：先由 `opencode-go/muse-spark-1.3-contributor` 切 `codebuddy/glm-5.3-flash`，同日再切本行）。**与 builder 同模型、不同角色**：builder 写代码，supervisor 只对编排者说话、只读复检、兼 Phase Integrity 六查与账本校验，不改业务代码。表内记全ID，禁本窗口代做 |
| builder | codebuddy/deepseek-v4.1-flash | codebuddy | codebuddy/glm-5.3-flash | codebuddy | 派工基础设施走 codebuddy 直调：`codebuddy --model deepseek-v4.1-flash --effort high -y -p "任务"`（非交互必带 `-y`，验成功只看正文；codebuddy 无跨目录沙箱限制，跨项目读写无需额外标志）。**2026-10-16 用户定：主用切回 codebuddy 通道的 `deepseek-v4.1-flash`、备用改 `glm-5.3-flash`**（2026-10-14 曾切 opencode-go 通道，现按用户令切回；opencode 通道跨项目必带 `--auto` 的口径是 opencode 通道专属规则、仍适用，但不作用于本行）。用户口语「deepseek-flash」按别名口径落在 `deepseek-v4.1-flash`——codebuddy 通道目录里无字面 `deepseek-flash`，有 `deepseek-v4.1-flash`。**切备**：主通道超时/限额 → `codebuddy --model glm-5.3-flash --effort high -y -p "任务"`（同形），DISPATCH 的 `used` **仍填主**、note 记切备原因；再限额 → 停派喊人。表内记全ID，禁本窗口代做 |
| planner | codex/gpt-6.1-sol | codex | — | — | **Phase1 只做把关者/审查者，不亲手写 plan 正文**（2026-10-08 用户定：拟稿与改稿归 builder，planner 只审查打分与列缺项，省 Sol 额度；不合格打回 builder，planner 不自己写，违反按 `WRONG_ROUTE` 打回）。派工基础设施走codex直调；CLI用短名`gpt-6.1-sol`：`codex exec -m "gpt-6.1-sol" -s danger-full-access --skip-git-repo-check "任务" </dev/null`；**需 Codex CLI ≥0.159.2**；**2026-10-07 用户令解禁沙箱**（默认沙箱写不了文件，产品审查汇总无法落盘）；**解禁只解决沙箱，不解除 Phase1「禁改业务代码」约束**；须在账本 note 记带了该标志；表内记全ID，禁本窗口代做 |
| code-reviewer | codebuddy/glm-5.3-flash | codebuddy | — | — | `codebuddy --model glm-5.3-flash --effort high -y -p "任务"`（非交互必带`-y`，验成功只看正文）；表内记全ID，禁本窗口代做 |
| qa | codex/gpt-6-luna | codex | — | — | 派工基础设施走codex直调；CLI用短名`gpt-6-luna`，**按 `AGENTS.md` 解禁口径带 `-s`（2026-10-09 已放宽到 QA＋planner＋senior-expert，本行不再写"仅限QA"以免执行者误拒）**：`codex exec -m "gpt-6-luna" -s danger-full-access --skip-git-repo-check "任务" </dev/null`（`-s danger-full-access`＝关闭沙箱、给完整访问权，用于解端口绑定/网络限制，实测可绑 127.0.0.1 端口；**其他角色是否可带，以 `AGENTS.md` 的解禁口径为准**（2026-10-07 用户令已放宽到 QA＋planner＋senior-expert；2026-10-09 已同步清理行标题的旧表述）；禁超出口径乱带，且每次带该标志须在账本 note 记账；表内记全ID，禁本窗口代做）。普通QA（回归/校验/DoD）走 codex Luna；真机QA（adb/Expo）走本窗口 bash 直驱（开窗口模型）。**口径以 `AGENTS.md`「TM 代做边界」为准**：真机直驱与 TM 兜底**一律记 `executed_by`＋note**（真机直驱记 `executed_by=task-manager` 并注明 qa 卡允许），不得以「supervisor 不记偏离」为由免记。 |
| product-reviewer | codebuddy/glm-5.3-flash | codebuddy | — | — | 派工基础设施走 codebuddy 通道直调：`codebuddy --model glm-5.3-flash --effort high -y -p "任务"`（**2026-10-08 用户令由 `opencode/muse-spark-1.3-contributor-free` 改来**；真调已过 exit 0 回 ok）。只读研究、禁写业务代码与改 Plan。**产品审查双审链的审查 A 位即本模型**，与审查 B（`codebuddy/deepseek-v4-pro`）**必须串行，禁并发** |
| experience-recorder | opencode/muse-spark-1.3-contributor-free | opencode | — | — | 派工基础设施走opencode直调：`opencode run -m opencode/muse-spark-1.3-contributor-free "任务"`（限时免费档；2026-10-07 由 opencode-go/space-bunny-free 切，该 ID 已不在 opencode 通道目录会致 CHANNEL-STALE 禁派）；表内记全ID，禁本窗口代做 |
| neat-freak | volcengine-plan/ark-code-latest | opencode | radeon-mimo/MiMo-V2.6-Flash | Claude Code | 派工基础设施走opencode直调：`opencode run -m volcengine-plan/ark-code-latest "任务"`（ark-code-latest模式，实际模型由控制台管理）；表内记全ID，禁本窗口代做 |
| senior-expert | codex/gpt-6.1-sol | codex | — | — | 派工基础设施走codex直调；CLI用短名`gpt-6.1-sol`：`codex exec -m "gpt-6.1-sol" -s danger-full-access --skip-git-repo-check "任务" </dev/null`；**需 Codex CLI ≥0.159.2**（0.155.1 拿不到该模型目录，会报 `not supported when using Codex with a ChatGPT account`）；**2026-10-07 用户令解禁沙箱**（升级任务需写业务仓库，默认沙箱写不了）；表内记全ID，只接升级任务，禁本窗口代做 |
| db-admin | volcengine-plan/ark-code-latest | opencode | radeon-mimo/MiMo-V2.6-Flash | Claude Code | 派工基础设施走opencode直调：`opencode run -m volcengine-plan/ark-code-latest "任务"`（ark-code-latest模式，实际模型由控制台管理）；表内记全ID；工作区固定本机 000-alw-数据库管理专家仓，禁本窗口代做 |

<!-- 分工表版本：T29（2026-10-16 用户令：supervisor 由 `codebuddy/glm-5.3-flash` 切 `codebuddy/deepseek-v4.1-flash`；含 T28：supervisor 由 `opencode-go/muse-spark-1.3-contributor` 切 `codebuddy/glm-5.3-flash`——opencode 通道报 An active OpenCode Go subscription is required 连续 3 次不可用；含 T27：builder 主用切回 `codebuddy/deepseek-v4.1-flash`、备用改 `codebuddy/glm-5.3-flash`；含 T26：qa 行去「仅限QA」旧字面、解禁口径以 AGENTS 为准、产品审查 A=glm-5.3-flash/B=deepseek-v4-pro 串行双审；含 10-07 T25：codex/gpt-6-sol→gpt-6.1-sol、planner/senior 用 gpt-6.1-sol、需 Codex CLI ≥0.159.2；10-08 product-reviewer 换模型；历史调用档案行不改写） -->
<!-- TM 资格测试候选（A/B，2026-09-26；真调已过）：opencode-go/deepseek-v4.1-flash 与 opencode-go/mimo-v2.6-flash，Runtime=opencode；TM 行仍"开窗口时定"，主备由用户批准后按"改表→真调→记账"处理（见 docs/model/TASK-MANAGER-QUALIFICATION.md）。 -->

## 产品审查双审派工约定（2026-10-07 用户定；**不新增角色**，复用 planner + product-reviewer）

用户口令「第三阶段产品审查」触发。位置＝**Phase1(PLAN) 末尾、Develop Approval Human Gate 之前**；不新增 Phase/状态/Gate。

| 位 | 角色 ID（不变） | 模型（精确 ID） | 调用方式 |
|---|---|---|---|
| 组织者 / 汇总 | `planner` | `codex/gpt-6.1-sol` | `codex exec -m "gpt-6.1-sol" -s danger-full-access --skip-git-repo-check "任务" </dev/null` |
| 独立审查 A | `product-reviewer` | `codebuddy/glm-5.3-flash` | `codebuddy --model glm-5.3-flash --effort high -y -p "任务"` |
| 独立审查 B | `product-reviewer` | `codebuddy/deepseek-v4-pro` | `codebuddy --model deepseek-v4-pro --effort high -y -p "任务"` |

- **表结构不动**：上表与本节并存，不改上表列结构；账本 `role` 记 `product-reviewer`，`model` 按实际执行者分别填（符合 `provider/model` 精确写法）。
- **串行禁并发（2026-10-07 实测，必守）**：A、B **必须串行**派，禁并发。codebuddy 双实例并发会互相干扰，被抢的那个**静默失败且 exit 0、零产出**——只看 exit 码会把失败误判成成功。
- **产出校验（必守）**：每份审查**必须校验产出文件存在且非空**，缺或空即判该轮 `BLOCKED` 并**重跑**，不得因 exit 0 就放行、不得手工代写补齐。
- **汇总落盘方式（2026-10-07 已改）**：planner(codex) 已按用户令加 `-s danger-full-access`，**可直接写盘**，不再需要「输出到 stdout 再由编排者落盘」的绕行。若某环境解禁失效（回「需切换到可写工作区」且 exit 0 零产出），才退回 stdout 落盘，并**按「缺产出即 BLOCKED 重跑」处理，禁信 exit 0**。
- **独立性**：A/B 不得看到对方结论、不得看到汇总结果；只读，禁止写业务代码与改 Product Plan。
- **审查维度白名单**（非代码层面）：用户使用体验／交互逻辑与流程顺序优化／新增或优化功能建议。
- **禁项**：代码风格、重构、命名、测试覆盖率、依赖升级——出现即判 `WRONG_ROUTE` 打回。
- **汇总不可抄边**：planner 须产出「一致项／分歧项＋裁决依据／仅 A／仅 B／明确不采纳项」；无分歧也要写两模型覆盖差异检查结论。
- **产物**：`docs/review/PRODUCT_REVIEW_<plan版本>_<日期>.md`，结构照 `docs/roles/product-reviewer.md`。
- **重复触发**：同一 Product Plan 版本已出报告则不重跑，除非用户明说重跑或 Plan 已升版本。
- **DEV_BASELINE**：过 Gate 进 DEVELOP 时，本报告作为成员并入基线。

## 模型调用档案（2026-09-26，集中记录，便于回溯）
> 本节汇总本项目调用过的所有模型精确 ID 与调用方式，供后续回溯。当前在用标 ✅，历史标 📦。

| # | 状态 | 模型精确 ID（provider/model） | 调用方式 | 用途/角色 | 真调证据 |
|---|---|---|---|---|---|
| 1 | 📦 | `opencode-go/muse-spark-1.3-contributor` | `opencode run -m opencode-go/muse-spark-1.3-contributor "任务"` | 历史 supervisor 主用（2026-10-16 切 codebuddy/glm-5.3-flash） | — |
| 1b | 📦 | `codebuddy/glm-5.3-flash` | `codebuddy --model glm-5.3-flash --effort high -y -p "任务"` | 历史 supervisor 主用（2026-10-16 同日两次切换的中间态）＋ **code-reviewer 现役主用** | 通道目录已验在列 |
| 1c | ✅ | `codebuddy/deepseek-v4.1-flash` | `codebuddy --model deepseek-v4.1-flash --effort high -y -p "任务"` | supervisor 主用（2026-10-16 用户令）＋ builder 主用 | 通道目录已验在列 |
| 2 | ✅ | `codebuddy/deepseek-v4.1-flash` | `codebuddy --model deepseek-v4.1-flash --effort high -y -p "任务"` | builder 主用（2026-10-16 用户令切回 codebuddy 通道） | codebuddy 2.168.0 目录只读验名在列；真调证据见下条 |
| 2b | ✅ | `codebuddy/glm-5.3-flash` | `codebuddy --model glm-5.3-flash --effort high -y -p "任务"` | builder 备用（2026-10-16 用户令） | codebuddy 2.168.0 目录只读验名在列；与 code-reviewer 同 ID 属允许 |
| 2c | 📦 | `opencode-go/deepseek-v4.1-flash` | `opencode run --auto -m opencode-go/deepseek-v4.1-flash "任务"` | 历史 builder 主用（2026-10-14 切通道，2026-10-16 切回 codebuddy） | 通道目录已验在列（`opencode models` 含该 ID） |
| 3 | 📦（历史，已不可用） | `codex/gpt-6-sol` | `codex exec -m "gpt-6-sol" --skip-git-repo-check "任务" </dev/null` | planner/senior-expert | — |
| 4 | ✅ | `codebuddy/glm-5.3-flash` | `codebuddy --model glm-5.3-flash --effort high -y -p "任务"` | code-reviewer | — |
| 5 | ✅ | `codex/gpt-6-luna` | `codex exec -m "gpt-6-luna" -s danger-full-access --skip-git-repo-check "任务" </dev/null` | qa 普通 QA（解禁沙箱） | — |
| 6 | 📦 | `opencode/muse-spark-1.3-contributor-free` | 本窗口 subagent 直派 | 历史 product-reviewer（2026-10-08 改 codebuddy/glm-5.3-flash） | — |
| 7 | ✅ | `volcengine-plan/ark-code-latest` | `opencode run -m volcengine-plan/ark-code-latest "任务"` | db-admin/neat-freak 主用（ark-code-latest 模式，实际模型由控制台管理） | §56 pong exit 0 |
| 8 | ✅ | `radeon-mimo/MiMo-V2.6-Flash` | `opencode run -m radeon-mimo/MiMo-V2.6-Flash "任务"`（via Claude Code） | db-admin/neat-freak 备用 | §58 pong exit 0 |
| 9 | 📦 | `opencode-go/space-bunny-free` | `opencode run -m opencode-go/space-bunny-free "任务"` | experience-recorder/neat-freak（旧，已切 ark-code-latest） | — |
| 10 | 📦 | `opencode-go/deepseek-v4.1-flash` | `opencode run -m opencode-go/deepseek-v4.1-flash "任务"` | TM 资格候选 A | §53 回「ds ok」 |
| 11 | 📦 | `opencode-go/mimo-v2.6-flash` | `opencode run -m opencode-go/mimo-v2.6-flash "任务"` | TM 资格候选 B | §53 回「mimo ok」 |
| 12 | 📦 | `volcengine-plan/glm-5.3-flash` | `opencode run -m volcengine-plan/glm-5.3-flash "任务"` | 历史（builder 备链等） | §42 回「glm exact ok」 |
| 13 | 📦 | `volcengine-plan/deepseek-flash` | `opencode run -m volcengine-plan/deepseek-flash "任务"` | 历史（不支持 coding plan） | §56 真调失败 |
| 14 | 📦 | `volcengine-plan/deepseek-v4.1-flash` | — | 不存在（opencode 无此 ID） | §56 Model not found |
| 15 | 📦 | `opencode/mimo-v2.5-free` | `opencode run -m opencode/mimo-v2.5-free "任务"` | 历史（HANDOFF-2026-09-11 存档） | — |
| 16 | 📦 | `codex/gpt-5.6-terra` | `codex exec -m "gpt-5.6-terra" --skip-git-repo-check "任务" </dev/null>` | 历史 product-reviewer | — |
| 17 | 📦 | `codex/gpt-5.6-luna` | `codex exec -m "gpt-5.6-luna" --skip-git-repo-check "任务" </dev/null>` | 历史 qa/builder/product-reviewer | — |
| 18 | ✅ | `codex/gpt-6.1-sol` | `codex exec -m "gpt-6.1-sol" --skip-git-repo-check "任务" </dev/null>` | senior-expert（2026-09-29 由 gpt-6-sol 切） | 2026-09-29 真调 exit 0 回 pong（需 CLI ≥0.159.2） |
| 19 | ✅ | `codex/gpt-6.1-sol` | `codex exec -m "gpt-6.1-sol" -s danger-full-access --skip-git-repo-check "任务" </dev/null>` | planner（2026-10-07 由 gpt-6-sol 切；同日加解禁沙箱） | 2026-10-07 真调 exit 0 回 pong（codex-cli 0.159.2，18139 tokens）；**解禁沙箱单独真调** exit 0 成功落盘 out/PLANNER-WRITETEST.md（9802 tokens），证明 `-s danger-full-access` 解除 planner 写盘失败 |
| 20 | ✅ | `opencode/muse-spark-1.3-contributor-free` | `opencode run -m opencode/muse-spark-1.3-contributor-free "任务"` | experience-recorder（2026-10-07 由 opencode-go/space-bunny-free 切） | 2026-10-07 真调 exit 0 回 ok（原 ID 已不在 opencode 通道目录，致 CHANNEL-STALE 禁派） |
| 21 | ✅ | `codebuddy/deepseek-v4-pro` | `codebuddy --model deepseek-v4-pro --effort high -y -p "任务"` | product-reviewer 独立审查 B（2026-10-07 双审链新增） | 2026-10-07 真调 exit 0 回 ok（codebuddy 2.160.0 目录内） |
| 22 | ✅ | `codebuddy/glm-5.3-flash` | `codebuddy --model glm-5.3-flash --effort high -y -p "任务"` | product-reviewer 独立审查 A（2026-10-07 双审链新增）＋ **product-reviewer 主模型（2026-10-08 用户令）** | 2026-07 真调证据（code-reviewer 同 ID）；**2026-10-08 作为 product-reviewer 主模型另单独真调 exit 0 回 ok** |

### 调用通道说明
- **当前客户端窗口（自动探测）**：每轮开工先跑 `bash scripts/detect-client.sh`（输出 `client=/subagent=/mode=`，认客户端顺序＝bundle id → TERM_PROGRAM → 环境变量 → 父进程链 → 仓库痕迹目录仅作提示）。`mode=window_subagent`＝当前客户端有原生子代理，在窗口内直派（TM），可享真 resume／并行／worktree 隔离；`mode=channel_cli`＝没有原生子代理或客户端未识别（保守默认），改走通道 CLI，**只在汇报里带一句"当前客户端未识别，按 CLI 通道派"，不找用户**。已校准客户端＝Orca／Trae／Qoder／Codex／Claude Code／opencode；新客户端跑一次 `bash scripts/detect-client.sh` 校准后加进脚本映射即可
- **opencode**：`opencode run -m <精确ID> "任务"`（supervisor/builder(旧)/db-admin/neat-freak(新)/experience-recorder(旧)）
- **codebuddy**：`codebuddy --model <精确ID> --effort high -y -p "任务"`（builder 主/code-reviewer）
- **codex**：`codex exec -m "<短名>" --skip-git-repo-check "任务" </dev/null>`（planner/senior-expert/qa）
- **Claude Code**：`radeon-mimo/MiMo-V2.6-Flash` 备用经 Claude Code 调用（policy.json `runner_bin: "claude"`）
- **ark-code-latest 模式**：分工表只写 `volcengine-plan/ark-code-latest`，实际模型由火山方舟控制台切换（3-5 分钟生效），不在配置中写具体模型 ID
