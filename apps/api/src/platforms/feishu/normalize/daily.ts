/**
 * 日报（ops_tags）：本地导出副本上做规范化（不改飞书云端元数据/单元格）。
 * 第一步：选最新两张 sheet → daily_brief_input.json
 * 第二步：规则精筛 → daily_brief_filtered.json（仍不接 LLM）
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getFeishuRawDir } from "../config.js";
import { FeishuError } from "../errors.js";
import type { FeishuRawSheet, FeishuRawSnapshot } from "../types.js";
import {
  cellText,
  headerIndexMap,
  isValidPartnerSku,
  parseNumber,
} from "./cells.js";
import {
  filterDailyBrief,
  type DailyBriefFiltered,
  type DailyRuleOptions,
} from "./daily-rules.js";
import type { NormalizeReject } from "./types.js";

/** 与 product M3 同根目录，避免 import normalize/index 造成循环依赖 */
function getFeishuNormalizedDir(): string {
  const fromEnv = process.env.OUTPOST_FEISHU_NORMALIZED_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(getFeishuRawDir(), "..", "feishu-normalized");
}

function resolveRawRunId(runId?: string): string {
  const rawDir = getFeishuRawDir();
  if (runId && runId !== "last") return runId;
  const lastPath = join(rawDir, "last-run.json");
  if (!existsSync(lastPath)) {
    throw new FeishuError(
      "没有 last-run.json，无法 normalize 日报",
      "SNAPSHOT_MISSING",
      "normalize",
      { lastPath },
      "先运行 feishu-pull-raw.ts --doc daily，或指定 --run <rawRunId>",
    );
  }
  const last = JSON.parse(readFileSync(lastPath, "utf8")) as { runId?: string };
  if (!last.runId) {
    throw new FeishuError(
      "last-run.json 缺少 runId",
      "SNAPSHOT_INVALID",
      "normalize",
      { lastPath },
    );
  }
  return last.runId;
}

/** 日报规范行（48 列重点字段，已类型清洗） */
export type DailyNormalizedRow = {
  partnerSku: string;
  sku: string;
  productName: string;
  reportDate: string | null;
  daysInWarehouse: number | null;
  onlineStatus: string;
  onlinePrice: number | null;
  sales30: number | null;
  visitors30: number | null;
  cvr30: number | null;
  returnRate30: number | null;
  linkStatus: string;
  grade: string;
  remark: string;
  problemTags: string;
  adLossTag: string;
  clearPriority: string;
  ageRisk: string;
  age365Plus: number | null;
  age271_365: number | null;
  age181_270: number | null;
  age91_180: number | null;
  age0_90: number | null;
  fbn: number | null;
  supermall: number | null;
  airInTransit: number | null;
  seaInTransit: number | null;
  purchasedQty: number | null;
  airReplenishPlan: number | null;
  seaReplenishPlan: number | null;
  stockRatioBackend: number | null;
  airReplenishRatio: number | null;
  totalReplenishRatio: number | null;
  ad7Tag: string;
  ad7Spend: number | null;
  ad7Orders: number | null;
  ad7Sales: number | null;
  ad7Roas: number | null;
  ad15Tag: string;
  ad15Spend: number | null;
  ad15Orders: number | null;
  ad15Sales: number | null;
  ad15Roas: number | null;
  ad30Tag: string;
  ad30Spend: number | null;
  ad30Orders: number | null;
  ad30Sales: number | null;
  ad30Roas: number | null;
};

export type DailySheetDateMeta = {
  title: string;
  sheetId: string;
  /** 用于排序：年*10000+月*100+日；解析失败则为 null */
  sortKey: number | null;
  month: number | null;
  day: number | null;
  /** 从 sheet 标题推断的 M.D 展示 */
  titleDateHint: string | null;
};

export type DailySheetBundle = {
  meta: DailySheetDateMeta;
  /** 单元格「日期」列众数转成的 ISO 日（若有） */
  reportDate: string | null;
  rowCountRaw: number;
  accepted: number;
  rejected: number;
  rows: DailyNormalizedRow[];
  rejects: NormalizeReject[];
  overview: DailySheetOverview;
};

