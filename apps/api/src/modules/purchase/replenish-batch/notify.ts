/**
 * 采购批次导入后通知发货人阿沈（任务收件箱，仅创建一条，不轮询骚扰）。
 */
import { findUserByUsername } from "../../../auth/users.js";
import type { AuthUser } from "../../../auth/types.js";
import { createTask } from "../../task-planning/store.js";
import type { ReplenishBatchRecord } from "./store.js";

export const SHIPPER_USERNAME = "阿沈";

export function notifyShipperOfReplenishBatch(
  batch: ReplenishBatchRecord,
  createdBy: AuthUser,
): { taskId: string | null; message: string } {
  const shipper = findUserByUsername(SHIPPER_USERNAME);
  if (!shipper || shipper.disabled) {
    return {
      taskId: null,
      message: `未找到用户「${SHIPPER_USERNAME}」，批次已保存但未发任务通知`,
    };
  }

  const shopLines = batch.byShop
    .map(
      (s) =>
        `· ${s.shop} ${s.shopName}：${s.skuCount} 个 SKU / ${s.totalQty} 件`,
    )
    .join("\n");

  const sample = batch.byShop
    .flatMap((s) =>
      s.lines.slice(0, 3).map(
        (l) =>
          `  - [${s.shop}] ${l.partnerSku} ${l.name || ""} ${l.spec ? `规格:${l.spec}` : ""} ×${l.qty}（${l.modePref}）`,
      ),
    )
    .slice(0, 12)
    .join("\n");

  const title = `【采购到货】批次 ${batch.batchDate} · ${batch.lineCount} 行待关注`;
  const body = `采购「${createdBy.username}」已导入一批已下单货物，请在物流管理查看归类明细并规划发货。

批次：${batch.batchDate}
合计：${batch.lineCount} 行 / ${batch.totalQty} 件
按店：
${shopLines || "（无）"}

明细摘录：
${sample || "（无）"}

【怎么看】
1. 点「知道了」关闭提醒（不会反复弹）
2. 打开左侧「供应链 → 物流管理」
3. 顶部「发货搭配」→「近期采购到货」查看本批按店汇总

任务 id 关联批次：${batch.id}`;

  const task = createTask({
    title,
    body,
    priority: "normal",
    dueAt: null,
    createdBy,
    assignee: {
      id: shipper.id,
      username: shipper.username,
      role: shipper.role,
    },
  });

  return {
    taskId: task.id,
    message: `已通知 ${shipper.username}（任务收件箱）`,
  };
}
