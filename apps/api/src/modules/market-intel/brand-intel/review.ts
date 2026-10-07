/**
 * 品牌审核编排（额度只用在刀刃上）：
 * 先查表（shared + 品类索引）→ 未知才搜证 → 有证据才 LLM → 写回「该品类」autoAvoid
 */
import {
  applyCategoryAutoAvoid,
  avoidKeywordsForCategory,
  confirmedKeywordsForCategory,
  ensureCategoryBucket,
  loadBrandRegistry,
  lookupBrandInRegistry,
  normBrand,
  saveBrandRegistry,
  type BrandRegistryFile,
  type BrandTier,
} from "../white-label.js";
import { deepseekConfig, judgeBrandWithDeepseek } from "./deepseek.js";
import { gatherBrandEvidence } from "./search.js";
import type {
  BrandIntelBatchResult,
  BrandIntelReviewRecord,
} from "./types.js";

const GENERIC_TOKENS = new Set([
  "the", "new", "for", "with", "and", "pro", "max", "mini", "pack", "set",
  "one", "two", "life", "peak", "smart", "usb", "wireless", "original",
  "official", "saudi", "arabia", "store", "shop", "seller", "noon", "partner",
  "generic", "brand", "home", "kit", "box", "case", "cover",
  "best", "mega", "faster", "super", "ultra", "plus", "lite", "premium",
  "by", "from", "all", "products", "this",
]);

const REVIEW_TTL_MS = Number(process.env.BRAND_INTEL_CACHE_DAYS || 30) * 86_400_000;

function nowIso() {
  return new Date().toISOString();
}

function minConfidence() {
  const n = Number(process.env.BRAND_INTEL_MIN_CONFIDENCE || 0.75);
  return Number.isFinite(n) ? n : 0.75;
}

function autoApplyEnabled(override?: boolean) {
  if (override != null) return override;
  const v = (process.env.BRAND_INTEL_AUTO_APPLY || "true").toLowerCase();
  return !["0", "false", "no", "off"].includes(v);
}

function recentReviewInBucket(
  reg: BrandRegistryFile,
  categoryId: string,
  token: string,
): BrandIntelReviewRecord | null {
  const b = ensureCategoryBucket(reg, categoryId);
  const t = normBrand(token);
  const rows = (b.aiReviews || []).filter(
    (r) => normBrand(String((r as { token?: unknown }).token || "")) === t,
  ) as BrandIntelReviewRecord[];
  // 也看迁移桶
  const mig = (reg.categories?._migrated?.aiReviews || []).filter(
    (r) => normBrand(String((r as { token?: unknown }).token || "")) === t,
  ) as BrandIntelReviewRecord[];
  const all = [...rows, ...mig];
  if (!all.length) return null;
  all.sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)));
  const latest = all[0]!;
  const ts = Date.parse(String(latest.reviewedAt || ""));
  if (!Number.isFinite(ts) || Date.now() - ts > REVIEW_TTL_MS) return null;
  return latest;
}

function upsertAiReview(
  reg: BrandRegistryFile,
  categoryId: string,
  rec: BrandIntelReviewRecord,
) {
  const b = ensureCategoryBucket(reg, categoryId);
  b.aiReviews = (b.aiReviews || []).filter(
    (r) => normBrand(String((r as { token?: unknown }).token || "")) !== normBrand(rec.token),
  );
  b.aiReviews.unshift(rec as unknown as Record<string, unknown>);
  b.aiReviews = b.aiReviews.slice(0, 300);
}

function notePendingInCategory(
  reg: BrandRegistryFile,
  categoryId: string,
  token: string,
  examples: string[],
) {
  const b = ensureCategoryBucket(reg, categoryId);
  const t = normBrand(token);
  if (
    avoidKeywordsForCategory(reg, categoryId).includes(t) ||
    confirmedKeywordsForCategory(reg, categoryId).includes(t)
  ) {
    return;
  }
  const row = b.pendingReview.find((p) => normBrand(p.token) === t);
  const ex = examples[0] || "";
  if (row) {
    row.hits += 1;
    row.lastSeenAt = nowIso();
    if (ex && !row.examples.includes(ex)) {
      row.examples = [...row.examples.slice(-4), ex];
    }
  } else {
    b.pendingReview.push({
      token: t,
      hits: 1,
      lastSeenAt: nowIso(),
      examples: ex ? [ex] : [],
    });
  }
}

