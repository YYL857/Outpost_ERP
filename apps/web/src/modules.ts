export type ModuleKey =
  | "home"
  | "sync-health"
  | "schedulers"
  | "noon"
  | "catalog"
  | "selection"
  | "best-sell"
  | "listing"
  | "info-check"
  | "ads"
  | "sales"
  | "finance"
  | "bom-cost"
  | "docs-assist"
  | "daily-brief"
  | "ops-daily"
  | "purchase"
  | "replenish"
  | "shipping"
  | "ticket-ledger"
  | "campaigns"
  | "users"
  | "audit"
  | "noon-guide"
  | "tasks"
  | "pw-studio";

export type ModuleRole = "admin" | "ops_lead" | "ops" | "purchase";

export type AppModule = {
  key: ModuleKey;
  title: string;
  path: string;
  phase: "P0" | "P1" | "P2" | "P3";
  group: string;
  /** 仅超管侧栏可见（等价于 roles: ["admin"]） */
  adminOnly?: boolean;
  /** 显式可见角色；优先于 adminOnly */
  roles?: ModuleRole[];
};

/** 当前登录角色是否可见该模块 */
export function canAccessModule(
  mod: AppModule,
  role: ModuleRole | string | null | undefined,
): boolean {
  if (!role) return false;
  if (mod.roles?.length) return mod.roles.includes(role as ModuleRole);
  if (mod.adminOnly) return role === "admin";
  return true;
}

export const MODULES: AppModule[] = [
  {
    key: "home",
    title: "数据看板",
    path: "/",
    phase: "P0",
    group: "工作台",
  },
  {
    key: "sync-health",
    title: "数据对齐",
    path: "/sync-health",
    phase: "P0",
    group: "工作台",
    adminOnly: true,
  },
  {
    key: "schedulers",
    title: "定时任务",
    path: "/schedulers",
    phase: "P0",
    group: "工作台",
    adminOnly: true,
  },
  {
    key: "noon",
    title: "NOON 接入",
    path: "/noon",
    phase: "P0",
    group: "工作台",
    adminOnly: true,
  },
  {
    key: "pw-studio",
    title: "RPA 工作台",
    path: "/pw-studio",
    phase: "P0",
    group: "工作台",
    adminOnly: true,
  },
  {
    key: "noon-guide",
    title: "Noon 后台向导",
    path: "/noon-guide",
    phase: "P1",
    group: "工作台",
  },
  {
    key: "users",
    title: "用户管理",
    path: "/users",
    phase: "P0",
    group: "工作台",
    adminOnly: true,
  },
  {
    key: "audit",
    title: "操作审计",
    path: "/audit",
    phase: "P0",
    group: "工作台",
    adminOnly: true,
  },
  {
    key: "tasks",
    title: "任务规划",
    path: "/tasks",
    phase: "P1",
    group: "工作台",
  },
  { key: "catalog", title: "Catalog", path: "/catalog", phase: "P1", group: "选品与上架" },
  { key: "selection", title: "市场情报", path: "/selection", phase: "P1", group: "选品与上架" },
  { key: "best-sell", title: "Best Sell", path: "/best-sell", phase: "P1", group: "选品与上架" },
  { key: "listing", title: "Listing", path: "/listing", phase: "P1", group: "选品与上架" },
  {
    key: "info-check",
    title: "信息检查",
    path: "/info-check",
    phase: "P1",
    group: "选品与上架",
  },
  { key: "ads", title: "广告管理", path: "/ads", phase: "P2", group: "经营分析" },
  {
    key: "sales",
    title: "销量统计",
    path: "/sales",
    phase: "P1",
    group: "经营分析",
    roles: ["admin", "ops_lead"],
  },
  {
    key: "finance",
    title: "财务报表",
    path: "/finance",
    phase: "P2",
    group: "经营分析",
    adminOnly: true,
  },
  {
    key: "bom-cost",
    title: "成本核算",
    path: "/bom-cost",
    phase: "P2",
    group: "经营分析",
    adminOnly: true,
  },
  {
    key: "docs-assist",
    title: "文档助手",
    path: "/docs-assist",
    phase: "P2",
    group: "经营分析",
  },
  {
    key: "daily-brief",
    title: "日报简报",
    path: "/daily-brief",
    phase: "P1",
    group: "经营分析",
    adminOnly: true,
  },
  {
    key: "ops-daily",
    title: "日更流水线",
    path: "/ops-daily",
    phase: "P1",
    group: "经营分析",
    roles: ["admin", "ops_lead", "ops"],
  },
  {
    key: "purchase",
    title: "采购管理",
    path: "/purchase",
    phase: "P2",
    group: "供应链",
    roles: ["admin", "purchase"],
  },
  { key: "replenish", title: "补货计划", path: "/replenish", phase: "P2", group: "供应链" },
  { key: "shipping", title: "物流管理", path: "/shipping", phase: "P2", group: "供应链" },
  {
    key: "ticket-ledger",
    title: "票货台账",
    path: "/ticket-ledger",
    phase: "P2",
    group: "供应链",
  },
  { key: "campaigns", title: "活动管理", path: "/campaigns", phase: "P2", group: "增长" },
];
