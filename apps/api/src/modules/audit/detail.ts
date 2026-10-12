import type { Request } from "express";
import type { AuditDetail } from "./types.js";

const KEY = Symbol.for("outpost.auditDetail");

type WithAudit = Request & { [KEY]?: AuditDetail };

/** 路由在写成功后补充「做了什么」的人话摘要与实体键 */
export function setAuditDetail(req: Request, detail: AuditDetail) {
  const prev = (req as WithAudit)[KEY];
  (req as WithAudit)[KEY] = prev ? { ...prev, ...detail } : { ...detail };
}

export function getAuditDetail(req: Request): AuditDetail | undefined {
  return (req as WithAudit)[KEY];
}
