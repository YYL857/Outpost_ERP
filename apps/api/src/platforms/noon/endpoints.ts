/**
 * NOON Partner API 路径（对照 https://noon-docs.noonpartners.dev/）。
 * Live 模式走 noon-api-gateway，不经 Seller Lab 门户。
 */
export const NOON_API_GATEWAY =
  process.env.OUTPOST_NOON_API_BASE?.trim() ||
  "https://noon-api-gateway.noon.partners";

export const NOON_ENDPOINTS = {
  /** Service Account JWT → 会话 Cookie */
  apiLogin: "POST /identity/public/v1/api/login",
  /** 校验当前会话 */
  validate: "GET /identity/v1/whoami",
  /** Impex 异步导出（catalog / orders / FBN inventory 等） */
  impexCategoryList: "GET /impex/v1/export/category/list",
  impexExportCreate: "POST /impex/v1/export/create",
  impexExportStatus: "POST /impex/v1/export/status",
  /** 以下 REST 路径作参考；当前 live 拉数走 Impex CSV */
  ordersList: "GET /fbpi/v1/orders",
  orderGet: "GET /fbpi/v1/fbpi-order/{order_nr}/get",
  stockGet: "GET /stock/v1/stock",
  catalogList: "GET /content/v1/products",
  /** 取商品内容（含 images[].url） */
  getContent: "POST /content/v1/product/content/get",
  pricingUpsert: "POST /pricing/v1/pricing/upsert",
  stockUpdate: "POST /stock/v1/stock-update",
} as const;

export type NoonEndpointKey = keyof typeof NOON_ENDPOINTS;
