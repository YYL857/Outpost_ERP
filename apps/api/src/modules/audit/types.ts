/** 人工操作审计：谁在何时对哪个模块做了什么 */

export type AuditActor = {
  id: string;
  username: string;
  role: string;
};

export type AuditResult = "ok" | "denied" | "error";

export type AuditEvent = {
  id: string;
  at: string;
  /** Asia/Shanghai YYYY-MM-DD */
  day: string;
  actor: AuditActor;
  shopId: string | null;
  /** URL 首段：purchase / auth / catalog … */
  module: string;
  /** 如 arrival-confirm、users.create */
  action: string;
  method: string;
  path: string;
  statusCode: number;
  result: AuditResult;
  /** 人话摘要，便于追责阅读 */
  summary: string;
  entityType?: string;
  entityId?: string;
  /** 脱敏后的请求体摘要（截断） */
  body?: Record<string, unknown>;
  /** 路由补充的前后关键字段 */
  detail?: Record<string, unknown>;
};

export type AuditDailySummary = {
  day: string;
  generatedAt: string;
  totalEvents: number;
  ok: number;
  denied: number;
  error: number;
  byModule: Record<string, number>;
  byAction: Record<string, number>;
  byActor: Record<string, number>;
  byShop: Record<string, number>;
};

/** 路由可在响应前写入，中间件会并入事件 */
export type AuditDetail = {
  summary?: string;
  entityType?: string;
  entityId?: string;
  detail?: Record<string, unknown>;
  /**
   * 覆盖中间件默认抓取的 req.body。
   * - 传对象：只落这些关键字段（仍会再过 sanitize）
   * - 传 null：本次不记 body
   */
  body?: Record<string, unknown> | null;
  /** 覆盖默认 actor（如 login 成功后） */
  actor?: AuditActor;
};
