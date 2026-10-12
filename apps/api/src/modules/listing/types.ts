/** AI Listing 草稿：competitors / ours / analysis 三区隔离 */

import type { ListingPromoState } from "./promo/types.js";
export type { ListingPromoState, PromoBrief, PromoJob, PromoSkuLock } from "./promo/types.js";
import { emptyListingPromo } from "./promo/types.js";

export type ListingDraftStatus =
  | "draft"
  | "vision_done"
  | "analyzed"
  | "generated"
  | "ready_review"
  | "approved"
  | "rejected";

export type CompetitorInput = {
  id: string;
  url: string;
  pastedTitle: string;
  pastedPrice: string;
  pastedBullets: string;
  pastedDescription: string;
};

/** 对手侧结构化（仅描述对手，禁止写入我方 Listing） */
export type CompetitorNormalized = {
  title: string;
  price: string;
  brand: string;
  bullets: string[];
  descriptionSummary: string;
  strengths: string[];
};

export type DraftImage = {
  id: string;
  filename: string;
  mimeType: string;
  /** 相对 listing-drafts 根的路径 */
  relativePath: string;
  sizeBytes: number;
  createdAt: string;
};

export type OursVisionNotes = {
  appearance: string[];
  features: string[];
  packaging: string[];
  visibleText: string[];
  caveats: string[];
  model: string;
  builtAt: string;
};

/** 我方最终 Noon Basic Content（仅 ours） */
export type OursNoonContent = {
  titleEn: string;
  titleAr: string;
  fulltype: string;
  brandEn: string;
  brandAr: string;
  longDescriptionEn: string;
  longDescriptionAr: string;
  numberOfPieces: string;
  sizeUnit: string;
  featureBulletsEn: string[];
  featureBulletsAr: string[];
  gtin: string;
};

export type AttackAngle =
  | "appearance"
  | "function"
  | "price"
  | "packaging"
  | "battery"
  | "other";

export type AnalysisEdge = {
  id: string;
  angle: AttackAngle;
  claim: string;
  evidence: string;
  /** ours | competitor_gap | user_note */
  source: "ours" | "competitor_gap" | "user_note";
  selected: boolean;
};

export type ListingAnalysis = {
  competitorPoints: Array<{
    competitorId: string;
    points: string[];
    strengths: string[];
  }>;
  ourEdges: AnalysisEdge[];
  attackAngles: Array<{
    angle: AttackAngle;
    summary: string;
    edgeIds: string[];
  }>;
  risks: string[];
  model: string;
  builtAt: string;
};

export type GuardrailResult = {
  ok: boolean;
  warnings: string[];
  blockers: string[];
};

export type ListingDraft = {
  id: string;
  status: ListingDraftStatus;
  createdAt: string;
  updatedAt: string;
  /** 用户备注：真实卖点、目标价等 */
  notes: string;
  ourPrice: string;
  brandEn: string;
  brandAr: string;
  gtin: string;
  numberOfPieces: string;
  sizeUnit: string;
  fulltypeHint: string;
  competitors: CompetitorInput[];
  /** 对手归一化结果，按 competitor.id 索引 */
  competitorNormalized: Record<string, CompetitorNormalized>;
  ours: {
    images: DraftImage[];
    visionNotes: OursVisionNotes | null;
    brandSuggestion: { en: string; ar: string } | null;
    content: OursNoonContent | null;
  };
  analysis: ListingAnalysis | null;
  guardrails: GuardrailResult | null;
  reviewNote: string;
  lastError: string | null;
  /** Cursor 宣传图子流程 */
  promo: ListingPromoState;
};

export function emptyNoonContent(): OursNoonContent {
  return {
    titleEn: "",
    titleAr: "",
    fulltype: "",
    brandEn: "",
    brandAr: "",
    longDescriptionEn: "",
    longDescriptionAr: "",
    numberOfPieces: "",
    sizeUnit: "",
    featureBulletsEn: [],
    featureBulletsAr: [],
    gtin: "",
  };
}

export function createEmptyDraft(partial?: Partial<ListingDraft>): ListingDraft {
  const now = new Date().toISOString();
  return {
    id: partial?.id || `ld-${Date.now()}`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    notes: "",
    ourPrice: "",
    brandEn: "",
    brandAr: "",
    gtin: "",
    numberOfPieces: "",
    sizeUnit: "",
    fulltypeHint: "",
    competitors: [],
    competitorNormalized: {},
    ours: {
      images: [],
      visionNotes: null,
      brandSuggestion: null,
      content: null,
    },
    analysis: null,
    guardrails: null,
    reviewNote: "",
    lastError: null,
    promo: emptyListingPromo(),
    ...partial,
  };
}
