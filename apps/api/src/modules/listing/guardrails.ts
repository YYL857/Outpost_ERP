import type { GuardrailResult, OursNoonContent } from "./types.js";

/** 中东电商常见雷点（简表，可后续外置配置） */
const BLOCK_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(cure|heal|treat|diagnose|anti-?cancer)\b/i, label: "医疗功效夸大" },
  { re: /(治愈|根治|治疗癌症|包治)/, label: "医疗功效夸大" },
  { re: /\b(alcohol|wine|beer|pork|bacon|ham)\b/i, label: "敏感品类用语" },
  { re: /(猪肉|酒精饮料|啤酒|红酒)/, label: "敏感品类用语" },
  { re: /\b(nude|sexy|erotic)\b/i, label: "不当暗示" },
  { re: /(保证100%|绝对|永久有效|零副作用)/, label: "绝对化承诺" },
  { re: /\b(100%\s*guaranteed|miracle|permanent\s*cure)\b/i, label: "绝对化承诺" },
];

const WARN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(FDA|CE|ISO)\s*(certified|approved)\b/i, label: "认证表述需人工核实" },
  { re: /(官方认证|医疗级)/, label: "认证表述需人工核实" },
];

function collectText(content: OursNoonContent): string {
  return [
    content.titleEn,
    content.titleAr,
    content.brandEn,
    content.brandAr,
    content.longDescriptionEn,
    content.longDescriptionAr,
    ...content.featureBulletsEn,
    ...content.featureBulletsAr,
  ].join("\n");
}

export function runContentGuardrails(
  content: OursNoonContent,
  opts?: { gtinFromUser?: string },
): GuardrailResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const text = collectText(content);

  for (const p of BLOCK_PATTERNS) {
    if (p.re.test(text)) blockers.push(p.label);
  }
  for (const p of WARN_PATTERNS) {
    if (p.re.test(text)) warnings.push(p.label);
  }

  if (!content.titleEn.trim()) blockers.push("英文标题为空");
  if (!content.titleAr.trim()) blockers.push("阿语标题为空");
  if (content.titleEn.length > 200) warnings.push("英文标题可能过长（>200）");
  if (content.featureBulletsEn.length < 3) {
    warnings.push("英文卖点少于 3 条");
  }
  if (content.featureBulletsEn.length !== content.featureBulletsAr.length) {
    blockers.push("英/阿 Feature Bullets 条数不一致");
  }

  const userGtin = (opts?.gtinFromUser || "").trim();
  const outGtin = content.gtin.trim();
  if (outGtin && !userGtin) {
    blockers.push("GTIN 禁止模型编造：用户未填却出现了 GTIN");
  }
  if (userGtin && outGtin && outGtin !== userGtin) {
    warnings.push("输出 GTIN 与用户填写不一致，已建议以用户为准");
  }

  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    ok: uniq(blockers).length === 0,
    blockers: uniq(blockers),
    warnings: uniq(warnings),
  };
}

/** 生成后强制：GTIN 只保留用户值 */
export function enforceGtinFromUser(
  content: OursNoonContent,
  userGtin: string,
): OursNoonContent {
  return { ...content, gtin: userGtin.trim() };
}
