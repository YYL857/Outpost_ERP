/**
 * Noon Seller Lab 操作向导（影刀对齐后的权威卡片）。
 *
 * 规则：
 * - 后台点击以英文原文为准（menu[].en）
 * - 展示给用户用中英对照 formatPath
 * - status=confirmed：已用影刀落盘 URL / 截图核实
 * - status=pending：侧栏有文案，落地页待补图确认
 */

import {
  L,
  formatLabel,
  formatPath,
  type NoonLabel,
} from "./noon-guide-labels";

export type NoonGuideStatus = "confirmed" | "pending";

export type NoonGuideEntry = {
  id: string;
  /** 中文场景名（用户搜索主文案） */
  title: string;
  section: string;
  /** 点击路径：中英对照 */
  menu: NoonLabel[];
  why: string;
  steps: string[];
  keywords: string[];
  status: NoonGuideStatus;
  /** 影刀采到的落地 URL（可含 project 占位说明） */
  landingUrl?: string;
  note?: string;
};

export type NoonGuideHit = {
  entry: NoonGuideEntry;
  score: number;
};

export { formatLabel, formatPath };

export const NOON_GUIDE: NoonGuideEntry[] = [
  // —— Home（早先截图确认）——
  {
    id: "home-dashboard",
    title: "看店铺总览 / 回首页",
    section: "首页",
    menu: [L.home],
    why: "进后台后的总览页，标题是 Store Dashboard（店铺看板）。",
    steps: [
      `左侧点 ${formatLabel(L.home)}（房子图标）。`,
      "落地页标题：Store Dashboard（店铺看板）。",
      "可看 Sales、Ad Sales、Account Health、Live SKUs、Pending Orders 等概览。",
      "完整功能菜单在左上角汉堡（三道杠）里；窄侧栏只有 Home / Set up guide。",
    ],
    keywords: ["首页", "home", "总览", "看板", "store dashboard", "店铺看板"],
    status: "confirmed",
    landingUrl: "https://noon-store.noon.partners/en/{store}/home?project={project}",
    note: "用户截图确认页眉 Store Dashboard。",
  },

  // —— Catalog：影刀 URL 已确认 4 条 ——
  {
    id: "catalog-add-product",
    title: "新建 / 添加商品",
    section: "商品目录",
    menu: [L.catalog, L.addProduct],
    why: "从 Catalog 进入创建商品流程。",
    steps: [
      "左上角汉堡打开主菜单。",
      `点 ${formatLabel(L.catalog)} → ${formatLabel(L.addProduct)}。`,
      "落地在 noon-catalog 的创建页（/catalog/create）。",
    ],
    keywords: [
      "上新",
      "新建商品",
      "添加商品",
      "add product",
      "创建sku",
      "刊登",
      "新品",
    ],
    status: "confirmed",
    landingUrl:
      "https://noon-catalog.noon.partners/en/catalog/create?project={project}",
    note: "影刀 2026-09-21 PRJ396770 URL 对齐。",
  },
  {
    id: "catalog-my-catalog",
    title: "查看我的商品 / 在售列表",
    section: "商品目录",
    menu: [L.catalog, L.myCatalog],
    why: "已创建 SKU、售价、库存、是否 Live 都在这里。改价、改 FBP 库存也从这里进。",
    steps: [
      "左上角汉堡打开主菜单。",
      `点 ${formatLabel(L.catalog)} → ${formatLabel(L.myCatalog)}。`,
      "落地 /catalog，站点常带 tab=noon。",
      "用 Partner SKU 或标题搜索；看 Live Status 判断为何没上架。",
    ],
    keywords: [
      "在售",
      "我的商品",
      "商品列表",
      "my catalog",
      "没上架",
      "not live",
      "链接",
    ],
    status: "confirmed",
    landingUrl:
      "https://noon-catalog.noon.partners/en/catalog?project={project}&tab=noon",
    note: "影刀对齐；站点自动追加 tab=noon。",
  },
  {
    id: "catalog-imports",
    title: "批量导入商品 / 内容",
    section: "商品目录",
    menu: [L.catalog, L.imports],
    why: "上传表格做批量创建或更新内容。",
    steps: [
      "左上角汉堡打开主菜单。",
      `点 ${formatLabel(L.catalog)} → ${formatLabel(L.imports)}。`,
      "落地 /imports（常见 tab=noon_catalog_content）。",
    ],
    keywords: ["导入", "imports", "批量上传", "表格上传", "nis"],
    status: "confirmed",
    landingUrl:
      "https://noon-catalog.noon.partners/en/imports?tab=noon_catalog_content&project={project}",
    note: "影刀对齐；站点自动追加 tab。",
  },
  {
    id: "catalog-exports",
    title: "导出商品 / 价格 / 库存表",
    section: "商品目录",
    menu: [L.catalog, L.exports],
    why: "下载 Catalog、Price、Stock 等导出，用于对账和批量改。",
    steps: [
      "左上角汉堡打开主菜单。",
      `点 ${formatLabel(L.catalog)} → ${formatLabel(L.exports)}。`,
      "落地 /exports；再在页内 Add Export 选类型。",
    ],
    keywords: ["导出", "exports", "下载表格", "价格模板", "库存模板"],
    status: "confirmed",
    landingUrl:
      "https://noon-catalog.noon.partners/en/exports?project={project}",
    note: "影刀 2026-09-21 URL 对齐；页内子操作待补图。",
  },

  // —— Catalog：侧栏有，落地待补图 ——
  {
    id: "catalog-noon-catalog",
    title: "浏览 noon 公共商品库（管控品牌跟卖）",
    section: "商品目录",
    menu: [L.catalog, L.noonCatalog],
    why: "在 noon Catalog 里按 SKU / URL / 品牌查找管控品牌商品并做映射。",
    steps: [
      `汉堡 → ${formatLabel(L.catalog)} → ${formatLabel(L.noonCatalog)}。`,
      "页眉标题：noon Catalog；说明为 Find and map products of gated brands directly。",
      "可用 SKU or noon URL、Brand、Product Family / Type / Subtype 筛选后搜索。",
    ],
    keywords: ["noon catalog", "公共目录", "跟卖", "管控品牌", "gated", "映射"],
    status: "confirmed",
    landingUrl:
      "https://noon-catalog.noon.partners/en/noon-catalog?project={project}",
    note: "影刀补图 2026-09-21 PRJ482387 确认。",
  },
  {
    id: "catalog-brand-catalog",
    title: "浏览品牌目录",
    section: "商品目录",
    menu: [L.catalog, L.brandCatalog],
    why: "按品牌查看可关联商品；左侧搜 SKU，右侧看详情。",
    steps: [
      `汉堡 → ${formatLabel(L.catalog)} → ${formatLabel(L.brandCatalog)}。`,
      "页眉标题：Brand Catalog；左侧 Search for SKU，右侧 Select a product。",
    ],
    keywords: ["brand catalog", "品牌目录", "品牌商品"],
    status: "confirmed",
    landingUrl:
      "https://noon-catalog.noon.partners/en/brand-catalog?project={project}",
    note: "影刀补图确认；空店时显示 No Products 仍算落地正确。",
  },
  {
    id: "catalog-my-brands",
    title: "管理我的品牌",
    section: "商品目录",
    menu: [L.catalog, L.myBrands],
    why: "申请 / 查看店铺品牌：可查 noon 是否已有该品牌，并看 Pending / Approved / Rejected。",
    steps: [
      `汉堡 → ${formatLabel(L.catalog)} → ${formatLabel(L.myBrands)}。`,
      "页眉标题：My Brands。",
      "上方 Check Brand 可查品牌是否已存在；Create New Brand 创建新品牌。",
      "下方 Tab：Pending / Approved / Rejected；表列含 Brand Name、Created At、Updated At、Image URL、Verification Link。",
    ],
    keywords: ["my brands", "我的品牌", "品牌授权", "创建品牌", "brand management"],
    status: "confirmed",
    landingUrl:
      "https://noon-catalog.noon.partners/en/brand-management?project={project}",
    note: "用户截图确认 2026-09-21；勿用错误路径 /brands。",
  },
  {
    id: "catalog-service-centers",
    title: "厂家服务中心",
    section: "商品目录",
    menu: [L.catalog, L.serviceCenters],
    why: "管理 Manufacturer Service Centers（厂家服务网点 / 售后点）。",
    steps: [
      `汉堡 → ${formatLabel(L.catalog)} → ${formatLabel(L.serviceCenters)}。`,
      "页眉标题：Manufacturer Service Centers；可 + Add Service Center。",
      "Tab：Directory / My Requests；可按 Brand、Family、Product Type 筛选，Search by partner SKU。",
    ],
    keywords: [
      "service centers",
      "服务中心",
      "售后点",
      "厂家服务",
      "manufacturer",
    ],
    status: "confirmed",
    landingUrl:
      "https://noon-catalog.noon.partners/en/service-center-management?project={project}",
    note: "用户截图确认 2026-09-21；勿用错误路径 /service-centers（会 404）。",
  },

  // —— 常用场景（落在已确认 My Catalog 上）——
  {
    id: "catalog-price",
    title: "修改售价",
    section: "商品目录",
    menu: [L.catalog, L.myCatalog],
    why: "顾客看到的价格在我的商品里改。",
    steps: [
      `进入 ${formatPath([L.catalog, L.myCatalog])}。`,
      "搜到 SKU，点开商品或价格列。",
      `在 ${formatLabel(L.offer)} 里改 Price 后保存。`,
      "批量改价走 Exports 的 Price 模板，再 Imports 传回。",
    ],
    keywords: ["改价", "调价", "售价", "价格", "price", "定价"],
    status: "confirmed",
    note: "入口已确认；Offer 页内操作待细图。",
  },
  {
    id: "catalog-stock",
    title: "修改自发货（FBP）库存",
    section: "商品目录",
    menu: [L.catalog, L.myCatalog],
    why: "FBP 库存在我的商品里改；FBN 要走入仓 ASN，不能手填仓内数量。",
    steps: [
      `进入 ${formatPath([L.catalog, L.myCatalog])}。`,
      `${formatLabel(L.stock)} 列点 Edit，选对仓库后保存。`,
    ],
    keywords: ["改库存", "fbp库存", "自发货库存", "stock", "库存"],
    status: "confirmed",
    note: "入口已确认；Stock 弹窗待细图。",
  },

  // —— Advertising：侧栏子项已确认，落地待影刀补图 ——
  {
    id: "ads-ad-manager",
    title: "打开广告管理后台",
    section: "广告",
    menu: [L.advertising, L.adManager],
    why: "站内付费广告：建活动、看花费/ROAS、导出报表都在这里。",
    steps: [
      "左上角汉堡打开主菜单。",
      `点 ${formatLabel(L.advertising)} → ${formatLabel(L.adManager)}。`,
      "落地页标题：Ad Manager；顶栏 Tab 有 Overview / Performance / Campaigns。",
      "Campaigns 里可筛 Live/Paused，右上 + Create Campaign；列表有 Export all campaigns。",
      "左侧还有 Billing、Vantage、Access Management、Settings（属 Ad Manager 内部菜单）。",
    ],
    keywords: [
      "广告",
      "投放",
      "ad manager",
      "广告后台",
      "花费",
      "roas",
      "advertising",
      "推广",
      "create campaign",
    ],
    status: "confirmed",
    landingUrl:
      "https://admanager.noon.partners/en-sa/home?project={project}&mpCode=noon&tab=campaigns",
    note: "影刀补图 2026-09-21 PRJ482387 确认。",
  },
  {
    id: "ads-external",
    title: "站外广告追踪链接",
    section: "广告",
    menu: [L.advertising, L.externalAds],
    why: "给站外投放生成 UTM 追踪链接，并看 Sessions / Orders / Revenue 等效果。",
    steps: [
      `汉堡 → ${formatLabel(L.advertising)} → ${formatLabel(L.externalAds)}。`,
      "落地域名：utmtracker.noon.partners；页眉标题：Campaigns Overview。",
      "可按国家、日期筛选；右上 + Generate UTM Campaign 生成追踪活动。",
      "下方可 Search campaign / Export；无数据时会提示 Looks like there's no data yet。",
    ],
    keywords: [
      "站外",
      "外链",
      "utm",
      "instagram",
      "google广告",
      "追踪链接",
      "external ads",
      "utmtracker",
    ],
    status: "confirmed",
    landingUrl:
      "https://utmtracker.noon.partners/en/?project={project}&x-locale=sa",
    note: "用户截图确认 2026-09-21；页内标题是 Campaigns Overview。",
  },
  {
    id: "ads-brand-store",
    title: "品牌店铺（Brand Store）",
    section: "广告",
    menu: [L.advertising, L.brandStore],
    why: "品牌店铺 / Stores 管理入口。部分账号可能无权限，会看到 Missing Access。",
    steps: [
      `汉堡 → ${formatLabel(L.advertising)} → ${formatLabel(L.brandStore)}。`,
      "落地域名：store.noon.partners；页内区域名 Stores。",
      "若提示 Seems like you're missing access?：找客户经理或 Seller Support 开通，不是菜单点错。",
    ],
    keywords: ["brand store", "品牌店铺", "品牌馆", "stores", "store.noon"],
    status: "confirmed",
    landingUrl: "https://store.noon.partners/en-sa/?project={project}",
    note: "用户截图确认 2026-09-21；本店账号当前无访问权限属正常业务状态。",
  },

  // —— Promotions：用户截图 2026-09-21 确认 ——
  {
    id: "promo-center",
    title: "打开促销中心",
    section: "促销活动",
    menu: [L.promotions, L.promotionsCenter],
    why: "促销总览：在跑活动数、促销销售额、可报名的 Deal / Coupon / Bundle。",
    steps: [
      `汉堡 → ${formatLabel(L.promotions)} → ${formatLabel(L.promotionsCenter)}。`,
      "落地 promotions.noon.partners；左侧高亮 Promotions Center。",
      "可看 Active campaigns、Promo sales、日历里的 Enroll，以及 Deals / Coupons / Bundles 入口卡片。",
    ],
    keywords: ["促销中心", "promotions center", "促销总览", "活动中心"],
    status: "confirmed",
    landingUrl: "https://promotions.noon.partners/en/?project={project}",
    note: "用户截图确认 2026-09-21。",
  },
  {
    id: "promo-deals",
    title: "报名活动 / Deals",
    section: "促销活动",
    menu: [L.promotions, L.deals],
    why: "查看已参加的 Deal，并报名 Category / Flash / Mega 等活动。",
    steps: [
      `汉堡 → ${formatLabel(L.promotions)} → ${formatLabel(L.deals)}。`,
      "落地 deals.noon.partners；页眉 Deals。",
      "Tab：My deals、Category deals、Flash deals、Mega deals、Price drop、Commission drop、Imports。",
      "可按活动名搜索，看报名 SKU、销量与 Ongoing / Completed。",
    ],
    keywords: ["活动", "deals", "大促", "类目活动", "报名活动", "flash", "mega"],
    status: "confirmed",
    landingUrl: "https://deals.noon.partners/en/?project={project}",
    note: "用户截图确认 2026-09-21。",
  },
  {
    id: "promo-coupon",
    title: "报名优惠券",
    section: "促销活动",
    menu: [L.promotions, L.coupons],
    why: "报名平台可点击券或折扣码。",
    steps: [
      `汉堡 → ${formatLabel(L.promotions)} → ${formatLabel(L.coupons)}。`,
      "落地 coupons.noon.partners；页眉 Coupons。",
      "Tab：Clickable Coupons、Promo Codes、Imports；其下可切 All Coupons / My Coupons。",
      "进行中的券点 + Enroll 报名。",
    ],
    keywords: ["优惠券", "coupon", "折扣码", "promo code", "enroll"],
    status: "confirmed",
    landingUrl: "https://coupons.noon.partners/en/?project={project}",
    note: "用户截图确认 2026-09-21。",
  },
  {
    id: "promo-virtual-bundles",
    title: "虚拟组合装",
    section: "促销活动",
    menu: [L.promotions, L.virtualBundles],
    why: "用现有 FBN SKU 组折扣组合，不用重新打包库存。",
    steps: [
      `汉堡 → ${formatLabel(L.promotions)} → ${formatLabel(L.virtualBundles)}。`,
      "落地 bundles.noon.partners；页眉 Virtual Bundles Guide。",
      "右上 + Create Virtual Bundle 创建；Imports 可批量。仅 FBN SKU 可做。",
    ],
    keywords: ["虚拟组合", "组合装", "virtual bundles", "bundle", "捆绑"],
    status: "confirmed",
    landingUrl: "https://bundles.noon.partners/en/?project={project}",
    note: "用户截图确认 2026-09-21。Eligibility：SKU 须为 FBN。",
  },

  // —— Fulfilled by noon：用户截图 2026-09-21 确认 ——
  {
    id: "fbn-asn",
    title: "创建入仓单（ASN）",
    section: "noon 仓发",
    menu: [L.fbn, L.createAsn],
    why: "货进 noon 仓库要先建 ASN（入仓通知单）。",
    steps: [
      `汉堡 → ${formatLabel(L.fbn)} → ${formatLabel(L.createAsn)}。`,
      "落地 fbn.noon.partners …/asn/createasn；页眉 Product Selection Method。",
      "二选一：Choose from Your Catalog（从目录选品）或 Upload CSV File（下模板填完上传）。",
    ],
    keywords: ["入仓", "asn", "fbn", "送仓", "补货入仓", "create asn"],
    status: "confirmed",
    landingUrl:
      "https://fbn.noon.partners/en-sa/asn/createasn?mp=noon&project={project}",
    note: "用户截图确认 2026-09-21。",
  },
  {
    id: "fbn-asn-storage",
    title: "查看入仓进度与仓容",
    section: "noon 仓发",
    menu: [L.fbn, L.asnStorage],
    why: "看 ASN 进度、Open Shipments，以及 All Shipments 列表与仓容表现。",
    steps: [
      `汉堡 → ${formatLabel(L.fbn)} → ${formatLabel(L.asnStorage)}。`,
      "落地 fbn.noon.partners …/asn；左侧高亮 My ASN & Storage。",
      "可看 Open Shipments、All Shipments / Auto-Generated；表列含 Status（如 GRN Completed）。",
    ],
    keywords: [
      "asn",
      "仓容",
      "storage",
      "入仓进度",
      "shipments",
      "my asn",
      "grn",
    ],
    status: "confirmed",
    landingUrl: "https://fbn.noon.partners/en-sa/asn?project={project}",
    note: "用户截图确认 2026-09-21。",
  },
  {
    id: "fbn-inventory",
    title: "查看 FBN 仓库库存",
    section: "noon 仓发",
    menu: [L.fbn, L.myInventory],
    why: "看 noon 仓内 Total / Saleable / Non-Saleable 库存与仓库分布。",
    steps: [
      `汉堡 → ${formatLabel(L.fbn)} → ${formatLabel(L.myInventory)}。`,
      "落地 fbn.noon.partners …/inventory；页眉 My Inventory。",
      "Tab：All Warehouses / Saleable / Non-Saleable；可按 Warehouse 筛选，右上 Export。",
    ],
    keywords: [
      "库存",
      "inventory",
      "fbn库存",
      "仓内库存",
      "可售",
      "my inventory",
      "saleable",
    ],
    status: "confirmed",
    landingUrl: "https://fbn.noon.partners/en-sa/inventory?project={project}",
    note: "用户截图确认 2026-09-21。",
  },
  {
    id: "fbn-returns",
    title: "处理 FBN 退货",
    section: "noon 仓发",
    menu: [L.fbn, L.myReturns],
    why: "创建 / 跟踪 FBN 退货（RTV）请求；可配 Automated Returns。",
    steps: [
      `汉堡 → ${formatLabel(L.fbn)} → ${formatLabel(L.myReturns)}。`,
      "落地 fbn.noon.partners …/rtv/requests；页眉 My Returns。",
      "右上 + Create Return Request；也可 Manage Transfers / Automated Returns。",
    ],
    keywords: ["退货", "returns", "rtv", "fbn退货", "my returns", "return request"],
    status: "confirmed",
    landingUrl: "https://fbn.noon.partners/en-sa/rtv/requests?project={project}",
    note: "用户截图确认 2026-09-21。",
  },
  {
    id: "fbn-fees",
    title: "查 FBN 预估费用",
    section: "noon 仓发",
    menu: [L.fbn, L.fbnFees],
    why: "按 partner barcode 查仓储/出库等预估费用（实扣以账单为准）。",
    steps: [
      `汉堡 → ${formatLabel(L.fbn)} → ${formatLabel(L.fbnFees)}。`,
      "落地 fbn.noon.partners …/fees；页眉 FBN Fees and Disputes。",
      "选国家后 Search by pbarcode；另有 Stock Reconciliation Dispute / Track VMS Dispute。",
    ],
    keywords: [
      "fbn费用",
      "仓储费",
      "出库费",
      "outbound",
      "storage fee",
      "fbn fees",
      "pbarcode",
      "dispute",
    ],
    status: "confirmed",
    landingUrl: "https://fbn.noon.partners/en-sa/fees?project={project}",
    note: "用户截图确认 2026-09-21；页内标题是 FBN Fees and Disputes。",
  },
  {
    id: "fbn-reports",
    title: "下载 FBN 报表",
    section: "noon 仓发",
    menu: [L.fbn, L.fbnReports],
    why: "生成并下载 FBN Inventory Ledger 等报表。",
    steps: [
      `汉堡 → ${formatLabel(L.fbn)} → ${formatLabel(L.fbnReports)}。`,
      "落地 fbn.noon.partners …/fbnreports；右侧 Generate Report。",
      "列表可 Download 已完成报表（如 Inventory Ledger Detailed View）。",
    ],
    keywords: [
      "fbn报表",
      "reports",
      "库存报表",
      "grn",
      "ledger",
      "received report",
      "generate report",
    ],
    status: "confirmed",
    landingUrl: "https://fbn.noon.partners/en-sa/fbnreports?project={project}",
    note: "用户截图确认 2026-09-21。勿与 Account Health 报表混淆。",
  },

  // —— Fulfilled by Partner：Playwright 2026-10-07 对齐（Manifestation 仍 pending）——
  {
    id: "fbp-directship",
    title: "处理直发订单",
    section: "商家自发货",
    menu: [L.fbp, L.directship],
    why: "FBP 直发订单的主入口。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.directship)}。`,
      "落地 fbp.noon.partners …/directship/。",
    ],
    keywords: ["自发货", "fbp", "直发", "directship", "待发货", "打单", "订单"],
    status: "confirmed",
    landingUrl:
      "https://fbp.noon.partners/en-sa/directship/?project={project}",
    note: "Playwright 2026-10-07 PRJ396770 侧栏扫链确认。",
  },
  {
    id: "fbp-picklists",
    title: "直发拣货单",
    section: "商家自发货",
    menu: [L.fbp, L.directshipPicklists],
    why: "按拣货单备货、打单。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.directshipPicklists)}。`,
      "落地 …/directship/picklist/。",
    ],
    keywords: ["拣货", "picklist", "拣货单", "directship picklists"],
    status: "confirmed",
    landingUrl:
      "https://fbp.noon.partners/en-sa/directship/picklist/?project={project}",
    note: "Playwright 2026-10-07 PRJ396770 侧栏扫链确认。",
  },
  {
    id: "fbp-direct-delivery",
    title: "直配送货",
    section: "商家自发货",
    menu: [L.fbp, L.directDelivery],
    why: "查看 Direct Delivery 货件。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.directDelivery)}。`,
      "落地页标题：Direct Delivery Shipments。",
    ],
    keywords: ["直配", "direct delivery", "shipments", "送货"],
    status: "confirmed",
    landingUrl:
      "https://direct-delivery.noon.partners/en-sa?project={project}",
    note: "Playwright 2026-10-07；独立子域 direct-delivery.noon.partners。",
  },
  {
    id: "fbp-return-manifest",
    title: "退货交运",
    section: "商家自发货",
    menu: [L.fbp, L.returnManifestation],
    why: "退货交接 / 交运清单。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.returnManifestation)}。`,
      "落地 lms.noon.partners …/return-manifestation。",
    ],
    keywords: ["退货交运", "return manifestation", "退货交接"],
    status: "confirmed",
    landingUrl:
      "https://lms.noon.partners/en-sa/direct-delivery/return-manifestation?project={project}",
    note: "Playwright 2026-10-07；侧栏文案偶见 Return Manifest。",
  },
  {
    id: "fbp-delivery-returns",
    title: "配送退货",
    section: "商家自发货",
    menu: [L.fbp, L.deliveryReturns],
    why: "配送环节退回的货。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.deliveryReturns)}。`,
      "落地 FBP 首页 tab=rtv（Pickup / Delivery Returns）。",
    ],
    keywords: ["配送退货", "delivery returns", "拒收"],
    status: "confirmed",
    landingUrl:
      "https://fbp.noon.partners/en-sa/?project={project}&tab=rtv",
    note: "Playwright 2026-10-07；仓码 lc / 日期区间为瞬时参数，模板只保留 tab=rtv。",
  },
  {
    id: "fbp-manifestation",
    title: "交运",
    section: "商家自发货",
    menu: [L.fbp, L.manifestation],
    why: "发货交运清单。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.manifestation)}（内侧栏现多为 Handover）。`,
      "落地页标题：Handover（directship.noon.partners …/handovers）。",
    ],
    keywords: ["交运", "manifestation", "交接单", "manifest", "handover"],
    status: "confirmed",
    landingUrl:
      "https://directship.noon.partners/en/handovers?project={project}",
    note:
      "Playwright 2026-10-07：包材内侧栏 Handover＝交运。汉堡「Manifest」href 曾误指 Return Manifestation，勿跟。",
  },
  {
    id: "fbp-customer-returns",
    title: "客户退货",
    section: "商家自发货",
    menu: [L.fbp, L.customerReturns],
    why: "买家发起的退货。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.customerReturns)}。`,
      "落地 mp-partners-fbp-returns.noon.partners。",
    ],
    keywords: ["客户退货", "customer returns", "买家退货"],
    status: "confirmed",
    landingUrl:
      "https://mp-partners-fbp-returns.noon.partners/en-sa?project={project}",
    note: "Playwright 2026-10-07。",
  },
  {
    id: "fbp-oos-logs",
    title: "缺货记录",
    section: "商家自发货",
    menu: [L.fbp, L.oosLogs],
    why: "查看因缺货未发出的记录。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.oosLogs)}。`,
      "落地 …/stocklog。",
    ],
    keywords: ["缺货", "out of stock", "oos", "断货记录"],
    status: "confirmed",
    landingUrl: "https://fbp.noon.partners/en-sa/stocklog?project={project}",
    note: "Playwright 2026-10-07。",
  },
  {
    id: "fbp-packaging",
    title: "包材",
    section: "商家自发货",
    menu: [L.fbp, L.packaging],
    why: "包装材料相关入口。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.packaging)}。`,
      "落地页标题：Packaging Material（…/packing/orders/）。",
    ],
    keywords: ["包材", "包装", "packaging", "packaging materials", "packing"],
    status: "confirmed",
    landingUrl:
      "https://fbp.noon.partners/en-sa/packing/orders/?project={project}",
    note: "Playwright 2026-10-07；侧栏文案 Packaging Material（单数）；勿猜 /packaging-materials（404）。",
  },
  {
    id: "fbp-reports",
    title: "下载 FBP 报表",
    section: "商家自发货",
    menu: [L.fbp, L.fbpReports],
    why: "自发货相关报表。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.fbpReports)}。`,
      "落地 …/exports（FBP Reports）。",
    ],
    keywords: ["fbp报表", "自发货报表", "directship report"],
    status: "confirmed",
    landingUrl: "https://fbp.noon.partners/en-sa/exports?project={project}",
    note: "Playwright 2026-10-07；勿与 FBN …/fbnreports、Catalog Exports 混淆。",
  },
  {
    id: "fbp-warehouse",
    title: "自发货仓库",
    section: "商家自发货",
    menu: [L.fbp, L.fbpWarehouse],
    why: "管理 FBP 发货仓库。",
    steps: [
      `汉堡 → ${formatLabel(L.fbp)} → ${formatLabel(L.fbpWarehouse)}。`,
      "落地 …/onboarding/warehouse-list/。",
    ],
    keywords: ["仓库", "warehouse", "自发货仓", "fbp仓库"],
    status: "confirmed",
    landingUrl:
      "https://fbp.noon.partners/en-sa/onboarding/warehouse-list/?project={project}",
    note: "Playwright 2026-10-07。",
  },

  // —— Payments：侧栏名已知；finance.noon.partners 根页现为 Legal Entities，子项直达仍 404 ——
  {
    id: "payments-statement",
    title: "看结算单",
    section: "财务",
    menu: [L.payments, L.statements],
    why: "看回款、佣金和费用明细。",
    steps: [
      `汉堡 → ${formatLabel(L.payments)} → ${formatLabel(L.statements)}。`,
      "落地页标题 / URL 待补图确认（勿用猜的 /statements，会 404）。",
    ],
    keywords: ["账单", "回款", "佣金", "费用", "对账", "statement", "结算", "statements"],
    status: "pending",
    note:
      "2026-10-07：finance.noon.partners/en/ 可进（Legal Entities）；Statements 等子路径猜链全 404。需人工汉堡点一次或 Ctrl+K。",
  },
  {
    id: "payments-soa",
    title: "看科目余额表",
    section: "财务",
    menu: [L.payments, L.soa],
    why: "按期间看科目余额。",
    steps: [
      `汉堡 → ${formatLabel(L.payments)} → ${formatLabel(L.soa)}。`,
      "落地页标题 / URL 待补图确认。",
    ],
    keywords: ["科目余额", "soa", "statement of account", "总账"],
    status: "pending",
    note: "侧栏原文是 Statement Of Account。与 Statements 同批待人工补图。",
  },
  {
    id: "payments-invoices",
    title: "看发票与贷项通知",
    section: "财务",
    menu: [L.payments, L.invoices],
    why: "发票和 Creditnotes。",
    steps: [
      `汉堡 → ${formatLabel(L.payments)} → ${formatLabel(L.invoices)}。`,
      "落地页标题 / URL 待补图确认。",
    ],
    keywords: ["发票", "invoice", "creditnote", "贷项", "红字"],
    status: "pending",
    note: "侧栏原文是 Invoices & Creditnotes。落地 URL 待采。",
  },
  {
    id: "payments-transactions",
    title: "看交易明细",
    section: "财务",
    menu: [L.payments, L.transactionView],
    why: "逐笔交易视图。",
    steps: [
      `汉堡 → ${formatLabel(L.payments)} → ${formatLabel(L.transactionView)}。`,
      "落地页标题 / URL 待补图确认。",
    ],
    keywords: ["交易", "transaction", "流水", "transaction view"],
    status: "pending",
    note: "侧栏名用户截图确认；落地 URL 待采。",
  },
  {
    id: "payments-exports",
    title: "导出财务文件",
    section: "财务",
    menu: [L.payments, L.paymentExports],
    why: "从回款与费用里导出。不是商品目录的 Exports。",
    steps: [
      `汉堡 → ${formatLabel(L.payments)} → ${formatLabel(L.paymentExports)}。`,
      "落地页标题 / URL 待补图确认。",
    ],
    keywords: ["财务导出", "导出账单", "payment export", "fees export"],
    status: "pending",
    note: "侧栏英文是 Exports，挂在 Payments & Fees 下。勿与 Catalog/FBP exports 混淆。",
  },
  {
    id: "health",
    title: "看账号健康",
    section: "账号",
    menu: [L.accountHealth, L.reputation],
    why: "账号健康分与合规。",
    steps: [
      `汉堡 → ${formatLabel(L.accountHealth)} → ${formatLabel(L.reputation)}。`,
      "落地页标题：Account Health（Reputation Management 侧栏高亮）。",
    ],
    keywords: ["账号健康", "评分", "reputation", "违规"],
    status: "confirmed",
    landingUrl: "https://noon-reputation.noon.partners/en/?project={project}",
    note: "Playwright 2026-10-07；内侧栏含 FBP Performance / Inventory Health 等。",
  },
  {
    id: "vantage",
    title: "看销售与流量分析",
    section: "分析",
    menu: [L.vantage],
    why: "Vantage Analytics（导航带 New）。",
    steps: [
      `汉堡 → ${formatLabel(L.vantage)}。`,
      "落地 vantage.noon.partners（页眉 Vantage + 店铺切换器）。",
    ],
    keywords: ["vantage", "数据分析", "流量", "转化", "销量分析"],
    status: "confirmed",
    landingUrl: "https://vantage.noon.partners/en/?project={project}",
    note: "Playwright 2026-10-07；首屏可能短暂 loading，属正常。",
  },
];

