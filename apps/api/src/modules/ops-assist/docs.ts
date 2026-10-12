/**
 * 运营文档助手：贴文案提炼。不推飞书、不写 Listing。
 */
import {
  clampOpsJudgment,
  type OpsJudgment,
} from "./judgment.js";
import { callOpsJson } from "./llm.js";

export type DocsKind = "weekly" | "competitor" | "product";

export type DocsCompetitorResult = {
  title: string;
  brand: string;
  price: string;
  strengths: string[];
  points: string[];
  risks: string[];
};

export type DocsProductFields = {
  titleHints: string[];
  featureBullets: string[];
  specs: string[];
  brandHint: string;
  notes: string[];
};

export type DocsAssistResult = {
  kind: DocsKind;
  asOf: string;
  model: string | null;
  judgment: OpsJudgment | null;
  competitor: DocsCompetitorResult | null;
  productFields: DocsProductFields | null;
};

const MAX_CHARS = 12000;

const WEEKLY_SYSTEM = `你是 Outpost 周报整理助手。唯一信息来源是用户贴上的周报正文。
输出严格 JSON：
{
  "headline": string,
  "highlights": [{"id": string, "name": string, "point": string, "evidence": string}],
  "risks": [{"id": string, "name": string, "point": string, "evidence": string}],
  "actions": [{"id": string, "name": string, "priority": "P0|P1|P2", "action": string, "why": string}],
  "caveats": string[],
  "confidence": "high|medium|low"
}
规则：
1. 只提炼正文里出现的事实，禁止编造 SKU、销量、广告花费或未写出的结论。
2. id 用 w1、w2…；没有对应板块时数组可为空。
3. highlights≤5，risks≤5，actions≤5。soft 信息写入 caveats。
4. 简体中文。这是贴文整理，不是定时晨报。`;

const COMPETITOR_SYSTEM = `你是 Outpost 竞品材料整理助手。唯一信息来源是用户贴上的竞品报告或对手页内容。
输出严格 JSON：
{
  "title": string,
  "brand": string,
  "price": string,
  "strengths": string[],
  "points": string[],
  "risks": string[]
}
规则：
1. 只描述对手，不要写成我方 Listing。
2. strengths / points 各≤8；risks≤6。正文没有的字段留空字符串或空数组。
3. 简体中文要点；不要编造认证、医疗功效或未写出的价格。`;

const PRODUCT_SYSTEM = `你是 Outpost 产品资料整理助手。唯一信息来源是用户贴上的说明书或参数表。
输出严格 JSON：
{
  "titleHints": string[],
  "featureBullets": string[],
  "specs": string[],
  "brandHint": string,
  "notes": string[]
}
规则：
1. 只抽可填进 Listing 的候选字段，不要输出完整上架文案，也不要编造 GTIN。
2. titleHints≤5，featureBullets≤8，specs≤12，notes≤6。
3. 原文没有品牌时 brandHint 为空字符串。
4. 简体中文。结果只供人工确认后填入，不要说已经写入系统。`;

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n);
}

function clipArr(raw: unknown, max: number, len: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => clip(String(x || ""), len))
    .filter(Boolean)
    .slice(0, max);
}

function parseCompetitor(raw: unknown): DocsCompetitorResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    title: clip(String(o.title || ""), 160),
    brand: clip(String(o.brand || ""), 80),
    price: clip(String(o.price || ""), 40),
    strengths: clipArr(o.strengths, 8, 120),
    points: clipArr(o.points, 8, 160),
    risks: clipArr(o.risks, 6, 160),
  };
}

function parseProduct(raw: unknown): DocsProductFields {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    titleHints: clipArr(o.titleHints, 5, 120),
    featureBullets: clipArr(o.featureBullets, 8, 160),
    specs: clipArr(o.specs, 12, 120),
    brandHint: clip(String(o.brandHint || ""), 80),
    notes: clipArr(o.notes, 6, 160),
  };
}

export async function runDocsAssist(input: {
  kind: DocsKind;
  text: string;
}): Promise<DocsAssistResult | { error: string }> {
  const text = input.text.trim();
  if (!text) return { error: "请粘贴文档正文" };
  if (text.length > MAX_CHARS) {
    return { error: `正文过长，请控制在 ${MAX_CHARS} 字以内` };
  }
  if (
    input.kind !== "weekly" &&
    input.kind !== "competitor" &&
    input.kind !== "product"
  ) {
    return { error: "kind 必须是 weekly、competitor 或 product" };
  }

  const asOf = new Date().toISOString();
  const user = [
    "请只根据下列正文提炼，不要使用外部知识。",
    "```text",
    text.slice(0, MAX_CHARS),
    "```",
  ].join("\n");

  if (input.kind === "weekly") {
    const llm = await callOpsJson({ system: WEEKLY_SYSTEM, user });
    return {
      kind: "weekly",
      asOf,
      model: llm.model,
      judgment: clampOpsJudgment(llm.parsed),
      competitor: null,
      productFields: null,
    };
  }

  if (input.kind === "competitor") {
    const llm = await callOpsJson({ system: COMPETITOR_SYSTEM, user });
    return {
      kind: "competitor",
      asOf,
      model: llm.model,
      judgment: null,
      competitor: parseCompetitor(llm.parsed),
      productFields: null,
    };
  }

  const llm = await callOpsJson({ system: PRODUCT_SYSTEM, user });
  return {
    kind: "product",
    asOf,
    model: llm.model,
    judgment: null,
    competitor: null,
    productFields: parseProduct(llm.parsed),
  };
}
