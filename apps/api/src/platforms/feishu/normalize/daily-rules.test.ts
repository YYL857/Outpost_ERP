/**
 * 日报规则精筛自测
 * pnpm exec tsx src/platforms/feishu/normalize/daily-rules.test.ts
 */
import { buildDailyBriefInput } from "./daily.js";
import { filterDailyBrief } from "./daily-rules.js";
import type { FeishuRawSnapshot } from "../types.js";

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

const header = [
  "日期",
  "PSKU",
  "SKU",
  "产品名称",
  "当前在线状态",
  "30销量",
  "30访客",
  "产品主等级",
  "问题标签汇总",
  "广告亏损判断标签",
  "清货优先级",
  "库龄风险等级",
  "7天广告盈亏标签",
];

function row(
  psku: string,
  name: string,
  online: string,
  sales: number,
  visitors: number,
  grade: string,
  tags: string,
  adLoss: string,
  clear: string,
  age: string,
  ad7: string,
) {
  return [
    46280,
    psku,
    "S",
    name,
    online,
    sales,
    visitors,
    grade,
    tags,
    adLoss,
    clear,
    age,
    ad7,
  ];
}

const snap: FeishuRawSnapshot = {
  version: 1,
  pulledAt: "2026-09-17T00:00:00.000Z",
  docId: "daily",
  docLabel: "日报",
  targetDomain: "ops_tags",
  kind: "spreadsheet",
  spreadsheetToken: "TOK",
  source: { appIdMasked: "cli…" },
  sheets: [
    {
      sheetId: "old",
      title: "9.5",
      rowCount: 4,
      colCount: header.length,
      values: [
        header,
        row(
          "N1SAAAA001WHT",
          "上涨款",
          "在线",
          10,
          100,
          "B 观察/优化款",
          "低毛利",
          "广告健康",
          "无",
          "库龄正常",
          "7天未投放",
        ),
        row(
          "N1SABBB001BLK",
          "降级款",
          "在线",
          20,
          200,
          "A 健康经营款",
          "",
          "广告健康",
          "无",
          "库龄正常",
          "7天广告不亏",
        ),
        row(
          "N1SACCC001GRN",
          "清货款",
          "在线",
          1,
          10,
          "C 淘汰/清理款",
          "待确认滞销",
          "未投放",
          "无",
          "库龄正常",
          "7天未投放",
        ),
      ],
    },
    {
      sheetId: "new",
      title: "9.16",
      rowCount: 4,
      colCount: header.length,
      values: [
        header,
        row(
          "N1SAAAA001WHT",
          "上涨款",
          "在线",
          25,
          180,
          "A 健康经营款",
          "低毛利",
          "广告健康",
          "无",
          "库龄正常",
          "7天未投放",
        ),
        row(
          "N1SABBB001BLK",
          "降级款",
          "不在线",
          8,
          50,
          "B 观察/优化款",
          "高退货风险",
          "短期亏损",
          "需处理",
          "轻度老化",
          "7天广告亏损",
        ),
        row(
          "N1SACCC001GRN",
          "清货款",
          "在线",
          1,
          10,
          "C 淘汰/清理款",
          "待确认滞销",
          "未投放",
          "需处理",
          "库龄正常",
          "7天未投放",
        ),
      ],
    },
  ],
};

const brief = buildDailyBriefInput(snap, {
  sourceRawRunId: "t",
  builtAt: "2026-09-18T00:00:00.000Z",
  refYear: 2026,
});
const filtered = filterDailyBrief(brief, { watchlistMax: 50, salesDeltaAbsMin: 5 });

assertEq(filtered.currentSheet, "9.16", "sheet");
assert(filtered.deltaCounts.grade >= 2, "grade changes");
assert(filtered.deltaCounts.online >= 1, "online changes");
assert(filtered.deltaCounts.clear >= 2, "clear changes");
assert(filtered.deltas.salesUpTop.some((x) => x.partnerSku === "N1SAAAA001WHT"), "sales up");
assert(filtered.deltas.salesDownTop.some((x) => x.partnerSku === "N1SABBB001BLK"), "sales down");
assert(
  filtered.watchlist.some((w) => w.partnerSku === "N1SABBB001BLK"),
  "bbb in watchlist",
);
assert(
  filtered.watchlist.some((w) => w.partnerSku === "N1SACCC001GRN"),
  "ccc clear_action in watchlist",
);
assert(filtered.watchlist.length <= 50, "cap");
assert(filtered.noiseStats.currentSkuTotal === 3, "sku total");

console.log("daily-rules.test.ts OK", {
  watchlist: filtered.watchlist.map((w) => ({
    psku: w.partnerSku,
    reasons: w.reasons,
  })),
  deltaCounts: filtered.deltaCounts,
});
