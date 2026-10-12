---
name: touch-only-task-scope
description: >-
  Restricts code edits to modules and files in scope for the current coding task.
  Already-finished unrelated modules must not be modified. Use automatically on any
  coding task in Outpost ERP: implement, fix, refactor, wire API/UI, YingDao flows,
  or config changes when the user asks to build or change code.
---

# 只改本次任务相关模块

## 硬性规则（用户原话）

已经做好的模块，如果和这次任务没有关系，不准乱改其他模块的东西。

## 何时启用

凡本仓库编码任务一律遵守：实现功能、修 bug、接线、重构、改影刀/API/前端、改配置等。

## 开工前

1. 用一两句话界定**本次任务范围**（目标模块 / 目录 / 文件）。
2. 默认可改范围 = 用户点名的路径 + 为完成该任务**必须**动到的直接依赖（import、类型、路由注册等）。
3. 范围外的「已经做好」的模块：只读，不改。

### Outpost 常见边界（举例）

| 任务大致在… | 不要顺手改… |
|-------------|-------------|
| `market-intel` / 品牌名录 / 影刀 market_intel | ads 导出、飞书、Catalog、店铺同步 |
| 广告影刀 / portal-imports | market-intel、品牌 AI |
| 飞书桥接 | Noon 市场情报、广告 RPA |
| 单店 Catalog / sync | 另一条业务线的完整重写 |

（边界随任务变；上表仅防「逛着改」。）

## 禁止

- 顺手重构、顺手清理、顺手「统一风格」无关模块
- 因看到旧代码/技术债就扩改范围外文件
- 为「完整性 / 更好」去改未要求的相邻功能
- 扩大 diff：无关文件出现在改动里

## 例外（须先说明）

仅当不改就**无法完成**本次任务时，可最小改动范围外文件；回复里写清：

- 为什么必须动
- 动了哪些文件
- 改动是否已压到最小

用户未授权时，不要把「可选项 / 优化项」当成必须项去改。

## 自检（改完前）

- [ ] 每个改动文件都能说清与**本任务**的直接关系
- [ ] 没有「顺便」改动的已完成无关模块
- [ ] diff 里没有超范围文件；有则撤回或征得用户同意