export type DailySheetOverview = {
  skuCount: number;
  online: number;
  offline: number;
  sales30Gt0: number;
  visitors30Gt0: number;
  grades: Record<string, number>;
  linkStatus: Record<string, number>;
  clearPriority: Record<string, number>;
  ageRisk: Record<string, number>;
  adLossTag: Record<string, number>;
  problemTagParts: Record<string, number>;
  emptyRemark: number;
  emptyReplenishPlan: number;
};

/** 第一步落盘契约：干净结构，供后续规则/LLM 消费 */
export type DailyBriefInput = {
  version: 1;
  builtAt: string;
  sourceRawRunId: string;
  docId: string;
  docLabel: string;
  strategy: "latest_two_dated";
  sheetTitlesAll: string[];
  current: DailySheetBundle;
  previous: DailySheetBundle | null;
};

export type DailyBriefRunResult = {
  runId: string;
  sourceRawRunId: string;
  outDir: string;
  briefPath: string;
  filteredPath: string;
  rejectsPath: string;
  manifestPath: string;
  brief: DailyBriefInput;
  filtered: DailyBriefFiltered;
};

const TITLE_DATE_RE = /^(?:运营)?(\d{1,2})\.(\d{1,2})$/;

/** Excel 序列日 → YYYY-MM-DD（Sheets ToString 常仍给数字） */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

export function parseReportDateCell(v: unknown): string | null {
  if (typeof v === "number") return excelSerialToIsoDate(v);
  const s = cellText(v);
  if (!s) return null;
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 20000) return excelSerialToIsoDate(asNum);
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * 解析 sheet 标题中的 M.D（含「运营8.13」）。
 * 无年份时用 refYear 拼 sortKey（跨年稀疏表后续可再增强）。
 */
export function parseDailySheetTitle(
  title: string,
  refYear = new Date().getFullYear(),
): DailySheetDateMeta {
  const t = cellText(title);
  const m = t.match(TITLE_DATE_RE);
  if (!m) {
    return {
      title: t,
      sheetId: "",
      sortKey: null,
      month: null,
      day: null,
      titleDateHint: null,
    };
  }
  const month = Number(m[1]);
  const day = Number(m[2]);
  const sortKey = refYear * 10000 + month * 100 + day;
  return {
    title: t,
    sheetId: "",
    sortKey,
    month,
    day,
    titleDateHint: `${month}.${day}`,
  };
}

/** 选最新两张可解析日期的 sheet；不足两张则 previous=null */
export function pickLatestDailySheets(
  sheets: FeishuRawSheet[],
  opts?: { refYear?: number; now?: Date },
): { current: FeishuRawSheet; previous: FeishuRawSheet | null; ranked: DailySheetDateMeta[] } {
  const refYear = opts?.refYear ?? (opts?.now ?? new Date()).getFullYear();
  const ranked = sheets
    .map((s) => {
      const meta = parseDailySheetTitle(s.title, refYear);
      return { ...meta, sheetId: s.sheetId, _sheet: s };
    })
    .filter((x) => x.sortKey != null)
    .sort((a, b) => (b.sortKey! - a.sortKey!) || a.title.localeCompare(b.title));

  if (!ranked.length) {
    throw new FeishuError(
      "日报没有可解析的日期 sheet（期望标题如 9.16 / 运营8.13）",
      "NORMALIZE_HEADER",
      "normalize",
      {
        titles: sheets.map((s) => s.title),
      },
      "检查飞书日报 sheet 命名是否为 M.D",
    );
  }

  const current = ranked[0]!._sheet;
  const previous = ranked[1]?._sheet ?? null;
  return {
    current,
    previous,
    ranked: ranked.map(({ _sheet: _, ...meta }) => meta),
  };
}

/**
 * 表头纠错：第 2 列应为 PSKU；若被写成某个 PSKU 字符串则强制改回。
 */
export function repairDailyHeader(headerRow: unknown[]): unknown[] {
  const fixed = [...headerRow];
  const col1 = cellText(fixed[1]);
  if (col1 !== "PSKU") {
    if (!col1 || isValidPartnerSku(col1) || col1.startsWith("N")) {
      fixed[1] = "PSKU";
    }
  }
  return fixed;
}

function countInc(map: Record<string, number>, key: string) {
  const k = key || "(空)";
  map[k] = (map[k] ?? 0) + 1;
}

