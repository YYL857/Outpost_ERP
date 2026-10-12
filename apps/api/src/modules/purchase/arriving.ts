/**
 * 采购物流：按 orderId 回填 + 今日关注筛选 + 分批到货确认。
 */
import type {
  AppState,
  PurchaseArrivalReceipt,
  PurchaseLine,
} from "../../common/types.js";
import {
  isAttentionTransit,
  shanghaiToday,
  type Alibaba1688OrderLogistics,
} from "../../platforms/alibaba-1688/index.js";

export type ArrivingTodayItem = {
  id: string;
  partnerSku: string;
  productName: string;
  qty: number;
  /** 累计已确认到货 */
  receivedQty: number;
  /** 尚待确认 = qty - receivedQty */
  remainingQty: number;
  orderId: string;
  trackingNo: string;
  transitStatus: string;
  etaDate: string | null;
  orderStatusHint: string;
  /** 飞书供应商/厂家，便于辨认货 */
  supplier: string;
  purchasedAt: string | null;
  remark: string;
  /** 去重键，确认到货时回传 */
  receiptKey: string;
};

export type CollectOrderIdsOptions = {
  /** 默认 true：只收在途/未完结/无运单 */
  onlyOpen?: boolean;
  /** 单次最多查多少订单号，默认 60 */
  limit?: number;
  /**
   * 只取采购日期落在最近 N 天内的行；默认 30（约一个月，更早无物流追踪意义）。
   * 传 0 = 不限日期（会扫到历史上千单，不推荐）。
   */
  recentDays?: number;
  /** 默认 false：无采购日期的历史行不进默认查询 */
  includeUndated?: boolean;
};

function isClosedLogistics(line: PurchaseLine): boolean {
  const blob = `${line.transitStatus || ""} ${line.status || ""}`;
  return /已签收|交易成功|交易关闭|已完成|已收货|已评价/.test(blob);
}

/** 1688 订单号一般为 15–22 位数字 */
function isValid1688OrderId(id: string): boolean {
  return /^\d{15,22}$/.test(id.trim());
}

function needsLogisticsRefresh(line: PurchaseLine): boolean {
  if (!isValid1688OrderId(line.orderId || "")) return false;
  if (isClosedLogistics(line) && (line.trackingNo || "").trim()) return false;
  const blob = `${line.transitStatus || ""} ${line.status || ""}`;
  if (/未发货|已下单|在途|待收货|待发货|派送|部分发货/.test(blob)) return true;
  if (!(line.trackingNo || "").trim()) return true;
  return false;
}

function daysAgoYmd(days: number, today = shanghaiToday()): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - Math.max(0, days));
  return dt.toISOString().slice(0, 10);
}

function inRecentWindow(
  purchasedAt: string | null | undefined,
  recentDays: number,
  includeUndated: boolean,
  today = shanghaiToday(),
): boolean {
  if (recentDays <= 0) {
    const at = (purchasedAt || "").trim();
    if (!at) return includeUndated;
    // 仍排除明显未来日期（表脏数据）
    return at <= today;
  }
  const at = (purchasedAt || "").trim();
  if (!at) return includeUndated;
  if (at > today) return false;
  const cutoff = daysAgoYmd(recentDays, today);
  return at >= cutoff;
}

export function collectPurchaseOrderIds(
  state: AppState,
  opts: CollectOrderIdsOptions = {},
): {
  orderIds: string[];
  totalWithOrderId: number;
  selected: number;
  recentDays: number;
  cutoff: string | null;
} {
  const onlyOpen = opts.onlyOpen !== false;
  const limit = Math.max(1, Math.min(opts.limit ?? 60, 300));
  const recentDays =
    typeof opts.recentDays === "number" ? opts.recentDays : 30;
  const includeUndated = opts.includeUndated === true;
  const cutoff = recentDays > 0 ? daysAgoYmd(recentDays) : null;

  const all = new Set<string>();
  type Cand = { id: string; purchasedAt: string };
  const cands: Cand[] = [];
  const seenSel = new Set<string>();

  for (const line of state.purchaseLines ?? []) {
    const id = (line.orderId || "").trim();
    if (!isValid1688OrderId(id)) continue;
    all.add(id);
    if (onlyOpen && !needsLogisticsRefresh(line)) continue;
    if (!inRecentWindow(line.purchasedAt, recentDays, includeUndated)) continue;
    if (seenSel.has(id)) continue;
    seenSel.add(id);
    cands.push({ id, purchasedAt: line.purchasedAt || "" });
  }

  // 最近采购优先；未来脏日期沉底
  const today = shanghaiToday();
  cands.sort((a, b) => {
    const af = a.purchasedAt > today ? 1 : 0;
    const bf = b.purchasedAt > today ? 1 : 0;
    if (af !== bf) return af - bf;
    return String(b.purchasedAt).localeCompare(String(a.purchasedAt));
  });

  return {
    orderIds: cands.slice(0, limit).map((c) => c.id),
    totalWithOrderId: all.size,
    selected: cands.length,
    recentDays,
    cutoff,
  };
}

