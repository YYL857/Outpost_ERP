/**
 * PSKU 前缀 → 店铺（N1→店1 …）；导入清洗以本函数为准，不以 Excel 手改为准。
 */

export type ShopCode = "店1" | "店2" | "店3" | "店4";

export const SHOP_META: Record<
  ShopCode,
  { name: string; projectId: string; prefix: string }
> = {
  店1: { name: "HUI Beauty", projectId: "PRJ396770", prefix: "N1" },
  店2: { name: "HFY-KSA", projectId: "PRJ482387", prefix: "N2" },
  店3: {
    name: "Glam Bag Collection",
    projectId: "PRJ488078",
    prefix: "N3",
  },
  店4: { name: "mmm", projectId: "PRJ595165", prefix: "N4" },
};

export function shopFromPartnerSku(
  partnerSku: string,
): { shop: ShopCode; shopName: string } | null {
  const m = partnerSku.trim().toUpperCase().match(/^(N)(\d+)/);
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 1 || n > 4) return null;
  const shop = `店${n}` as ShopCode;
  return { shop, shopName: SHOP_META[shop].name };
}

/** Excel 店铺列公式（r 为 1-based 行号，PSKU 在 B 列） */
export function shopFormulaForRow(r: number): string {
  return (
    `IF(B${r}="","",` +
    `IF(UPPER(LEFT(B${r},2))="N1","店1",` +
    `IF(UPPER(LEFT(B${r},2))="N2","店2",` +
    `IF(UPPER(LEFT(B${r},2))="N3","店3",` +
    `IF(UPPER(LEFT(B${r},2))="N4","店4","请检查PSKU")))))`
  );
}
