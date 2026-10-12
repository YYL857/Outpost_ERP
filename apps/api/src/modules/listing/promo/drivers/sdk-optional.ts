/**
 * 可选：LISTING_PROMO_DRIVER=sdk 时才走 Cursor 官方 SDK（需登录/密钥）。
 * 默认公司链路不要用这个。
 */
import { runCursorPromoAgent } from "../cursor-driver.js";
import type { PromoDriver, PromoHandoffPayload } from "./types.js";
import { readFileSync, existsSync } from "node:fs";
import { listingPaths } from "../../paths.js";
import { draftImageAbsPaths } from "../cursor-driver.js";
import { loadDraft } from "../../store.js";

export const sdkOptionalDriver: PromoDriver = {
  id: "sdk",
  async dispatch(payload) {
    const prompt = existsSync(payload.promptPathAbs)
      ? readFileSync(payload.promptPathAbs, "utf8")
      : "";
    const draft = loadDraft(payload.draftId);
    const refs = draft
      ? draftImageAbsPaths(
          listingPaths().root,
          draft.ours.images.map((i) => i.relativePath),
        )
      : [];
    const result = await runCursorPromoAgent({
      prompt,
      refImageAbsPaths: refs,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error || "SDK 驱动失败",
        message: result.resultText,
      };
    }
    return { ok: true, message: result.resultText || "sdk ok" };
  },
};

export type { PromoHandoffPayload };
