import assert from "node:assert/strict";
import { hasHan, preferChineseTitle } from "./catalog-display.js";

assert.equal(hasHan("塑形按摩器"), true);
assert.equal(hasHan("KAZA Body Shaping Massager"), false);
assert.equal(hasHan(""), false);

assert.equal(
  preferChineseTitle(
    "KAZA Body Shaping Massager, White",
    "塑形按摩器 白色",
    "KAZA Body Shaping Massager, White",
  ),
  "塑形按摩器 白色",
);

assert.equal(
  preferChineseTitle("装箱中文名", "采购中文名", "English Catalog"),
  "装箱中文名",
);

assert.equal(
  preferChineseTitle("", null, "English only"),
  "English only",
);

assert.equal(preferChineseTitle("", "  ", null), "");

console.log("catalog-display.test.ts ok");
