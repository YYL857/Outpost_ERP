/** Listing 优化任务：自有链接 + 后台绩效 → 诊断 → 改写 */

import type { OursNoonContent } from "./types.js";
import { emptyNoonContent } from "./types.js";

export type OptimizeJobStatus =
  | "draft"
  | "metrics_ready"
  | "analyzed"
  | "rewritten";

export type OptimizeCurrentContent = {
  title: string;
  price: string;
  brand: string;
  bullets: string;
  description: string;
};

export type PerfAdsWindow = {
  days: number;
  views: number;
  clicks: number;
  orders: number;
  atc: number;
  spend: number;
  revenue: number;
  /** clicks / views */
  ctr: number | null;
  /** orders / clicks */
  cvr: number | null;
  /** atc / clicks */
  atcRate: number | null;
  /** orders / atc（有加购时） */
  orderFromAtc: number | null;
  roas: number | null;
  acos: number | null;
  hasData: boolean;
  fromDate?: string | null;
  toDate?: string | null;
};

export type PerfSalesWindow = {
  days: number;
  units: number;
  amount: number;
  dailyAvg: number;
};

export type PerfSignal = {
  code: string;
  severity: "info" | "warn" | "danger";
  message: string;
};

export type PerfBaseline = {
  shopCtrP50: number | null;
  shopCvrP50: number | null;
  shopAtcRateP50: number | null;
  /** skuCtr / shopCtrP50；>1 优于中位 */
  skuCtrVsP50: number | null;
  skuCvrVsP50: number | null;
  skuAtcRateVsP50: number | null;
  sampleSkuCount: number;
};

export type PerfFunnel = {
  primaryWindow: "d7" | "d14" | "d30" | "latest";
  stage: "exposure" | "click" | "cart" | "order" | "ok" | "unknown";
  dropOff: string;
};

/** 清洗后的绩效包，专供 LLM（禁止塞原始脏表） */
export type ListingPerfBundle = {
  partnerSku: string;
  noonSku: string;
  catalogTitle: string;
  price: number | null;
  currency: string;
  isActive: boolean | null;
  asOf: string;
  ads: {
    d7: PerfAdsWindow;
    d14: PerfAdsWindow;
    d30: PerfAdsWindow;
    latest: PerfAdsWindow;
  };
  sales: {
    d7: PerfSalesWindow;
    d14: PerfSalesWindow;
    d30: PerfSalesWindow;
  };
  baseline: PerfBaseline;
  funnel: PerfFunnel;
  signals: PerfSignal[];
  dataGaps: string[];
  sourceNote: string;
};

export type OptimizeDiagnosis = {
  summary: string;
  ctrIssues: string[];
  cvrIssues: string[];
  otherIssues: string[];
  priorities: string[];
  suggestedFocus: Array<
    "title" | "bullets" | "description" | "images" | "price" | "ads"
  >;
  model: string;
  builtAt: string;
};

export type OptimizeJob = {
  id: string;
  status: OptimizeJobStatus;
  createdAt: string;
  updatedAt: string;
  listingUrl: string;
  partnerSku: string;
  noonSku: string;
  notes: string;
  current: OptimizeCurrentContent;
  metrics: ListingPerfBundle | null;
  diagnosis: OptimizeDiagnosis | null;
  optimized: OursNoonContent | null;
  lastError: string | null;
};

export function emptyCurrentContent(): OptimizeCurrentContent {
  return {
    title: "",
    price: "",
    brand: "",
    bullets: "",
    description: "",
  };
}

export function createEmptyOptimizeJob(
  partial?: Partial<OptimizeJob>,
): OptimizeJob {
  const now = new Date().toISOString();
  return {
    id: partial?.id || `lo-${Date.now()}`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    listingUrl: "",
    partnerSku: "",
    noonSku: "",
    notes: "",
    current: emptyCurrentContent(),
    metrics: null,
    diagnosis: null,
    optimized: null,
    lastError: null,
    ...partial,
    current: {
      ...emptyCurrentContent(),
      ...(partial?.current ?? {}),
    },
  };
}

export { emptyNoonContent };
