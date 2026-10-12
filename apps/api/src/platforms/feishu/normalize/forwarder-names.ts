/**
 * 货代名称归一：装箱笔误 / 大纲全称 → 统一展示名。
 * 只读清洗，不改飞书原文。
 */
const CANONICAL: Array<{ match: RegExp | string; name: string }> = [
  // 用户指定保留「起克」；装箱/大纲偶发写成「起客」
  { match: /^起客$/, name: "起克" },
  { match: /^起克$/, name: "起克" },
  { match: /安时达/, name: "安时达" },
  { match: /^义特/, name: "义特" },
];

export function canonicalizeForwarderName(raw: string): string {
  const n = raw.trim();
  if (!n) return n;
  for (const rule of CANONICAL) {
    if (typeof rule.match === "string") {
      if (n === rule.match) return rule.name;
    } else if (rule.match.test(n)) {
      return rule.name;
    }
  }
  return n;
}
