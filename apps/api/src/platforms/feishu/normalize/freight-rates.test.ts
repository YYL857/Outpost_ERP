/**
 * pnpm exec tsx src/platforms/feishu/normalize/freight-rates.test.ts
 */
import assert from "node:assert/strict";
import {
  extractFreightQuotes,
  parseAirSeaQuoteText,
  parsePriceSpan,
  summarizeQuotesByForwarder,
} from "./freight-rates.js";

{
  const s = parsePriceSpan("50.5-52.5/KG");
  assert.equal(s.low, 50.5);
  assert.equal(s.high, 52.5);
  assert.equal(s.mid, 51.5);
}

{
  const q = parseAirSeaQuoteText(
    "(空运) 50.5-52.5/KG - (海运) 10.4/KG",
  );
  assert.equal(q.air?.mid, 51.5);
  assert.equal(q.air?.unit, "kg");
  assert.equal(q.sea?.mid, 10.4);
}

{
  const q = parseAirSeaQuoteText(
    "（空运）（单50.5-杂52.5/KG）-（海运）10.4/KG",
  );
  assert.equal(q.air?.mid, 51.5);
  assert.equal(q.sea?.mid, 10.4);
}

{
  const values = [
    ["文本", "普货", "带电普货", "敏货", "灯具", "额外费用"],
    [
      "亦邦",
      "(空运) 50.5-52.5/KG - (海运) 10.4/KG",
      "(空运) 60.5-62.5/KG",
      "",
      "",
      "含送仓",
    ],
    ["飞坦", "(空运) 40/KG - (海运) 9/KG", "", "", "", ""],
    ["注：", "", "", "", "", ""],
    ["空运普货（汉沙）", "海运普货（汉沙，义特）同价", "6000", "1", "1", ""],
    ["空运带电普货（汉沙）", "海运带电普货（飞坦）", "6000", "", "", ""],
  ];
  const quotes = extractFreightQuotes(values);
  assert.ok(quotes.length >= 2);
  const by = summarizeQuotesByForwarder(quotes);
  assert.equal(by.length, 2, "note rows excluded");
  assert.ok(!by.some((x) => x.forwarder.startsWith("空运")));
  const yb = by.find((x) => x.forwarder === "亦邦")!;
  assert.equal(yb.generalAirMid, 51.5);
  assert.equal(yb.generalSeaMid, 10.4);
  assert.equal(yb.batteryAirMid, 61.5);
  const ft = by.find((x) => x.forwarder === "飞坦")!;
  assert.equal(ft.generalAirMid, 40);
}

console.log("freight-rates.test.ts OK");
