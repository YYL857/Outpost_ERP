/**
 * 运营面板 48 列（与 FLOW OUTPOST_LOCK / golden 表头一致）。
 * phase: 1=Phase1 填值；2/3/4=后续；manual=飞书旁路可空；equiv=等价映射。
 */
export type PanelPhase = 1 | 2 | 3 | 4 | "manual" | "equiv";

export type PanelColumnSpec = {
  name: string;
  phase: PanelPhase;
  /** Outpost 源说明 */
  source: string;
};

export const PANEL_COLUMNS: PanelColumnSpec[] = [
  { name: "日期", phase: 1, source: "asOf（Asia/Shanghai）" },
  { name: "PSKU", phase: 1, source: "catalog.partnerSku" },
  { name: "SKU", phase: 1, source: "catalog.noonSku" },
  { name: "产品名称", phase: 1, source: "catalog.title" },
  {
    name: "入仓天数",
    phase: 3,
    source: "FBN detailed FIFO 首次 inbound→asOf（含当天）；无流水=入仓天数缺失",
  },
  {
    name: "当前在线状态",
    phase: 1,
    source: "catalog.isActive → 在线/不在线",
  },
  {
    name: "在线价",
    phase: 1,
    source: "catalog.activePrice ?? catalog.price",
  },
  {
    name: "30销量",
    phase: 1,
    source: "sales_export 行级；排除 invalid_order_statuses；按 SKU 计行数",
  },
  {
    name: "30访客",
    phase: 2,
    source:
      "productviews raw Your_Visitors 30d Σ（portal-imports/cache/FLOW 浏览转化报表）",
  },
  {
    name: "30转化率",
    phase: 2,
    source: "Shipped_Units_sum / 30访客",
  },
  {
    name: "近30天退货率",
    phase: 1,
    source: "sales_export Returned 行数 / 窗口内全部行数",
  },
  { name: "链接状态", phase: "manual", source: "飞书日报旁路；v1 可空" },
  { name: "产品主等级", phase: "manual", source: "飞书日报旁路；v1 可空" },
  { name: "操作备注", phase: "manual", source: "飞书日报旁路；v1 可空" },
  { name: "问题标签汇总", phase: "manual", source: "飞书日报旁路；v1 可空" },
  {
    name: "广告亏损判断标签",
    phase: 2,
    source: "由 7/15/30 窗标签近似汇总（与 Prep 毛利阈值可分报）",
  },
  { name: "清货优先级", phase: "manual", source: "飞书日报旁路；v1 可空" },
  {
    name: "库龄风险等级",
    phase: 3,
    source:
      "五桶：正常/轻度老化/中度积压/重度积压/超长期积压；无流水=入仓天数缺失",
  },
  { name: "365天以上", phase: 3, source: "FBN detailed FIFO 剩余件数" },
  { name: "271-365天", phase: 3, source: "同上" },
  { name: "181-270天", phase: 3, source: "同上" },
  { name: "91-180天", phase: 3, source: "同上" },
  { name: "0-90天", phase: 3, source: "同上" },
  {
    name: "FBN",
    phase: 1,
    source: "stock 按 warehouse_map.fbn_warehouses 汇总 qty",
  },
  {
    name: "supermall",
    phase: 1,
    source: "stock 非 FBN 仓汇总 qty（default_channel）",
  },
  {
    name: "空运在途",
    phase: 3,
    source: "装箱明细在途 × mode=air；缺则 feishuOpsSnapshots",
  },
  {
    name: "海运在途",
    phase: 3,
    source: "装箱明细在途 × mode=sea；缺则 feishuOpsSnapshots",
  },
  {
    name: "已采购数量",
    phase: 3,
    source: "purchaseLines 未关闭（非已到/完成/取消）；缺则日报快照",
  },
  { name: "空运计划补货", phase: "manual", source: "飞书日报；v1 可空" },
  { name: "海运计划补货", phase: "manual", source: "飞书日报；v1 可空" },
  { name: "后台库存比例", phase: "manual", source: "Prep 派生；v1 可空" },
  { name: "空运补货比例", phase: "manual", source: "Prep 派生；v1 可空" },
  { name: "总补货比例", phase: "manual", source: "Prep 派生；v1 可空" },
  {
    name: "7天广告盈亏标签",
    phase: 2,
    source: "portal ads_sku 单日 CSV + state 单日 facts，7d 窗",
  },
  { name: "7广告花费", phase: 2, source: "Σspend 7d（Noon SKU）" },
  { name: "7广告订单", phase: 2, source: "Σorders 7d" },
  { name: "7广告销售额", phase: 2, source: "Σrevenue 7d" },
  { name: "7ROAS", phase: 2, source: "revenue/spend 7d；不亏阈值 ROAS≥1" },
  { name: "15天广告盈亏标签", phase: 2, source: "同上 15d" },
  { name: "15广告花费", phase: 2, source: "同上 15d" },
  { name: "15广告订单", phase: 2, source: "同上 15d" },
  { name: "15广告销售额", phase: 2, source: "同上 15d" },
  { name: "15ROAS", phase: 2, source: "同上 15d" },
  { name: "30天广告盈亏标签", phase: 2, source: "同上 30d" },
  { name: "30广告花费", phase: 2, source: "同上 30d" },
  { name: "30广告订单", phase: 2, source: "同上 30d" },
  { name: "30广告销售额", phase: 2, source: "同上 30d" },
  { name: "30ROAS", phase: 2, source: "同上 30d" },
];

export const PANEL_HEADER = PANEL_COLUMNS.map((c) => c.name);

/** 毛利三列：面板无此列；等价映射（Phase4 / sku_enrich 旁路） */
export const MARGIN_EQUIV = {
  note: "运营面板 48 列不含海运/空运/单品毛利率；等价用 Catalog assemble",
  map: {
    海运毛利率: "assemble.margin when !preferAir（海运头程）",
    空运毛利率: "assemble.margin when preferAir（空运头程）",
    单品毛利率: "assemble.margin（当前 prefer 模式单一毛利）",
    preferAir: "skuLocalCosts.preferAir",
    cargoType: "skuLocalCosts.cargoType（海运分档 plug/builtin/general）",
  },
} as const;
