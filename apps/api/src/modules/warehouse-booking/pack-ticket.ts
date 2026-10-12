import { existsSync, readFileSync } from "node:fs";
import {
  loadLatestPackingLines,
  loadLogisticsBoxHints,
  shopPrefixFromPartnerSku,
  type PackingLineRow,
} from "../../platforms/feishu/normalize/packing-lines.js";
import { shopPrefixMapPath } from "./paths.js";
import type { BookingBox, BookingLineItem, BookingShopBucket } from "./types.js";

export type ShopPreset = {
  prefix: string;
  label: string;
  name: string;
  projectCode: string;
};

const FALLBACK_SHOPS: ShopPreset[] = [
  { prefix: "N1", label: "店1", name: "HUI Beauty", projectCode: "PRJ396770" },
  { prefix: "N2", label: "店2", name: "HFY-KSA", projectCode: "PRJ482387" },
  {
    prefix: "N3",
    label: "店3",
    name: "Glam Bag Collection",
    projectCode: "PRJ488078",
  },
  { prefix: "N4", label: "店4", name: "mmm", projectCode: "PRJ595165" },
];

export function loadShopPresets(): ShopPreset[] {
  const path = shopPrefixMapPath();
  if (!existsSync(path)) return FALLBACK_SHOPS.map((s) => ({ ...s }));
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      shops?: ShopPreset[];
      map?: Record<string, string>;
    };
    if (Array.isArray(raw.shops) && raw.shops.length) {
      return raw.shops.map((s) => ({
        prefix: String(s.prefix || "").toUpperCase(),
        label: s.label || s.prefix,
        name: s.name || s.prefix,
        projectCode: s.projectCode,
      }));
    }
    if (raw.map) {
      return Object.entries(raw.map).map(([prefix, projectCode]) => {
        const fb = FALLBACK_SHOPS.find((s) => s.prefix === prefix);
        return {
          prefix,
          label: fb?.label || prefix,
          name: fb?.name || prefix,
          projectCode,
        };
      });
    }
  } catch {
    /* fallback */
  }
  return FALLBACK_SHOPS.map((s) => ({ ...s }));
}

export function loadShopPrefixMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of loadShopPresets()) {
    if (s.prefix && s.projectCode) map[s.prefix] = s.projectCode;
  }
  return map;
}

export function findShopPreset(opts: {
  prefix?: string | null;
  projectCode?: string | null;
}): ShopPreset | null {
  const presets = loadShopPresets();
  const prefix = (opts.prefix || "").toUpperCase();
  const project = (opts.projectCode || "").trim().toUpperCase();
  if (prefix) {
    const hit = presets.find((s) => s.prefix === prefix);
    if (hit) return hit;
  }
  if (project) {
    const hit = presets.find(
      (s) => s.projectCode.toUpperCase() === project,
    );
    if (hit) return hit;
  }
  return null;
}

export function asnCreateUrl(projectCode: string, region = "sa"): string {
  const locale = region === "ae" ? "en-ae" : "en-sa";
  return `https://fbn-inbound.noon.partners/${locale}/asn/create?project=${encodeURIComponent(projectCode)}&step=skus`;
}

export function matchesTicket(line: PackingLineRow, ticketPrefix: string): boolean {
  const t = ticketPrefix.trim();
  if (!t) return false;
  const ln = (line.logisticsNo || "").trim();
  const tn = (line.ticketNo || "").trim();
  if (ln === t || ln.startsWith(t)) return true;
  if (tn === t || tn.startsWith(t)) return true;
  return false;
}

/** 票号后后缀：10002160U001 + ticket 10002160 → U001 */
export function logisticsSuffix(logisticsNo: string, ticketPrefix: string): string {
  const ln = logisticsNo.trim();
  const t = ticketPrefix.trim();
  if (ln.startsWith(t) && ln.length > t.length) return ln.slice(t.length);
  if (ln) return ln;
  return "(empty)";
}

