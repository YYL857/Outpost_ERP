/**
 * Outpost 系统骨架：给其他 Agent 看清分层、域、入口。
 * 业务行级联查仍走 wiki-graph；本卡不承载单号/金额。
 */

export type SystemLayer = {
  id: string;
  label: string;
  where: string;
  role: string;
};

export type SystemDomain = {
  id: string;
  label: string;
  /** 主代码目录（相对仓库根） */
  code: string;
  /** 主 API 前缀 */
  api: string;
  note: string;
};

export type SystemApiMount = {
  path: string;
  role: string;
};

export type SystemUiGroup = {
  group: string;
  modules: string[];
};

export type SystemCatalog = {
  version: 1;
  title: string;
  principle: string;
  layers: SystemLayer[];
  pipeline: string[];
  domains: SystemDomain[];
  entryFiles: Array<{ path: string; why: string }>;
  readOrder: string[];
  constraints: string[];
  apiMounts: SystemApiMount[];
  uiGroups: SystemUiGroup[];
  automation: Array<{ id: string; where: string; role: string }>;
  pitfalls: string[];
  boundaries: string[];
};

export const OUTPOST_SYSTEM_CATALOG: SystemCatalog = {
  version: 1,
  title: "Outpost System Map",
  principle:
    "Noon 多店 ERP。运行时 = apps/web + apps/api + OUTPOST_ROOT（默认 D:\\outpost-data）。业务事实在各店 state.json，不在 Git。本卡讲框架；单号/金额走 wiki-graph；工具与反幻觉走 agent-hub。",
  layers: [
    { id: "web", label: "Web", where: "apps/web", role: "React SPA；侧栏 modules.ts，路由 App.tsx" },
    { id: "api", label: "API", where: "apps/api/src", role: "Express :8787；挂载 apps/api/src/index.ts" },
    { id: "platforms", label: "Platforms", where: "apps/api/src/platforms", role: "Noon / 飞书 / 货代门户 / 1688 适配" },
    { id: "data", label: "Data", where: "OUTPOST_ROOT", role: "店态、portal CSV、审计、wiki、agent-hub" },
    { id: "rpa", label: "RPA", where: "apps/api/scripts/noon-pw-platform + 影刀", role: "门户导出与部分抓取，结果进 portal-imports" },
    { id: "ext", label: "Extensions", where: "apps/*-extension", role: "浏览器助手：上架 / 市场情报 / ASN 预约" },
    { id: "agent", label: "Agent", where: "wiki-graph + agent-hub + system-map", role: "查数、工具、本骨架卡" },
  ],
  pipeline: [
    "NOON Impex（live）直接写入各店 state.json",
    "或 Playwright / 影刀导出 → shops/{shopId}/portal-imports → auto-ingest",
    "幂等落入 orders / catalog / stock / salesFacts / adsFacts 等",
    "业务模块只读当前店本地店态；同步健康中心看新鲜度",
  ],
  domains: [
    { id: "catalog", label: "Catalog·上架·市场情报", code: "apps/api/src/modules/{catalog,listing,market-intel}", api: "/api/catalog · /api/listing · /api/market-intel", note: "商品主数据、文案/宣传图、选品" },
    { id: "commerce", label: "销量·广告·财务", code: "apps/api/src/modules/{sales,ads,finance,analytics,ops-daily}", api: "/api/sales · /api/ads · /api/finance · /api/ops-daily", note: "吃同步事实；广告预算在 pw-rpa" },
    { id: "supply", label: "采购·补货·物流·票货", code: "apps/api/src/modules/{purchase,replenish,shipping,cargo-ledger,warehouse-booking}", api: "/api/purchase · /api/replenish · /api/shipping-ops · /api/cargo-ledger · /api/warehouse-booking", note: "装箱/PSKU 联查优先 wiki context-pack" },
    { id: "sync", label: "同步·调度·PW-RPA", code: "apps/api/src/modules/{sync,schedulers,pw-rpa,noon}", api: "/api/sync · /api/schedulers · /api/pw-rpa · /api/noon", note: "Impex 与门户导出两条入库路径" },
    { id: "work", label: "任务·看板·简报", code: "apps/api/src/modules/{task-planning,dashboard,daily-brief,morning-digest,ops-assist}", api: "/api/tasks · /api/dashboard · /api/daily-brief", note: "运营协作，不是店态真相源" },
    { id: "access", label: "多店·登录·审计", code: "apps/api/src/{shops,auth,modules/audit}", api: "/api/shops · /api/auth · /api/audit", note: "角色 admin/ops_lead/ops/purchase；写操作落审计" },
    { id: "agent", label: "Agent 入口", code: "apps/api/src/modules/{system-map,wiki-graph,agent-hub}", api: "/api/system-map · /api/wiki-graph · /api/agent-hub", note: "先骨架，再表关联，再工具" },
  ],
  entryFiles: [
    { path: "apps/api/src/index.ts", why: "全部 /api 挂载与启动调度" },
    { path: "apps/web/src/modules.ts", why: "侧栏模块、路径、角色" },
    { path: "apps/api/src/shops/registry.ts", why: "OUTPOST_ROOT、多店注册" },
    { path: "docs/NOON_OUTPOST_DATA_MAP.md", why: "磁盘布局与字段" },
    { path: "docs/PW_RPA_PLATFORM.md", why: "Playwright 导出任务" },
    { path: "AGENTS.md", why: "Agent 先读哪张卡" },
  ],
  readOrder: [
    "看框架：GET /api/system-map/agent-preload（本卡）；不够再 GET /api/system-map",
    "查箱号/票号/PSKU/金额：GET /api/wiki-graph/agent-preload → context-pack",
    "确认能调哪些工具与反幻觉：GET /api/agent-hub/manifest",
    "改代码：只动任务相关模块；前端须兼容局域网 HTTP 非本机",
  ],
  constraints: [
    "同事用 http://内网IP 访问，禁止只按 localhost/HTTPS 设计复制与下载",
    "已完成且无关的模块不要顺手改（touch-only-task-scope）",
    "无工具证据不得编造 PSKU、箱号、金额、库存",
    "Git 提交作者仅用户本人（sole-github-author）",
  ],
  apiMounts: [
    { path: "/api/health", role: "存活" },
    { path: "/api/auth", role: "登录与会话" },
    { path: "/api/audit", role: "写操作审计" },
    { path: "/api/shops", role: "多店切换与注册" },
    { path: "/api/store", role: "当前店概要" },
    { path: "/api/config", role: "运行配置" },
    { path: "/api/sync", role: "Impex/汇总同步" },
    { path: "/api/noon", role: "Noon 接入" },
    { path: "/api/catalog", role: "商品主数据" },
    { path: "/api/listing", role: "上架文案与宣传图" },
    { path: "/api/sales", role: "销量事实" },
    { path: "/api/analytics", role: "分析" },
    { path: "/api/finance", role: "财务" },
    { path: "/api/ads", role: "广告事实" },
    { path: "/api/pw-rpa", role: "Playwright 任务与广告预算" },
    { path: "/api/purchase", role: "采购" },
    { path: "/api/replenish", role: "补货" },
    { path: "/api/shipping-ops", role: "物流/装箱" },
    { path: "/api/campaigns", role: "活动" },
    { path: "/api/market-intel", role: "市场情报" },
    { path: "/api/daily-brief", role: "日报简报" },
    { path: "/api/morning-digest", role: "晨报" },
    { path: "/api/ops-assist", role: "运营判断" },
    { path: "/api/dashboard", role: "看板" },
    { path: "/api/wiki-graph", role: "表关联与 context-pack" },
    { path: "/api/agent-hub", role: "工具清单与问答" },
    { path: "/api/system-map", role: "本骨架卡" },
    { path: "/api/schedulers", role: "定时任务开关" },
    { path: "/api/tasks", role: "任务规划" },
    { path: "/api/warehouse-booking", role: "仓预约" },
    { path: "/api/cargo-ledger", role: "票货台账" },
    { path: "/api/ops-daily", role: "日更流水线" },
    { path: "/api/extensions", role: "浏览器插件包下载" },
  ],
  uiGroups: [
    { group: "工作台", modules: "数据看板 / 数据对齐 / 定时任务 / NOON 接入 / RPA 工作台 / Noon 向导 / 用户 / 审计 / 任务" },
    { group: "选品与上架", modules: "Catalog / 市场情报 / Best Sell / 上架文案" },
    { group: "经营分析", modules: "广告 / 销量 / 财务 / 成本核算 / 文档助手 / 日报 / 日更" },
    { group: "供应链", modules: "采购 / 补货 / 物流 / 票货台账" },
    { group: "增长", modules: "活动" },
  ].map((g) => ({ group: g.group, modules: [g.modules] })),
  automation: [
    { id: "impex", where: "apps/api/src/platforms/noon + modules/sync", role: "订单/库存/费用 live 入库" },
    { id: "pw", where: "apps/api/scripts/noon-pw-platform jobs: ads, sales, keepalive, ads-budget", role: "门户导出 → portal-imports；API POST /api/pw-rpa/:job/run" },
    { id: "yingdao", where: ".cursor/skills/yingdao-* · docs/YINGDAO_*.md", role: "影刀抓取（市场情报等），不替代 Impex" },
    { id: "listing-ext", where: "apps/listing-extension", role: "竞品页辅助上架" },
    { id: "intel-ext", where: "apps/market-intel-extension", role: "Noon 货架辅助" },
    { id: "asn-ext", where: "apps/asn-booking-extension", role: "仓预约辅助" },
  ],
  pitfalls: [
    "OUTPOST_ROOT 是数据根（shops、wiki-graph）；OUTPOST_DATA_DIR 常被设成某一店的 json 目录，不要当成全库根",
    "同一 PSKU 跨箱/跨采购单；金额以业务 API 为准，preload 不是真相",
    "飞书同步成功后会重建 wiki-graph；改表关联要改 schema-catalog，不会自动长出新模块",
    "README 架构段偏旧；以本卡与 index.ts 为准",
  ],
  boundaries: [
    "本卡 = 代码与运行时骨架，不含实例单号",
    "wiki-graph = 飞书/店态表怎么连",
    "agent-hub = 可调用工具与 HubAnswer 反幻觉",
  ],
};

export function declaredApiPaths(
  catalog: SystemCatalog = OUTPOST_SYSTEM_CATALOG,
): string[] {
  return catalog.apiMounts.map((m) => m.path);
}
