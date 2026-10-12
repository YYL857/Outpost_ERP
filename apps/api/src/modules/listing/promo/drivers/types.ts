import type { PromoJob } from "../types.js";

/** 宣传图出图驱动（与 Cursor 官方 API 解耦） */
export type PromoDriverId = "folder" | "sdk";

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
  /** 投递任务：写盘 / 可选调外部。不要求员工登录 Cursor。 */
  dispatch(payload: PromoHandoffPayload, job: PromoJob): Promise<{
    ok: boolean;
    message?: string;
    error?: string;
  }>;
};

export function resolvePromoDriverId(): PromoDriverId {
  const raw = (process.env.LISTING_PROMO_DRIVER || "folder").trim().toLowerCase();
  return raw === "sdk" ? "sdk" : "folder";
}