export function applyLogisticsToPurchaseLines(
  state: AppState,
  orders: Alibaba1688OrderLogistics[],
  updatedAt = new Date().toISOString(),
): { matchedLines: number; updatedOrderIds: string[] } {
  const byOrder = new Map(
    orders.filter((o) => o.orderId).map((o) => [o.orderId, o] as const),
  );
  const updatedOrderIds: string[] = [];
  let matchedLines = 0;
  const lines = state.purchaseLines ?? [];
  for (const line of lines) {
    const oid = (line.orderId || "").trim();
    if (!oid) continue;
    const hit = byOrder.get(oid);
    if (!hit || !hit.ok) continue;
    matchedLines++;
    if (!updatedOrderIds.includes(oid)) updatedOrderIds.push(oid);
    if (hit.trackingNo) line.trackingNo = hit.trackingNo;
    const status = hit.transitStatus || hit.orderStatus;
    if (status) line.transitStatus = status;
    // 允许清空错误 ETA（例如曾把下单日误写成 eta）
    line.etaDate = hit.etaDate;
    line.logisticsUpdatedAt = updatedAt;
  }
  state.purchaseLines = lines;
  return { matchedLines, updatedOrderIds };
}

function receiptMap(state: AppState): Map<string, PurchaseArrivalReceipt> {
  const map = new Map<string, PurchaseArrivalReceipt>();
  for (const r of state.purchaseArrivalReceipts ?? []) {
    if (r?.key) map.set(r.key, r);
  }
  return map;
}

export function listArrivingToday(
  state: AppState,
  today = shanghaiToday(),
): ArrivingTodayItem[] {
  const receipts = receiptMap(state);
  const byKey = new Map<string, ArrivingTodayItem>();
  for (const line of state.purchaseLines ?? []) {
    const transit = line.transitStatus || "";
    const eta = line.etaDate ?? null;
    if (!isAttentionTransit(transit, line.status || "", eta, today)) continue;
    const item = toArrivingItem(line, receipts);
    // 已全部确认到货 → 清出待处理
    if (item.remainingQty <= 0) continue;
    const key = item.receiptKey;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    // 飞书常有同订单+同 SKU 重复行；或旧 id 残留。合并为一条，不叠数量。
    byKey.set(key, preferArrivingItem(prev, item));
  }
  const out = [...byKey.values()];
  out.sort((a, b) =>
    String(a.partnerSku).localeCompare(String(b.partnerSku)),
  );
  return out;
}

/** 有订单号时按「订单+SKU」去重；否则保留行 id（避免误吞不同采购） */
export function arrivingDedupeKey(item: {
  id: string;
  partnerSku: string;
  orderId: string;
}): string {
  const oid = (item.orderId || "").trim();
  const sku = (item.partnerSku || "").trim();
  if (oid && sku) return `o:${oid}|${sku}`;
  return `id:${item.id}`;
}

function preferArrivingItem(
  a: ArrivingTodayItem,
  b: ArrivingTodayItem,
): ArrivingTodayItem {
  const score = (x: ArrivingTodayItem) =>
    (x.trackingNo ? 8 : 0) +
    (x.transitStatus ? 4 : 0) +
    (x.supplier ? 2 : 0) +
    (x.productName ? 1 : 0) +
    (x.qty > 0 ? 1 : 0);
  const sa = score(a);
  const sb = score(b);
  const better =
    sb !== sa
      ? sb > sa
        ? b
        : a
      : b.qty !== a.qty
        ? b.qty > a.qty
          ? b
          : a
        : a.id <= b.id
          ? a
          : b;
  // 保留累计到货（同一 key 下应相同）
  const receivedQty = Math.max(a.receivedQty, b.receivedQty);
  const qty = better.qty;
  return {
    ...better,
    receivedQty,
    remainingQty: Math.max(0, qty - receivedQty),
  };
}

