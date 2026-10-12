import { callListingTextLlm } from "./llm.js";
import { enforceGtinFromUser, runContentGuardrails } from "./guardrails.js";
import { withListingPlaybook } from "./playbook.js";
import type {
  GuardrailResult,
  OursNoonContent,
} from "./types.js";
import { toPlainLongDescription } from "./plain-text.js";
import { emptyNoonContent } from "./types.js";
import type {
  ListingPerfBundle,
  OptimizeCurrentContent,
  OptimizeDiagnosis,
} from "./optimize-types.js";

const REWRITE_SYSTEM = `你是 Noon Partner「Product Content / Basic Content」优化助手，面向沙特及海湾买家。
在保留事实的前提下，按诊断结果改写我方现有 Listing。只输出 JSON：
{
  "titleEn": string,
  "titleAr": string,
  "fulltype": string,
  "brandEn": string,
  "brandAr": string,
  "longDescriptionEn": string,
  "longDescriptionAr": string,
  "numberOfPieces": string,
  "sizeUnit": string,
  "featureBulletsEn": string[],
  "featureBulletsAr": string[]
}
硬规则：
1. 只写本品；禁止编造认证/GTIN/医疗功效；不要输出 gtin。
2. 标题：有品牌则最前；核心词在前 20 字符；埋入核心/次核心/场景/人群词；颜色末尾「 - Color」；建议 60–130 字符。
3. Feature Bullets 固定 5 条、开头大写、痛点强→弱、每条约 15–40 词并自然埋词；英阿条数一致。
4. Long Description 纯文本一段话≤900 字符、自然埋词；禁止任何 HTML 标签；低 CVR 时强化差异与规格清晰度。
5. 避开中东宗教/文化雷点；无依据不写。
6. brand / numberOfPieces / sizeUnit：用户有则沿用；无品牌勿虚构。
7. fulltype 用英文路径。`;

function clip(s: string, n: number) {
  const t = String(s || "").trim();
  return t.length <= n ? t : t.slice(0, n);
}

function clipBullets(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => clip(String(x || ""), 200))
    .filter(Boolean)
    .slice(0, max);
}

function clampContent(
  parsed: unknown,
  defaults: {
    brandEn: string;
    brandAr: string;
    gtin: string;
  },
): OursNoonContent {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  const bulletsEn = clipBullets(o.featureBulletsEn, 8);
  let bulletsAr = clipBullets(o.featureBulletsAr, 8);
  if (bulletsAr.length > bulletsEn.length) bulletsAr = bulletsAr.slice(0, bulletsEn.length);
  while (bulletsAr.length < bulletsEn.length) bulletsAr.push("");

  const content: OursNoonContent = {
    titleEn: clip(String(o.titleEn || ""), 200),
    titleAr: clip(String(o.titleAr || ""), 200),
    fulltype: clip(String(o.fulltype || ""), 160),
    brandEn: defaults.brandEn || clip(String(o.brandEn || ""), 80),
    brandAr: defaults.brandAr || clip(String(o.brandAr || ""), 80),
    longDescriptionEn: clip(toPlainLongDescription(String(o.longDescriptionEn || "")), 900),
    longDescriptionAr: clip(toPlainLongDescription(String(o.longDescriptionAr || "")), 900),
    numberOfPieces: clip(String(o.numberOfPieces || ""), 20),
    sizeUnit: clip(String(o.sizeUnit || ""), 40),
    featureBulletsEn: bulletsEn,
    featureBulletsAr: bulletsAr,
    gtin: "",
  };
  return enforceGtinFromUser(content, defaults.gtin);
}

export async function runOptimizeRewrite(input: {
  current: OptimizeCurrentContent;
  metrics: ListingPerfBundle;
  diagnosis: OptimizeDiagnosis;
  notes: string;
  brandEn?: string;
  brandAr?: string;
  gtin?: string;
}): Promise<{ content: OursNoonContent; guardrails: GuardrailResult }> {
  const brandEn = clip(input.brandEn || input.current.brand, 80);
  const { parsed } = await callListingTextLlm({
    system: withListingPlaybook(REWRITE_SYSTEM, "rewrite"),
    user: JSON.stringify(
      {
        currentListing: {
          title: clip(input.current.title, 200),
          price: clip(input.current.price, 40),
          brand: brandEn,
          bullets: clip(input.current.bullets, 2000),
          description: clip(input.current.description, 4000),
        },
        diagnosis: {
          summary: input.diagnosis.summary,
          priorities: input.diagnosis.priorities,
          suggestedFocus: input.diagnosis.suggestedFocus,
          ctrIssues: input.diagnosis.ctrIssues,
          cvrIssues: input.diagnosis.cvrIssues,
        },
        metricsBrief: {
          signals: input.metrics.signals,
          funnel: input.metrics.funnel,
          baseline: input.metrics.baseline,
          adsD14: input.metrics.ads.d14,
          salesD14: input.metrics.sales.d14,
          dataGaps: input.metrics.dataGaps,
        },
        userNotes: clip(input.notes, 800),
      },
      null,
      2,
    ),
    temperature: 0.35,
  });

  const content = clampContent(parsed, {
    brandEn,
    brandAr: clip(input.brandAr || "", 80),
    gtin: clip(input.gtin || "", 32),
  });

  // 无现有文案时至少保住标题线索
  if (!content.titleEn && input.current.title) {
    content.titleEn = clip(input.current.title, 200);
  }

  const guardrails = runContentGuardrails(content, { gtinFromUser: input.gtin || "" });
  if (!content.titleEn && !content.titleAr) {
    return {
      content: emptyNoonContent(),
      guardrails: {
        ok: false,
        warnings: guardrails.warnings,
        blockers: [...guardrails.blockers, "改写结果缺少标题"],
      },
    };
  }
  return { content, guardrails };
}
