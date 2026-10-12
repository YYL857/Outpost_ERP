# Outpost 中枢 Agent / Wiki Graph — 任务交接

**日期：** 2026-09-24  
**状态：** 数据看板已上线（原「我的主页」）；财务/看板营收口径对齐 salesFacts  
**设计原则：** 高可用靠超时+降级；高性能靠截断/限轮次/禁 mutate；清单仍是 `catalog.ts`

---

## 1. 目标回顾

为企业私有 AI 助理中枢提供：

1. **指路**：表字段焦点 + 跨表关联（不吞全文）  
2. **跳转**：有箱号/票号/物流号/PSKU/订单号时 context-pack  
3. **办事**：工具清单指向现有 API  
4. **防幻觉**：HubAnswer + validate-answer（无证据不得报单号/金额）

---

## 2. 已完成模块

### 2.1 Wiki Graph — `apps/api/src/modules/wiki-graph/`

| 能力 | 路径 / API |
|------|------------|
| SQLite 图 | `D:\outpost-data\wiki-graph\outpost.sqlite` |
| Agent 预加载卡（默认，省 token） | `GET /api/wiki-graph/agent-preload`（`?format=md`） |
| 完整 Schema | `GET /api/wiki-graph/schema-map` |
| 键查找 / 邻域包 | `GET /api/wiki-graph/lookup` · `GET /api/wiki-graph/context-pack` |
| 重建 | `POST /api/wiki-graph/rebuild` |
| 统计 | `GET /api/wiki-graph/stats` |
| 磁盘卡 | `D:\outpost-data\wiki-graph\agent-preload.md` · `schema-map.md` |

**实例索引已接：** packing（箱/票/物流/PSKU）、accounts 采购（订单/快递/PSKU）、freight-rates（货代报价摘要）  
**仅 Schema、未灌行：** 入账开支、产品成本表、日报、Catalog 全量、Noon、Portal/1688（刻意：走 API）

**自动重建：** `assembly-sync` 飞书成功后阶段 `wiki_graph`（失败不拖垮整链 `ok`）；`skipFeishu` / `skipWikiGraph` 可跳过。

**Skill：** `.cursor/skills/outpost-wiki-graph/SKILL.md`

### 2.2 Agent Hub — `apps/api/src/modules/agent-hub/`

| 能力 | API |
|------|-----|
| 工具清单 + 反幻觉 | `GET /api/agent-hub/manifest`（`?format=md`，`?persist=1` 落盘） |
| 仅协议 | `GET /api/agent-hub/protocol` |
| 仅工具 | `GET /api/agent-hub/tools`（`?kind=lookup` 等） |
| 回答自检 | `POST /api/agent-hub/validate-answer` |
| DeepSeek 编排 | `POST /api/agent-hub/ask` `{ question }` |
| 运行时旋钮 | `GET /api/agent-hub/runtime` |
| 落盘 | `POST /api/agent-hub/persist` → `D:\outpost-data\agent-hub\manifest.md` |

**Skill：** `.cursor/skills/outpost-agent-hub/SKILL.md`  
**校验：** `validate.ts` — 无 evidence 却含疑似箱号/SKU 会判违规。

**当前 12 个工具 ID（2026-09-24 实测后路径）：**

| id | kind | path | 实测 |
|----|------|------|------|
| hub.preload | navigate | GET /api/wiki-graph/agent-preload | 200 |
| hub.manifest | navigate | GET /api/agent-hub/manifest | 200 |
| wiki.context_pack | lookup | GET /api/wiki-graph/context-pack | 200（箱 `2508-01-N1-K`） |
| wiki.lookup | lookup | GET /api/wiki-graph/lookup | 200 |
| shipping.board | query | GET **/api/shipping-ops/overview** | 200（根路径曾 404） |
| purchase.list | query | GET **/api/purchase/lines** | 200（根路径曾 404） |
| catalog.query | query | GET /api/catalog | 200（全量，无 partnerSku 查询参数） |
| sales.query | query | GET **/api/sales/summary** | 200（根路径曾 404） |
| finance.query | query | GET **/api/finance/overview** | 200（根路径曾 404） |
| ops.interpret | judge | POST /api/ops-assist/interpret | 200（body.surface） |
| replenish.query | query | GET **/api/replenish/plan** | 200（根路径曾 404） |
| wiki.rebuild | mutate | POST /api/wiki-graph/rebuild | 路径正确；PoC **未调用**（mutate） |

