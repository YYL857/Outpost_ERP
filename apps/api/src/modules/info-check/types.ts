export const INFO_CHECK_DOC_IDS = [
  "product",
  "monthly-deals",
  "info-check",
] as const;

export type InfoCheckDocId = (typeof INFO_CHECK_DOC_IDS)[number];

export type InfoCheckSourceKey = "product" | "monthlyDeals" | "infoCheck";

export type InfoCheckTableIndex = {
  docId: InfoCheckDocId;
  label: string;
  pulledAt: string | null;
  snapshotPath: string | null;
  /** 全量字段名（去重，不含仅内部用的空头） */
  headers: string[];
  /** PSKU → 字段值 */
  byPsku: Map<string, Record<string, string>>;
};

export type InfoCheckBundle = {
  product: InfoCheckTableIndex;
  monthlyDeals: InfoCheckTableIndex;
  infoCheck: InfoCheckTableIndex;
  /** 三表 header 交集，去掉 PSKU */
  commonFields: string[];
};

export type InfoCheckCompareCell = {
  field: string;
  product: string;
  monthlyDeals: string;
  infoCheck: string;
  mismatch: boolean;
  /** 各表实际命中的列名（语义映射后） */
  sources?: {
    product: string | null;
    monthlyDeals: string | null;
    infoCheck: string | null;
  };
};

export type InfoCheckQueryRow = {
  psku: string;
  sources: {
    product: Record<string, string> | null;
    monthlyDeals: Record<string, string> | null;
    infoCheck: Record<string, string> | null;
  };
  compare?: InfoCheckCompareCell[];
};

export type InfoCheckQueryMode = "exact" | "fuzzy";
