import type { PromoJob } from "../types.js";

/** 宣传图出图驱动（与 Cursor 官方 API 解耦） */
export type PromoDriverId = "folder" | "sdk" | "rpa";

export type PromoHandoffPayload = {
  draftId: string;
  jobId: string;
  jobDirAbs: string;
  outDirAbs: string;
  promptPathAbs: string;
  refsDirAbs: string;
  frameCount: number;
  aspectRatio: string;
  kind: "generate" | "revise";
  reviseNote?: string;
};

export type PromoDriver = {
  id: PromoDriverId;
  /** 投递任务：写盘 / 可选调外部（rpa=本机键鼠唤起 Cursor）。 */
  dispatch(payload: PromoHandoffPayload, job: PromoJob): Promise<{
    ok: boolean;
    message?: string;
    error?: string;
  }>;
};

/**
 * 默认 rpa：folder 落盘 + 本机键鼠唤起 Cursor。
 * folder=只投递不唤起；sdk=可选官方接口（不推荐）。
 */
export function resolvePromoDriverId(): PromoDriverId {
  const raw = (process.env.LISTING_PROMO_DRIVER || "rpa").trim().toLowerCase();
  if (raw === "sdk") return "sdk";
  if (raw === "folder") return "folder";
  return "rpa";
}
