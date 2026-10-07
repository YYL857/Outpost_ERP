/**
 * 飞书桥接 — 结构化错误（全模块共用）
 * CLI / 日志请打印 toJSON()，用 stage 定位。
 */
export type FeishuErrorStage =
  | "config"
  | "auth"
  | "meta"
  | "read"
  | "write"
  | "guard"
  | "normalize"
  | "im";

export type FeishuErrorCode =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "CREDENTIALS_MISSING"
  | "AUTH_FAILED"
  | "DOC_TOKEN_MISSING"
  | "DOC_KIND_UNSUPPORTED"
  | "LINK_PARSE_FAILED"
  | "API_HTTP"
  | "API_BIZ"
  | "SHEET_NOT_FOUND"
  | "SHEET_EMPTY"
  | "RAW_WRITE_FAILED"
  | "ROW_DROP_GUARD"
  | "SNAPSHOT_MISSING"
  | "SNAPSHOT_INVALID"
  | "NORMALIZE_HEADER"
  | "NORMALIZE_EMPTY"
  | "NORMALIZE_WRITE_FAILED";

export class FeishuError extends Error {
  readonly name = "FeishuError";

  constructor(
    message: string,
    readonly code: FeishuErrorCode,
    readonly stage: FeishuErrorStage,
    readonly detail: Record<string, unknown> = {},
    readonly hint?: string,
  ) {
    super(message);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      stage: this.stage,
      message: this.message,
      hint: this.hint ?? null,
      detail: this.detail,
    };
  }
}

export function isFeishuError(e: unknown): e is FeishuError {
  return e instanceof FeishuError;
}

export function formatFeishuError(e: unknown): string {
  if (isFeishuError(e)) {
    return JSON.stringify(e.toJSON(), null, 2);
  }
  if (e instanceof Error) {
    return JSON.stringify(
      { name: e.name, message: e.message, stack: e.stack?.split("\n").slice(0, 6) },
      null,
      2,
    );
  }
  return JSON.stringify({ message: String(e) }, null, 2);
}
