/**
 * 货代大纲费率查找：精确货性 → 推断敏货带电 → 普货 → 全局配置。
 */
import type {
  CargoKind,
  ForwarderQuoteRow,
  FreightRatesPayload,
} from "../../../platforms/feishu/normalize/freight-rates.js";
import type { ShippingConfig } from "../../../common/types.js";
import type { ShipMode } from "../../../platforms/feishu/normalize/forwarder-board.js";
import type { FreightCargoKind } from "./cargo-name-rules.js";
import type { RateSource } from "./types.js";

export type ResolvedRate = {
  mid: number;
  source: RateSource;
  unit: "kg" | "cbm" | "unknown";
};

function findQuote(
  quotes: ForwarderQuoteRow[],
  forwarder: string,
  kind: CargoKind,
): ForwarderQuoteRow | null {
  const exact = quotes.find(
    (q) => q.forwarder === forwarder && q.cargoKind === kind,
  );
  if (exact) return exact;
  return (
    quotes.find(
      (q) =>
        q.cargoKind === kind &&
        (forwarder.includes(q.forwarder) || q.forwarder.includes(forwarder)),
    ) ?? null
  );
}

function modeRate(
  q: ForwarderQuoteRow | null,
  mode: "air" | "sea",
): { mid: number; unit: "kg" | "cbm" | "unknown" } | null {
  if (!q) return null;
  const r = mode === "air" ? q.air : q.sea;
  if (r?.mid == null || r.mid <= 0) return null;
  return { mid: r.mid, unit: r.unit };
}

function fromByForwarder(
  by: FreightRatesPayload["byForwarder"][number] | undefined,
  kind: FreightCargoKind,
  mode: "air" | "sea",
): number | null {
  if (!by) return null;
  const pick = (air: number | null, sea: number | null) =>
    mode === "air" ? air : sea;
  switch (kind) {
    case "general":
      return pick(by.generalAirMid, by.generalSeaMid);
    case "battery":
      return pick(by.batteryAirMid, by.batterySeaMid);
    case "sensitive":
      return pick(by.sensitiveAirMid, by.sensitiveSeaMid);
    case "sensitive_battery":
      return pick(by.sensitiveBatteryAirMid, by.sensitiveBatterySeaMid);
    case "lamp":
      return pick(by.lampAirMid, by.lampSeaMid);
    default:
      return null;
  }
}

function findByForwarder(
  rates: FreightRatesPayload,
  forwarder: string,
): FreightRatesPayload["byForwarder"][number] | undefined {
  return (
    rates.byForwarder.find((x) => x.forwarder === forwarder) ??
    rates.byForwarder.find(
      (x) =>
        forwarder.includes(x.forwarder) || x.forwarder.includes(forwarder),
    )
  );
}

/**
 * 解析 (货代, 货性, 空/海) 单价。
 * 敏货带电无列时取 max(敏货, 带电)。
 */
export function resolveForwarderRate(args: {
  rates: FreightRatesPayload;
  forwarder: string;
  cargoKind: FreightCargoKind;
  mode: ShipMode;
  shipping: ShippingConfig;
}): ResolvedRate | null {
  const mode: "air" | "sea" =
    args.mode === "sea" ? "sea" : args.mode === "air" ? "air" : "air";
  const by = findByForwarder(args.rates, args.forwarder);

  const tryKind = (kind: CargoKind, source: RateSource): ResolvedRate | null => {
    const q = findQuote(args.rates.quotes, args.forwarder, kind);
    const fromQ = modeRate(q, mode);
    if (fromQ) return { mid: fromQ.mid, source, unit: fromQ.unit };
    const mid = fromByForwarder(by, kind as FreightCargoKind, mode);
    if (mid != null && mid > 0) {
      return {
        mid,
        source,
        unit: mode === "air" ? "kg" : "cbm",
      };
    }
    return null;
  };

  if (args.cargoKind === "sensitive_battery") {
    const exact = tryKind("sensitive_battery", "exact");
    if (exact) return exact;
    const sens = tryKind("sensitive", "inferred");
    const batt = tryKind("battery", "inferred");
    if (sens && batt) {
      return {
        mid: Math.max(sens.mid, batt.mid),
        source: "inferred",
        unit: sens.unit !== "unknown" ? sens.unit : batt.unit,
      };
    }
    if (sens) return { ...sens, source: "inferred" };
    if (batt) return { ...batt, source: "inferred" };
  } else {
    const exact = tryKind(args.cargoKind, "exact");
    if (exact) return exact;
  }

  if (args.cargoKind !== "general") {
    const gen = tryKind("general", "general_fallback");
    if (gen) return gen;
  }

  // 全局配置兜底
  if (mode === "air") {
    const mid = args.shipping.airFreightRmbPerKg ?? 0;
    if (mid > 0) {
      return { mid, source: "global_config", unit: "kg" };
    }
  } else {
    const mid = args.shipping.seaFreightRmbPerCbmGeneral ?? 0;
    if (mid > 0) {
      return { mid, source: "global_config", unit: "cbm" };
    }
  }
  return null;
}

/** 店内最近常用货代（箱数最多） */
export function mostUsedForwarder(
  boxes: Array<{ forwarder: string }>,
): string | null {
  const counts = new Map<string, number>();
  for (const b of boxes) {
    if (!b.forwarder || b.forwarder === "(未填货代)") continue;
    counts.set(b.forwarder, (counts.get(b.forwarder) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [name, c] of counts) {
    if (c > n) {
      n = c;
      best = name;
    }
  }
  return best;
}
