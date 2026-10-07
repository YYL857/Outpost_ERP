/** LLM 品牌审核：结构化结果（禁止散文当结论） */

export type BrandFameLevel =
  | "global"
  | "mena_known"
  | "niche"
  | "unknown";

export type BrandIntelAction =
  | "avoid_compete"
  | "keep_candidate"
  | "needs_human";

export type BrandEvidenceItem = {
  title: string;
  url: string;
  snippet: string;
  source: "duckduckgo" | "wikipedia" | "bing" | "other";
};

export type BrandIntelLlmJudgment = {
  canonicalName: string | null;
  aliases: string[];
  existsInSaudiOrMena: boolean | null;
  fameLevel: BrandFameLevel;
  isLocallyNotable: boolean;
  action: BrandIntelAction;
  confidence: number;
  reason: string;
  /** 只能引用证据包里出现过的 URL，禁止编造 */
  citedUrls: string[];
};

export type BrandIntelReviewRecord = {
  token: string;
  action: BrandIntelAction;
  fameLevel: BrandFameLevel;
  isLocallyNotable: boolean;
  confidence: number;
  reason: string;
  canonicalName: string | null;
  aliases: string[];
  citedUrls: string[];
  evidenceCount: number;
  model: string | null;
  skippedLlm: boolean;
  skipReason: string | null;
  applied: boolean;
  appliedTo: "autoAvoid" | null;
  reviewedAt: string;
  examples: string[];
};

export type BrandIntelBatchResult = {
  reviewed: BrandIntelReviewRecord[];
  appliedAvoid: string[];
  skipped: string[];
  errors: Array<{ token: string; error: string }>;
  llmCalls: number;
  searchCalls: number;
};
