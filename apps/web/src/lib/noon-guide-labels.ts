/**
 * Noon Seller Lab 菜单中英对照。
 * en = 后台界面原文（点哪里以英文为准）
 * zh = 给中国用户看的含义
 */

export type NoonLabel = { en: string; zh: string };

export function formatLabel(label: NoonLabel): string {
  return `${label.zh}（${label.en}）`;
}

export function formatPath(labels: NoonLabel[]): string {
  return labels.map(formatLabel).join(" → ");
}

/** 一级 / 常用入口 */
export const L = {
  home: { en: "Home", zh: "首页" },
  catalog: { en: "Catalog", zh: "商品目录" },
  addProduct: { en: "Add Product", zh: "添加商品" },
  myCatalog: { en: "My Catalog", zh: "我的商品" },
  imports: { en: "Imports", zh: "导入" },
  exports: { en: "Exports", zh: "导出" },
  noonCatalog: { en: "noon Catalog", zh: "noon 公共目录" },
  brandCatalog: { en: "Brand Catalog", zh: "品牌目录" },
  myBrands: { en: "My Brands", zh: "我的品牌" },
  serviceCenters: { en: "Service Centers", zh: "服务中心" },
  advertising: { en: "Advertising", zh: "广告" },
  adManager: { en: "Ad Manager", zh: "广告管理后台" },
  externalAds: { en: "External Ads Tracker", zh: "站外广告追踪" },
  brandStore: { en: "Brand Store", zh: "品牌店铺" },
  promotions: { en: "Promotions", zh: "促销活动" },
  fbn: { en: "Fulfilled by noon", zh: "noon 仓发（FBN）" },
  fbp: { en: "Fulfilled by Partner", zh: "商家自发货（FBP）" },
  payments: { en: "Payments & Fees", zh: "回款与费用" },
  statements: { en: "Statements", zh: "结算单" },
  soa: { en: "Statement Of Account", zh: "科目余额表" },
  invoices: { en: "Invoices & Creditnotes", zh: "发票与贷项通知" },
  transactionView: { en: "Transaction View", zh: "交易明细" },
  paymentExports: { en: "Exports", zh: "财务导出" },
  accountHealth: { en: "Account Health & Reports", zh: "账号健康与报表" },
  reputation: { en: "Reputation Management", zh: "声誉管理" },
  fbpPerf: { en: "FBP Performance", zh: "自发货表现" },
  vantage: { en: "Vantage Analytics", zh: "经营分析" },
  support: { en: "Support & Disputes", zh: "客服与纠纷" },
  storeMgmt: { en: "Store Management", zh: "店铺管理" },
  globalSelling: { en: "Global Selling", zh: "全球销售" },
  createAsn: { en: "Create ASN", zh: "创建入仓单" },
  asnStorage: { en: "My ASN & Storage", zh: "入仓与仓容" },
  myInventory: { en: "My Inventory", zh: "我的库存" },
  myReturns: { en: "My Returns", zh: "我的退货" },
  fbnFees: { en: "FBN Fees", zh: "FBN 费用" },
  fbnReports: { en: "Reports", zh: "FBN 报表" },
  directship: { en: "Directship", zh: "直发" },
  directshipPicklists: { en: "Directship Picklists", zh: "直发拣货单" },
  directDelivery: { en: "Direct Delivery Shipments", zh: "直配送货" },
  returnManifestation: { en: "Return Manifestation", zh: "退货交运" },
  deliveryReturns: { en: "Delivery Returns", zh: "配送退货" },
  manifestation: { en: "Manifestation", zh: "交运" },
  customerReturns: { en: "Customer Returns", zh: "客户退货" },
  oosLogs: { en: "Out of Stock Logs", zh: "缺货记录" },
  packaging: { en: "Packaging Materials", zh: "包材" },
  fbpReports: { en: "Reports", zh: "FBP 报表" },
  fbpWarehouse: { en: "Warehouse", zh: "仓库" },
  coupons: { en: "Coupons", zh: "优惠券" },
  deals: { en: "Deals", zh: "活动 Deal" },
  categoryDeals: { en: "Category Deals", zh: "类目活动" },
  promotionsCenter: { en: "Promotions Center", zh: "促销中心" },
  virtualBundles: { en: "Virtual Bundles", zh: "虚拟组合装" },
  externalAds: { en: "External Ads Tracker", zh: "站外广告追踪" },
  stock: { en: "Stock", zh: "库存" },
  offer: { en: "Offer", zh: "报价" },
} as const satisfies Record<string, NoonLabel>;
