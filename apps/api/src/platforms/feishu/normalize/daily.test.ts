/**
 * 日报第一步自测：sheet 选择 / 表头纠错 / 规范化
 * pnpm exec tsx src/platforms/feishu/normalize/daily.test.ts
 */
import {
  buildDailyBriefInput,
  excelSerialToIsoDate,
  parseDailySheetTitle,
  pickLatestDailySheets,
  repairDailyHeader,
  normalizeDailySheet,
} from "./daily.js";
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

assertEq(excelSerialToIsoDate(46280), "2026-09-15", "excel serial");
assertEq(parseDailySheetTitle("9.16", 2026).sortKey, 20260916, "title 9.16");
assertEq(parseDailySheetTitle("运营8.13", 2026).month, 8, "运营 prefix");
assert(parseDailySheetTitle("杂表", 2026).sortKey == null, "non-date title");

const repaired = repairDailyHeader([
  "日期",
  "N1SACFSQ001GRN",
  "SKU",
  "产品名称",
]);
assertEq(repaired[1], "PSKU", "repair psku header");

const sheets = [
  {
    sheetId: "a",
    title: "8.30",
    rowCount: 2,
    colCount: 4,
    values: [["日期", "PSKU", "SKU", "产品名称"]],
  },
  {
    sheetId: "b",
    title: "9.16",
    rowCount: 2,
    colCount: 4,
    values: [["日期", "PSKU", "SKU", "产品名称"]],
  },
  {
    sheetId: "c",
    title: "9.5",
    rowCount: 2,
    colCount: 4,
    values: [["日期", "PSKU", "SKU", "产品名称"]],
  },
  {
    sheetId: "d",
    title: "说明",
    rowCount: 1,
    colCount: 1,
    values: [["x"]],
  },
];
const picked = pickLatestDailySheets(sheets, { refYear: 2026 });
assertEq(picked.current.title, "9.16", "latest sheet");
assertEq(picked.previous?.title, "9.5", "previous sheet");

const sheetNorm = normalizeDailySheet(
  {
    sheetId: "s1",
    title: "9.16",
    rowCount: 3,
    colCount: 16,
    values: [
      [
        "日期",
        "N1XXX",
        "SKU",
        "产品名称",
        "入仓天数",
        "当前在线状态",
        "在线价",
        "30销量",
        "30访客",
        "30转化率",
        "近30天退货率",
        "链接状态",
        "产品主等级",
        "操作备注",
        "问题标签汇总",
        "广告亏损判断标签",
        "清货优先级",
        "库龄风险等级",
      ],
      [
        46280,
        "N1SAAFWO001WHT",
        "SKU1",
        "玩偶",
        10,
        "在线",
        99,
        5,
        100,
        0.05,
        0.01,
        "在售",
        "A 健康经营款",
        "",
        "低毛利",
        "广告健康",
        "无",
        "库龄正常",
      ],
      ["", "", "", "空行"],
    ],
  },
  { refYear: 2026 },
);
assertEq(sheetNorm.accepted, 1, "one accepted");
assertEq(sheetNorm.rejected, 1, "one empty psku reject");
assertEq(sheetNorm.rows[0]!.partnerSku, "N1SAAFWO001WHT", "psku");
assertEq(sheetNorm.rows[0]!.reportDate, "2026-09-15", "report date");
assertEq(sheetNorm.overview.online, 1, "online count");

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
      rowCount: 2,
      colCount: 4,
      values: [
        ["日期", "PSKU", "SKU", "产品名称", "当前在线状态", "产品主等级"],
        [46269, "N1SAAFWO001WHT", "SKU1", "玩偶", "在线", "B 观察/优化款"],
      ],
    },
    {
      sheetId: "new",
      title: "9.16",
      rowCount: 2,
      colCount: 4,
      values: [
        ["日期", "PSKU", "SKU", "产品名称", "当前在线状态", "产品主等级"],
        [46280, "N1SAAFWO001WHT", "SKU1", "玩偶", "在线", "A 健康经营款"],
      ],
    },
  ],
};

const brief = buildDailyBriefInput(snap, {
  sourceRawRunId: "test_run",
  builtAt: "2026-09-18T00:00:00.000Z",
  refYear: 2026,
});
assertEq(brief.current.meta.title, "9.16", "brief current");
assertEq(brief.previous?.meta.title, "9.5", "brief previous");
assertEq(brief.current.rows[0]!.grade, "A 健康经营款", "current grade");
assertEq(brief.previous!.rows[0]!.grade, "B 观察/优化款", "prev grade");

console.log("daily.test.ts OK");
