/**
 * 从头程引擎构建全量结果（只读飞书 raw + ShippingConfig）。
 */
import type { ShippingConfig, SkuDims, SkuLocalCost } from "../../../common/types.js";
import {
  extractPackingBoxRows,
  type PackingBoxRow,
} from "../../../platforms/feishu/normalize/forwarder-board.js";
import { buildFreightRatesPayload } from "../../../platforms/feishu/normalize/freight-rates.js";
import {
  extractPackingLines,
  groupPackingLinesByBox,
  loadLatestPackingLines,
  type PackingLineRow,
} from "../../../platforms/feishu/normalize/packing-lines.js";
import { getFeishuRawDir } from "../../../platforms/feishu/config.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  allocateTicketFreightToBoxes,
  computeBoxHeadhaul,
} from "./allocate.js";
import { resolveCargoKind } from "./cargo-name-rules.js";
import { mostUsedForwarder, resolveForwarderRate } from "./rate-lookup.js";
import { summarizeSkuHeadhaul, skuHeadhaulMap } from "./summarize.js";
import type {
  BoxHeadhaulResult,
  HeadhaulPayload,
  SkuHeadhaulSummary,
} from "./types.js";

type Cache = { key: string; payload: HeadhaulPayload };
let cache: Cache | null = null;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function rawDirCandidates(): string[] {
  const primary = getFeishuRawDir();
  const shared = resolve(
    process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
    "feishu-raw",
  );
  const fromShop = resolve(primary, "..", "..", "..", "feishu-raw");
  return [...new Set([primary, shared, fromShop])];
}

function latestPackingFull(): {
  path: string;
  pulledAt: string | null;
  boxValues: unknown[][];
  detailValues: unknown[][];
} | null {
  for (const dir of rawDirCandidates()) {
    const candidates: string[] = [];
    const lastPath = join(dir, "last-run.json");
    if (existsSync(lastPath)) {
      try {
        const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
          runId?: string;
        };
        if (last.runId) {
          candidates.push(
            join(dir, "runs", last.runId, "packing", "snapshot.json"),
          );
        }
      } catch {
        /* */
      }
    }
    const runsDir = join(dir, "runs");
    if (existsSync(runsDir)) {
      try {
        const runs = readdirSync(runsDir)
          .map((name) => {
            const path = join(runsDir, name, "packing", "snapshot.json");
            if (!existsSync(path)) return null;
            return { path, mtime: statSync(path).mtimeMs };
          })
          .filter(Boolean) as Array<{ path: string; mtime: number }>;
        runs.sort((a, b) => b.mtime - a.mtime);
        for (const r of runs) candidates.push(r.path);
      } catch {
        /* */
      }
    }
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      try {
        const snap = JSON.parse(readFileSync(path, "utf8")) as {
          pulledAt?: string;
          sheets?: Array<{ title?: string; values?: unknown[][] }>;
        };
        const boxSheet =
          snap.sheets?.find((s) => s.title === "箱表") ??
          snap.sheets?.find((s) => (s.title ?? "").includes("箱表"));
        const detailSheet = snap.sheets?.find((s) => s.title === "装箱明细");
        if (!boxSheet?.values) continue;
        return {
          path,
          pulledAt: snap.pulledAt ?? null,
          boxValues: boxSheet.values,
          detailValues: detailSheet?.values ?? [],
        };
      } catch {
        /* next */
      }
    }
  }
  return null;
}

export function clearHeadhaulCache(): void {
  cache = null;
}

export function buildHeadhaulFromParts(args: {
  boxes: PackingBoxRow[];
  lines: PackingLineRow[];
  rates: ReturnType<typeof buildFreightRatesPayload>;
  shipping: ShippingConfig;
  productCargoBySku?: ReadonlyMap<string, string>;
  packingSnapshot?: string | null;
  pulledAt?: string | null;
}): HeadhaulPayload {
  const byBox = groupPackingLinesByBox(args.lines);
  const ticketAlloc = allocateTicketFreightToBoxes(args.boxes, args.shipping);
  const results: BoxHeadhaulResult[] = [];

  for (const box of args.boxes) {
    if (!box.boxNo) continue;
    const lines = byBox.get(box.boxNo) ?? [];
    if (lines.length === 0) continue;
    results.push(
      computeBoxHeadhaul({
        box,
        lines,
        rates: args.rates,
        shipping: args.shipping,
        ticketAllocatedRmb: ticketAlloc.get(box.boxNo) ?? null,
        productCargoBySku: args.productCargoBySku,
      }),
    );
  }

  const bySku = summarizeSkuHeadhaul(results);
  return {
    source: {
      packingSnapshot: args.packingSnapshot ?? null,
      ratesSnapshot: args.rates.source.snapshotPath,
      pulledAt: args.pulledAt ?? args.rates.source.pulledAt,
    },
    boxes: results,
    bySku,
  };
}