路由挂载：`apps/api/src/index.ts` → `/api/wiki-graph`、`/api/agent-hub`。  
**鉴权：** 除 health/login 外均需 session（`POST /api/auth/login`）。

---

## 3. 反幻觉约定（必须遵守）

1. 禁止编造 PSKU / 箱号 / 票号 / 物流号 / 订单号 / 金额 / 库存 / 销量  
2. 事实必须来自本轮工具返回，并写入 HubAnswer.evidence  
3. 404/空 → 「未查到」，不猜相近单号  
4. 输出结构：`verdict, confidence, evidence, openQuestions, toolsUsed`  
5. 无 evidence 时 confidence 仅 `none`/`low`  
6. mutate（rebuild）默认不主动调用  

HubAnswer 示例见 `agent-hub/types.ts`；自检见 `POST /api/agent-hub/validate-answer`。

---

## 4. 本窗口已完成：DeepSeek 轻量编排

### 高可用 / 高性能（刻意不做的）

- **不做**独立注册中心、工具心跳守护  
- **做**：工具超时（默认 12s）→ `unavailable`，本轮跳过；LLM 超时 45s；最多 3 轮、每轮最多 3 工具  
- **做**：大响应截断（默认 6k 字符；catalog 按 partnerSku 过滤）  
- **做**：默认不暴露 `wiki.rebuild`（除非 `allowMutate:true`）  
- **做**：合成后 `validate-answer`；失败降级 confidence  

### 调用

```bash
# 需已登录 cookie + DEEPSEEK_API_KEY
curl -X POST http://127.0.0.1:8787/api/agent-hub/ask \
  -H "Content-Type: application/json" -H "Cookie: outpost_session=..." \
  -d '{"question":"箱号 2508-01-N1-K 现在什么状态？"}'
```

### 压测登记（2026-09-24，5 类问句均 validate 通过）

| 问句类型 | 选用工具 | 约耗时 | 备注 |
|----------|----------|--------|------|
| 箱号状态 | context_pack | ~4s | |
| 销量汇总 | sales + ops.interpret | ~11–14s | 已禁默认 navigate，不再空调 preload |
| 财务概览 | finance + ops.interpret | ~11s | |
| 在途箱数 | shipping.board | ~4s | |
| 紧急补货 | replenish + ops.interpret | ~11s | |

默认暴露 **9** 个工具（禁 mutate + 禁 navigate）；`allowNavigate` / `allowMutate` 可打开。

### 冒烟

```bash
cd apps/api
npx tsx src/modules/agent-hub/agent-hub.test.ts
npx tsx src/modules/agent-hub/poc-ask.ts
```

### 下一窗口可选

- 对话 UI / 多轮会话记忆  
- Catalog 服务端按 SKU 过滤轻量端点（进一步降延迟）  
- 调用成功率简易计数（仍非心跳）

---

## 5. 刻意未做（避免下一窗口跑偏）

- 未把 Catalog/日报/Noon 全量灌进 SQLite  
- 未做对话 UI / 多轮会话  
- 未做工具心跳 / 独立注册中心（调用失败当场标 unavailable）  
- Catalog 仍无服务端 SKU 过滤（编排层截断兜底）  
- **已做 Web 悬浮助手**：`apps/web` 右下角小球 / 面板 → `POST /api/agent-hub/ask`（交互参考 BotUI 消息流，未引 botui 包）

---

## 6. 关键文件速查

```
apps/api/src/modules/wiki-graph/     # 图、preload、context-pack
apps/api/src/modules/agent-hub/      # 工具清单、协议、校验、本交接
apps/api/src/modules/sync/assembly-sync.ts  # wiki_graph 阶段
.cursor/skills/outpost-wiki-graph/
.cursor/skills/outpost-agent-hub/
D:\outpost-data\wiki-graph\
D:\outpost-data\agent-hub\
```

**下一窗口开场建议：**  
「试用 `POST /api/agent-hub/ask` 多问几类业务题，按失败日志收紧 system prompt / 截断策略。」
