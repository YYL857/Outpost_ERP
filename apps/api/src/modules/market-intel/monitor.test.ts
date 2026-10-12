/**
 * 双次同向价变告警：npx tsx src/modules/market-intel/monitor.test.ts
 */
import {
  evaluatePriceAlertTransition,
  scorePriceObservation,
} from "./monitor.js";
import type { PriceObservation } from "./types.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function obs(
  partial: Partial<PriceObservation> & { price: number },
): PriceObservation {
  return {
    id: partial.id ?? "obs_1",
    productKey: "SKU1",
    url: "https://www.noon.com/saudi-en/x/p/SKU1",
    title: partial.title ?? "Wireless earbuds",
    price: partial.price,
    currency: "SAR",
    promoText: null,
    inStock: true,
    confidence: partial.confidence ?? 0.85,
    tier: partial.tier ?? "high",
    source: "extension",
    parseMethod: "dom",
    flags: partial.flags ?? [],
    capturedAt: partial.capturedAt ?? "2026-09-23T01:00:00.000Z",
  };
}

{
  const s = scorePriceObservation({
    price: 99,
    title: "Wireless earbuds",
    source: "extension",
    parseMethod: "dom",
  });
  assert(s.tier === "high", `expected high tier, got ${s.tier} (${s.confidence})`);
  assert(s.flags.length === 0, `unexpected flags ${s.flags.join(",")}`);
}

{
  const dirty = scorePriceObservation({
    price: 2025,
    title: "Mega Deal iPad 2025",
    source: "yingdao",
    parseMethod: "regex",
  });
  assert(dirty.tier === "low", `dirty should be low, got ${dirty.tier}`);
  assert(
    dirty.flags.includes("promo_title") || dirty.flags.includes("implausible_price"),
    "expected promo or implausible flag",
  );
}

{
  const first = evaluatePriceAlertTransition({
    prevPrice: 100,
    pending: null,
    observation: obs({ id: "a", price: 80 }),
  });
  assert(first.alert == null, "first change must not alert");
  assert(first.pending?.direction === "down", "pending down");
  assert(first.skippedAlertReason === "awaiting_confirm", "await confirm");

  const second = evaluatePriceAlertTransition({
    prevPrice: 80,
    pending: first.pending,
    observation: obs({ id: "b", price: 79, capturedAt: "2026-09-23T02:00:00.000Z" }),
  });
  assert(second.alert != null, "second confirm should alert");
  assert(second.alert!.direction === "down", "alert down");
  assert(second.alert!.fromPrice === 100, "from baseline");
  assert(second.pending == null, "pending cleared");
}

{
  const first = evaluatePriceAlertTransition({
    prevPrice: 100,
    pending: null,
    observation: obs({ id: "c", price: 80 }),
  });
  const bounce = evaluatePriceAlertTransition({
    prevPrice: 80,
    pending: first.pending,
    observation: obs({ id: "d", price: 100 }),
  });
  assert(bounce.alert == null, "bounce should not alert");
  assert(
    bounce.skippedAlertReason === "reverted" ||
      bounce.skippedAlertReason === "direction_reset",
    `bounce reason ${bounce.skippedAlertReason}`,
  );
}

{
  const low = evaluatePriceAlertTransition({
    prevPrice: 100,
    pending: null,
    observation: obs({
      id: "e",
      price: 70,
      confidence: 0.3,
      tier: "low",
      flags: ["implausible_price"],
    }),
  });
  assert(low.alert == null && low.pending == null, "low conf no pending");
  assert(low.skippedAlertReason === "low_confidence", "low conf reason");
}

console.log("monitor.test.ts OK");
