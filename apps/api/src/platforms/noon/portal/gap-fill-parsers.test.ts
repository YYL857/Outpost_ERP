/**
 * Estimated Fees / FBN dims 解析自测
 * pnpm exec tsx src/platforms/noon/portal/gap-fill-parsers.test.ts
 */
import {
  detectDomainFromFilename,
  parseCatalogContent,
  parseCatalogEstimatedFees,
  parseFbnDimsContent,
} from "./parsers.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) {
    console.error("FAIL:", msg, "got", a, "expected", b);
    process.exit(1);
  }
}

assertEq(
  detectDomainFromFilename("catalog_est_fees_2026-09-18.csv"),
  "fee_estimates",
  "est fees domain",
);
assertEq(
  detectDomainFromFilename("fbn_dims_2026-09-18.csv"),
  "fbn_dims",
  "fbn dims domain",
);
assertEq(
  detectDomainFromFilename("noon_financeweb_statements_2026-06_09.csv"),
  "statements",
  "statements domain",
);
assertEq(
  detectDomainFromFilename("PRJ_live.csv"),
  "catalog",
  "catalog still catalog",
);

const feesCsv = [
  "partner_sku,estimated_fees_fbn,estimated_fees_fbp,sale_price",
  "N1SA001,22.58,31.50,89.99",
  "N1SA002,0,12.00,50",
].join("\n");
const fees = parseCatalogEstimatedFees(feesCsv, "csv");
assertEq(fees.length, 2, "two fee rows");
assertEq(fees[0]!.estimated_fee_total, 22.58, "fbn preferred");
assertEq(fees[0]!.fulfillment, "fbn", "fbn flag");
assertEq(fees[1]!.fulfillment, "fbp", "fbp fallback");

const dimsCsv = [
  "partner_sku,dimensions,weight",
  "N1SA001,12.6 x 8.8 x 3.3,0.04",
  "N1SA002,,,",
].join("\n");
const dims = parseFbnDimsContent(dimsCsv, "csv");
assertEq(dims.length, 1, "one dim row");
assertEq(dims[0]!.length_cm, 12.6, "L");
assertEq(dims[0]!.width_cm, 8.8, "W");
assertEq(dims[0]!.height_cm, 3.3, "H");
assertEq(dims[0]!.weight_kg, 0.04, "weight");

const catalogCsv = [
  "partner_sku,title,active_price,price,sale_price,currency",
  "N1SABZH001BLK,Insulin,29.9,33.9,,SAR",
  "N1PLAIN,Plain,,18.5,,SAR",
].join("\n");
const catalog = parseCatalogContent(catalogCsv, "csv");
assertEq(catalog.length, 2, "two catalog rows");
assertEq(catalog[0]!.price, 29.9, "selling price prefers active_price");
assertEq(catalog[0]!.active_price, 29.9, "activity price column");
assertEq(catalog[0]!.list_price, 33.9, "base price column");
assertEq(catalog[1]!.price, 18.5, "missing active_price falls back to price");
assertEq(catalog[1]!.active_price, null, "no activity price");
assertEq(catalog[1]!.list_price, 18.5, "list price still present");

console.log("OK gap-fill parsers");
