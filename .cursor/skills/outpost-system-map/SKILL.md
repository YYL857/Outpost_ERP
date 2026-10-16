---
name: outpost-system-map
description: >-
  Outpost ERP system map for other agents: layers, domains, API mounts, data
  root, and where to read next. Use when orienting on the repo, finding which
  module owns a feature, or explaining architecture. Business keys and amounts
  stay on wiki-graph; tool catalog stays on agent-hub.
---

# Outpost System Map（系统骨架）

## 何时读

看清项目框架、找模块/API/数据根、改代码前定位入口。  
不要用本卡回答箱号、PSKU、金额、库存。

## 读序

1. 本目录 `preload.md`（L0，与 `GET /api/system-map/agent-preload?format=md` 一致）
2. 不够再 `GET /api/system-map`（L1：全挂载、UI 分组、RPA、易错点）
3. 业务联查 → Skill `outpost-wiki-graph`
4. 工具与反幻觉 → Skill `outpost-agent-hub`

源码真相：`apps/api/src/modules/system-map/catalog.ts`。  
改 catalog 后跑：

`npx tsx src/modules/system-map/system-map.test.ts`（在 `apps/api`）

会把 L0 写回本目录 `preload.md`，并落到 `D:\outpost-data\agent-hub\system-preload.md`。

## 禁止

- 把 README 旧架构段当成当前挂载表
- 把 `OUTPOST_DATA_DIR` 当成全库根（根是 `OUTPOST_ROOT`）
- 用本卡编造业务单号或金额
