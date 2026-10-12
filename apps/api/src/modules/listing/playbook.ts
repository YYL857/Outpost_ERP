/**
 * Listing 优化流程图（运营手册）提炼版。
 * 在创建 / 优化诊断 / 改写走大模型时自动拼入 system，禁止整表照搬 Amazon 广告位控投细节。
 */

export type ListingPlaybookMode = "diagnose" | "rewrite" | "create";

/** 核心决策要点（短，控 token） */
const CORE = `【Listing 决策手册｜Noon 适配】
目标症状：转化低、出单少 → 先分「自然流量弱」还是「广告效率弱」，再按漏斗断点动刀。
标题与埋词是 Listing 优化的核心，直接影响搜索曝光和转化。

漏斗（按断点优先）：
1) 曝光→点击：CTR 弱 → 主图/标题吸引力（勿先改长描述）
2) 点击→加购：卖点/价带/首屏信任弱
3) 加购→支付：规格/顾虑/评价信任弱

参考阈值（须与店内基线/样本一起看，勿盲从）：
- CTR：≥1% 优秀，≥0.5% 合格；自动广告词收录宜冲 1%
- 广告转化：非标约 5%、标品约 8% 合格；明显高于则偏优秀
- 原则：精准核心词流量优先，少灌泛流量；质量差会反向拉低相关度与排名

【标题硬规则｜英阿均适用；阿语在可读前提下对齐关键词意图】
1) 有品牌则品牌放最前（如 HPMY）；Noon 勾选无品牌则从核心词起笔，禁止编造品牌
2) 精准核心词（产品类型）布局在标题前 20 个字符内
3) 埋入搜索词：核心词（产品类型）+ 次核心词（功能/规格）+ 场景词 + 人群词；自然可读，禁止堆砌
4) 颜色放标题末尾，格式「 - Color」（如 - Black）；无明确颜色则省略
5) 标题建议 60–130 字符（英文字符计数）；勿超 Noon 字段上限

【五点 Feature Bullets】
1) 固定 5 条；每条开头首词大写
2) 按产品痛点从强到弱排序 1→5
3) 每条约 15–40 词（英文）；阿语条数对齐、意图一致
4) 每条自然预埋核心词/次核心词/场景词/人群词（勿生硬堆词）

【长描述 Long Description】
1) 写成纯文本一段话；禁止任何 HTML 标签（含 <p>/<br>/<b>）；禁止多段清单式堆砌
2) ≤900 字符；自然埋入同上四类搜索词
3) 只写有证据的规格与卖点，勿编造认证/医疗功效

【变体】Size / Group 合并链接时，前台可共享 Rating（运营建品提示，文案侧勿编造评分）

Listing 质量因子：主图场景细化｜关键词/人群/属性/价带相关度｜标题语法可读｜可信评价信号｜价带匹配搜索意图
行动节奏：改一项，观察约 3 天；好转则固化，仍差再下一步。
广告位仅可作建议；本系统主产出是文案。禁止把 Amazon A9 绝对权重公式当事实。`;

const MODE_HINT: Record<ListingPlaybookMode, string> = {
  diagnose: `【本轮任务=诊断】必须引用 funnel.stage/dropOff 与 baseline；按断点给出 priorities，并标明建议观察约 3 天的验证点。suggestedFocus：曝光/CTR→title+images；加购弱→bullets+price；转化弱→bullets+description+price；ACOS 高可附带 ads 建议。标题/埋词问题优先指出。`,
  rewrite: `【本轮任务=改写】严格遵守手册「标题硬规则 / 五点 / 长描述」。CTR/曝光弱→先改标题前 20 字符核心词与品牌位；转化弱→按痛点强弱重排五点并改一段话长描述（≤900）。勿为堆词牺牲可读性；勿编造认证/功效。`,
  create: `【本轮任务=新建】第一版就按手册硬规则写：品牌前置（有则）、核心词进前 20 字符、四类搜索词埋入、颜色「 - Color」收尾、标题 60–130、五点 5 条痛点强弱序各 15–40 词、长描述一段话≤900。差异打点须可追溯证据。`,
};

/** 拼到既有 system 末尾 */
export function withListingPlaybook(
  system: string,
  mode: ListingPlaybookMode,
): string {
  const base = String(system || "").trimEnd();
  return `${base}\n\n---\n${CORE}\n${MODE_HINT[mode]}\n---`;
}

/** 测试/调试用：仅核心正文 */
export function listingPlaybookCore(): string {
  return CORE;
}
