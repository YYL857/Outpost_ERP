export type PromoJobStatus =
  | "queued"
  | "running"
  /** 已投递 prompt+refs，等待 out/ 出现图片（默认 folder 驱动） */
  | "awaiting_images"
  | "awaiting_manual"
  | "succeeded"
  | "failed"
  | "needs_review"
  | "approved";

export type PromoSkuLock = {
  /** 有货颜色，如 Black */
  colorOnly: string;
  /** 禁止画的颜色 */
  forbidColors: string;
  /** 有货规格，如 4-layer thickened */
  specOnly: string;
  /** 禁止画的规格 */
  forbidSpecs: string;
  /** 尺码/适配 */
  sizeFit: string;
  /** 效果数字文案 */
  effectNumber: string;
};

export type PromoBrief = {
  platform: string;
  language: string;
  frameCount: number;
  aspectRatio: string;
  productName: string;
  sellingPoints: string[];
  skuLock: PromoSkuLock;
  extraNotes: string;
};

export type PromoImage = {
  filename: string;
  relativePath: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  aspectOk?: boolean;
  updatedAt: string;
};

export type PromoFeedback = {
  at: string;
  note: string;
  frameIndexes?: string[];
};

export type PromoJob = {
  id: string;
  status: PromoJobStatus;
  createdAt: string;
  updatedAt: string;
  brief: PromoBrief;
  agentId?: string;
  runId?: string;
  /** folder=投递箱+轮询（默认）；sdk=可选官方接口 */
  driverMode?: "folder" | "sdk" | "manual";
  images: PromoImage[];
  userFeedback: PromoFeedback[];
  error?: string | null;
  /** 绝对输出目录（审计用） */
  outDirAbs?: string;
  /** 公司级 inbox 路径（出图端只盯这里） */
  inboxDirAbs?: string;
};

export type ListingPromoState = {
  brief: PromoBrief;
  activeJobId: string | null;
  jobs: PromoJob[];
};

export function emptyPromoSkuLock(): PromoSkuLock {
  return {
    colorOnly: "",
    forbidColors: "",
    specOnly: "",
    forbidSpecs: "",
    sizeFit: "",
    effectNumber: "",
  };
}

export function emptyPromoBrief(): PromoBrief {
  return {
    platform: "Noon SA",
    language: "English only (no Chinese)",
    frameCount: 9,
    aspectRatio: "9:16",
    productName: "",
    sellingPoints: [],
    skuLock: emptyPromoSkuLock(),
    extraNotes: "",
  };
}

export function emptyListingPromo(): ListingPromoState {
  return {
    brief: emptyPromoBrief(),
    activeJobId: null,
    jobs: [],
  };
}
