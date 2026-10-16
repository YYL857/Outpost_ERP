import type { AuthUser } from "../../auth/types.js";
import type { TaskInboxItem, TaskRecord } from "./types.js";
import { listTasksForUser, markRejectSeen, markReviewSeen } from "./store.js";

export function buildInbox(user: AuthUser): TaskInboxItem[] {
  const tasks = listTasksForUser(user);
  const items: TaskInboxItem[] = [];

  for (const t of tasks) {
    if (
      t.assignee.id === user.id &&
      t.status === "open" &&
      !t.ackedAt
    ) {
      items.push({
        id: `inbox-assign-${t.id}`,
        taskId: t.id,
        type: "new_assignment",
        title: t.title,
        summary: `来自 ${t.createdBy.username} 的新任务`,
        createdAt: t.createdAt,
      });
    }

    if (
      t.createdBy.id === user.id &&
      t.status === "submitted" &&
      !t.reviewNotifiedAt
    ) {
      items.push({
        id: `inbox-review-${t.id}`,
        taskId: t.id,
        type: "pending_review",
        title: t.title,
        summary: `${t.assignee.username} 已提交，等待验收`,
        createdAt: t.submission?.submittedAt ?? t.updatedAt,
      });
    }

    if (
      t.assignee.id === user.id &&
      t.status === "rejected" &&
      !t.rejectNotifiedAt
    ) {
      items.push({
        id: `inbox-reject-${t.id}`,
        taskId: t.id,
        type: "rejected",
        title: t.title,
        summary: t.review?.comment
          ? `已退回：${t.review.comment}`
          : "任务已退回，请修改后重新提交",
        createdAt: t.review?.reviewedAt ?? t.updatedAt,
      });
    }
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items;
}

export function dismissRejectInbox(task: TaskRecord, user: AuthUser) {
  if (task.assignee.id !== user.id) return task;
  if (task.status !== "rejected" || task.rejectNotifiedAt) return task;
  return markRejectSeen(task);
}

export function dismissReviewInbox(task: TaskRecord, user: AuthUser) {
  if (task.createdBy.id !== user.id) return task;
  if (task.status !== "submitted" || task.reviewNotifiedAt) return task;
  return markReviewSeen(task);
}
