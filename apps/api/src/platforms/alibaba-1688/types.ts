/**
 * 1688 买家订单物流 — 类型与数据目录（会话落本地，不进仓库）
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const BUYER_ORDER_LIST_BASE =
  "https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html";

export type Alibaba1688OrderLogistics = {
  orderId: string;
  ok: boolean;
  /** 列表侧订单状态：待付款 / 待发货 / 待收货 / 已收货 等 */
  orderStatus: string;
  trackingNo: string;
  /** 物流摘要或在途文案 */
  transitStatus: string;
  /** 从文案解析的预计送达 YYYY-MM-DD */
  etaDate: string | null;
  logisticsText: string;
  message: string;
};

export type Alibaba1688BatchResult = {
  ok: boolean;
  message: string;
  durationMs: number;
  batches: number;
  orders: Alibaba1688OrderLogistics[];
  screenshotPath?: string;
  runPath?: string;
};

export type Alibaba1688FetchOptions = {
  headed?: boolean;
  timeoutMs?: number;
  /** 每批订单号上限，对齐 pageSize=30 */
  batchSize?: number;
  storageStatePath?: string;
  /**
   * 操作节奏：normal（默认）| slow（更稳）| fast（仅调试）
   * 也可用环境变量 OUTPOST_1688_PACE
   */
  pace?: "slow" | "normal" | "fast";
  /**
   * 无会话或会话失效时：有头打开浏览器，等人扫码/登录后自动存 storageState 再继续。
   * 默认 true（同步物流可直接点按钮，不必先跑登录脚本）。
   */
  interactiveLogin?: boolean;
  /** 等待人工登录的最长毫秒，默认 180000 */
  loginWaitMs?: number;
  /** 每批查完回调（用于分块回填 + 写进度） */
  onBatch?: (info: {
    batchIndex: number;
    batchTotal: number;
    orders: Alibaba1688OrderLogistics[];
    orderDone: number;
    orderTotal: number;
  }) => void | Promise<void>;
};

export function getAlibaba1688Dir(): string {
  const fromEnv = process.env.OUTPOST_1688_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  const root =
    process.env.OUTPOST_ROOT?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  return resolve(root, "alibaba-1688");
}

export function ensureAlibaba1688Dir(): string {
  const dir = getAlibaba1688Dir();
  mkdirSync(dir, { recursive: true });
  mkdirSync(resolve(dir, "runs"), { recursive: true });
  return dir;
}

export function getDefaultStorageStatePath(): string {
  const fromEnv = process.env.OUTPOST_1688_STORAGE_STATE?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(getAlibaba1688Dir(), "storage-state.json");
}

export function hasStorageState(path = getDefaultStorageStatePath()): boolean {
  return existsSync(path);
}

/** 拼批量订单列表 URL */
export function buildBuyerOrderListUrl(
  orderIds: string[],
  page = 1,
  pageSize = 30,
): string {
  const ids = orderIds.map((x) => x.trim()).filter(Boolean);
  const q = new URLSearchParams({
    spm: "a360q.7751291.topmenu.dmyorder_popup_dallorder",
    orderIds: ids.join(","),
    page: String(page),
    pageSize: String(pageSize),
  });
  return `${BUYER_ORDER_LIST_BASE}?${q.toString()}`;
}
