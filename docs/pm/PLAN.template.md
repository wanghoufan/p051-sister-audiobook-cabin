
# PLAN（Phase2 Stage / Task Plan 专用；Phase1 产品计划用 PRODUCT_PLAN.template.md）

- DEV_BASELINE：（如 PRODUCT_PLAN_V1.0，DEVELOP 必填）
- CHANGE_REQUEST：（NONE / A / B / C）
- APP 基础能力承接（Phase2 实施必须回指 Phase1，不得在此重新定义）：
  - 主题三态／系统跟随／持久化／切换不丢状态：DEV_BASELINE 中的相关 AC 编号＝
  - 中英双语／不支持语言回退 zh-CN／可扩展架构：相关 AC 编号＝
  - 品牌资产最终四项（中文名／英文名／安卓图标／启动画面）：Design Freeze 的 BRAND Freeze 引用＝
  - **未拍板的品牌资产，Phase2 一律停下问，禁止自行决定**（`docs/sop/app-brand-assets.md`）

## Product Goal

TBD

## Current Stage

- Stage ID:
- Goal:

## Stage P0（P0=本 Stage 非做不可、缺它不算完的事项，由 planner 初定、Task Manager 拍板）

- [ ]

## In Scope

- 

## 产品简化门槛·实施前防膨胀自检（Gate C，照 `docs/sop/app-simplicity.md`；确认无误后方可确认 DEV_BASELINE）

- [ ] C1 TASK **未新增**原型/UX Contract 之外的页面、按钮、设置项
- [ ] C2 **未把**技术内部状态（Phase／Gate／AC-FR／数据 ID／动作代码／开发版本与 hash）暴露为用户页面
- [ ] C3 **未为满足 AC** 不断堆入说明文字与控件
- [ ] C4 **未偏离**已批准的主要用户路径
- [ ] C5 **未出现**原型未批准的新交互负担
- 检出膨胀时的处理：入口合并、布局简化、局部交互修正（**不改核心业务规则**）→ 走**已有局部变更流程**，**不强制 Change C**；涉及需求范围／关键行为／安全边界 → 按现有变更分级（Change C 受控重开）
- **不得为追求覆盖率而增加页面和控件**；**安全、隐私、异常恢复与数据正确性不因简化而丢失**

## Out of Scope

- 

## Task Breakdown

| Task ID | Priority | Role | Status | Notes |
|---|---|---|---|---|

## Risks

- 

## Human Decisions Needed

-
