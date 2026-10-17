# APP 品牌资产规范｜命名 · 图标 · 启动画面（全局默认，必选）

> 定位：`docs/sop/` 基础设施规范位，**APP 基础能力单一真源**（与 `app-theme-i18n.md` 并列：那份管主题与多语言，本份管品牌资产）。
> 来源：P045 实战暴露的漏项——设计阶段定了 A/B/C 方向与原型，但**没有前置锁定品牌资产**，开发阶段由执行者自行决定命名、图标与启动画面，结果不可控、必然返工。
> 适用范围：Android / iOS / Flutter / React Native / PWA 等**面向用户交付的 APP**。
> **不新增 Skill、不新增 Gate、不新增 Human Decision**——强制点全部落在既有环节：Readiness Gate、Human 1（Direction Selection）、Human 2（Prototype Approval）、Design Freeze。

---

## 1. 必选内容（六件，缺一不可）

| # | 项 | 说明 |
|---|---|---|
| 1 | **软件中文名称** | 面向用户展示名；商店副标题另计 |
| 2 | **软件英文名称** | 面向国际用户展示名 |
| 3 | **安卓软件图标** | 桌面图标；须给风格方向与最终稿 |
| 4 | **启动画面（Splash / Launch Screen）** | 冷启动首屏；须给方向与最终稿 |
| 5 | 副标题 / slogan | **仅在需要时**补充，不强制 |
| 6 | 资产交付形态 | 至少一份可查看的图/描述（PNG/SVG/图标源文件或明确风格说明） |

---

## 2. 各环节必做项

### 2.1 Product Plan（Phase1）

「品牌资产方向」一节必须写清：
- 命名方向（中文名语气、英文名语气、是否含功能词/品牌词）
- 图标风格偏好（几何/拟物/线性/渐变…）
- 启动画面要求（是否含 logo、底色、与主题三态的关系）
- 副标题/slogan 是否需要（不需要就明写「不需要」）

**这些是方向与偏好，不是最终答案**——最终答案在 Freeze 前拍板。

### 2.2 A/B/C 三方向（Human 1 前）

**每个方向都必须附带四项**，缺任一项该方向不合格：
1. 中文名建议（至少 1 个，最好 2 个备选）
2. 英文名建议（同上）
3. 图标方向（风格 + 构图意图）
4. 启动画面方向

> A/B/C 仍是**三种产品设计方向**，不是三套配色；品牌资产随方向走，不得三个方向共用同一套命名/图标。

### 2.3 交互原型 / HTML 原型（Human 2 前）

- **必须体现启动页**（可点击进入，或至少可预览）
- 必须展示**命名与图标候选**（供 Human 2 判断）
- 启动页到主界面的跳转、加载态、可跳过规则须可见

### 2.4 Human 2 / Design Freeze 前——最终拍板

**四项必须全部定稿**：
1. 最终中文名
2. 最终英文名
3. 最终图标
4. 最终启动画面

（副标题/slogan 如需要，此时一并定稿或明写「本版不做」。）

---

## 3. 执行约束（硬）

1. **未明确上述内容时，不得进入 Design Freeze**——由 `design-freeze` Skill 的原有 Gate 拦截。
2. **未完成最终拍板时，开发者不得自行决定名称、图标和启动画面**——Phase2 的 builder / senior-expert 遇到未拍板的品牌资产，须**停下来问**，不得自行发挥。
3. **属于 APP 前置设计范围，不放到开发阶段临时补**。
4. **不新增 Skill / Gate / Human Decision**——强制点挂在既有环节上。
5. Product Plan 未写品牌资产方向 ⇒ Phase1 的 `check-ledger` 报 `APP-BRAND-ASSETS-MISSING`（exit 1）。

---

## 4. 与既有体系的关系

| 环节 | 强制点落在哪 |
|---|---|
| Phase1 收工 | `scripts/model/check-ledger.mjs` → `APP-BRAND-ASSETS-MISSING`（机器拦） |
| A/B/C | `visual-direction-exploration` 的 `DIRECTION_SET.json` Gate（方向须附带四项） |
| Human 1 | 用户选方向时连带看命名/图标/启动页方向 |
| 原型 | `interactive-product-prototype` 的 `NO RUNTIME EVIDENCE → NO PASS` 与五槽交付 |
| Human 2 / Freeze | `design-freeze` 的 **BRAND Freeze**（第七项语义）——未锁定不得 Freeze |

- 品牌资产与主题/多语言（`app-theme-i18n.md`）**互相独立但同属 APP 前置**：启动画面底色须与主题三态兼容，但不因此合并两份规范。
- **依赖边界（2026-10-08 澄清，与 `app-theme-i18n.md` §6 对等）**：上表中的**阶段级拦截全部依赖七颗 Design Pipeline Skill**（`design-reference-research`／`visual-direction-exploration`／`ux-interaction-contract`／`interactive-product-prototype`／`design-freeze`／`requirements-traceability`／`orca-design-pipeline`），它们装在 Skill 体系里（中央 Skill 仓库 → 各 Agent 目录），**不随本治理模板包分发**。
  ⇒ **只用本模板包时，品牌资产的机器强制点只有两层**：①`PRODUCT_PLAN` 的「APP 品牌资产方向」字段；②`scripts/model/check-ledger.mjs` 的 `APP-BRAND-ASSETS-MISSING` / `APP-BRAND-AC-INCOMPLETE`。
  ⇒ 装了七颗 Skill 时，才额外获得 §2 各阶段的 `BLOCKED` 拦截（尤其 `design-freeze` 的 **BRAND Freeze**）。**未装时不报错**——那些阶段无机器门，属可选增强，不要高估强制力。
