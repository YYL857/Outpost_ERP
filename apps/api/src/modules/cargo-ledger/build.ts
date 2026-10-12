import {
  cellText,
  headerIndexMap,
  parseNumber,
  pickCol,
} from "../../platforms/feishu/normalize/cells.js";
import {
  extractPackingBoxRows,
  isPackingInTransit,
} from "../../platforms/feishu/normalize/forwarder-board.js";
import {
  extractPackingLines,
  shopPrefixFromBoxNo,
  shopPrefixFromPartnerSku,
} from "../../platforms/feishu/normalize/packing-lines.js";
import { normalizeAccountsSnapshot } from "../../platforms/feishu/normalize/accounts.js";
import { normalizeProductSnapshot } from "../../platforms/feishu/normalize/product.js";
import type { FeishuRawSnapshot } from "../../platforms/feishu/types.js";
import type {
  CargoLedger,
  CargoLedgerSkuLine,
  CargoLedgerTicket,
  FreightBasis,
  LedgerIssue,
  LedgerSourceMeta,
} from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sheetValues(
  snap: FeishuRawSnapshot | null | undefined,
  title: string,
): unknown[][] {
  const sheet = snap?.sheets.find((s) => s.title === title);
  return sheet?.values ?? [];
}

function extractBoxShopMap(values: unknown[][]): Map<string, string> {
  const map = new Map<string, string>();
  if (values.length < 2) return map;
  const headers = headerIndexMap(values[0] ?? []);
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const boxNo = cellText(pickCol(row, headers, ["箱号"])).trim();
    if (!boxNo) continue;
    const shop = cellText(
      pickCol(row, headers, ["店铺Code", "店铺代码", "店铺", "StoreCode"]),
    )
      .trim()
      .toUpperCase();
    if (shop) map.set(boxNo, shop);
  }
  return map;
}

function uniquePositive(
  values: Array<number | null | undefined>,
): { value: number | null; conflict: boolean } {
  const nums = [
    ...new Set(
      values
        .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
        .map(round2),
    ),
  ];
  if (nums.length === 0) return { value: null, conflict: false };
  return { value: nums[0]!, conflict: nums.length > 1 };
}

function ticketKeyOf(box: {
  ticketNo: string;
  logisticsNo: string;
  boxNo: string;
}): string {
  const t = box.ticketNo.trim();
  if (t) return t;
  const l = box.logisticsNo.trim();
  if (l) return l;
  return `__box:${box.boxNo}`;
}

function lineWeightKg(line: {
  totalWeightKg: number | null;
  unitWeightKg: number | null;
  qty: number;
}): number {
  if (line.totalWeightKg != null && line.totalWeightKg > 0) {
    return line.totalWeightKg;
  }
  if (line.unitWeightKg != null && line.unitWeightKg > 0) {
    return round2(line.unitWeightKg * line.qty);
  }
  return 0;
}

