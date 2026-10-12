/**
 * Outpost 表级 Schema Map：字段清单 + 跨表关联（给 Agent / LLM 用）。
 * 不承载行级内容；行级联查走 wiki-graph lookup / context-pack。
 */

export type SchemaField = {
  name: string;
  role: "key" | "attr" | "measure" | "status" | "ref";
  aliases?: string[];
  note?: string;
};

export type SchemaJoin = {
  fromTable: string;
  fromField: string;
  toTable: string;
  toField: string;
  /** 通过该关联能查到什么 */
  yields: string;
  viaKeyType?: string;
  /** 1:1 / 1:N 等，防止 Agent 加总算错 */
  cardinality?: "1:1" | "1:N" | "N:1" | "N:N";
  /** 联查时易错点（不必读全表也能避开） */
  pitfalls?: string[];
  /** 有具体键后优先调的 API / 模块 */
  preferredApi?: string;
};

export type SchemaTable = {
  id: string;
  label: string;
  kind: "feishu_sheet" | "feishu_bitable" | "app_state" | "portal_csv" | "api";
  source: string;
  purpose: string;
  fields: SchemaField[];
  /** Agent 默认读哪些字段就够推理，勿吞全文 */
  agentFocus: string[];
};

export type SchemaMap = {
  version: 1;
  title: string;
  principle: string;
  tables: SchemaTable[];
  joins: SchemaJoin[];
  keyTypes: Array<{
    keyType: string;
    meaning: string;
    primaryTables: string[];
  }>;
  agentProtocol: string[];
};

