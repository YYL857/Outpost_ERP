import { Router } from "express";
import type { AuthedRequest } from "./middleware.js";
import { requireAdmin } from "./middleware.js";
import { verifyPassword } from "./password.js";
import {
  clearSessionCookieHeader,
  createSession,
  destroySession,
  destroySessionsForUser,
  loadSession,
  readSessionToken,
  replaceSessionsForUser,
  sessionCookieHeader,
  listUserPresence,
} from "./sessions.js";
import {
  createUser,
  deleteUser,
  findUserById,
  findUserByUsername,
  isUserRole,
  listUsersPublic,
  publicUser,
  resetUserPassword,
  setUserDisabled,
  toAuthUser,
  updateUserRole,
} from "./users.js";
import { ensureUserWorkspace, loadUserPrefs } from "./workspace.js";
import { getActiveShop, loadRegistry } from "../shops/registry.js";
import { appendAudit } from "../modules/audit/append.js";
import { setAuditDetail } from "../modules/audit/detail.js";

export function createAuthRouter() {
  const router = Router();

  router.post("/login", (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!username || !password) {
      res.status(400).json({ error: "请输入用户名和密码" });
      return;
    }
    const record = findUserByUsername(username);
    if (!record || !verifyPassword(password, record.passwordHash)) {
      try {
        appendAudit({
          actor: { id: "", username: username || "(empty)", role: "" },
          shopId: null,
          module: "auth",
          action: "login",
          method: "POST",
          path: "/api/auth/login",
          statusCode: 401,
          result: "denied",
          summary: `登录失败：${username || "(空用户名)"}`,
        });
      } catch {
        /* ignore audit errors */
      }
      res.status(401).json({ error: "用户名或密码错误" });
      return;
    }
    if (record.disabled) {
      try {
        appendAudit({
          actor: {
            id: record.id,
            username: record.username,
            role: record.role,
          },
          shopId: null,
          module: "auth",
          action: "login",
          method: "POST",
          path: "/api/auth/login",
          statusCode: 403,
          result: "denied",
          summary: `登录拒绝（已停用）：${record.username}`,
        });
      } catch {
        /* ignore */
      }
      res.status(403).json({ error: "账号已停用，请联系超级管理员" });
      return;
    }
    ensureUserWorkspace(record.id);
    replaceSessionsForUser(record.id);
    const session = createSession(record.id);
    const prefs = loadUserPrefs(record.id);
    const registry = loadRegistry();
    const shop =
      registry.shops.find((s) => s.id === prefs.selectedShopId) ??
      getActiveShop(registry);

    try {
      appendAudit({
        actor: {
          id: record.id,
          username: record.username,
          role: record.role,
        },
        shopId: shop.id,
        module: "auth",
        action: "login",
        method: "POST",
        path: "/api/auth/login",
        statusCode: 200,
        summary: `登录成功：${record.username}`,
        entityType: "user",
        entityId: record.id,
      });
    } catch {
      /* ignore */
    }

    res.setHeader("Set-Cookie", sessionCookieHeader(session.token));
    res.json({
      data: {
        user: toAuthUser(record),
        selectedShopId: shop.id,
        token: session.token,
      },
      message: `欢迎，${record.username}`,
    });
  });

  router.post("/logout", (req, res) => {
    const token = readSessionToken(req);
    let actor: { id: string; username: string; role: string } | null = null;
    if (token) {
      const session = loadSession(token);
      if (session) {
        const record = findUserById(session.userId);
        if (record) {
          actor = {
            id: record.id,
            username: record.username,
            role: record.role,
          };
        }
      }
      destroySession(token);
    }
    if (actor) {
      try {
        appendAudit({
          actor,
          shopId: null,
          module: "auth",
          action: "logout",
          method: "POST",
          path: "/api/auth/logout",
          statusCode: 200,
          summary: `退出登录：${actor.username}`,
          entityType: "user",
          entityId: actor.id,
        });
      } catch {
        /* ignore */
      }
    }
    res.setHeader("Set-Cookie", clearSessionCookieHeader());
    res.json({ data: { ok: true } });
  });

  router.get("/me", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    const prefs = loadUserPrefs(user.id);
    res.json({
      data: {
        user,
        selectedShopId: prefs.selectedShopId,
      },
    });
  });

  router.get("/users", requireAdmin, (_req, res) => {
    const presence = listUserPresence();
    const data = listUsersPublic().map((u) => {
      const p = presence.get(u.id);
      return {
        ...u,
        online: Boolean(p?.online),
        lastSeenAt: p?.lastSeenAt ?? null,
      };
    });
    res.json({
      data,
      meta: {
        onlineWindowSec: 300,
        onlineCount: data.filter((u) => u.online).length,
      },
    });
  });

  router.post("/users", requireAdmin, (req, res) => {
    try {
      const username = String(req.body?.username ?? "").trim();
      const password = String(req.body?.password ?? "");
      const roleRaw = String(req.body?.role ?? "ops").trim();
      if (!isUserRole(roleRaw)) {
          res.status(400).json({
            error: "role 仅支持 admin | ops_lead | ops | purchase",
          });
        return;
      }
      const user = createUser({ username, password, role: roleRaw });
      ensureUserWorkspace(user.id);
      setAuditDetail(req, {
        summary: `创建用户 ${user.username}（${user.role}）`,
        entityType: "user",
        entityId: user.id,
        detail: { username: user.username, role: user.role },
      });
      res.json({
        data: publicUser(user),
        message: `已创建用户 ${user.username}`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "创建用户失败",
      });
    }
  });

  router.patch("/users/:id", requireAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).user;
      const id = String(req.params.id ?? "");
      if (req.body?.role != null) {
        const roleRaw = String(req.body.role).trim();
        if (!isUserRole(roleRaw)) {
          res.status(400).json({
            error: "role 仅支持 admin | ops_lead | ops | purchase",
          });
          return;
        }
        const user = updateUserRole(id, roleRaw);
        setAuditDetail(req, {
          summary: `更新用户角色 ${user.username} → ${roleRaw}`,
          entityType: "user",
          entityId: user.id,
          detail: { role: roleRaw },
        });
        res.json({
          data: publicUser(user),
          message: `已更新 ${user.username} 的定位`,
        });
        return;
      }
      if (req.body?.disabled != null) {
        const disabled = Boolean(req.body.disabled);
        if (actor?.id === id && disabled) {
          res.status(400).json({ error: "不能停用当前登录账号" });
          return;
        }
        const user = setUserDisabled(id, disabled);
        if (disabled) destroySessionsForUser(user.id);
        setAuditDetail(req, {
          summary: disabled
            ? `停用用户 ${user.username}`
            : `启用用户 ${user.username}`,
          entityType: "user",
          entityId: user.id,
          detail: { disabled },
        });
        res.json({
          data: publicUser(user),
          message: disabled
            ? `已停用 ${user.username}`
            : `已启用 ${user.username}`,
        });
        return;
      }
      res.status(400).json({ error: "请传入 role 或 disabled" });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "更新用户失败",
      });
    }
  });

  router.delete("/users/:id", requireAdmin, (req, res) => {
    try {
      const actor = (req as AuthedRequest).user;
      const id = String(req.params.id ?? "");
      if (actor?.id === id) {
        res.status(400).json({ error: "不能删除当前登录账号" });
        return;
      }
      const user = deleteUser(id);
      destroySessionsForUser(user.id);
      setAuditDetail(req, {
        summary: `删除用户 ${user.username}`,
        entityType: "user",
        entityId: user.id,
        detail: { username: user.username, role: user.role },
      });
      res.json({
        data: publicUser(user),
        message: `已删除 ${user.username}`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "删除用户失败",
      });
    }
  });

  router.post("/users/:id/reset-password", requireAdmin, (req, res) => {
    try {
      const password = String(req.body?.password ?? "");
      const user = resetUserPassword(req.params.id, password);
      destroySessionsForUser(user.id);
      setAuditDetail(req, {
        summary: `重置密码：${user.username}`,
        entityType: "user",
        entityId: user.id,
      });
      res.json({
        data: publicUser(user),
        message: `已重置 ${user.username} 的密码（旧会话已失效）`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "重置密码失败",
      });
    }
  });

  return router;
}