function splitTags(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，;；|/｜]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function col(
  row: unknown[],
  headers: Map<string, number>,
  name: string,
): unknown {
  const i = headers.get(name);
  return i != null ? row[i] : undefined;
}

function buildOverview(rows: DailyNormalizedRow[]): DailySheetOverview {
  const overview: DailySheetOverview = {
    skuCount: rows.length,
    online: 0,
    offline: 0,
    sales30Gt0: 0,
    visitors30Gt0: 0,
    grades: {},
    linkStatus: {},
    clearPriority: {},
    ageRisk: {},
    adLossTag: {},
    problemTagParts: {},
    emptyRemark: 0,
    emptyReplenishPlan: 0,
  };
  for (const r of rows) {
    if (r.onlineStatus === "在线") overview.online++;
    else if (r.onlineStatus) overview.offline++;
    if ((r.sales30 ?? 0) > 0) overview.sales30Gt0++;
    if ((r.visitors30 ?? 0) > 0) overview.visitors30Gt0++;
    countInc(overview.grades, r.grade);
    countInc(overview.linkStatus, r.linkStatus);
    countInc(overview.clearPriority, r.clearPriority);
    countInc(overview.ageRisk, r.ageRisk);
    countInc(overview.adLossTag, r.adLossTag);
    for (const t of splitTags(r.problemTags)) countInc(overview.problemTagParts, t);
    if (!r.remark) overview.emptyRemark++;
    if ((r.airReplenishPlan ?? 0) <= 0 && (r.seaReplenishPlan ?? 0) <= 0) {
      overview.emptyReplenishPlan++;
    }
  }
  return overview;
}

function majorityReportDate(rows: DailyNormalizedRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.reportDate) continue;
    counts.set(r.reportDate, (counts.get(r.reportDate) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [d, c] of counts) {
    if (c > n) {
      best = d;
      n = c;
    }
  }
  return best;
}