export const OUTPOST_SCHEMA_MAP: SchemaMap = {
  version: 1,
  title: "Outpost ERP Schema Wiki",
  principle:
    "Agent 只需掌握「表有哪些字段、字段如何连到别的表」；不要通读行内容。有具体键时用 /api/wiki-graph/context-pack 跳转。",
  tables: [
    {
      id: "feishu.packing.boxes",
      label: "装箱表·箱表",
      kind: "feishu_sheet",
      source: "feishu:packing / 箱表",
      purpose: "一箱一行：货代轨迹与整票/箱级费用主源",
      agentFocus: ["箱号", "票号", "物流编号", "货代名称", "到仓情况"],
      fields: [
        { name: "箱号", role: "key", note: "boxNo" },
        { name: "票号", role: "key", note: "ticketNo；货代轨迹常用" },
        { name: "物流编号", role: "key", note: "logisticsNo；部分货代用此号查" },
        { name: "货代名称", role: "key", aliases: ["货代", "承运商"] },
        { name: "运输方式", role: "attr" },
        { name: "产品PCS-箱级", role: "measure", aliases: ["PCS", "数量"] },
        { name: "FBA号/ASN号", role: "ref", aliases: ["ASN号", "FBA号"] },
        { name: "发货时间", role: "attr" },
        { name: "送仓时间", role: "attr", aliases: ["到仓时间", "入库时间"] },
        { name: "到仓情况", role: "status" },
        { name: "整票国内运费", role: "measure" },
        { name: "整票跨境实付", role: "measure" },
        { name: "实收跨境费", role: "measure", note: "箱级" },
        { name: "货物重量", role: "measure", aliases: ["实际重量", "重量"] },
        { name: "方数", role: "measure", aliases: ["CBM", "体积"] },
        { name: "长/宽/高", role: "attr" },
        { name: "结账与否", role: "status" },
      ],
    },
    {
      id: "feishu.packing.lines",
      label: "装箱表·装箱明细",
      kind: "feishu_sheet",
      source: "feishu:packing / 装箱明细",
      purpose: "箱内 SKU 行：箱号↔PSKU 数量与单重",
      agentFocus: ["箱号", "PSKU", "数量", "物流编号"],
      fields: [
        { name: "PSKU", role: "key", aliases: ["Partner SKU"] },
        { name: "名称", role: "attr" },
        { name: "数量", role: "measure", aliases: ["件数", "PCS"] },
        { name: "箱号", role: "key" },
        { name: "产品单重", role: "measure" },
        { name: "产品重量合计", role: "measure" },
        { name: "物流编号", role: "key" },
        { name: "FBA号/ASN号", role: "ref" },
        { name: "运输方式", role: "attr" },
        { name: "货代名称", role: "key" },
      ],
    },
    {
      id: "feishu.accounts.purchase",
      label: "账目表·产品采购",
      kind: "feishu_sheet",
      source: "feishu:accounts / 产品采购",
      purpose: "采购行：成本、1688 订单与国内快递",
      agentFocus: ["PSKU", "订单号", "快递单号", "采购单价", "在途状态"],
      fields: [
        { name: "PSKU", role: "key" },
        { name: "名称", role: "attr", aliases: ["产品名称", "品名"] },
        { name: "数量", role: "measure", aliases: ["采购数量"] },
        { name: "采购时间", role: "attr", aliases: ["采购日期"] },
        { name: "订单号", role: "key", aliases: ["1688订单号"], note: "orderId" },
        { name: "采购单价", role: "measure" },
        { name: "实付款", role: "measure", aliases: ["采购金额", "金额"] },
        { name: "在途状态", role: "status" },
        { name: "快递单号", role: "key", aliases: ["物流单号", "运单号"] },
        { name: "供应商", role: "attr" },
        { name: "备注", role: "attr" },
      ],
    },
    {
      id: "feishu.accounts.cash",
      label: "账目表·入账/开支",
      kind: "feishu_sheet",
      source: "feishu:accounts / 公司入账|公司开支-杂项",
      purpose: "现金流水（一般不按箱号联查）",
      agentFocus: ["金额", "类别", "日期"],
      fields: [
        { name: "金额", role: "measure" },
        { name: "类别", role: "attr", aliases: ["分类"] },
        { name: "日期", role: "attr" },
        { name: "备注", role: "attr" },
      ],
    },
    {
      id: "feishu.product.costs",
      label: "产品表·成本/尺寸",
      kind: "feishu_sheet",
      source: "feishu:product / 产品|每日信息|到仓成本|查找代码表",
      purpose: "本地采购成本、到仓成本、尺寸、货型；Catalog 组装输入",
      agentFocus: ["PSKU", "采购成本", "头程偏好", "货型", "长宽高重量"],
      fields: [
        { name: "PSKU", role: "key" },
        { name: "采购成本", role: "measure" },
        { name: "头程/补货方式", role: "attr", note: "空运/海运/单品" },
        { name: "货型", role: "attr", note: "普货/插电/内置电" },
        { name: "长宽高/重量", role: "attr" },
        { name: "查找代码表", role: "ref", note: "拼 PSKU 用" },
      ],
    },
    {
      id: "feishu.daily",
      label: "日报",
      kind: "feishu_sheet",
      source: "feishu:daily / 日期 sheet",
      purpose: "按日运营标签：补货、在途、广告标记",
      agentFocus: ["PSKU", "补货计划", "空海在途", "广告标记"],
      fields: [
        { name: "PSKU", role: "key" },
        { name: "FBN/库存相关列", role: "attr" },
        { name: "空运在途/海运在途", role: "measure" },
        { name: "补货计划", role: "attr" },
        { name: "广告/库龄标签", role: "status" },
      ],
    },
    {
      id: "feishu.freight_rates",
      label: "货代大纲",
      kind: "feishu_bitable",
      source: "feishu:freight-rates",
      purpose: "货代×货型空运/海运报价",
      agentFocus: ["货代名称", "普货", "带电", "敏货", "额外费用"],
      fields: [
        { name: "文本", role: "key", note: "货代名称" },
        { name: "普货", role: "measure" },
        { name: "带电普货", role: "measure" },
        { name: "敏货", role: "measure" },
        { name: "敏货带电", role: "measure" },
        { name: "灯具", role: "measure" },
        { name: "额外费用", role: "attr" },
      ],
    },
    {
      id: "state.catalog",
      label: "Catalog / AppState",
      kind: "app_state",
      source: "shops/{shopId}/json/state.json",
      purpose: "店铺商品主数据枢纽：售价、库存、销量、费用、本地成本",
      agentFocus: ["partnerSku", "stock", "sales", "fees", "skuLocalCosts"],
      fields: [
        { name: "partnerSku", role: "key" },
        { name: "noonSku", role: "key" },
        { name: "catalog.*", role: "attr" },
        { name: "stock.*", role: "measure" },
        { name: "salesFacts", role: "measure" },
        { name: "feeSnapshots / feeEstimates", role: "measure" },
        { name: "skuLocalCosts / skuDims", role: "measure" },
        { name: "feishuOpsSnapshots", role: "attr", note: "来自日报" },
        { name: "purchaseLines", role: "ref", note: "来自账目采购" },
      ],
    },
    {
      id: "noon.impex",
      label: "Noon Impex / portal-imports",
      kind: "portal_csv",
      source: "Impex API 或 portal-imports CSV",
      purpose: "平台侧 catalog/orders/stock/sales/fees/invoices/ads",
      agentFocus: ["partner_sku", "order", "inventory"],
      fields: [
        { name: "partner_sku", role: "key" },
        { name: "order_nr", role: "key" },
        { name: "warehouse / FBN", role: "attr" },
        { name: "date / campaign", role: "attr" },
      ],
    },
    {
      id: "forwarder.portals",
      label: "货代 Portal 轨迹",
      kind: "api",
      source: "platforms/forwarder-portals",
      purpose: "用票号或物流编号查在途轨迹（按货代选键）",
      agentFocus: ["票号或物流编号", "货代"],
      fields: [
        { name: "trackKey", role: "key", note: "票号或物流编号，因货代而异" },
        { name: "forwarder", role: "key" },
        { name: "status / events", role: "status" },
      ],
    },
    {
      id: "alibaba.1688",
      label: "1688 采购物流",
      kind: "api",
      source: "platforms/alibaba-1688",
      purpose: "用采购订单号/快递单号回填国内物流",
      agentFocus: ["订单号", "快递单号"],
      fields: [
        { name: "orderId", role: "key" },
        { name: "trackingNo", role: "key" },
        { name: "eta / status", role: "status" },
      ],
    },
  ],
  joins: [
    {
      fromTable: "feishu.packing.boxes",
      fromField: "箱号",
      toTable: "feishu.packing.lines",
      toField: "箱号",
      yields: "箱内有哪些 PSKU 及数量",
      viaKeyType: "boxNo",
      cardinality: "1:N",
      preferredApi: "GET /api/wiki-graph/context-pack?keyType=boxNo",
      pitfalls: ["一箱多 SKU；数量在明细行，不在箱表 PCS 与明细简单等同"],
    },
    {
      fromTable: "feishu.packing.lines",
      fromField: "PSKU",
      toTable: "state.catalog",
      toField: "partnerSku",
      yields: "售价、库存、销量、本地成本、FBN",
      viaKeyType: "partnerSku",
      cardinality: "N:1",
      preferredApi: "GET /api/catalog（或店铺 state）",
      pitfalls: ["同一 PSKU 可能出现在多箱；Catalog 是店铺级枢纽"],
    },
    {
      fromTable: "feishu.packing.boxes",
      fromField: "票号",
      toTable: "forwarder.portals",
      toField: "trackKey",
      yields: "货代在途/签收轨迹（部分货代用票号）",
      viaKeyType: "ticketNo",
      cardinality: "N:1",
      preferredApi: "shipping-ops / forwarder-portals track",
      pitfalls: [
        "同票多箱：整票跨境费按票号去重再加总，勿按箱重复加",
        "不是所有货代都用票号作查询键",
      ],
    },
    {
      fromTable: "feishu.packing.boxes",
      fromField: "物流编号",
      toTable: "forwarder.portals",
      toField: "trackKey",
      yields: "货代轨迹（部分货代用物流编号）",
      viaKeyType: "logisticsNo",
      cardinality: "N:1",
      preferredApi: "shipping-ops / forwarder-portals track",
      pitfalls: ["查轨迹前先看箱表货代名称，再选票号或物流编号"],
    },
    {
      fromTable: "feishu.packing.boxes",
      fromField: "货代名称",
      toTable: "feishu.freight_rates",
      toField: "文本",
      yields: "该货代空运/海运报价带",
      viaKeyType: "forwarder",
      cardinality: "N:1",
      preferredApi: "GET /api/wiki-graph/context-pack?keyType=forwarder",
      pitfalls: ["大纲是报价带不是实付；实付看箱表整票/箱级费用"],
    },
    {
      fromTable: "feishu.accounts.purchase",
      fromField: "PSKU",
      toTable: "state.catalog",
      toField: "partnerSku",
      yields: "采购成本行 ↔ 店铺商品",
      viaKeyType: "partnerSku",
      cardinality: "N:1",
      preferredApi: "GET /api/purchase",
      pitfalls: ["同一 PSKU 可有多笔采购订单"],
    },
    {
      fromTable: "feishu.accounts.purchase",
      fromField: "订单号",
      toTable: "alibaba.1688",
      toField: "orderId",
      yields: "国内采购物流进度",
      viaKeyType: "orderId",
      cardinality: "1:1",
      preferredApi: "purchase 1688 物流同步",
      pitfalls: ["订单号需先去空格；无登录态则无法回填"],
    },
    {
      fromTable: "feishu.accounts.purchase",
      fromField: "快递单号",
      toTable: "alibaba.1688",
      toField: "trackingNo",
      yields: "用运单号反查/核对物流",
      viaKeyType: "trackingNo",
      cardinality: "N:1",
      preferredApi: "purchase 1688 物流同步",
    },
    {
      fromTable: "feishu.product.costs",
      fromField: "PSKU",
      toTable: "state.catalog",
      toField: "partnerSku",
      yields: "本地成本与尺寸写入 Catalog 组装",
      viaKeyType: "partnerSku",
      cardinality: "1:1",
      preferredApi: "Catalog assemble / skuLocalCosts",
    },
    {
      fromTable: "feishu.daily",
      fromField: "PSKU",
      toTable: "state.catalog",
      toField: "partnerSku",
      yields: "日报补货/在途标签",
      viaKeyType: "partnerSku",
      cardinality: "1:1",
      preferredApi: "daily-brief / feishuOpsSnapshots",
      pitfalls: ["日报按日期 sheet，取最近有效日即可，勿扫历史全表"],
    },
    {
      fromTable: "noon.impex",
      fromField: "partner_sku",
      toTable: "state.catalog",
      toField: "partnerSku",
      yields: "平台导出落入 AppState",
      viaKeyType: "partnerSku",
      cardinality: "1:1",
      preferredApi: "noon sync / portal-imports",
    },
    {
      fromTable: "feishu.packing.lines",
      fromField: "PSKU",
      toTable: "feishu.accounts.purchase",
      toField: "PSKU",
      yields: "发货箱内 SKU 的采购订单与单价",
      viaKeyType: "partnerSku",
      cardinality: "N:N",
      preferredApi: "context-pack(partnerSku) → purchase",
      pitfalls: ["装箱与采购无直接箱号连接，只能经 PSKU；时间上采购早于发货"],
    },
  ],
  keyTypes: [
    {
      keyType: "boxNo",
      meaning: "装箱箱号",
      primaryTables: ["feishu.packing.boxes", "feishu.packing.lines"],
    },
    {
      keyType: "ticketNo",
      meaning: "货代票号",
      primaryTables: ["feishu.packing.boxes", "forwarder.portals"],
    },
    {
      keyType: "logisticsNo",
      meaning: "物流编号",
      primaryTables: ["feishu.packing.boxes", "forwarder.portals"],
    },
    {
      keyType: "partnerSku",
      meaning: "伙伴 SKU / PSKU（全库枢纽）",
      primaryTables: [
        "feishu.packing.lines",
        "feishu.accounts.purchase",
        "feishu.product.costs",
        "feishu.daily",
        "state.catalog",
        "noon.impex",
      ],
    },
    {
      keyType: "forwarder",
      meaning: "货代名称",
      primaryTables: ["feishu.packing.boxes", "feishu.freight_rates"],
    },
    {
      keyType: "orderId",
      meaning: "1688/采购订单号",
      primaryTables: ["feishu.accounts.purchase", "alibaba.1688"],
    },
    {
      keyType: "trackingNo",
      meaning: "国内快递单号",
      primaryTables: ["feishu.accounts.purchase", "alibaba.1688"],
    },
  ],
  agentProtocol: [
    "默认 GET /api/wiki-graph/agent-preload（压缩卡）；勿先读全量 schema-map。",
    "有箱号/票号/物流号/PSKU/订单号：GET /api/wiki-graph/context-pack?keyType=&keyValue=。",
    "按 join.api / preferredApi 调业务接口；细节不够再 GET /schema-map。",
    "禁止通读飞书表/CSV；行级实例图只做键跳转加速。",
  ],
};

