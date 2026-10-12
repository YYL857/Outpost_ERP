/**
 * Offline flow check for task-planning store (no HTTP).
 * Run: pnpm --filter @outpost/api exec tsx ../../scripts/task-flow-check.ts
 * or from apps/api: npx tsx ../../scripts/task-flow-check.ts
 */
import {
  ackTask,
  cancelTask,
  canViewTask,
  createTask,
  listTasksForUser,
  reviewTask,
  submitTask,
} from "../apps/api/src/modules/task-planning/store.js";
import {
  assertCanAssign,
  listAssignableUsers,
  resolveAssignee,
} from "../apps/api/src/modules/task-planning/access.js";
import { buildInbox } from "../apps/api/src/modules/task-planning/inbox.js";
import type { AuthUser } from "../apps/api/src/auth/types.js";
import { loadUsersRegistry } from "../apps/api/src/auth/users.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const users = loadUsersRegistry().users;
const admin = users.find((u) => u.role === "admin" && !u.disabled);
const lead = users.find((u) => u.role === "ops_lead" && !u.disabled);
const ops = users.find((u) => u.role === "ops" && !u.disabled);

assert(admin && lead && ops, "需要至少一名超管、运营主管、运营账号");

const adminUser: AuthUser = {
  id: admin!.id,
  username: admin!.username,
  role: "admin",
};
const leadUser: AuthUser = {
  id: lead!.id,
  username: lead!.username,
  role: "ops_lead",
};
const opsUser: AuthUser = {
  id: ops!.id,
  username: ops!.username,
  role: "ops",
};

assertCanAssign(adminUser);
assertCanAssign(leadUser);
try {
  assertCanAssign(opsUser);
  throw new Error("运营不应能分配");
} catch (e) {
  assert(e instanceof Error && e.message.includes("超管"), "运营分配应被拒绝");
}

const leadTargets = listAssignableUsers(leadUser, false);
assert(
  leadTargets.every((t) => t.role === "ops"),
  "主管可选对象应全是运营",
);

const assignee = resolveAssignee(leadUser, opsUser.id);
let task = createTask({
  title: `flow-check ${Date.now()}`,
  body: "自动化流程校验",
  priority: "high",
  dueAt: null,
  createdBy: leadUser,
  assignee,
});

assert(task.status === "open", "新建应为 open");
const opsInbox = buildInbox(opsUser);
assert(
  opsInbox.some((i) => i.taskId === task.id && i.type === "new_assignment"),
  "运营收件箱应有新任务",
);

task = ackTask(task, opsUser);
assert(task.status === "in_progress", "确认后应为 in_progress");

task.draftSubmitAttachments = [];
task = submitTask(task, opsUser, "已完成截图说明");
assert(task.status === "submitted", "提交后应为 submitted");

const leadInbox = buildInbox(leadUser);
assert(
  leadInbox.some((i) => i.taskId === task.id && i.type === "pending_review"),
  "主管收件箱应有待验收",
);

task = reviewTask(task, leadUser, "reject", "请补充数据");
assert(task.status === "rejected", "退回后应为 rejected");

task = submitTask(task, opsUser, "已补充");
task = reviewTask(task, leadUser, "approve", "OK");
assert(task.status === "done", "通过后应为 done");

assert(canViewTask(task, adminUser), "超管应能看");
assert(canViewTask(task, leadUser), "创建主管应能看自己创建的已完成");
assert(
  listTasksForUser(opsUser).some((t) => t.id === task.id),
  "运营应能看到指派给自己的任务",
);

const adminTask = createTask({
  title: `admin-cancel ${Date.now()}`,
  body: "",
  priority: "normal",
  dueAt: null,
  createdBy: adminUser,
  assignee: {
    id: leadUser.id,
    username: leadUser.username,
    role: leadUser.role,
  },
});
cancelTask(adminTask, adminUser);

console.log("task-flow-check OK");