export const NOON_GUIDE_PROMPTS = [
  "改价格",
  "添加商品",
  "我的商品",
  "导出表格",
  "开广告",
  "优惠券",
  "报名活动",
  "入仓",
  "看账单",
];

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

export function searchNoonGuide(query: string, limit = 5): NoonGuideHit[] {
  const raw = query.trim();
  if (!raw) return [];
  const folded = compact(raw);
  const hits: NoonGuideHit[] = [];

  for (const entry of NOON_GUIDE) {
    const matched = entry.keywords
      .map((keyword) => compact(keyword))
      .filter((key) => key.length >= 2 && folded.includes(key));
    const specific = matched.filter(
      (key) =>
        !matched.some((other) => other.length > key.length && other.includes(key)),
    );
    let score = 0;
    for (const key of specific) score += 8 + key.length * 3;
    if (folded.length >= 2 && compact(entry.title).includes(folded)) score += 8;
    for (const step of entry.menu) {
      if (folded.includes(compact(step.en)) || folded.includes(compact(step.zh))) {
        score += 6;
      }
    }
    // 已确认条目略加权，搜索时优先稳的
    if (entry.status === "confirmed" && score > 0) score += 4;
    if (score > 0) hits.push({ entry, score });
  }

  hits.sort(
    (a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, "zh"),
  );
  return hits.slice(0, limit);
}

export function noonGuideSections(): {
  section: string;
  entries: NoonGuideEntry[];
}[] {
  const order: string[] = [];
  for (const entry of NOON_GUIDE) {
    if (!order.includes(entry.section)) order.push(entry.section);
  }
  return order.map((section) => ({
    section,
    entries: NOON_GUIDE.filter((entry) => entry.section === section),
  }));
}