export function schemaMapToMarkdown(map: SchemaMap = OUTPOST_SCHEMA_MAP): string {
  const lines: string[] = [
    `# ${map.title}`,
    "",
    map.principle,
    "",
    "## Agent 协议",
    ...map.agentProtocol.map((p) => `- ${p}`),
    "",
    "## 键类型",
    ...map.keyTypes.map(
      (k) =>
        `- \`${k.keyType}\`：${k.meaning} ← ${k.primaryTables.join(", ")}`,
    ),
    "",
    "## 表与字段",
  ];
  for (const t of map.tables) {
    lines.push("", `### ${t.label} (\`${t.id}\`)`, t.purpose, "");
    lines.push(`焦点：${t.agentFocus.join(" · ")}`, "");
    for (const f of t.fields) {
      const al = f.aliases?.length ? ` / ${f.aliases.join(",")}` : "";
      const note = f.note ? ` — ${f.note}` : "";
      lines.push(`- **${f.name}** [${f.role}]${al}${note}`);
    }
  }
  lines.push("", "## 跨表关联");
  for (const j of map.joins) {
    lines.push(
      `- \`${j.fromTable}.${j.fromField}\` → \`${j.toTable}.${j.toField}\`：${j.yields}` +
        (j.viaKeyType ? ` (keyType=${j.viaKeyType})` : "") +
        (j.cardinality ? ` [${j.cardinality}]` : ""),
    );
    if (j.preferredApi) lines.push(`  - API: ${j.preferredApi}`);
    if (j.pitfalls?.length) {
      for (const p of j.pitfalls) lines.push(`  - 注意: ${p}`);
    }
  }
  return lines.join("\n");
}