export function brandIntelStatus() {
  const cfg = deepseekConfig();
  const reg = loadBrandRegistry();
  const catIds = Object.keys(reg.categories || {}).filter((k) => k !== "_migrated");
  let pendingCount = 0;
  let autoAvoidCount = (reg.shared?.avoidCompete?.autoAvoid || []).length;
  const recent: unknown[] = [];
  for (const cid of catIds) {
    const b = ensureCategoryBucket(reg, cid);
    pendingCount += b.pendingReview.length;
    autoAvoidCount += (b.avoidCompete.autoAvoid || []).length;
    for (const r of (b.aiReviews || []).slice(0, 5)) {
      recent.push({ categoryId: cid, ...r });
    }
  }
  const mig = reg.categories?._migrated;
  if (mig) pendingCount += mig.pendingReview.length;

  return {
    configured: Boolean(cfg.apiKey),
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    autoApply: autoApplyEnabled(),
    minConfidence: minConfidence(),
    cacheDays: Number(process.env.BRAND_INTEL_CACHE_DAYS || 30),
    pendingCount,
    autoAvoidCount,
    categoryIds: catIds,
    recentReviews: recent.slice(0, 15),
  };
}

/**
 * 影刀主路径：先查表，未知才审。
 * 返回每个 token 的最终 tier，供深采过滤。
 */
export async function resolveBrandsForCategory(opts: {
  categoryId: string;
  items: Array<{ token: string; example?: string }>;
  force?: boolean;
  dryRun?: boolean;
  autoApply?: boolean;
  /** 本轮最多对新牌调几次 LLM（控额度） */
  maxLlm?: number;
}): Promise<{
  categoryId: string;
  resolutions: Array<{
    token: string;
    tier: BrandTier;
    source: "shared" | "category" | "llm" | "pending" | "generic" | "cache";
    review?: BrandIntelReviewRecord;
  }>;
  llmCalls: number;
  searchCalls: number;
  appliedAvoid: string[];
  tableHits: number;
}> {
  const categoryId = opts.categoryId || "_uncategorized";
  const maxLlm = Math.max(0, Math.min(opts.maxLlm ?? 8, 20));
  const force = Boolean(opts.force);
  const dryRun = Boolean(opts.dryRun);
  const doApply = autoApplyEnabled(opts.autoApply);
  const confFloor = minConfidence();

  let reg = loadBrandRegistry();
  ensureCategoryBucket(reg, categoryId);

  const resolutions: Array<{
    token: string;
    tier: BrandTier;
    source: "shared" | "category" | "llm" | "pending" | "generic" | "cache";
    review?: BrandIntelReviewRecord;
  }> = [];
  let llmCalls = 0;
  let searchCalls = 0;
  let tableHits = 0;
  const appliedAvoid: string[] = [];

  const seen = new Set<string>();
  const queue: Array<{ token: string; example: string }> = [];
  for (const it of opts.items) {
    const token = normBrand(it.token);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    queue.push({ token, example: String(it.example || "").slice(0, 160) });
  }

  for (const { token, example } of queue) {
    if (GENERIC_TOKENS.has(token)) {
      resolutions.push({ token, tier: "white_candidate", source: "generic" });
      continue;
    }

    const hit = lookupBrandInRegistry(token, categoryId, reg);
    if (hit.layer !== "none" && hit.tier !== "white_candidate") {
      tableHits += 1;
      resolutions.push({
        token,
        tier: hit.tier,
        source: hit.layer,
      });
      continue;
    }

    // 表中没有 → 才考虑 LLM
    if (!force) {
      const cached = recentReviewInBucket(reg, categoryId, token);
      if (cached) {
        const tier: BrandTier =
          cached.action === "avoid_compete" && cached.applied
            ? "avoid_compete"
            : "white_candidate";
        resolutions.push({
          token,
          tier,
          source: "cache",
          review: cached,
        });
        continue;
      }
    }

    if (llmCalls >= maxLlm) {
      if (!dryRun) notePendingInCategory(reg, categoryId, token, [example]);
      resolutions.push({ token, tier: "white_candidate", source: "pending" });
      continue;
    }

    if (!deepseekConfig().apiKey) {
      if (!dryRun) notePendingInCategory(reg, categoryId, token, [example]);
      resolutions.push({ token, tier: "white_candidate", source: "pending" });
      continue;
    }

    searchCalls += 1;
    const { evidence } = await gatherBrandEvidence(token);
    if (!evidence.length) {
      const rec: BrandIntelReviewRecord = {
        token,
        action: "needs_human",
        fameLevel: "unknown",
        isLocallyNotable: false,
        confidence: 0,
        reason: "代码预滤：联网无可用证据，不调用模型（防编造）",
        canonicalName: null,
        aliases: [],
        citedUrls: [],
        evidenceCount: 0,
        model: null,
        skippedLlm: true,
        skipReason: "no_web_evidence",
        applied: false,
        appliedTo: null,
        reviewedAt: nowIso(),
        examples: example ? [example] : [],
      };
      if (!dryRun) {
        notePendingInCategory(reg, categoryId, token, [example]);
        upsertAiReview(reg, categoryId, rec);
        reg = saveBrandRegistry(reg);
      }
      resolutions.push({
        token,
        tier: "white_candidate",
        source: "pending",
        review: rec,
      });
      continue;
    }

    llmCalls += 1;
    try {
      const { judgment, model } = await judgeBrandWithDeepseek({
        token,
        examples: example ? [example] : [],
        evidence,
      });

      let applied = false;
      let tier: BrandTier = "white_candidate";
      if (
        !dryRun &&
        doApply &&
        judgment.action === "avoid_compete" &&
        judgment.confidence >= confFloor &&
        judgment.citedUrls.length > 0
      ) {
        const toAdd = [token, ...judgment.aliases];
        applyCategoryAutoAvoid(categoryId, toAdd);
        reg = loadBrandRegistry();
        applied = true;
        appliedAvoid.push(...toAdd.map(normBrand));
        tier = "avoid_compete";
      } else if (!dryRun) {
        notePendingInCategory(reg, categoryId, token, [example]);
      }

      const rec: BrandIntelReviewRecord = {
        token,
        action: judgment.action,
        fameLevel: judgment.fameLevel,
        isLocallyNotable: judgment.isLocallyNotable,
        confidence: judgment.confidence,
        reason: judgment.reason,
        canonicalName: judgment.canonicalName,
        aliases: judgment.aliases,
        citedUrls: judgment.citedUrls,
        evidenceCount: evidence.length,
        model,
        skippedLlm: false,
        skipReason: null,
        applied,
        appliedTo: applied ? "autoAvoid" : null,
        reviewedAt: nowIso(),
        examples: example ? [example] : [],
      };
      if (!dryRun) {
        upsertAiReview(reg, categoryId, rec);
        reg = saveBrandRegistry(reg);
      }
      resolutions.push({
        token,
        tier,
        source: applied ? "llm" : "pending",
        review: rec,
      });
    } catch (e) {
      if (!dryRun) {
        notePendingInCategory(reg, categoryId, token, [example]);
        reg = saveBrandRegistry(reg);
      }
      resolutions.push({ token, tier: "white_candidate", source: "pending" });
      void e;
    }
  }

  if (!dryRun) reg = saveBrandRegistry(reg);

  return {
    categoryId,
    resolutions,
    llmCalls,
    searchCalls,
    appliedAvoid: [...new Set(appliedAvoid)],
    tableHits,
  };
}

