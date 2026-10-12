import { callListingTextLlm } from "./llm.js";
import { withListingPlaybook } from "./playbook.js";
import type {
  OptimizeCurrentContent,
  OptimizeDiagnosis,
  ListingPerfBundle,
} from "./optimize-types.js";

const FOCUS = [
  "title",
  "bullets",
  "description",
  "images",
  "price",
  "ads",
] as const;

const DIAGNOSE_SYSTEM = `你是 Noon（中东）电商 Listing 绩效诊断助手。
输入：currentListing（现有文案）+ metrics（已清洗：漏斗 funnel、店内基线 baseline、signals、广告/销量窗口）。
只输出 JSON：
{
  "summary": string,
  "ctrIssues": string[],
  "cvrIssues": string[],
  "otherIssues": string[],
  "priorities": string[],
  "suggestedFocus": ("title"|"bullets"|"description"|"images"|"price"|"ads")[]
}
硬规则：
1. 简体中文。必须引用 metrics.funnel.stage / dropOff 与 baseline（相对店中位）；禁止编造未给出的数据。
2. funnel.stage=exposure → 偏向 title/images；click → bullets/price；cart/order → bullets/description/price。
3. 低 CTR 或 below_shop_ctr → title/images；低 ATC/CVR → bullets/description/price。
4. dataGaps 或 thin_sample 时，在 otherIssues 说明「数据不足，结论需谨慎」。
5. priorities 按紧急度最多 5 条；suggestedFocus 最多 4 个去重。`;

function clip(s: string, n: number) {
  const t = String(s || "").trim();
  return t.length <= n ? t : t.slice(0, n);
}

function clipArr(raw: unknown, max: number, len: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => clip(String(x || ""), len))
    .filter(Boolean)
    .slice(0, max);
}

function clampFocus(raw: unknown): OptimizeDiagnosis["suggestedFocus"] {
  if (!Array.isArray(raw)) return [];
  const out: OptimizeDiagnosis["suggestedFocus"] = [];
  for (const x of raw) {
    const s = String(x || "");
    if ((FOCUS as readonly string[]).includes(s) && !out.includes(s as (typeof FOCUS)[number])) {
      out.push(s as (typeof FOCUS)[number]);
    }
    if (out.length >= 4) break;
  }
  return out;
}

export async function runOptimizeDiagnose(input: {
  current: OptimizeCurrentContent;
  metrics: ListingPerfBundle;
  notes: string;
}): Promise<OptimizeDiagnosis> {
  const { model, parsed } = await callListingTextLlm({
    system: withListingPlaybook(DIAGNOSE_SYSTEM, "diagnose"),
    user: JSON.stringify(
      {
        currentListing: {
          title: clip(input.current.title, 200),
          price: clip(input.current.price, 40),
          brand: clip(input.current.brand, 80),
          bullets: clip(input.current.bullets, 2000),
          description: clip(input.current.description, 4000),
        },
        metrics: input.metrics,
        userNotes: clip(input.notes, 800),
      },
      null,
      2,
    ),
    temperature: 0.2,
  });

  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  return {
    summary: clip(String(o.summary || "暂无诊断摘要"), 600),
    ctrIssues: clipArr(o.ctrIssues, 6, 200),
    cvrIssues: clipArr(o.cvrIssues, 6, 200),
    otherIssues: clipArr(o.otherIssues, 6, 200),
    priorities: clipArr(o.priorities, 5, 200),
    suggestedFocus: clampFocus(o.suggestedFocus),
    model,
    builtAt: new Date().toISOString(),
  };
}
