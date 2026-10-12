/**
 * 轻量：npx tsx src/modules/market-intel/parse-products-sold.test.ts
 */
import { parseSoldRecentlyCount } from "./parse-products.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(parseSoldRecentlyCount("6700+ Sold Recently") === 6700, "text with label");
assert(parseSoldRecentlyCount("2.6K+") === 2600, "K suffix");
assert(parseSoldRecentlyCount(80) === 80, "number");
assert(parseSoldRecentlyCount(null) === null, "null");

// 模拟 pickListSignals 从 cardTags 回落：与 parse-products 内逻辑一致
function soldFromTags(tags: string[]): number | null {
  const tagSold =
    tags.find((t) => /sold\s+recently/i.test(t)) ||
    tags.find((t) => /\d[\d.,]*\s*[KkMm]?\+?\s*sold/i.test(t)) ||
    null;
  return parseSoldRecentlyCount(tagSold);
}
assert(soldFromTags(["Free Delivery", "80+ Sold Recently"]) === 80, "from cardTags");
assert(soldFromTags(["GET IN 47 MINS"]) === null, "no sold tag");

console.log("parse-products-sold.test.ts: ok");
