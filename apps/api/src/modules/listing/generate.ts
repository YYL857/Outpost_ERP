import { callListingTextLlm } from "./llm.js";
import {
  enforceGtinFromUser,
  runContentGuardrails,
} from "./guardrails.js";
import { withListingPlaybook } from "./playbook.js";
import type {
  AnalysisEdge,
  GuardrailResult,
  ListingAnalysis,
  OursNoonContent,
  OursVisionNotes,
} from "./types.js";
import { toPlainLongDescription } from "./plain-text.js";
import { emptyNoonContent } from "./types.js";

const GENERATE_SYSTEM = `你是 Noon Partner「Product Content / Basic Content」撰稿助手，面向沙特及海湾买家。
只输出我方 Listing JSON（禁止输出对手文案）：
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
  "featureBulletsAr": string[],
  "brandSuggestion": { "en": string, "ar": string } | null
}
硬规则：
1. 只写本品。若有对手参考仅作差异对照；禁止抄袭对手品牌名、禁止把对手独有卖点写成我方卖点。无对手时完全依据本品视觉要点与用户备注撰写。
2. 禁止编造 GTIN；不要输出 gtin 字段。
3. 标题：有品牌则品牌最前；核心词落在前 20 字符；埋入核心/次核心/场景/人群词；颜色末尾「 - Color」；建议 60–130 字符。
4. Feature Bullets 固定 5 条、开头大写、痛点从强到弱、每条约 15–40 词并自然埋词；英阿条数一致。
5. Long Description 为纯文本一段话，≤900 字符，自然埋词；禁止输出任何 HTML 标签（含 <p>/<br>/<b>/<ul> 等）。
6. 避开中东宗教/文化雷点与医疗夸大；无依据的认证不要写。
7. brandEn/brandAr：用户已提供则沿用；无品牌则空字符串且标题不要虚构品牌；否则可给 brandSuggestion 供人确认。
8. numberOfPieces / sizeUnit：用户有则用，无则空字符串。
9. fulltype 用英文路径，如 "Electronic Accessories > Wearables > Fitness Trackers"。
10. 标题/卖点/长描述必须能追溯到视觉要点或用户备注中的可见事实；图片看不清的规格不要瞎编。`;

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
    numberOfPieces: string;
    sizeUnit: string;
    fulltypeHint: string;
  },
): {
  content: OursNoonContent;
  brandSuggestion: { en: string; ar: string } | null;
} {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  const brandEn = defaults.brandEn || clip(String(o.brandEn || ""), 80);
  const brandAr = defaults.brandAr || clip(String(o.brandAr || ""), 80);
  let brandSuggestion: { en: string; ar: string } | null = null;
  if (o.brandSuggestion && typeof o.brandSuggestion === "object") {
    const b = o.brandSuggestion as Record<string, unknown>;
    const en = clip(String(b.en || ""), 80);
    const ar = clip(String(b.ar || ""), 80);
    if (en || ar) brandSuggestion = { en, ar };
  }
  if (!defaults.brandEn && brandSuggestion?.en && !brandEn) {
    // 建议可填进内容供人审，但仍保留 suggestion
  }

  const bulletsEn = clipBullets(o.featureBulletsEn, 8);
  let bulletsAr = clipBullets(o.featureBulletsAr, 8);
  if (bulletsAr.length !== bulletsEn.length) {
    // 对齐长度：多截少补空（人审可见）
    if (bulletsAr.length > bulletsEn.length) bulletsAr = bulletsAr.slice(0, bulletsEn.length);
    while (bulletsAr.length < bulletsEn.length) bulletsAr.push("");
  }

  const content: OursNoonContent = {
    titleEn: clip(String(o.titleEn || ""), 200),
    titleAr: clip(String(o.titleAr || ""), 200),
    fulltype: clip(String(o.fulltype || defaults.fulltypeHint || ""), 160),
    brandEn: brandEn || brandSuggestion?.en || "",
    brandAr: brandAr || brandSuggestion?.ar || "",
    longDescriptionEn: clip(toPlainLongDescription(String(o.longDescriptionEn || "")), 900),
    longDescriptionAr: clip(toPlainLongDescription(String(o.longDescriptionAr || "")), 900),
    numberOfPieces: defaults.numberOfPieces || clip(String(o.numberOfPieces || ""), 20),
    sizeUnit: defaults.sizeUnit || clip(String(o.sizeUnit || ""), 40),
    featureBulletsEn: bulletsEn,
    featureBulletsAr: bulletsAr,
    gtin: "",
  };
  return {
    content: enforceGtinFromUser(content, defaults.gtin),
    brandSuggestion: defaults.brandEn ? null : brandSuggestion,
  };
}

