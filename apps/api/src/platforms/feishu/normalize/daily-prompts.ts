/**
 * 日报简报 — 系统提示词与用户载荷拼装。
 * 目标：格式统一、可读、防幻觉（只依据规则包，禁止编造 SKU/数字）。
 */

import type { DailyBriefFiltered } from "./daily-rules.js";

/** 模型必须遵守的系统提示（编撰稿，勿轻易改语义） */
export const DAILY_BRIEF_SYSTEM_PROMPT = `你是 Outpost 电商运营日报简报助手。你的唯一信息来源是用户消息里的 JSON 规则包（overview / deltaCounts / deltas / watchlist / noiseStats）。

## 硬性约束（违反即失败）
1. 禁止幻觉：不得编造规则包中不存在的 PSKU、产品名、销量、访客、标签、等级、广告结论或库存数字。
2. 引用边界：每条 highlights / risks / actions 中的 partnerSku 必须出现在规则包的 watchlist 或 deltas 列表里；数字必须能在对应条目或 overview / deltaCounts 中找到依据。
3. 原文照抄字段：产品主等级、清货优先级、广告标签、问题标签、在线状态必须与规则包字符串**完全一致**（例如只能写「B 观察/优化款」，禁止改成「S 核心利润款」等包内未出现的等级名）。
4. 等级变化只能引用 deltas.gradeChanges 里该 PSKU 的 from/to；若该 PSKU 不在 gradeChanges 中，禁止描述等级升降。
5. 不确定就降级：信息不足时写入 caveats，不要猜测补货计划、毛利、未给出的 ROAS 或「下周趋势」。
6. 空字段诚实对待：若 noiseStats.emptyRemark 或 emptyReplenishPlan 很大，禁止假装有操作备注或补货计划结论。
7. 禁止对比包外知识：不要引入外部市场新闻、竞品、政策或常识性「应该涨价」类建议，除非规则包已给出对应标签。
8. 语言：简体中文；语气冷静、可执行；面向早上看「相对上一张日报 sheet」趋势的运营同事。
9. 输出：只输出一个 JSON 对象，不要 Markdown 围栏，不要额外解释文字。

## 输出 JSON Schema（字段必须齐全）
{
  "headline": string,          // 1 句总览；数字必须原样来自 overview / deltaCounts（如 skuCount、grade、salesDeltaAbsGeMin），禁止改写阈值含义
  "highlights": [              // 机会/改善，最多 5 条
    {
      "partnerSku": string,
      "productName": string,
      "point": string,         // ≤40 字，说清「什么变好了」
      "evidence": string       // ≤60 字，必须点名规则包中的具体字段或差值，如 dSales=+22、等级 B→A
    }
  ],
  "risks": [                   // 风险/恶化，最多 5 条；结构同 highlights
    {
      "partnerSku": string,
      "productName": string,
      "point": string,
      "evidence": string
    }
  ],
  "actions": [                 // 今日建议跟进，最多 8 条，按 priority 排序
    {
      "partnerSku": string,
      "productName": string,
      "priority": "P0" | "P1" | "P2",
      "action": string,        // ≤30 字，可执行动词开头（检查/暂停/清货/复盘广告…）
      "why": string            // ≤50 字，依据 reasons 或标签，勿空话
    }
  ],
  "caveats": string[],         // 0～5 条数据缺口或解读限制；无则 []
  "confidence": "high" | "medium" | "low"  // 对整份简报把握；缺 previousSheet 或 watchlist 过少时用 low/medium
}

## 选题优先级（从高到低）
P0：清货需处理 + 销量大跌 / 广告亏损或有花费无订单 / 等级明显下挫
P1：上下线异常、库龄老化、高退货风险标签、潜力款（X+/A）伴随风险标签
P2：一般标签变化、小幅销量波动

## 写作风格
- 先结论后证据；避免形容词堆砌（「非常」「巨大」等）。
- 同一 PSKU 不要在 highlights 与 risks 重复出现；若又好又坏，放 risks 或 actions，并在 evidence 写清矛盾点。
- highlights 优先选自 salesUpTop 与等级上调；risks 优先选自 salesDownTop、clear_action、ad_bad。
- 若某类 deltas 为空，对应板块可少于上限，但不要用假数据凑数。`;

export type DailyLlmPayload = {
  meta: {
    currentSheet: string;
    previousSheet: string | null;
    reportDate: string | null;
    builtAt: string;
    sourceRawRunId: string;
  };
  /** 规则包内出现过的等级原文，模型不得使用此列表之外的等级名 */
  allowedGradeLabels: string[];
  overview: DailyBriefFiltered["overview"];
  deltaCounts: DailyBriefFiltered["deltaCounts"];
  noiseStats: DailyBriefFiltered["noiseStats"];
  deltas: {
    gradeChanges: DailyBriefFiltered["deltas"]["gradeChanges"];
    onlineChanges: DailyBriefFiltered["deltas"]["onlineChanges"];
    clearChanges: DailyBriefFiltered["deltas"]["clearChanges"];
    salesUpTop: DailyBriefFiltered["deltas"]["salesUpTop"];
    salesDownTop: DailyBriefFiltered["deltas"]["salesDownTop"];
  };
  watchlist: Array<{
    partnerSku: string;
    productName: string;
    reasons: string[];
    dSales: number | null;
    dVisitors: number | null;
    prevGrade?: string;
    prevOnline?: string;
    prevClear?: string;
    metrics: {
      onlineStatus: string;
      grade: string;
      problemTags: string;
      clearPriority: string;
      ageRisk: string;
      adLossTag: string;
      ad7Tag: string;
      sales30: number | null;
      visitors30: number | null;
      cvr30: number | null;
      returnRate30: number | null;
      fbn: number | null;
    };
  }>;
};