export function buildHeadhaulPayload(shipping: ShippingConfig): HeadhaulPayload {
  const pack = latestPackingFull();
  const rates = buildFreightRatesPayload();
  const packKey = pack
    ? `${pack.path}:${statSync(pack.path).mtimeMs}`
    : "empty-pack";
  const ratesKey = rates.source.snapshotPath
    ? `${rates.source.snapshotPath}:${rates.source.pulledAt ?? ""}`
    : "empty-rates";
  const shipKey = `${shipping.airFreightRmbPerKg}:${shipping.seaFreightRmbPerCbmGeneral}:${shipping.volumetricDivisor}`;
  const key = `${packKey}|${ratesKey}|${shipKey}`;
  if (cache?.key === key) return cache.payload;

  const boxes = pack ? extractPackingBoxRows(pack.boxValues) : [];
  const lines = pack
    ? extractPackingLines(pack.detailValues)
    : loadLatestPackingLines();

  const payload = buildHeadhaulFromParts({
    boxes,
    lines,
    rates,
    shipping,
    packingSnapshot: pack?.path ?? null,
    pulledAt: pack?.pulledAt ?? null,
  });
  cache = { key, payload };
  return payload;
}

export function getBoxHeadhaul(
  shipping: ShippingConfig,
  boxNo: string,
): BoxHeadhaulResult | null {
  const payload = buildHeadhaulPayload(shipping);
  return payload.boxes.find((b) => b.boxNo === boxNo) ?? null;
}

export function getSkuHeadhaulSummary(
  shipping: ShippingConfig,
  partnerSku: string,
): SkuHeadhaulSummary | null {
  const payload = buildHeadhaulPayload(shipping);
  return payload.bySku.find((s) => s.partnerSku === partnerSku) ?? null;
}

export function loadSkuHeadhaulMap(
  shipping: ShippingConfig,
): Map<string, SkuHeadhaulSummary> {
  return skuHeadhaulMap(buildHeadhaulPayload(shipping).bySku);
}

/**
 * Catalog 无装箱史时的单件头程：尺寸 × preferAir × 常用货代大纲（或全局）。
 */
export function estimateUnitHeadhaulFallback(args: {
  shipping: ShippingConfig;
  dims: SkuDims | null;
  localCost: SkuLocalCost | null;
  productName?: string;
  boxes?: PackingBoxRow[];
  rates?: ReturnType<typeof buildFreightRatesPayload>;
}): { rmb: number; confidence: "fallback" | "approx"; reasons: string[] } {
  const reasons: string[] = [];
  const dims = args.dims;
  if (!dims) {
    return { rmb: 0, confidence: "fallback", reasons: ["无尺寸"] };
  }
  const preferAir = args.localCost?.preferAir ?? true;
  const mode = preferAir ? "air" : "sea";
  const cargoKind = resolveCargoKind({
    productName: args.productName ?? "",
    productCargoLabel: args.localCost?.cargoType ?? null,
  });
  // cargoType plug/builtin/general 不是大纲标签；重新映射
  let kind = cargoKind;
  if (args.localCost?.cargoType === "builtin") kind = "battery";
  else if (args.localCost?.cargoType === "plug") kind = "battery";

  const rates = args.rates ?? buildFreightRatesPayload();
  const forwarder =
    mostUsedForwarder(args.boxes ?? []) ??
    rates.byForwarder[0]?.forwarder ??
    "";

  const rate = resolveForwarderRate({
    rates,
    forwarder: forwarder || "(无货代)",
    cargoKind: kind,
    mode,
    shipping: args.shipping,
  });

  const vol =
    dims.lengthCm > 0 &&
    dims.widthCm > 0 &&
    dims.heightCm > 0 &&
    args.shipping.volumetricDivisor > 0
      ? (dims.lengthCm * dims.widthCm * dims.heightCm) /
        args.shipping.volumetricDivisor
      : 0;
  const chargeable = Math.max(dims.weightKg ?? 0, vol);
  const cbm =
    dims.lengthCm > 0 && dims.widthCm > 0 && dims.heightCm > 0
      ? (dims.lengthCm * dims.widthCm * dims.heightCm) / 1_000_000
      : 0;

  if (!rate) {
    return { rmb: 0, confidence: "fallback", reasons: ["无费率"] };
  }
  reasons.push(`单方式=${mode}`, `货性=${kind}`, `费率=${rate.mid}(${rate.source})`);

  let rmb = 0;
  if (mode === "air") {
    if (chargeable <= 0) return { rmb: 0, confidence: "fallback", reasons };
    rmb = round2(chargeable * rate.mid);
  } else {
    if (rate.unit === "kg" && chargeable > 0) {
      rmb = round2(chargeable * rate.mid);
    } else if (cbm > 0) {
      rmb = round2(cbm * rate.mid);
    } else {
      return { rmb: 0, confidence: "fallback", reasons };
    }
  }

  const confidence =
    rate.source === "global_config" ? "fallback" : "approx";
  return { rmb, confidence, reasons };
}

export type { HeadhaulPayload, BoxHeadhaulResult, SkuHeadhaulSummary };
