/**
 * 日报简报 LLM 自测（不调网络）：提示词载荷 + 钳制解析 + Markdown
 * pnpm exec tsx src/platforms/feishu/normalize/daily-llm.test.ts
 */
import { filterDailyBrief } from "./daily-rules.js";
import { buildDailyBriefInput } from "./daily.js";
import {
  buildDailyLlmPayload,
  collectAllowedPartnerSkus,
  DAILY_BRIEF_SYSTEM_PROMPT,
} from "./daily-prompts.js";
import {
  parseAndClampDailyJudgment,
  renderDailyBriefMarkdown,
} from "./daily-llm.js";
import type { FeishuRawSnapshot } from "../types.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(DAILY_BRIEF_SYSTEM_PROMPT.includes("禁止幻觉"), "system has anti-hallucination");
assert(DAILY_BRIEF_SYSTEM_PROMPT.includes("partnerSku"), "system mentions psku");
assert(DAILY_BRIEF_SYSTEM_PROMPT.includes("只输出一个 JSON"), "json only");

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
      sheetId: "a",
      title: "9.5",
      rowCount: 2,
      colCount: header.length,
      values: [
        header,
        [
          46269,
          "N1SAAFWO001WHT",
          "S",
          "玩偶",
          "在线",
          10,
          50,
          "B 观察/优化款",
          "",
          "广告健康",
          "无",
          "库龄正常",
          "7天未投放",
        ],
      ],
    },
    {
      sheetId: "b",
      title: "9.16",
      rowCount: 2,
      colCount: header.length,
      values: [
        header,
        [
          46280,
          "N1SAAFWO001WHT",
          "S",
          "玩偶",
          "在线",
          30,
          120,
          "A 健康经营款",
          "准S",
          "广告健康",
          "无",
          "库龄正常",
          "7天未投放",
        ],
      ],
    },
  ],
};

const brief = buildDailyBriefInput(snap, {
  sourceRawRunId: "t",
  builtAt: "2026-09-18T00:00:00.000Z",
  refYear: 2026,
});
const filtered = filterDailyBrief(brief);
const payload = buildDailyLlmPayload(filtered);
const allowed = collectAllowedPartnerSkus(payload);
assert(allowed.has("N1SAAFWO001WHT"), "allowed psku");

const { judgment, clampNotes } = parseAndClampDailyJudgment(
  {
    headline: "9.16 相对 9.5：1 个 SKU 销量上升且等级上调",
    highlights: [
      {
        partnerSku: "N1SAAFWO001WHT",
        productName: "假名字",
        point: "销量与等级双升",
        evidence: "dSales=+20，B→A",
      },
      {
        partnerSku: "N1FAKE0000000",
        productName: "幻觉款",
        point: "编造",
        evidence: "无",
      },
    ],
    risks: [],
    actions: [
      {
        partnerSku: "N1SAAFWO001WHT",
        productName: "玩偶",
        priority: "P1",
        action: "复盘转化与广告",
        why: "等级升至 A 且销量上涨",
      },
    ],
    caveats: ["补货计划字段为空"],
    confidence: "high",
  },
  allowed,
  new Map([["N1SAAFWO001WHT", "玩偶"]]),
);

assert(judgment.highlights.length === 1, "fake psku dropped");
assert(judgment.highlights[0]!.productName === "玩偶", "name corrected");
assert(clampNotes.some((n) => n.includes("N1FAKE")), "note fake drop");

const scrubbed = parseAndClampDailyJudgment(
  {
    headline: "x",
    highlights: [],
    risks: [
      {
        partnerSku: "N1SAAFWO001WHT",
        productName: "玩偶",
        point: "从 S 核心利润款跌落",
        evidence: "等级 S 核心利润款→B 观察/优化款",
      },
    ],
    actions: [],
    caveats: [],
    confidence: "medium",
  },
  allowed,
  new Map([["N1SAAFWO001WHT", "玩偶"]]),
  new Set(["B 观察/优化款", "A 健康经营款"]),
);
assert(
  !scrubbed.judgment.risks[0]!.evidence.includes("S 核心利润款"),
  "scrub fake grade",
);
assert(scrubbed.clampNotes.some((n) => n.includes("编造等级")), "note scrub");
assert(judgment.actions[0]!.priority === "P1", "priority");

const md = renderDailyBriefMarkdown(judgment, {
  currentSheet: "9.16",
  previousSheet: "9.5",
  confidence: judgment.confidence,
});
assert(md.includes("## 亮点"), "md section");
assert(md.includes("N1SAAFWO001WHT"), "md psku");
assert(md.includes("未修改飞书源表"), "md disclaimer");

console.log("daily-llm.test.ts OK");
