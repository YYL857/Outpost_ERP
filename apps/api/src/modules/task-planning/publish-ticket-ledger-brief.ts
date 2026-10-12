/**
 * 发布 2026-10-06 票货台账试用任务（每人一条，登录弹窗可见）
 * npx tsx src/modules/task-planning/publish-ticket-ledger-brief.ts
 */
import { loadUsersRegistry } from "../../auth/users.js";
import { createTask, loadTasksRegistry } from "./store.js";

const TITLE = "【今日】试用票货台账：用熟悉的一票核对 SKU";
const BODY = `今日任务汇总（2026-10-06）

【新功能】票货台账
飞书装箱表、产品表、采购表还在（云文档照常填）。系统已把装箱洗成「店铺 → 票 → 箱 → SKU」，方便看每一票货里每个 SKU 发了多少。

【怎么用】
1. 左侧「供应链」点「票货台账」（数据看板顶部也有入口）
2. 先点店铺 N1 / N2 / N3
3. 搜索票号、箱号或 PSKU
4. 点开一票：看箱数、件数、每个 SKU 的分摊头程
5. 「采购参考」= 该 SKU 最近一次采购单价，不是这一票锁定的批次

【请你做】
用你熟悉的一票货对一下：店铺、件数、SKU 是否对。对不上或看不懂，在本任务里回复具体票号。`;

const existing = loadTasksRegistry().tasks.some(
  (t) => t.title === TITLE && t.status !== "cancelled" && t.status !== "done",
);
if (existing) {
  console.log("already published, skip");
  process.exit(0);
}

const users = loadUsersRegistry().users.filter((u) => !u.disabled);
const creator = users.find((u) => u.username === "慧慧") ?? users.find((u) => u.role === "admin");
if (!creator) {
  console.error("no creator");
  process.exit(1);
}

const dueAt = "2026-10-06T15:59:59.000Z";
let n = 0;
for (const u of users) {
  createTask({
    title: TITLE,
    body: BODY,
    priority: "high",
    dueAt,
    createdBy: { id: creator.id, username: creator.username, role: creator.role },
    assignee: { id: u.id, username: u.username, role: u.role },
  });
  n += 1;
}
console.log(`published ${n} tasks as ${creator.username}`);