function toArrivingItem(
  line: PurchaseLine,
  receipts: Map<string, PurchaseArrivalReceipt>,
): ArrivingTodayItem {
  const key = arrivingDedupeKey({
    id: line.id,
    partnerSku: line.partnerSku,
    orderId: line.orderId || "",
  });
  const qty = Math.max(0, Number(line.qty) || 0);
  const receivedQty = Math.max(0, receipts.get(key)?.receivedQty ?? 0);
  return {
    id: line.id,
    partnerSku: line.partnerSku,
    productName: line.productName,
    qty,
    receivedQty,
    remainingQty: Math.max(0, qty - receivedQty),
    orderId: line.orderId || "",
    trackingNo: line.trackingNo || "",
    transitStatus: line.transitStatus || "",
    etaDate: line.etaDate ?? null,
    orderStatusHint: line.status || "",
    supplier: line.supplier || "",
    purchasedAt: line.purchasedAt ?? null,
    remark: line.remark || "",
    receiptKey: key,
  };
}

export type ConfirmArrivalInput = {
  /** 优先用 list 返回的 receiptKey */
  receiptKey?: string;
  id?: string;
  partnerSku?: string;
  orderId?: string;
  /** 本次到货件数；与 markComplete 二选一 */
  addQty?: number;
  /** 一键记满到齐 */
  markComplete?: boolean;
  updatedBy: string;
};

export type ConfirmArrivalResult = {
  receipt: PurchaseArrivalReceipt;
  item: ArrivingTodayItem | null;
  cleared: boolean;
};

/**
 * 确认分批到货。到齐后该项不再出现在今日要处理。
 */
export function confirmArrival(
  state: AppState,
  input: ConfirmArrivalInput,
  today = shanghaiToday(),
): ConfirmArrivalResult {
  const listed = listArrivingToday(state, today);
  const key =
    (input.receiptKey || "").trim() ||
    arrivingDedupeKey({
      id: (input.id || "").trim(),
      partnerSku: (input.partnerSku || "").trim(),
      orderId: (input.orderId || "").trim(),
    });
  if (!key || key === "id:") {
    throw new Error("缺少到货确认键（receiptKey / 订单+SKU）");
  }

  let base = listed.find((x) => x.receiptKey === key) ?? null;
  if (!base) {
    const line = (state.purchaseLines ?? []).find((l) => {
      const k = arrivingDedupeKey({
        id: l.id,
        partnerSku: l.partnerSku,
        orderId: l.orderId || "",
      });
      return k === key || (!!input.id && l.id === input.id);
    });
    if (!line) throw new Error("未找到对应采购行");
    if (
      !isAttentionTransit(
        line.transitStatus || "",
        line.status || "",
        line.etaDate ?? null,
        today,
      )
    ) {
      throw new Error("该采购不在今日待处理列表");
    }
    base = toArrivingItem(line, receiptMap(state));
  }

  const prevReceived = base.receivedQty;
  let nextReceived: number;
  if (input.markComplete) {
    nextReceived = base.qty;
  } else {
    const add = Number(input.addQty);
    if (!Number.isFinite(add) || add <= 0) {
      throw new Error("请填写本次到货数量（正整数）");
    }
    nextReceived = Math.min(base.qty, prevReceived + Math.floor(add));
  }

  const receipt: PurchaseArrivalReceipt = {
    key,
    partnerSku: base.partnerSku,
    orderId: base.orderId,
    lineId: base.id,
    qtyOrdered: base.qty,
    receivedQty: nextReceived,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy || "",
  };

  const map = receiptMap(state);
  map.set(key, receipt);
  state.purchaseArrivalReceipts = [...map.values()];

  const cleared = nextReceived >= base.qty;
  const remainingQty = Math.max(0, base.qty - nextReceived);
  const item: ArrivingTodayItem | null = cleared
    ? null
    : {
        ...base,
        receivedQty: nextReceived,
        remainingQty,
      };

  return { receipt, item, cleared };
}
