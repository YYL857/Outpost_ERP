import type { AppState } from "../../common/types.js";
import { getActiveShop } from "../../shops/registry.js";
import { buildStoreDigestPayload } from "../morning-digest/store-payload.js";
import { checkStoreReadiness } from "../morning-digest/readiness.js";
import {
  buildFinanceInterpretPayload,
  financeHasNumbers,
} from "./finance-payload.js";
import {
  clampOpsJudgment,
  emptyJudgment,
  unionCaveats,
  type OpsJudgment,
} from "./judgment.js";
import { callOpsJson } from "./llm.js";

export type OpsSurface = "sales" | "replenish" | "finance";

export type OpsInterpretResult = {
  surface: OpsSurface;
  asOf: string;
  model: string | null;
  skippedLlm: boolean;
  judgment: OpsJudgment;
};

const JUDGMENT_SHAPE = `{
  "headline": string,
  "highlights": [{"id": string, "name": string, "point": string, "evidence": string}],
  "risks": [{"id": string, "name": string, "point": string, "evidence": string}],
  "actions": [{"id": string, "name": string, "priority": "P0|P1|P2", "action": string, "why": string}],
  "caveats": string[],
  "confidence": "high|medium|low"
}`;

const SALES_SYSTEM = `你是 Outpost 销量解读助手。唯一信息来源是用户 JSON。
输出严格 JSON：
${JUDGMENT_SHAPE}
规则：
1. 只依据 JSON 里的 partnerSku 和数字，禁止编造 SKU、销量或广告花费。
2. 重点写 topSales 与 overview 的近 7 日销量；adsWatch 只在花费或 ROAS 已给出时提及。
3. highlights≤5，risks≤5，actions≤5。id 必须是 JSON 中出现的 partnerSku。
4. softNotes 必须写入 caveats。
5. 简体中文。这是按需解读，不要写成定时晨报。`;

const REPLENISH_SYSTEM = `你是 Outpost 补货解读助手。唯一信息来源是用户 JSON。
输出严格 JSON：
${JUDGMENT_SHAPE}
规则：
1. 只依据 JSON 里的 partnerSku、stockTotal、availableDays、sales7u，禁止编造库存或补货数量。
2. 重点写 urgentReplenish。没有紧急行时，headline 说明当前没有紧急补货，不要凑假 SKU。
3. highlights≤5，risks≤5，actions≤5。id 必须是 JSON 中出现的 partnerSku；若无紧急行，三个数组都可以为空。
4. softNotes 必须写入 caveats。不要根据常识建议具体补货件数。
5. 简体中文。这是按需解读，不要写成定时晨报。`;

const FINANCE_SYSTEM = `你是 Outpost 财务解读助手。唯一信息来源是用户 JSON 的汇总数字。
输出严格 JSON：
${JUDGMENT_SHAPE}
规则：
1. 禁止编造 SKU、订单号或发票号。id 只能是 revenue、platformFees、profit、invoices、cost 之一。
2. 数字必须能在 JSON 中找到。不要把店铺粗利说成单品 BOM 毛利。
3. highlights≤5，risks≤5，actions≤5。softNotes 必须写入 caveats。
4. 简体中文，先结论后证据。`;

export async function interpretSurface(
  state: AppState,
  surface: OpsSurface,
): Promise<OpsInterpretResult> {
  if (surface === "finance") return interpretFinance(state);
  return interpretStore(state, surface);
}

async function interpretStore(
  state: AppState,
  surface: "sales" | "replenish",
): Promise<OpsInterpretResult> {
  const readiness = checkStoreReadiness(state);
  const notes = [
    ...readiness.softNotes,
    ...readiness.hardReasons.map(
      (r) => `未满足晨报硬条件，解读仍给出但请核对：${r}`,
    ),
  ];
  const payload = buildStoreDigestPayload(state, {
    ...readiness,
    softNotes: notes,
  });
  if (payload.overview.skuCount === 0) {
    return {
      surface,
      asOf: payload.asOf,
      model: null,
      skippedLlm: true,
      judgment: emptyJudgment("暂无在售商品，无法解读", [
        "Catalog 为空",
        ...notes,
      ]),
    };
  }

  const user = {
    focus: surface,
    shopName: payload.shopName,
    asOf: payload.asOf,
    today: payload.today,
    overview: payload.overview,
    topSales:
      surface === "sales" ? payload.topSales : payload.topSales.slice(0, 5),
    urgentReplenish: payload.urgentReplenish,
    adsWatch: surface === "sales" ? payload.adsWatch : [],
    softNotes: notes,
  };
  const llm = await callOpsJson({
    system: surface === "sales" ? SALES_SYSTEM : REPLENISH_SYSTEM,
    user: ["请根据下列快照生成解读 JSON。", "```json", JSON.stringify(user), "```"].join(
      "\n",
    ),
  });
  return {
    surface,
    asOf: payload.asOf,
    model: llm.model,
    skippedLlm: false,
    judgment: unionCaveats(clampOpsJudgment(llm.parsed), notes),
  };
}

async function interpretFinance(state: AppState): Promise<OpsInterpretResult> {
  const shop = getActiveShop();
  const payload = buildFinanceInterpretPayload(state, shop.name);
  if (!financeHasNumbers(payload)) {
    return {
      surface: "finance",
      asOf: payload.asOf,
      model: null,
      skippedLlm: true,
      judgment: emptyJudgment("暂无财务汇总，无法解读", payload.softNotes),
    };
  }
  const llm = await callOpsJson({
    system: FINANCE_SYSTEM,
    user: [
      "请根据下列财务汇总生成解读 JSON。",
      "```json",
      JSON.stringify(payload),
      "```",
    ].join("\n"),
  });
  return {
    surface: "finance",
    asOf: payload.asOf,
    model: llm.model,
    skippedLlm: false,
    judgment: unionCaveats(clampOpsJudgment(llm.parsed), payload.softNotes),
  };
}
