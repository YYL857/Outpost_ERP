import type { NextFunction, Request, Response } from "express";
import { getActiveShop, loadRegistry } from "../shops/registry.js";
import { requestContext } from "./context.js";
import {
  getSessionCookieName,
  loadSession,
  readSessionToken,
  sessionWasReplaced,
  touchSessionActivity,
} from "./sessions.js";
import { findUserById, toAuthUser } from "./users.js";
import { loadUserPrefs } from "./workspace.js";
import type { AuthUser } from "./types.js";

export type AuthedRequest = Request & { user?: AuthUser; shopId?: string };

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
]);

function requestPath(req: Request) {
  return (req.originalUrl || req.url || "").split("?")[0] || req.path;
}

function isPublic(path: string) {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path === "/api/ready") return true;
  if (path === "/api/auth/logout") return true;
  if (path === "/api/noon/webhook") return true;
  return false;
}

/** 本机 loopback，或办公室私网（扩展走局域网 IP 时） */
function isTrustedOfficeClient(req: Request): boolean {
  const raw = String(req.ip || req.socket.remoteAddress || "");
  const ip = raw.replace(/^::ffff:/, "");
  if (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.endsWith("127.0.0.1")
  ) {
    return true;
  }
  // RFC1918：同局域网同事扩展访问约仓 API
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  return false;
}

/**
 * 本机/办公室扩展免登录：
 * - 约仓陪伴（warehouse-booking）
 * - Listing 对手 PDP 采集写入（须在路由里带 username，写入对应用户 inbox）
 */
function isLocalExtensionApi(path: string, method: string): boolean {
  if (path.startsWith("/api/warehouse-booking")) return true;
  const m = method.toUpperCase();
  if (m === "POST" && path === "/api/listing/competitor-capture") return true;
  return false;
}

export function createAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = requestPath(req);
    if (isPublic(path)) {
      next();
      return;
    }
    const officeExtOk =
      isLocalExtensionApi(path, req.method || "GET") &&
      isTrustedOfficeClient(req);

    const token = readSessionToken(req);
    if (!token) {
      if (officeExtOk) {
        // 局域网 Listing/约仓扩展：可无会话，由路由用 username 写入对应用户
        next();
        return;
      }
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    const session = loadSession(token);
    if (!session) {
      if (sessionWasReplaced(token)) {
        res.status(401).json({
          error: "账号已在其他设备登录，当前设备已退出",
          code: "SESSION_REPLACED",
        });
        return;
      }
      if (officeExtOk) {
        next();
        return;
      }
      res.status(401).json({ error: "会话已失效，请重新登录", code: "UNAUTHORIZED" });
      return;
    }
    touchSessionActivity(token);
    const record = findUserById(session.userId);
    if (!record) {
      if (officeExtOk) {
        next();
        return;
      }
      res.status(401).json({ error: "用户不存在", code: "UNAUTHORIZED" });
      return;
    }
    if (record.disabled) {
      res.status(401).json({ error: "账号已停用", code: "UNAUTHORIZED" });
      return;
    }

    const user = toAuthUser(record);
    const prefs = loadUserPrefs(user.id);
    const registry = loadRegistry();
    let shopId = prefs.selectedShopId;
    if (!registry.shops.some((s) => s.id === shopId)) {
      shopId = getActiveShop(registry).id;
    }

    (req as AuthedRequest).user = user;
    (req as AuthedRequest).shopId = shopId;

    requestContext.run({ user, shopId }, () => next());
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthedRequest).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "需要超级管理员权限", code: "FORBIDDEN" });
    return;
  }
  next();
}

/** 采购管理：超管或采购 */
export function requirePurchaseAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = (req as AuthedRequest).user;
  if (!user || (user.role !== "admin" && user.role !== "purchase")) {
    res.status(403).json({ error: "需要超管或采购权限", code: "FORBIDDEN" });
    return;
  }
  next();
}

export function requireAssigner(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = (req as AuthedRequest).user;
  if (!user || (user.role !== "admin" && user.role !== "ops_lead")) {
    res.status(403).json({ error: "仅超管或运营主管可分配任务", code: "FORBIDDEN" });
    return;
  }
  next();
}

export { requireCapability } from "./permissions.js";

export function getCookieHint() {
  return getSessionCookieName();
}
