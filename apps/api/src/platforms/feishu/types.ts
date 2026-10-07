/**
 * 飞书桥接 — 跨模块契约类型
 * M2 写出 / M3 只读：FeishuRawSnapshot、FeishuPullRunManifest
 */

/** 四表业务 id（配置与文件名用） */
export type FeishuDocId =
  | "product"
  | "daily"
  | "packing"
  | "accounts"
  | (string & {});

/** M3 目标域（Puller 只记录，不执行） */
export type FeishuTargetDomain =
  | "local_cost_dims"
  | "ops_tags"
  | "packing"
  | "purchase_cash"
  | "raw_only";

export type FeishuDocKind = "spreadsheet" | "wiki" | "bitable";

export type FeishuDocRef = {
  id: FeishuDocId;
  label: string;
  kind: FeishuDocKind;
  /** 原始分享链接（可选，便于人眼核对） */
  url?: string;
  /** 电子表格 token；spreadsheet 必填（可由 url 解析） */
  spreadsheetToken?: string;
  /** 仅拉这些 sheet 标题；空 = 全部 */
  sheetTitles?: string[];
  /** 下游域提示，M2 原样写入 snapshot */
  targetDomain: FeishuTargetDomain;
  enabled?: boolean;
};

export type FeishuDocsFile = {
  version: 1;
  docs: FeishuDocRef[];
};

export type FeishuCredentials = {
  appId: string;
  appSecret: string;
};

export type FeishuDocsConfig = {
  credentials: FeishuCredentials;
  docs: FeishuDocRef[];
  rawDir: string;
  docsFilePath: string;
};

/** M2 → M3：单次文档快照 */
export type FeishuRawSnapshot = {
  version: 1;
  pulledAt: string;
  docId: FeishuDocId;
  docLabel: string;
  targetDomain: FeishuTargetDomain;
  kind: FeishuDocKind;
  spreadsheetToken: string;
  sheets: FeishuRawSheet[];
  source: {
    url?: string;
    appIdMasked: string;
  };
};

export type FeishuRawSheet = {
  sheetId: string;
  title: string;
  rowCount: number;
  colCount: number;
  /** 完整二维值；首行通常为表头 */
  values: unknown[][];
};

export type FeishuPullDocResult = {
  docId: FeishuDocId;
  ok: boolean;
  snapshotPath?: string;
  metaPath?: string;
  sheetCount?: number;
  totalRows?: number;
  sha1?: string;
  durationMs?: number;
  error?: {
    code: string;
    stage: string;
    message: string;
    hint?: string | null;
    detail?: Record<string, unknown>;
  };
};

/** M2 → 运维 / M3：一次 pull run */
export type FeishuPullRunManifest = {
  version: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  rawDir: string;
  docsFilePath: string;
  results: FeishuPullDocResult[];
};
