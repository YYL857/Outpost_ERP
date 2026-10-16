import { existsSync } from "node:fs";
import { Router } from "express";
import type { AuthedRequest } from "../../auth/middleware.js";
import { requireAssigner } from "../../auth/middleware.js";
import {
  addAttachmentToTask,
  assertCanAssign,
  findAttachment,
  listAssignableUsers,
  resolveAssignee,
  attachmentAbsPath,
} from "./access.js";
import { buildInbox, dismissRejectInbox, dismissReviewInbox } from "./inbox.js";
import {
  ackTask,
  cancelTask,
  canViewTask,
  createTask,
  findTask,
  listTasksForUser,
  reviewTask,
  submitTask,
} from "./store.js";
import type { TaskPriority } from "./types.js";

function asStr(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function parsePriority(v: unknown): TaskPriority {
  if (v === "high" || v === "urgent" || v === "normal") return v;
  return "normal";
}

export function createTaskPlanningRouter() {
  const router = Router();

  router.get("/", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    res.json({ data: listTasksForUser(user) });
  });

  router.get("/assignees", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    try {
      assertCanAssign(user);
    } catch (e) {
      res.status(403).json({
        error: e instanceof Error ? e.message : "无权分配",
        code: "FORBIDDEN",
      });
      return;
    }
    const showAll = String(req.query.showAll ?? "") === "1";
    res.json({ data: listAssignableUsers(user, showAll) });
  });

  router.get("/inbox", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    const items = buildInbox(user);
    res.json({ data: { items, count: items.length } });
  });

  router.post("/", requireAssigner, (req, res) => {
    const user = (req as AuthedRequest).user!;
    try {
      const title = asStr(req.body?.title);
      if (!title) {
        res.status(400).json({ error: "标题必填" });
        return;
      }
      const body = asStr(req.body?.body);
      const assigneeId = asStr(req.body?.assigneeId);
      if (!assigneeId) {
        res.status(400).json({ error: "请选择指派对象" });
        return;
      }
      const assignee = resolveAssignee(user, assigneeId);
      const dueRaw = asStr(req.body?.dueAt);
      const dueAt = dueRaw ? new Date(dueRaw).toISOString() : null;
      if (dueRaw && Number.isNaN(Date.parse(dueRaw))) {
        res.status(400).json({ error: "截止日期无效" });
        return;
      }
      const task = createTask({
        title,
        body,
        priority: parsePriority(req.body?.priority),
        dueAt,
        createdBy: user,
        assignee,
      });
      res.json({
        data: task,
        message: `已通知 ${assignee.username}`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "创建任务失败",
      });
    }
  });

  router.get("/:id", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    const task = findTask(String(req.params.id));
    if (!task || !canViewTask(task, user)) {
      res.status(404).json({ error: "任务不存在" });
      return;
    }
    res.json({ data: task });
  });

  router.post("/:id/attachments", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    try {
      const task = findTask(String(req.params.id));
      if (!task) {
        res.status(404).json({ error: "任务不存在" });
        return;
      }
      const kind =
        asStr(req.body?.kind) === "submit" ? "submit" : "publish";
      const result = addAttachmentToTask(task, user, {
        filename: asStr(req.body?.filename) || "file.bin",
        mimeType: asStr(req.body?.mimeType) || "application/octet-stream",
        base64: asStr(req.body?.base64),
        kind,
      });
      res.json({ data: result.task, attachment: result.attachment });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "上传失败",
      });
    }
  });

  router.get("/:id/attachments/:aid/file", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    const task = findTask(String(req.params.id));
    if (!task || !canViewTask(task, user)) {
      res.status(404).json({ error: "任务不存在" });
      return;
    }
    const att = findAttachment(task, String(req.params.aid));
    if (!att) {
      res.status(404).json({ error: "附件不存在" });
      return;
    }
    const abs = attachmentAbsPath(att);
    if (!existsSync(abs)) {
      res.status(404).json({ error: "文件缺失" });
      return;
    }
    res.setHeader("Content-Type", att.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
    );
    res.sendFile(abs);
  });

  router.post("/:id/ack", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    try {
      const task = findTask(String(req.params.id));
      if (!task) {
        res.status(404).json({ error: "任务不存在" });
        return;
      }
      if (task.assignee.id !== user.id) {
        res.status(403).json({ error: "仅被指派人可确认收到" });
        return;
      }
      const next = ackTask(task, user);
      res.json({ data: next, message: "已确认，开始处理" });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "确认失败",
      });
    }
  });

  router.post("/:id/submit", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    try {
      const task = findTask(String(req.params.id));
      if (!task) {
        res.status(404).json({ error: "任务不存在" });
        return;
      }
      if (task.assignee.id !== user.id) {
        res.status(403).json({ error: "仅被指派人可提交" });
        return;
      }
      const next = submitTask(task, user, asStr(req.body?.body));
      res.json({
        data: next,
        message: `已提交，等待 ${task.createdBy.username} 验收`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "提交失败",
      });
    }
  });

  router.post("/:id/review", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    try {
      const task = findTask(String(req.params.id));
      if (!task) {
        res.status(404).json({ error: "任务不存在" });
        return;
      }
      if (task.createdBy.id !== user.id) {
        res.status(403).json({ error: "仅创建者可验收" });
        return;
      }
      const decision =
        asStr(req.body?.decision) === "reject" ? "reject" : "approve";
      const next = reviewTask(
        task,
        user,
        decision,
        asStr(req.body?.comment),
      );
      res.json({
        data: next,
        message: decision === "approve" ? "已通过验收" : "已退回",
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "验收失败",
      });
    }
  });

  router.post("/:id/cancel", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    try {
      const task = findTask(String(req.params.id));
      if (!task) {
        res.status(404).json({ error: "任务不存在" });
        return;
      }
      if (task.createdBy.id !== user.id) {
        res.status(403).json({ error: "仅创建者可取消" });
        return;
      }
      const next = cancelTask(task, user);
      res.json({ data: next, message: "已取消任务" });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "取消失败",
      });
    }
  });

  router.post("/:id/dismiss-reject", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    const task = findTask(String(req.params.id));
    if (!task || !canViewTask(task, user)) {
      res.status(404).json({ error: "任务不存在" });
      return;
    }
    const next = dismissRejectInbox(task, user);
    res.json({ data: next });
  });

  router.post("/:id/dismiss-review", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录", code: "UNAUTHORIZED" });
      return;
    }
    const task = findTask(String(req.params.id));
    if (!task || !canViewTask(task, user)) {
      res.status(404).json({ error: "任务不存在" });
      return;
    }
    if (task.createdBy.id !== user.id) {
      res.status(403).json({ error: "仅创建者可关闭验收提醒" });
      return;
    }
    const next = dismissReviewInbox(task, user);
    res.json({ data: next });
  });

  return router;
}