export function normalizeDailySheet(
  sheet: FeishuRawSheet,
  opts?: { refYear?: number },
): DailySheetBundle {
  const values = sheet.values ?? [];
  if (values.length < 2) {
    throw new FeishuError(
      `日报 sheet 无数据行: ${sheet.title}`,
      "NORMALIZE_EMPTY",
      "normalize",
      { title: sheet.title, sheetId: sheet.sheetId },
    );
  }

  const header = repairDailyHeader(values[0] ?? []);
  const headers = headerIndexMap(header);
  if (!headers.has("PSKU")) {
    throw new FeishuError(
      `日报表头缺少 PSKU: ${sheet.title}`,
      "NORMALIZE_HEADER",
      "normalize",
      { title: sheet.title, header: header.map(cellText).slice(0, 12) },
    );
  }

  const meta = parseDailySheetTitle(sheet.title, opts?.refYear);
  meta.sheetId = sheet.sheetId;

  const rows: DailyNormalizedRow[] = [];
  const rejects: NormalizeReject[] = [];

  for (let ri = 1; ri < values.length; ri++) {
    const row = values[ri] ?? [];
    const partnerSku = cellText(col(row, headers, "PSKU"));
    if (!partnerSku) {
      rejects.push({
        sheet: sheet.title,
        row: ri + 1,
        reason: "empty_psku",
      });
      continue;
    }
    if (!isValidPartnerSku(partnerSku)) {
      rejects.push({
        sheet: sheet.title,
        row: ri + 1,
        partnerSku,
        reason: "invalid_psku",
      });
      continue;
    }

    rows.push({
      partnerSku,
      sku: cellText(col(row, headers, "SKU")),
      productName: cellText(col(row, headers, "产品名称")),
      reportDate: parseReportDateCell(col(row, headers, "日期")),
      daysInWarehouse: parseNumber(col(row, headers, "入仓天数")),
      onlineStatus: cellText(col(row, headers, "当前在线状态")),
      onlinePrice: parseNumber(col(row, headers, "在线价")),
      sales30: parseNumber(col(row, headers, "30销量")),
      visitors30: parseNumber(col(row, headers, "30访客")),
      cvr30: parseNumber(col(row, headers, "30转化率")),
      returnRate30: parseNumber(col(row, headers, "近30天退货率")),
      linkStatus: cellText(col(row, headers, "链接状态")),
      grade: cellText(col(row, headers, "产品主等级")),
      remark: cellText(col(row, headers, "操作备注")),
      problemTags: cellText(col(row, headers, "问题标签汇总")),
      adLossTag: cellText(col(row, headers, "广告亏损判断标签")),
      clearPriority: cellText(col(row, headers, "清货优先级")),
      ageRisk: cellText(col(row, headers, "库龄风险等级")),
      age365Plus: parseNumber(col(row, headers, "365天以上")),
      age271_365: parseNumber(col(row, headers, "271-365天")),
      age181_270: parseNumber(col(row, headers, "181-270天")),
      age91_180: parseNumber(col(row, headers, "91-180天")),
      age0_90: parseNumber(col(row, headers, "0-90天")),
      fbn: parseNumber(col(row, headers, "FBN")),
      supermall: parseNumber(col(row, headers, "supermall")),
      airInTransit: parseNumber(col(row, headers, "空运在途")),
      seaInTransit: parseNumber(col(row, headers, "海运在途")),
      purchasedQty: parseNumber(col(row, headers, "已采购数量")),
      airReplenishPlan: parseNumber(col(row, headers, "空运计划补货")),
      seaReplenishPlan: parseNumber(col(row, headers, "海运计划补货")),
      stockRatioBackend: parseNumber(col(row, headers, "后台库存比例")),
      airReplenishRatio: parseNumber(col(row, headers, "空运补货比例")),
      totalReplenishRatio: parseNumber(col(row, headers, "总补货比例")),
      ad7Tag: cellText(col(row, headers, "7天广告盈亏标签")),
      ad7Spend: parseNumber(col(row, headers, "7广告花费")),
      ad7Orders: parseNumber(col(row, headers, "7广告订单")),
      ad7Sales: parseNumber(col(row, headers, "7广告销售额")),
      ad7Roas: parseNumber(col(row, headers, "7ROAS")),
      ad15Tag: cellText(col(row, headers, "15天广告盈亏标签")),
      ad15Spend: parseNumber(col(row, headers, "15广告花费")),
      ad15Orders: parseNumber(col(row, headers, "15广告订单")),
      ad15Sales: parseNumber(col(row, headers, "15广告销售额")),
      ad15Roas: parseNumber(col(row, headers, "15ROAS")),
      ad30Tag: cellText(col(row, headers, "30天广告盈亏标签")),
      ad30Spend: parseNumber(col(row, headers, "30广告花费")),
      ad30Orders: parseNumber(col(row, headers, "30广告订单")),
      ad30Sales: parseNumber(col(row, headers, "30广告销售额")),
      ad30Roas: parseNumber(col(row, headers, "30ROAS")),
    });
  }

  const overview = buildOverview(rows);
  return {
    meta,
    reportDate: majorityReportDate(rows),
    rowCountRaw: Math.max(0, values.length - 1),
    accepted: rows.length,
    rejected: rejects.length,
    rows,
    rejects,
    overview,
  };
}

export function buildDailyBriefInput(
  snap: FeishuRawSnapshot,
  opts?: { sourceRawRunId?: string; builtAt?: string; refYear?: number },
): DailyBriefInput {
  if (snap.docId !== "daily" && snap.targetDomain !== "ops_tags") {
    throw new FeishuError(
      `期望日报快照，收到 docId=${snap.docId} domain=${snap.targetDomain}`,
      "SNAPSHOT_INVALID",
      "normalize",
      { docId: snap.docId, targetDomain: snap.targetDomain },
    );
  }

  const { current, previous } = pickLatestDailySheets(snap.sheets, {
    refYear: opts?.refYear,
  });
  const currentBundle = normalizeDailySheet(current, { refYear: opts?.refYear });
  const previousBundle = previous
    ? normalizeDailySheet(previous, { refYear: opts?.refYear })
    : null;

  return {
    version: 1,
    builtAt: opts?.builtAt ?? new Date().toISOString(),
    sourceRawRunId: opts?.sourceRawRunId ?? "",
    docId: String(snap.docId),
    docLabel: snap.docLabel,
    strategy: "latest_two_dated",
    sheetTitlesAll: snap.sheets.map((s) => s.title),
    current: currentBundle,
    previous: previousBundle,
  };
}