/** 压缩规则包，控制 token，并去掉易诱导编造的冗余列 */
export function buildDailyLlmPayload(
  filtered: DailyBriefFiltered,
  opts?: { watchlistMax?: number },
): DailyLlmPayload {
  const watchMax = opts?.watchlistMax ?? 40;
  const gradeLabels = new Set<string>();
  for (const g of Object.keys(filtered.overview.grades)) {
    if (g && g !== "(空)") gradeLabels.add(g);
  }
  for (const w of filtered.watchlist) {
    if (w.metrics.grade) gradeLabels.add(w.metrics.grade);
    if (w.prevGrade) gradeLabels.add(w.prevGrade);
  }
  for (const g of filtered.deltas.gradeChanges) {
    if (g.from) gradeLabels.add(g.from);
    if (g.to) gradeLabels.add(g.to);
  }

  return {
    meta: {
      currentSheet: filtered.currentSheet,
      previousSheet: filtered.previousSheet,
      reportDate: filtered.reportDate,
      builtAt: filtered.builtAt,
      sourceRawRunId: filtered.sourceRawRunId,
    },
    allowedGradeLabels: [...gradeLabels].sort(),
    overview: filtered.overview,
    deltaCounts: filtered.deltaCounts,
    noiseStats: filtered.noiseStats,
    deltas: {
      gradeChanges: filtered.deltas.gradeChanges.slice(0, 20),
      onlineChanges: filtered.deltas.onlineChanges.slice(0, 20),
      clearChanges: filtered.deltas.clearChanges.slice(0, 20),
      salesUpTop: filtered.deltas.salesUpTop.slice(0, 12),
      salesDownTop: filtered.deltas.salesDownTop.slice(0, 12),
    },
    watchlist: filtered.watchlist.slice(0, watchMax).map((w) => ({
      partnerSku: w.partnerSku,
      productName: w.productName,
      reasons: w.reasons,
      dSales: w.dSales,
      dVisitors: w.dVisitors,
      prevGrade: w.prevGrade,
      prevOnline: w.prevOnline,
      prevClear: w.prevClear,
      metrics: {
        onlineStatus: w.metrics.onlineStatus,
        grade: w.metrics.grade,
        problemTags: w.metrics.problemTags,
        clearPriority: w.metrics.clearPriority,
        ageRisk: w.metrics.ageRisk,
        adLossTag: w.metrics.adLossTag,
        ad7Tag: w.metrics.ad7Tag,
        sales30: w.metrics.sales30,
        visitors30: w.metrics.visitors30,
        cvr30: w.metrics.cvr30,
        returnRate30: w.metrics.returnRate30,
        fbn: w.metrics.fbn,
      },
    })),
  };
}

export function buildDailyBriefUserPrompt(payload: DailyLlmPayload): string {
  return [
    "请根据下列「日报规则包」生成简报 JSON。",
    "再次提醒：",
    "- 只能使用包内出现的 PSKU 与数字；",
    `- 等级名只能使用 allowedGradeLabels：${payload.allowedGradeLabels.join(" | ") || "（无）"}；`,
    "- 不要输出 JSON 以外的任何字符。",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

/** 收集允许引用的 PSKU（用于代码侧钳制幻觉） */
export function collectAllowedPartnerSkus(payload: DailyLlmPayload): Set<string> {
  const set = new Set<string>();
  for (const w of payload.watchlist) set.add(w.partnerSku);
  for (const list of [
    payload.deltas.gradeChanges,
    payload.deltas.onlineChanges,
    payload.deltas.clearChanges,
    payload.deltas.salesUpTop,
    payload.deltas.salesDownTop,
  ]) {
    for (const x of list) set.add(x.partnerSku);
  }
  return set;
}

/** PSKU → 规则包内官方品名（纠正模型改名） */
export function collectOfficialNames(
  payload: DailyLlmPayload,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const w of payload.watchlist) {
    if (w.productName) map.set(w.partnerSku, w.productName);
  }
  for (const list of [
    payload.deltas.gradeChanges,
    payload.deltas.onlineChanges,
    payload.deltas.clearChanges,
    payload.deltas.salesUpTop,
    payload.deltas.salesDownTop,
  ]) {
    for (const x of list) {
      if (x.productName && !map.has(x.partnerSku)) {
        map.set(x.partnerSku, x.productName);
      }
    }
  }
  return map;
}
