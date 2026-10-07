export type ModuleKey =
  | "home"
  | "sync-health"
  | "schedulers"
  | "noon"
  | "catalog"
  | "selection"
  | "best-sell"
  | "listing"
  | "favorites"
  | "ads"
  | "sales"
  | "finance"
  | "daily-brief"
  | "purchase"
  | "replenish"
  | "shipping"
  | "amazon"
  | "alibaba"
  | "campaigns";

export type AppModule = {
  key: ModuleKey;
  title: string;
  path: string;
  phase: "P0" | "P1" | "P2" | "P3";
  group: string;
};

export const MODULES: AppModule[] = [
  { key: "home", title: "我的主页", path: "/", phase: "P0", group: "工作台" },
  {
    key: "sync-health",
    title: "同步健康",
    path: "/sync-health",
    phase: "P0",
    group: "工作台",
  },
  {
    key: "schedulers",
    title: "定时任务",
    path: "/schedulers",
    phase: "P0",
    group: "工作台",
  },
  {
    key: "noon",
    title: "NOON 接入",
    path: "/noon",
    phase: "P0",
    group: "工作台",
  },
  { key: "catalog", title: "Catalog", path: "/catalog", phase: "P1", group: "选品与上架" },
  { key: "selection", title: "市场情报", path: "/selection", phase: "P1", group: "选品与上架" },
  { key: "best-sell", title: "Best Sell", path: "/best-sell", phase: "P1", group: "选品与上架" },
  { key: "listing", title: "链接上架", path: "/listing", phase: "P1", group: "选品与上架" },
  { key: "favorites", title: "收藏列表", path: "/favorites", phase: "P3", group: "选品与上架" },
  { key: "ads", title: "广告管理", path: "/ads", phase: "P2", group: "经营分析" },
  { key: "sales", title: "销量统计", path: "/sales", phase: "P1", group: "经营分析" },
  { key: "finance", title: "财务报表", path: "/finance", phase: "P2", group: "经营分析" },
  {
    key: "daily-brief",
    title: "日报简报",
    path: "/daily-brief",
    phase: "P1",
    group: "经营分析",
  },
  { key: "purchase", title: "采购管理", path: "/purchase", phase: "P2", group: "供应链" },
  { key: "replenish", title: "补货计划", path: "/replenish", phase: "P2", group: "供应链" },
  { key: "shipping", title: "发货管理", path: "/shipping", phase: "P2", group: "供应链" },
  { key: "amazon", title: "亚马逊上架", path: "/amazon", phase: "P3", group: "供应链" },
  { key: "alibaba", title: "1688 上架", path: "/alibaba", phase: "P3", group: "供应链" },
  { key: "campaigns", title: "活动管理", path: "/campaigns", phase: "P2", group: "增长" },
];