function mergeItems(items: BookingLineItem[]): BookingLineItem[] {
  const map = new Map<string, BookingLineItem>();
  for (const it of items) {
    const key = it.partnerSku || `name:${it.name}`;
    const prev = map.get(key);
    if (prev) {
      prev.qty += it.qty;
      if (!prev.name && it.name) prev.name = it.name;
    } else {
      map.set(key, { ...it });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.partnerSku.localeCompare(b.partnerSku),
  );
}

function pickConsensusAsn(asns: string[]): string | null {
  const counts = new Map<string, number>();
  for (const a of asns) {
    const t = a.trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

/**
 * 按物流编号完整值分箱（后缀相同 = 同号 = 一箱），再按 PSKU 店前缀分店。
 * 箱表 ASN / 货代自动挂到店桶。
 */
export function buildShopBucketsFromLines(
  lines: PackingLineRow[],
  ticketPrefix: string,
  opts?: {
    region?: string;
    prefixMap?: Record<string, string>;
    logisticsHints?: Map<
      string,
      { asn: string; forwarder: string; arriveAt: string | null }
    >;
  },
): BookingShopBucket[] {
  const matched = lines.filter((l) => matchesTicket(l, ticketPrefix));
  const prefixMap = opts?.prefixMap ?? loadShopPrefixMap();
  const region = opts?.region ?? "sa";
  const hints = opts?.logisticsHints ?? new Map();

  const byShop = new Map<
    string,
    {
      boxes: Map<string, BookingBox>;
      forwarders: string[];
    }
  >();

  for (const line of matched) {
    const shop = shopPrefixFromPartnerSku(line.partnerSku) || "UNKNOWN";
    let bucket = byShop.get(shop);
    if (!bucket) {
      bucket = { boxes: new Map(), forwarders: [] };
      byShop.set(shop, bucket);
    }

    const logisticsNo = (line.logisticsNo || "").trim() || ticketPrefix;
    const hint = hints.get(logisticsNo);
    if (hint?.forwarder) bucket.forwarders.push(hint.forwarder);

    const item: BookingLineItem = {
      partnerSku: line.partnerSku,
      name: line.name,
      qty: line.qty,
    };

    let box = bucket.boxes.get(logisticsNo);
    if (!box) {
      box = {
        logisticsNo,
        suffix: logisticsSuffix(logisticsNo, ticketPrefix),
        items: [],
        pcs: 0,
        asnFromSheet: hint?.asn || null,
      };
      bucket.boxes.set(logisticsNo, box);
    }
    box.items.push(item);
    box.pcs += item.qty;
    if (!box.asnFromSheet && hint?.asn) box.asnFromSheet = hint.asn;
  }

  const shops: BookingShopBucket[] = [];
  for (const [shopPrefix, data] of [...byShop.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const boxes = [...data.boxes.values()]
      .map((b) => ({
        ...b,
        items: mergeItems(b.items),
      }))
      .sort((a, b) => a.logisticsNo.localeCompare(b.logisticsNo));
    const items = mergeItems(boxes.flatMap((b) => b.items));
    const projectCode = prefixMap[shopPrefix] ?? null;
    const preset = findShopPreset({ prefix: shopPrefix, projectCode });
    const asnFromSheet = pickConsensusAsn(
      boxes.map((b) => b.asnFromSheet || ""),
    );
    const forwarder =
      data.forwarders.find((f) => f.trim()) ||
      null;
    shops.push({
      shopPrefix,
      shopLabel: preset?.label ?? null,
      shopName: preset?.name ?? null,
      projectCode: projectCode || preset?.projectCode || null,
      asnCreateUrl:
        projectCode || preset?.projectCode
          ? asnCreateUrl(projectCode || preset!.projectCode, region)
          : null,
      asnId: asnFromSheet,
      asnSource: asnFromSheet ? "sheet" : null,
      boxes,
      items,
      // 箱表已有 ASN 时默认视为已对齐封装，用户可取消
      asnPackedConfirmed: Boolean(asnFromSheet),
      forwarder,
    });
  }
  return shops;
}

export function buildShopBucketsForTicket(
  ticketPrefix: string,
  opts?: { region?: string },
): { shops: BookingShopBucket[]; matchedLineCount: number } {
  const lines = loadLatestPackingLines();
  const matched = lines.filter((l) => matchesTicket(l, ticketPrefix));
  const logisticsHints = loadLogisticsBoxHints();
  return {
    shops: buildShopBucketsFromLines(matched, ticketPrefix, {
      ...opts,
      logisticsHints,
    }),
    matchedLineCount: matched.length,
  };
}
