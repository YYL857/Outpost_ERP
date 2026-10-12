/**
 * 列表信号质量：促销标题、脏价（容量/型号/年份当 SAR）。
 * 供入库、适销、短名单共用，避免互相 import 成环。
 */

export function looksPromoTitle(title: string | null | undefined): boolean {
  const t = String(title || "").trim();
  return /^(mega\s*deal|deal\b|live\s*check|\[yd-demo\])/i.test(t);
}

/** 拒绝年份 / 容量 / 型号数字被当成 SAR 的脏价 */
export function isPlausiblePrice(
  price: number | null | undefined,
  title: string,
): boolean {
  if (price == null || !(price > 0)) return false;
  if (price < 5 || price > 15000) return false;
  const rounded = Math.round(price);
  if (
    rounded >= 2010 &&
    rounded <= 2035 &&
    Math.abs(price - rounded) < 0.001
  ) {
    return false;
  }
  const mah = title.match(/(\d{3,5})\s*mAh/i);
  if (mah && Number(mah[1]) === rounded) return false;
  const model = title.match(/\b[A-Za-z]{1,6}[-_]?(\d{3,5})\b/);
  if (model && Number(model[1]) === rounded) return false;
  const bare = title.match(/(?:^|\s)(\d{3,5})(?:\s|$)/);
  if (bare && Number(bare[1]) === rounded && rounded >= 1000) return false;
  return true;
}