export async function runOursListingGenerate(input: {
  visionNotes: OursVisionNotes | null;
  /** 无对手对标时可为 null；此时仅凭视觉要点 + 备注生成 */
  analysis: ListingAnalysis | null;
  selectedEdges: AnalysisEdge[];
  notes: string;
  ourPrice: string;
  brandEn: string;
  brandAr: string;
  gtin: string;
  numberOfPieces: string;
  sizeUnit: string;
  fulltypeHint: string;
  /** 对手卖点摘要：仅作「禁止抄袭 / 差异参考」，不进入输出 schema */
  competitorReference: Array<{
    id: string;
    title: string;
    strengths: string[];
    points: string[];
  }>;
  /** ours_only：无对手；from_edges：按勾选优势（可同时参考对手） */
  mode?: "ours_only" | "from_edges";
}): Promise<{
  content: OursNoonContent;
  brandSuggestion: { en: string; ar: string } | null;
  guardrails: GuardrailResult;
  model: string;
}> {
  const mode =
    input.mode ||
    (input.selectedEdges.length > 0 && input.analysis ? "from_edges" : "ours_only");

  const payload = {
    mode,
    ours: {
      visionNotes: input.visionNotes,
      notes: input.notes,
      ourPrice: input.ourPrice,
      brandEn: input.brandEn,
      brandAr: input.brandAr,
      numberOfPieces: input.numberOfPieces,
      sizeUnit: input.sizeUnit,
      fulltypeHint: input.fulltypeHint,
      selectedEdges: input.selectedEdges.map((e) => ({
        id: e.id,
        angle: e.angle,
        claim: e.claim,
        evidence: e.evidence,
      })),
      analysisRisks: input.analysis?.risks ?? [],
    },
    competitorReferenceOnlyDoNotCopy: input.competitorReference,
  };

  const userLines =
    mode === "ours_only"
      ? [
          "模式=凭本品图生成（无对手也对）。",
          "仅根据 ours.visionNotes 与用户备注，写出 Noon Basic Content（标题/5卖点/长描述 英阿）。",
          "不要编造图片上看不见的规格、认证或功效；数量/尺码优先用用户字段。",
          "```json",
          JSON.stringify(payload),
          "```",
        ]
      : [
          "模式=按勾选优势生成。",
          "根据 ours.selectedEdges 与视觉要点生成 Noon Basic Content。",
          "competitorReferenceOnlyDoNotCopy 仅供避开抄袭与突出差异，禁止写入对手品牌/原文卖点。",
          "```json",
          JSON.stringify(payload),
          "```",
        ];

  const { model, parsed } = await callListingTextLlm({
    system: withListingPlaybook(GENERATE_SYSTEM, "create"),
    user: userLines.join("\n"),
    temperature: 0.35,
  });

  const { content, brandSuggestion } = clampContent(parsed, {
    brandEn: input.brandEn,
    brandAr: input.brandAr,
    gtin: input.gtin,
    numberOfPieces: input.numberOfPieces,
    sizeUnit: input.sizeUnit,
    fulltypeHint: input.fulltypeHint,
  });

  // 若内容仍空，给最小占位便于人审
  const finalContent =
    content.titleEn || content.featureBulletsEn.length
      ? content
      : { ...emptyNoonContent(), gtin: input.gtin, brandEn: input.brandEn, brandAr: input.brandAr };

  const guardrails = runContentGuardrails(finalContent, {
    gtinFromUser: input.gtin,
  });

  return { content: finalContent, brandSuggestion, guardrails, model };
}