/** UI 批量审 pending（按品类） */
export async function reviewPendingBrands(opts: {
  tokens?: string[];
  categoryId?: string;
  limit?: number;
  force?: boolean;
  dryRun?: boolean;
  autoApply?: boolean;
} = {}): Promise<BrandIntelBatchResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 30));
  const reg = loadBrandRegistry();
  const categoryId = opts.categoryId || pickBusiestCategory(reg);

  const bucket = ensureCategoryBucket(reg, categoryId);
  const want = (opts?.tokens || []).map(normBrand).filter(Boolean);
  const fromPending = bucket.pendingReview.slice(0, limit).map((p) => p.token);
  const mig = reg.categories?._migrated?.pendingReview || [];
  const tokens = (want.length ? want : [...fromPending, ...mig.map((p) => p.token)])
    .map(normBrand)
    .filter(Boolean)
    .slice(0, limit);

  const items = tokens.map((token) => {
    const row =
      bucket.pendingReview.find((p) => normBrand(p.token) === token) ||
      mig.find((p) => normBrand(p.token) === token);
    return { token, example: row?.examples?.[0] };
  });

  const resolved = await resolveBrandsForCategory({
    categoryId,
    items,
    force: opts?.force,
    dryRun: opts?.dryRun,
    autoApply: opts?.autoApply,
    maxLlm: limit,
  });

  return {
    reviewed: resolved.resolutions
      .map((r) => r.review)
      .filter(Boolean) as BrandIntelReviewRecord[],
    appliedAvoid: resolved.appliedAvoid,
    skipped: resolved.resolutions
      .filter((r) => r.source === "shared" || r.source === "category" || r.source === "cache")
      .map((r) => r.token),
    errors: [],
    llmCalls: resolved.llmCalls,
    searchCalls: resolved.searchCalls,
  };
}

function pickBusiestCategory(reg: BrandRegistryFile): string {
  let best = "_uncategorized";
  let n = -1;
  for (const [cid, b] of Object.entries(reg.categories || {})) {
    if (cid === "_migrated") continue;
    const c = b.pendingReview?.length || 0;
    if (c > n) {
      n = c;
      best = cid;
    }
  }
  if (n <= 0 && reg.categories?._migrated?.pendingReview?.length) {
    return "_migrated";
  }
  return best;
}