function loadDailySnapshot(rawRunDir: string): FeishuRawSnapshot {
  const path = join(rawRunDir, "daily", "snapshot.json");
  if (!existsSync(path)) {
    throw new FeishuError(
      "缺少日报 raw 快照 daily/snapshot.json",
      "SNAPSHOT_MISSING",
      "normalize",
      { path },
      "先运行: pnpm exec tsx scripts/feishu-pull-raw.ts --doc daily",
    );
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FeishuRawSnapshot;
  } catch (e) {
    throw new FeishuError(
      "日报 snapshot JSON 损坏",
      "SNAPSHOT_INVALID",
      "normalize",
      { path, cause: e instanceof Error ? e.message : String(e) },
    );
  }
}

function writeText(path: string, body: string) {
  try {
    writeFileSync(path, body, "utf8");
  } catch (e) {
    throw new FeishuError(
      "写入日报 brief 失败",
      "NORMALIZE_WRITE_FAILED",
      "normalize",
      { path, cause: e instanceof Error ? e.message : String(e) },
    );
  }
}

/**
 * 从 raw run 规范化日报并落盘（独立于 product normalize；只写本地，不写飞书）。
 */
export function normalizeDailyBriefRun(opts?: {
  rawRunId?: string;
  now?: () => Date;
  refYear?: number;
  ruleOptions?: DailyRuleOptions;
}): DailyBriefRunResult {
  const nowFn = opts?.now ?? (() => new Date());
  const builtAt = nowFn().toISOString();
  const sourceRawRunId = resolveRawRunId(opts?.rawRunId);
  const rawRunDir = join(getFeishuRawDir(), "runs", sourceRawRunId);
  if (!existsSync(rawRunDir)) {
    throw new FeishuError(
      "raw run 目录不存在",
      "SNAPSHOT_MISSING",
      "normalize",
      { rawRunDir, sourceRawRunId },
    );
  }
  const snap = loadDailySnapshot(rawRunDir);
  const brief = buildDailyBriefInput(snap, {
    sourceRawRunId,
    builtAt,
    refYear: opts?.refYear,
  });
  const filtered = filterDailyBrief(brief, opts?.ruleOptions);

  const outRoot = getFeishuNormalizedDir();
  const runId = `daily_${builtAt.replace(/[:.]/g, "-")}`;
  const outDir = join(outRoot, "runs", runId, "daily");
  mkdirSync(outDir, { recursive: true });

  const briefPath = join(outDir, "daily_brief_input.json");
  const filteredPath = join(outDir, "daily_brief_filtered.json");
  const rejectsPath = join(outDir, "rejects.jsonl");
  const manifestPath = join(outDir, "daily-brief-manifest.json");

  const allRejects = [
    ...brief.current.rejects,
    ...(brief.previous?.rejects ?? []),
  ];

  writeText(briefPath, JSON.stringify(brief, null, 2) + "\n");
  writeText(filteredPath, JSON.stringify(filtered, null, 2) + "\n");
  writeText(
    rejectsPath,
    allRejects.map((x) => JSON.stringify(x)).join("\n") +
      (allRejects.length ? "\n" : ""),
  );

  const manifest = {
    version: 1,
    runId,
    sourceRawRunId,
    builtAt,
    strategy: brief.strategy,
    currentSheet: brief.current.meta.title,
    previousSheet: brief.previous?.meta.title ?? null,
    currentAccepted: brief.current.accepted,
    previousAccepted: brief.previous?.accepted ?? 0,
    rejected: allRejects.length,
    watchlistKept: filtered.watchlist.length,
    deltaCounts: filtered.deltaCounts,
    briefPath,
    filteredPath,
    rejectsPath,
  };
  writeText(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  writeText(
    join(outRoot, "last-daily-brief.json"),
    JSON.stringify(
      {
        runId,
        sourceRawRunId,
        builtAt,
        briefPath,
        filteredPath,
        rejectsPath,
        manifestPath,
        currentSheet: brief.current.meta.title,
        previousSheet: brief.previous?.meta.title ?? null,
        currentAccepted: brief.current.accepted,
        previousAccepted: brief.previous?.accepted ?? 0,
        watchlistKept: filtered.watchlist.length,
        deltaCounts: filtered.deltaCounts,
      },
      null,
      2,
    ) + "\n",
  );

  return {
    runId,
    sourceRawRunId,
    outDir,
    briefPath,
    filteredPath,
    rejectsPath,
    manifestPath,
    brief,
    filtered,
  };
}
