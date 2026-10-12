/**
 * 补货表（本地动态 xlsx）行模型。
 * 需求库存：月均 × 备货月数 + 15（默认月数=3）；在途：箱表 ASN 空且非包装盒。
 */

export type ReplenishWorkbookRow = {
  partnerSku: string;
  title: string;
  /** 近 90 日销量合计 */
  salesD90: number;
  /** 近三个月月均 = salesD90 / 3 */
  monthlyAvg: number;
  /** 店内月均排名，1=最好；无销量则为 null */
  salesRank: number | null;
  /** (N−rank+1)/N，无销量 0 */
  salesWeight: number;
  /** 月均 × 备货月数 + 15 */
  demandQty: number;
  /**
   * 可售库存（对齐门户 Active Net）：分仓 FBN + supermall。
   * 建议补货用此字段。
   */
  fbn: number;
  /** 分仓 FBN 合计（不含 supermall） */
  fbnWh: number;
  supermall: number;
  inTransit: number;
  inTransitAir: number;
  inTransitSea: number;
  /** 如「海运」「空运」「空运+海运」 */
  shipModesLabel: string;
  /** max(0, demand − 可售(fbn) − inTransit) */
  suggestQty: number;
  /** 建议补货 / 不补货（含人工排除） */
  needReplenish: boolean;
  needReplenishLabel: string;
  /** 人工列：刷新时保留 */
  manualTag: string;
  note: string;
  imageUrl: string;
  noonSku: string;
};

export type ReplenishWorkbookMeta = {
  shopPrefix: string;
  shopId: string;
  shopName: string;
  projectCode: string;
  filePath: string;
  sheetTitle: string;
  generatedAt: string;
  rowCount: number;
  needCount: number;
  formulaNote: string;
};

export type ReplenishWorkbookDoc = {
  meta: ReplenishWorkbookMeta;
  rows: ReplenishWorkbookRow[];
};

export const WORKBOOK_SHEET_TITLE = "补货表";

export function workbookFormulaNote(coverMonths = 3): string {
  const m = Number.isFinite(coverMonths)
    ? Math.round(coverMonths * 10) / 10
    : 3;
  return `需求库存=近三个月月均销量×${m}+15；可售=分仓FBN+supermall（贴近门户 Active Net）；FBN=仅FBN仓合计；supermall=超商仓合计；建议补货=ceil(max(0,需求−可售−在途))；在途=箱表ASN空（排除包装盒）。判定只有补货/不补货：淘汰/清仓/不补/暂时不补/走线下→不补货；N/A忽略。`;
}

export const WORKBOOK_FORMULA_NOTE = workbookFormulaNote(3);

/** 前端常用人工标记（语义均为「不补货」，空=可按公式补） */
export const MANUAL_TAG_OPTIONS = [
  { value: "", label: "可补（按公式）" },
  { value: "不补", label: "不补" },
  { value: "暂时不补", label: "暂时不补" },
  { value: "淘汰", label: "淘汰" },
  { value: "清仓", label: "清仓" },
  { value: "走线下", label: "走线下" },
] as const;

/** xlsx 表头（顺序固定，便于人打开对照） */
export const WORKBOOK_HEADERS = [
  "PSKU",
  "名称",
  "近三个月月均销量",
  "销量排名",
  "销量权重",
  "需求库存",
  "可售库存",
  "FBN",
  "supermall参考",
  "在途数量",
  "在途空运",
  "在途海运",
  "运输方式",
  "建议补货数量",
  "是否需要补货",
  "人工标记",
  "备注",
] as const;
