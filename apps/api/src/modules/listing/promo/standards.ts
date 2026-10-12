/** Listing 宣传图标准（与 cross-border-listing-images skill 对齐） */

export type PromoFrameRole = {
  index: string;
  role: string;
  composition: string;
  headlineHint: string;
};

export const DEFAULT_FRAME_COUNT = 9;
export const DEFAULT_ASPECT_RATIO = "9:16";

export const PROMO_FRAME_ROLES: PromoFrameRole[] = [
  {
    index: "01",
    role: "主图 Hero",
    composition: "完整产品平铺/成对，白底干净；标题+2 徽章；不拆层爆炸图",
    headlineHint: "Product name + core spec",
  },
  {
    index: "02",
    role: "规格锁",
    composition: "特写唯一进货规格（层数/加厚/容量），箭头标注",
    headlineHint: "Spec lock e.g. 4-LAYER THICKENED",
  },
  {
    index: "03",
    role: "尺码/适配",
    composition: "尺码范围、可裁剪、适用人群",
    headlineHint: "UNIVERSAL FIT / size range",
  },
  {
    index: "04",
    role: "核心科技",
    composition: "气垫/材质/结构微距",
    headlineHint: "Tech feature e.g. AIR CUSHION",
  },
  {
    index: "05",
    role: "效果数字",
    composition: "增高 cm / 片数 / 容量等大数字",
    headlineHint: "Number claim e.g. UP TO 6 CM",
  },
  {
    index: "06",
    role: "真实使用",
    composition:
      "完整实物场景（打开鞋口放垫/手持等）；禁止假剖面、劈开悬浮、不可能结构",
    headlineHint: "INVISIBLE / IN-USE scene",
  },
  {
    index: "07",
    role: "颜色/款式",
    composition: "只展示有货颜色；单色则做「本批仅×色」场景，勿画虚假色板",
    headlineHint: "COLOR ONLY / in-stock variant",
  },
  {
    index: "08",
    role: "细节舒适",
    composition: "透气、防滑、分区 callout",
    headlineHint: "ALL-DAY COMFORT / details",
  },
  {
    index: "09",
    role: "卖点汇总",
    composition: "小产品图 + 下方图标网格；勿复用 01 大图构图",
    headlineHint: "WHY CHOOSE… icon grid",
  },
];

export const PROMO_NEGATIVE_CONSTRAINTS = [
  "No Chinese characters on images unless explicitly requested",
  "No out-of-stock colors or specs",
  "No impossible cutaways / split shoes / warped product",
  "No duplicate layouts across frames (especially 01/07/09)",
  "No heavy powder explosions or unrelated floating props",
  "Photorealistic commercial listing quality, not surreal AI art",
].join("; ");

export function framesTableMarkdown(): string {
  const rows = PROMO_FRAME_ROLES.map(
    (f) =>
      `| ${f.index} | ${f.role} | ${f.composition} | ${f.headlineHint} |`,
  );
  return [
    "| # | Role | Composition | Headline hint |",
    "|---|------|-------------|-----------------|",
    ...rows,
  ].join("\n");
}
