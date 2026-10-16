# Outpost System Map · Preload

Noon 多店 ERP。运行时 = apps/web + apps/api + OUTPOST_ROOT（默认 D:\outpost-data）。业务事实在各店 state.json，不在 Git。本卡讲框架；单号/金额走 wiki-graph；工具与反幻觉走 agent-hub。

## Layers
- **Web** (`apps/web`): React SPA；侧栏 modules.ts，路由 App.tsx
- **API** (`apps/api/src`): Express :8787；挂载 apps/api/src/index.ts
- **Platforms** (`apps/api/src/platforms`): Noon / 飞书 / 货代门户 / 1688 适配
- **Data** (`OUTPOST_ROOT`): 店态、portal CSV、审计、wiki、agent-hub
- **RPA** (`apps/api/scripts/noon-pw-platform + 影刀`): 门户导出与部分抓取，结果进 portal-imports
- **Extensions** (`apps/*-extension`): 浏览器助手：上架 / 市场情报 / ASN 预约
- **Agent** (`wiki-graph + agent-hub + system-map`): 查数、工具、本骨架卡

## Data pipeline
1. NOON Impex（live）直接写入各店 state.json
2. 或 Playwright / 影刀导出 → shops/{shopId}/portal-imports → auto-ingest
3. 幂等落入 orders / catalog / stock / salesFacts / adsFacts 等
4. 业务模块只读当前店本地店态；同步健康中心看新鲜度

## Domains
- **Catalog·上架·市场情报** `/api/catalog · /api/listing · /api/market-intel` — apps/api/src/modules/{catalog,listing,market-intel} — 商品主数据、文案/宣传图、选品
- **销量·广告·财务** `/api/sales · /api/ads · /api/finance · /api/ops-daily` — apps/api/src/modules/{sales,ads,finance,analytics,ops-daily} — 吃同步事实；广告预算在 pw-rpa
- **采购·补货·物流·票货** `/api/purchase · /api/replenish · /api/shipping-ops · /api/cargo-ledger · /api/warehouse-booking` — apps/api/src/modules/{purchase,replenish,shipping,cargo-ledger,warehouse-booking} — 装箱/PSKU 联查优先 wiki context-pack
- **同步·调度·PW-RPA** `/api/sync · /api/schedulers · /api/pw-rpa · /api/noon` — apps/api/src/modules/{sync,schedulers,pw-rpa,noon} — Impex 与门户导出两条入库路径
- **任务·看板·简报** `/api/tasks · /api/dashboard · /api/daily-brief` — apps/api/src/modules/{task-planning,dashboard,daily-brief,morning-digest,ops-assist} — 运营协作，不是店态真相源
- **多店·登录·审计** `/api/shops · /api/auth · /api/audit` — apps/api/src/{shops,auth,modules/audit} — 角色 admin/ops_lead/ops/purchase；写操作落审计
- **Agent 入口** `/api/system-map · /api/wiki-graph · /api/agent-hub` — apps/api/src/modules/{system-map,wiki-graph,agent-hub} — 先骨架，再表关联，再工具

## Read order
1. 看框架：GET /api/system-map/agent-preload（本卡）；不够再 GET /api/system-map
2. 查箱号/票号/PSKU/金额：GET /api/wiki-graph/agent-preload → context-pack
3. 确认能调哪些工具与反幻觉：GET /api/agent-hub/manifest
4. 改代码：只动任务相关模块；前端须兼容局域网 HTTP 非本机

## Entry files
- `apps/api/src/index.ts` — 全部 /api 挂载与启动调度
- `apps/web/src/modules.ts` — 侧栏模块、路径、角色
- `apps/api/src/shops/registry.ts` — OUTPOST_ROOT、多店注册
- `docs/NOON_OUTPOST_DATA_MAP.md` — 磁盘布局与字段
- `docs/PW_RPA_PLATFORM.md` — Playwright 导出任务
- `AGENTS.md` — Agent 先读哪张卡

## Constraints
- 同事用 http://内网IP 访问，禁止只按 localhost/HTTPS 设计复制与下载
- 已完成且无关的模块不要顺手改（touch-only-task-scope）
- 无工具证据不得编造 PSKU、箱号、金额、库存
- Git 提交作者仅用户本人（sole-github-author）

## Boundaries
- 本卡 = 代码与运行时骨架，不含实例单号
- wiki-graph = 飞书/店态表怎么连
- agent-hub = 可调用工具与 HubAnswer 反幻觉

深挖：`GET /api/system-map`（全挂载、UI、RPA、易错点）。