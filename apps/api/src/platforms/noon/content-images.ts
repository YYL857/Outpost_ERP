/**
 * Content API：按 sku_parent 取主图（Catalog 导出不含图片列）。
 */
import type { NoonConnection } from "../../common/types.js";
import { noonRequest, readNoonCredentialsFile } from "./http.js";

export type ContentImage = {
  url: string;
  sort: number;
  review_status?: string;
  visibility?: string;
};

export type GetContentResult = {
  sku_parent?: string;
  images?: ContentImage[];
};

/** sku_child `Z…-1` → sku_parent `Z…` */
export function deriveSkuParent(noonSku: string): string {
  const s = noonSku.trim();
  if (!s) return "";
  return s.replace(/-\d+$/, "");
}

export function pickPrimaryImageUrl(images: ContentImage[] | undefined): string {
  if (!images?.length) return "";
  const visible = images
    .filter((img) => img.url)
    .sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99));
  const preferred =
    visible.find(
      (img) =>
        (!img.visibility || img.visibility.includes("VISIBLE")) &&
        (!img.review_status ||
          img.review_status.includes("VALID") ||
          img.review_status.includes("PENDING")),
    ) ?? visible[0];
  return preferred?.url?.trim() || "";
}

export async function fetchProductPrimaryImage(
  connection: NoonConnection,
  skuParent: string,
): Promise<string> {
  const parent = skuParent.trim();
  if (!parent) return "";
  const res = (await noonRequest(
    connection,
    "POST",
    "/content/v1/product/content/get",
    { sku_parent: parent },
  )) as GetContentResult;
  return pickPrimaryImageUrl(res?.images);
}

export function canFetchContentImages(): boolean {
  return Boolean(readNoonCredentialsFile());
}
