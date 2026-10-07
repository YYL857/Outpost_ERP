/**
 * 飞书桥接公开出口（P0：Config + Puller）
 * 下游 M3/M4 只依赖 types 契约与 raw 磁盘布局，勿 import http 内部细节。
 */
export { FeishuError, formatFeishuError, isFeishuError } from "./errors.js";
export type {
  FeishuErrorCode,
  FeishuErrorStage,
} from "./errors.js";
export {
  getFeishuDocsFilePath,
  getFeishuRawDir,
  loadFeishuDocsConfig,
  loadFeishuDocsFile,
  parseFeishuDocsFile,
  readFeishuCredentials,
  summarizeConfig,
} from "./config.js";
export { parseFeishuDocUrl, resolveSpreadsheetToken } from "./link.js";
export { pullFeishuRaw } from "./puller.js";
export type { PullRawOptions } from "./puller.js";
export {
  getFeishuNormalizedDir,
  normalizeFeishuRun,
  resolveRawRunId,
} from "./normalize/index.js";
export {
  buildDailyBriefInput,
  normalizeDailyBriefRun,
  normalizeDailySheet,
  parseDailySheetTitle,
  pickLatestDailySheets,
  repairDailyHeader,
} from "./normalize/daily.js";
export type {
  DailyBriefInput,
  DailyBriefRunResult,
  DailyNormalizedRow,
  DailySheetBundle,
} from "./normalize/daily.js";
export { filterDailyBrief } from "./normalize/daily-rules.js";
export type {
  DailyBriefFiltered,
  DailyWatchItem,
} from "./normalize/daily-rules.js";
export {
  DAILY_BRIEF_SYSTEM_PROMPT,
  buildDailyBriefUserPrompt,
  buildDailyLlmPayload,
} from "./normalize/daily-prompts.js";
export {
  dailyDeepseekConfig,
  loadDailyBriefFiltered,
  parseAndClampDailyJudgment,
  renderDailyBriefMarkdown,
  resolveLastDailyFilteredPath,
  summarizeDailyBriefFromFile,
  summarizeDailyBriefWithLlm,
} from "./normalize/daily-llm.js";
export type {
  DailyBriefLlmJudgment,
  DailyBriefSummaryResult,
} from "./normalize/daily-llm.js";
export {
  markdownToFeishuText,
  sendFeishuInteractiveMessage,
  sendFeishuTextMessage,
} from "./im.js";
export type {
  FeishuReceiveIdType,
  SendFeishuMessageResult,
  SendFeishuTextResult,
} from "./im.js";
export { buildDailyBriefCard } from "./normalize/daily-card.js";
export type { DailyBriefCardInput } from "./normalize/daily-card.js";
export {
  ingestFeishuLocalIntoState,
  inferStorePrefixes,
  readLastNormalizePaths,
} from "./ingest/local.js";
export type { LocalAlignReport } from "./ingest/local.js";
export type {
  NormalizeDocResult,
  NormalizeRunManifest,
  NormalizedDimsRow,
  NormalizedLocalCostRow,
} from "./normalize/types.js";
export type {
  FeishuDocId,
  FeishuDocRef,
  FeishuDocsConfig,
  FeishuDocsFile,
  FeishuPullDocResult,
  FeishuPullRunManifest,
  FeishuRawSheet,
  FeishuRawSnapshot,
  FeishuTargetDomain,
} from "./types.js";