function majorityShop(codes: string[]): string {
  const counts = new Map<string, number>();
  for (const c of codes) {
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

function countSheetRows(snap: FeishuRawSnapshot | null, title: string): number {
  const values = sheetValues(snap, title);
  if (values.length < 2) return 0;
  return values.length - 1;
}

function latestDailySheet(snap: FeishuRawSnapshot | null): {
  title: string;
  pskus: Set<string>;
} | null {
  if (!snap?.sheets.length) return null;
  const dated = snap.sheets
    .map((s) => {
      const m = s.title.match(/(\d{1,2})\.(\d{1,2})/);
      if (!m) return null;
      return { sheet: s, month: Number(m[1]), day: Number(m[2]) };
    })
    .filter(Boolean) as Array<{
    sheet: (typeof snap.sheets)[0];
    month: number;
    day: number;
  }>;
  dated.sort((a, b) => b.month - a.month || b.day - a.day);
  const hit = dated[0]?.sheet ?? snap.sheets[0];
  if (!hit || hit.values.length < 2) return null;
  const headers = headerIndexMap(hit.values[0] ?? []);
  const pskus = new Set<string>();
  for (let r = 1; r < hit.values.length; r++) {
    const sku = cellText(pickCol(hit.values[r] ?? [], headers, ["PSKU", "psku"]));
    if (sku && !sku.startsWith("=")) pskus.add(sku);
  }
  return { title: hit.title, pskus };
}

export type BuildInput = {
  packing?: { path: string; snap: FeishuRawSnapshot } | null;
  product?: { path: string; snap: FeishuRawSnapshot } | null;
  accounts?: { path: string; snap: FeishuRawSnapshot } | null;
  daily?: { path: string; snap: FeishuRawSnapshot } | null;
  now?: string;
};

function sourceMeta(
  hit: { path: string; snap: FeishuRawSnapshot } | null | undefined,
): LedgerSourceMeta {
  return {
    path: hit?.path ?? null,
    pulledAt: hit?.snap.pulledAt ?? null,
  };
}

export function buildCargoLedger(input: BuildInput): CargoLedger {
  const now = input.now ?? new Date().toISOString();
  const issues: LedgerIssue[] = [];
  const packingSnap = input.packing?.snap ?? null;
  const boxValues = sheetValues(packingSnap, "箱表");
  const lineValues = sheetValues(packingSnap, "装箱明细");
  const boxes = extractPackingBoxRows(boxValues);
  const lines = extractPackingLines(lineValues);
  const shopByBox = extractBoxShopMap(boxValues);

  let productPskus = new Set<string>();
  let purchaseBySku = new Map<
    string,
    { unitCost: number; purchasedAt: string | null }[]
  >();
  let purchaseLots = 0;
  let cashEntries = 0;
  let packagingRows = 0;

  if (input.product?.snap) {
    try {
      const n = normalizeProductSnapshot(input.product.snap, now);
      for (const c of n.costs) productPskus.add(c.partnerSku);
      for (const d of n.dims) productPskus.add(d.partnerSku);
    } catch (e) {
      issues.push({
        code: "product_normalize_failed",
        severity: "warn",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (input.accounts?.snap) {
    try {
      const n = normalizeAccountsSnapshot(input.accounts.snap, now);
      purchaseLots = n.purchases.length;
      cashEntries = n.cash.length;
      for (const p of n.purchases) {
        const list = purchaseBySku.get(p.partnerSku) ?? [];
        list.push({ unitCost: p.unitCost, purchasedAt: p.purchasedAt });
        purchaseBySku.set(p.partnerSku, list);
      }
      for (const list of purchaseBySku.values()) {
        list.sort((a, b) =>
          String(b.purchasedAt ?? "").localeCompare(String(a.purchasedAt ?? "")),
        );
      }
    } catch (e) {
      issues.push({
        code: "accounts_normalize_failed",
        severity: "warn",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    packagingRows = countSheetRows(input.accounts.snap, "产品包装采购");
    const incomeRows = countSheetRows(input.accounts.snap, "公司入账");
    const expenseRows = countSheetRows(input.accounts.snap, "公司开支-杂项");
    if (cashEntries === 0 && incomeRows + expenseRows > 0) {
      cashEntries = incomeRows + expenseRows;
    }
  }

  const daily = latestDailySheet(input.daily?.snap ?? null);

  type Acc = {
    key: string;
    boxes: typeof boxes;
    lines: typeof lines;
  };
  const byTicket = new Map<string, Acc>();
  const boxIndex = new Map<string, (typeof boxes)[0]>();
  for (const b of boxes) {
    if (!b.boxNo) continue;
    boxIndex.set(b.boxNo, b);
    const key = ticketKeyOf(b);
    const acc = byTicket.get(key) ?? { key, boxes: [], lines: [] };
    acc.boxes.push(b);
    byTicket.set(key, acc);
  }
  for (const line of lines) {
    const box = boxIndex.get(line.boxNo);
    const key = box
      ? ticketKeyOf(box)
      : ticketKeyOf({
          ticketNo: line.ticketNo,
          logisticsNo: line.logisticsNo,
          boxNo: line.boxNo,
        });
    const acc = byTicket.get(key) ?? { key, boxes: [], lines: [] };
    acc.lines.push(line);
    byTicket.set(key, acc);
    if (!box && line.boxNo) {
      issues.push({
        code: "line_box_missing",
        severity: "warn",
        message: `明细箱号 ${line.boxNo} 不在箱表`,
        boxNo: line.boxNo,
        partnerSku: line.partnerSku,
        ticketKey: key,
      });
    }
  }

  for (const b of boxes) {
    if (!b.boxNo) continue;
    const acc = byTicket.get(ticketKeyOf(b));
    if (acc && acc.lines.every((l) => l.boxNo !== b.boxNo)) {
      issues.push({
        code: "box_without_lines",
        severity: "info",
        message: `箱 ${b.boxNo} 无装箱明细`,
        boxNo: b.boxNo,
        ticketKey: acc.key,
      });
    }
  }

  const tickets: CargoLedgerTicket[] = [];
  for (const acc of byTicket.values()) {
    const first = acc.boxes[0];
    const shopCodes = acc.boxes.map(
      (b) =>
        shopByBox.get(b.boxNo) ||
        shopPrefixFromBoxNo(b.boxNo) ||
        "",
    );
    const shopFromLines = acc.lines
      .map((l) => shopPrefixFromPartnerSku(l.partnerSku) || "")
      .filter(Boolean);
    const shopCode =
      majorityShop(shopCodes) || majorityShop(shopFromLines) || "";
    if (new Set(shopCodes.filter(Boolean)).size > 1) {
      issues.push({
        code: "ticket_mixed_shop",
        severity: "warn",
        message: `票 ${acc.key} 箱表店铺不一致：${[...new Set(shopCodes)].join(",")}`,
        ticketKey: acc.key,
      });
    }

    const ticketFee = uniquePositive(
      acc.boxes.map((b) => b.ticketCrossFreight),
    );
    const boxFeeSum = round2(
      acc.boxes.reduce((s, b) => s + (b.boxCrossFreight ?? 0), 0),
    );
    let freightBasis: FreightBasis = "missing";
    let crossFreight: number | null = null;
    if (ticketFee.value != null) {
      crossFreight = ticketFee.value;
      freightBasis = "ticket";
      if (ticketFee.conflict) {
        issues.push({
          code: "ticket_freight_conflict",
          severity: "warn",
          message: `票 ${acc.key} 整票跨境实付多值，已取其一`,
          ticketKey: acc.key,
        });
      }
    } else if (boxFeeSum > 0) {
      crossFreight = boxFeeSum;
      freightBasis = "box_sum";
    }

    const domestic = uniquePositive(acc.boxes.map((b) => b.domesticFreight));

    const skuMap = new Map<
      string,
      { name: string; qty: number; weightKg: number; boxNos: Set<string> }
    >();
    for (const line of acc.lines) {
      if (!line.partnerSku) continue;
      const cur = skuMap.get(line.partnerSku) ?? {
        name: line.name,
        qty: 0,
        weightKg: 0,
        boxNos: new Set<string>(),
      };
      cur.qty += line.qty;
      cur.weightKg = round2(cur.weightKg + lineWeightKg(line));
      if (line.boxNo) cur.boxNos.add(line.boxNo);
      if (!cur.name && line.name) cur.name = line.name;
      skuMap.set(line.partnerSku, cur);
    }

    const weightTotal = [...skuMap.values()].reduce((s, x) => s + x.weightKg, 0);
    const qtyTotal = [...skuMap.values()].reduce((s, x) => s + x.qty, 0);

    const skuLines: CargoLedgerSkuLine[] = [...skuMap.entries()]
      .map(([partnerSku, row]) => {
        let allocated: number | null = null;
        if (crossFreight != null) {
          if (weightTotal > 0 && row.weightKg > 0) {
            allocated = round2((crossFreight * row.weightKg) / weightTotal);
          } else if (qtyTotal > 0) {
            allocated = round2((crossFreight * row.qty) / qtyTotal);
          }
        }
        const lots = purchaseBySku.get(partnerSku) ?? [];
        const skuShop = shopPrefixFromPartnerSku(partnerSku) || "";
        const shopMismatch = Boolean(
          shopCode && skuShop && shopCode !== skuShop,
        );
        if (shopMismatch) {
          issues.push({
            code: "sku_shop_mismatch",
            severity: "info",
            message: `${partnerSku} 前缀 ${skuShop} 与票店铺 ${shopCode} 不一致`,
            ticketKey: acc.key,
            partnerSku,
          });
        }
        if (!productPskus.has(partnerSku) && productPskus.size > 0) {
          issues.push({
            code: "sku_not_in_product",
            severity: "info",
            message: `${partnerSku} 不在产品主数据`,
            ticketKey: acc.key,
            partnerSku,
          });
        }
        return {
          partnerSku,
          name: row.name,
          qty: row.qty,
          weightKg: row.weightKg,
          boxNos: [...row.boxNos],
          allocatedCrossFreight: allocated,
          purchaseUnitHint: lots[0]?.unitCost ?? null,
          purchaseLotCount: lots.length,
          inProductMaster: productPskus.has(partnerSku),
          shopMismatch,
        };
      })
      .sort((a, b) => b.qty - a.qty || a.partnerSku.localeCompare(b.partnerSku));

    const inTransit = acc.boxes.some((b) =>
      isPackingInTransit(b.arriveAt, b.warehouseStatus),
    );
    const arriveDates = acc.boxes
      .map((b) => b.arriveAt)
      .filter((d): d is string => Boolean(d))
      .sort();
    const shipDates = acc.boxes
      .map((b) => b.shipAt)
      .filter((d): d is string => Boolean(d))
      .sort();

    tickets.push({
      ticketKey: acc.key,
      ticketNo: first?.ticketNo || acc.lines[0]?.ticketNo || "",
      logisticsNo: first?.logisticsNo || acc.lines[0]?.logisticsNo || "",
      shopCode,
      forwarder: first?.forwarder || acc.lines[0]?.forwarder || "",
      mode: first?.mode || acc.lines[0]?.mode || "",
      modeRaw: first?.modeRaw || acc.lines[0]?.modeRaw || "",
      shipAt: shipDates[0] ?? null,
      arriveAt: arriveDates[arriveDates.length - 1] ?? null,
      inTransit,
      settled: first?.settled || "",
      boxCount: acc.boxes.length,
      skuCount: skuLines.length,
      pcs: skuLines.reduce((s, x) => s + x.qty, 0),
      weightKg: round2(weightTotal),
      crossFreight,
      freightBasis,
      domesticFreight: domestic.value,
      boxes: acc.boxes.map((b) => ({
        boxNo: b.boxNo,
        shopCode: shopByBox.get(b.boxNo) || shopPrefixFromBoxNo(b.boxNo) || "",
        pcs: b.pcs,
        weightKg: b.weightKg,
        boxCrossFreight: b.boxCrossFreight,
        warehouseStatus: b.warehouseStatus,
        arriveAt: b.arriveAt,
      })),
      skuLines,
    });
  }

  tickets.sort((a, b) => {
    const da = a.shipAt || "";
    const db = b.shipAt || "";
    return db.localeCompare(da) || a.ticketKey.localeCompare(b.ticketKey);
  });

  const shopMap = new Map<
    string,
    CargoLedger["shops"][0]
  >();
  const skuPerShop = new Map<string, Set<string>>();
  for (const t of tickets) {
    const code = t.shopCode || "(未填)";
    const cur = shopMap.get(code) ?? {
      shopCode: code,
      tickets: 0,
      boxes: 0,
      pcs: 0,
      skuCount: 0,
      inTransitTickets: 0,
    };
    cur.tickets += 1;
    cur.boxes += t.boxCount;
    cur.pcs += t.pcs;
    if (t.inTransit) cur.inTransitTickets += 1;
    shopMap.set(code, cur);
    const set = skuPerShop.get(code) ?? new Set();
    for (const s of t.skuLines) set.add(s.partnerSku);
    skuPerShop.set(code, set);
  }
  const shops = [...shopMap.values()]
    .map((s) => ({
      ...s,
      skuCount: skuPerShop.get(s.shopCode)?.size ?? 0,
    }))
    .sort((a, b) => b.tickets - a.tickets);

  const MAX_ISSUES = 400;
  return {
    version: 1,
    builtAt: now,
    sources: {
      packing: sourceMeta(input.packing),
      product: sourceMeta(input.product),
      accounts: sourceMeta(input.accounts),
      daily: sourceMeta(input.daily),
    },
    side: {
      purchaseLots,
      purchasePskus: purchaseBySku.size,
      cashEntries,
      packagingRows,
      productMaster: productPskus.size,
      dailyLatestSheet: daily?.title ?? null,
      dailyPskus: daily?.pskus.size ?? 0,
    },
    shops,
    issues: issues.slice(0, MAX_ISSUES),
    tickets,
  };
}
