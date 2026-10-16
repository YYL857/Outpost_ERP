import type { NextFunction, Request, Response } from "express";
import type { AuthedRequest } from "../../auth/middleware.js";
import { appendAudit } from "./append.js";
import { getAuditDetail } from "./detail.js";
import { sanitizeBody } from "./sanitize.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SKIP_PREFIXES = [
  "/api/health",
  "/api/ready",
  "/api/audit",
  "/api/noon/webhook",
];

function requestPath(req: Request) {
  return (req.originalUrl || req.url || "").split("?")[0] || req.path;
}

function shouldSkip(path: string) {
  return SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** /api/purchase/arrival-confirm → { module: purchase, action: arrival-confirm } */
export function parseModuleAction(path: string, method: string) {
  const parts = path.split("/").filter(Boolean);
  // ["api", "purchase", "arrival-confirm"] or ["api", "auth", "users", ":id"]
  if (parts[0] !== "api" || !parts[1]) {
    return { module: "unknown", action: method.toLowerCase() };
  }
  const module = parts[1];
  const rest = parts.slice(2).filter((p) => !p.startsWith(":"));
  // 把动态段（纯数字 / uuid 样）压成 :id，避免 action 爆炸
  const normalized = rest.map((p) =>
    /^[0-9a-f-]{8,}$/i.test(p) || /^\d+$/.test(p) ? ":id" : p,
  );
  const action =
    normalized.length > 0
      ? normalized.join(".")
      : method.toLowerCase();
  return { module, action };
}

function defaultSummary(
  method: string,
  path: string,
  statusCode: number,
  extra?: string,
) {
  const base = `${method} ${path} → ${statusCode}`;
  return extra ? `${extra}（${base}）` : base;
}

/**
 * 全局人工写操作审计：凡已登录用户发起的 POST/PUT/PATCH/DELETE，
 * 在响应结束后落盘（含失败，便于追责）。
 * 登录等公开路径需路由内显式 appendAudit。
 */
export function createAuditMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING.has(req.method)) {
      next();
      return;
    }
    const path = requestPath(req);
    if (shouldSkip(path)) {
      next();
      return;
    }

    const bodySnap = sanitizeBody(req.body);

    res.on("finish", () => {
      try {
        const authed = req as AuthedRequest;
        const detail = getAuditDetail(req);
        let actor = detail?.actor ??
          (authed.user
            ? {
                id: authed.user.id,
                username: authed.user.username,
                role: authed.user.role,
              }
            : null);
        // 约仓扩展免登录：仍须落审计，否则无法追溯 ASN 改写
        if (!actor?.id && !actor?.username && path.startsWith("/api/warehouse-booking")) {
          actor = {
            id: "office-ext",
            username: "约仓扩展",
            role: "extension",
          };
        }
        if (!actor?.id && !actor?.username) return;

        const { module, action } = parseModuleAction(path, req.method);
        const body =
          detail && "body" in detail
            ? detail.body === null
              ? undefined
              : sanitizeBody(detail.body)
            : bodySnap;
        appendAudit({
          actor,
          shopId: authed.shopId ?? null,
          module,
          action,
          method: req.method,
          path,
          statusCode: res.statusCode,
          summary: defaultSummary(
            req.method,
            path,
            res.statusCode,
            detail?.summary,
          ),
          entityType: detail?.entityType,
          entityId: detail?.entityId,
          body,
          detail: detail?.detail,
        });
      } catch (e) {
        console.error("[audit] append failed:", e);
      }
    });

    next();
  };
}
