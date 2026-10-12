import type { BomQuote } from "./bom.js";
import { callOpsJson } from "./llm.js";

export type BomExplanation = {
  summary: string;
  priceNote: string;
  caveats: string[];
  model: string;
};

const SYSTEM = `你是 Outpost 定价说明助手。唯一数字来源是用户 JSON 的 breakdown。
输出严格 JSON：{ "summary": string, "priceNote": string, "caveats": string[] }
规则：
1. summary 用一句话复述 profitSar 和 marginPct，数字必须与 breakdown 完全一致，禁止重算。
2. priceNote 只谈这个毛利对定价的含义，不要给出另一套毛利或新售价公式。
3. profitComplete 为 false 时，caveats 必须写明缺采购成本、结果是估算。
4. usedDefaults 每一项都要出现在 caveats。
5. 简体中文。不要把结果说成店铺总利润。`;

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n);
}

export async function explainBomQuote(quote: BomQuote): Promise<BomExplanation> {
  const llm = await callOpsJson({
    system: SYSTEM,
    user: [
      "请只根据下列已算好的分项写说明，不要改数字。",
      "```json",
      JSON.stringify({
        profile: quote.profile,
        usedDefaults: quote.usedDefaults,
        materials: quote.materials,
        breakdown: quote.breakdown,
      }),
      "```",
    ].join("\n"),
  });
  const o = (llm.parsed && typeof llm.parsed === "object" ? llm.parsed : {}) as Record<
    string,
    unknown
  >;
  const fromModel = Array.isArray(o.caveats)
    ? o.caveats.map((c) => clip(String(c || ""), 200)).filter(Boolean)
    : [];
  const caveats = [...fromModel];
  if (!quote.breakdown.profitComplete) {
    const mark = "缺采购成本，毛利为估算";
    if (!caveats.some((c) => c.includes("估算"))) caveats.unshift(mark);
  }
  for (const note of quote.usedDefaults) {
    const key = note.slice(0, 8);
    if (!caveats.some((c) => c.includes(key))) caveats.push(note);
  }
  return {
    summary: clip(String(o.summary || ""), 240) || "说明未生成",
    priceNote: clip(String(o.priceNote || ""), 240),
    caveats: caveats.slice(0, 8),
    model: llm.model,
  };
}
