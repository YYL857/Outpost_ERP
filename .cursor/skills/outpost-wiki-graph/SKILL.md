---
name: outpost-wiki-graph
description: >-
  Use Outpost Agent Preload card and wiki-graph context packs for ERP table
  joins (箱号/票号/物流号/PSKU/订单号). Prefer compact preload over full sheets.
  Use when answering logistics, packing, purchase, freight, or catalog
  cross-table questions in Outpost ERP.
---

# Outpost Wiki Graph（表关联加速）

## 原则

你**不需要**理解每张表的全部行内容。只需要：

1. 每张表的**焦点字段**（不必全字段）
2. 字段如何连到其它表（能查到什么、易错点、优先 API）
3. 用户给出具体键时，用 context-pack 跳转

## 协议（按顺序）

1. **先读 Agent 预加载卡（默认，省 token）**  
   - `GET /api/wiki-graph/agent-preload`  
   - 或 `?format=md`  
   - 磁盘：`D:\outpost-data\wiki-graph\agent-preload.md`  
   - 只含 focus 字段 + 关联路径 + 一条 watch

2. **有具体键 → 实例邻域**  
   - `GET /api/wiki-graph/context-pack?keyType=boxNo&keyValue=...&hops=2`  
   - keyType：`boxNo` | `ticketNo` | `logisticsNo` | `partnerSku` | `forwarder` | `orderId` | `trackingNo`

3. **按 join 上的 api 调业务接口**；仍不够再读完整 Schema：  
   - `GET /api/wiki-graph/schema-map`（全字段 + 全部 pitfalls）

Preload 解决「怎么走」；context-pack / 业务 API 解决「此刻是什么」。

## 重建

`POST /api/wiki-graph/rebuild`  
汇总同步飞书成功后会自动跑 `wiki_graph` 阶段。

## 与中枢 Agent 的关系

业务中枢请同时使用 **outpost-agent-hub** Skill：  
先读 `/api/agent-hub/manifest`（工具 + 反幻觉），再用本 preload / context-pack 指路与跳转。

## 禁止

- 通读装箱表/账目表全文
- 跳过 preload 直接扫 CSV/snapshot
- 默认加载完整 schema-map（仅细节不足时）
- 无工具证据时编造单号或金额
