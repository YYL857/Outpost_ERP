/**
 * 货代看板 LLM：基于已清洗汇总做划算解读。
 */
import { callOpsJson } from "../ops-assist/llm.js";
import type { ForwarderBoardPayload } from "../../platforms/feishu/normalize/forwarder-board.js";

export type ForwarderLlmJudgment = {
  headline: string;
  topPick: string | null;
  rankingNotes: Array<{ forwarder: string; note: string }>;
  caveats: string[];
  confidence: "high" | "medium" | "low";
};

const SYSTEM = `你是跨境电商物流分析助手。用户会提供装箱实付汇总、货代大纲报价（若有）与确定性排名。
规则：
1. 只根据给定数字评论，禁止编造未出现的货代、费用、天数。
2. 性价比要分空运(RMB/kg)与海运(RMB/方)；样本少的货代要降置信度。
3. 整票跨境实付已按票去重；实收跨境费是箱级分摊——不要把两者再加总成「总运费」。
4. 大纲报价是挂价（区间取中值），装箱是实付；两者不一致时要指出。
5. 禁止建议或假设「改写飞书表/回写报价/删除记录」；系统对货代大纲与装箱表只读。
6. 输出严格 JSON：
{
  "headline": "一句话结论",
  "topPick": "最划算货代名或 null",
  "rankingNotes": [{"forwarder":"名","note":"一句理由"}],
  "caveats": ["数据缺口/口径提醒"],
  "confidence": "high|medium|low"
}`;

function clip(s: string, n: number) {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

export function buildForwarderLlmUserPayload(board: ForwarderBoardPayload) {
  return {
    source: board.source,
    freightRates: board.freightRates,
    ranking: board.ranking.slice(0, 12),
    quotes: board.quotes.slice(0, 16),
    forwarders: board.forwarders.slice(0, 12).map((f) => ({
      forwarder: f.forwarder,
      boxes: f.boxes,
      tickets: f.tickets,
      pcs: f.pcs,
      weightKg: f.weightKg,
      cbm: f.cbm,
      boxFreightSum: f.boxFreightSum,
      ticketFreightSum: f.ticketFreightSum,
      rmbPerKg: f.rmbPerKg,
      rmbPerCbm: f.rmbPerCbm,
      avgTransitDays: f.avgTransitDays,
      withTransit: f.withTransit,
      inTransitBoxes: f.inTransitBoxes,
      deliveredBoxes: f.deliveredBoxes,
      airBoxes: f.byMode.air.boxes,
      seaBoxes: f.byMode.sea.boxes,
      airBoxFreight: f.byMode.air.boxFreight,
      seaBoxFreight: f.byMode.sea.boxFreight,
      airWeightKg: f.byMode.air.weightKg,
      seaCbm: f.byMode.sea.cbm,
    })),
    note: board.freightRates.snapshotPath
      ? "已含货代大纲普货报价（区间取中值）与装箱实付。"
      : "货代大纲尚未同步；当前仅装箱实付历史。",
  };
}

export function clampForwarderJudgment(
  raw: unknown,
  allowed: Set<string>,
): ForwarderLlmJudgment {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const conf = String(o.confidence || "").toLowerCase();
  const confidence =
    conf === "high" || conf === "medium" || conf === "low"
      ? (conf as "high" | "medium" | "low")
      : "medium";

  let topPick: string | null =
    typeof o.topPick === "string" && o.topPick.trim() ? o.topPick.trim() : null;
  if (topPick && !allowed.has(topPick)) topPick = null;

  const rankingNotes: ForwarderLlmJudgment["rankingNotes"] = [];
  if (Array.isArray(o.rankingNotes)) {
    for (const item of o.rankingNotes) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const forwarder = String(r.forwarder || "").trim();
      if (!forwarder || !allowed.has(forwarder)) continue;
      rankingNotes.push({
        forwarder,
        note: clip(String(r.note || ""), 120),
      });
      if (rankingNotes.length >= 12) break;
    }
  }

  const caveats: string[] = [];
  if (Array.isArray(o.caveats)) {
    for (const c of o.caveats) {
      const s = clip(String(c || ""), 160);
      if (s) caveats.push(s);
      if (caveats.length >= 8) break;
    }
  }

  return {
    headline: clip(String(o.headline || "货代性价比已按装箱实付汇总"), 160),
    topPick,
    rankingNotes,
    caveats,
    confidence,
  };
}

export async function summarizeForwarderBoardWithLlm(
  board: ForwarderBoardPayload,
): Promise<{ model: string; judgment: ForwarderLlmJudgment }> {
  const allowed = new Set([
    ...board.forwarders.map((f) => f.forwarder),
    ...board.quotes.map((q) => q.forwarder),
    ...board.ranking.map((r) => r.forwarder),
  ]);
  const user = JSON.stringify(buildForwarderLlmUserPayload(board), null, 2);
  const llm = await callOpsJson({ system: SYSTEM, user });
  return {
    model: llm.model,
    judgment: clampForwarderJudgment(llm.parsed, allowed),
  };
}
