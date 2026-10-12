/**
 * M3 → M4 文件契约类型
 */
export type NormalizedLocalCostRow = {
  partnerSku: string;
  purchaseCost: number;
  headhaul: number;
  preferAir: boolean;
  /** plug | builtin | general；缺省 general */
  cargoType: "plug" | "builtin" | "general";
  updatedAt: string;
  source: string;
};

export type NormalizedDimsRow = {
  partnerSku: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  updatedAt: string;
  source: string;
};

export type NormalizeReject = {
  sheet?: string;
  row: number;
  partnerSku?: string;
  reason: string;
  detail?: string;
};

export type NormalizeDocResult = {
  docId: string;
  ok: boolean;
  acceptedCost: number;
  acceptedDims: number;
  acceptedPurchase?: number;
  acceptedCash?: number;
  rejected: number;
  costPath?: string;
  dimsPath?: string;
  purchasePath?: string;
  cashPath?: string;
  rejectsPath?: string;
  error?: {
    code: string;
    stage: string;
    message: string;
    hint?: string | null;
    detail?: Record<string, unknown>;
  };
};

export type NormalizeRunManifest = {
  version: 1;
  runId: string;
  sourceRawRunId: string;
  startedAt: string;
  finishedAt: string;
  outDir: string;
  /** M4 文件名约定 */
  files: {
    localCost?: string;
    dims?: string;
    purchase?: string;
    cash?: string;
  };
  results: NormalizeDocResult[];
  guards: Array<{
    docId: string;
    kind: string;
    message: string;
    ok: boolean;
  }>;
};
