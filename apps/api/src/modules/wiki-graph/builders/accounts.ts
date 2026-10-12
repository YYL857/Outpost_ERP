/**
 * 账目·产品采购 → orderId / trackingNo / PSKU 实例索引（摘要级，非全文）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Database } from "sql.js";
import { getFeishuRawDir } from "../../../platforms/feishu/config.js";
import {
  edgeId,
  nodeId,
  purgeSourceTypes,
  upsertEdge,
  upsertLookup,
  upsertNode,
  upsertNodeKeepIfExists,
} from "../upsert.js";
import { cellText, headerIndexMap, isValidPartnerSku, parseNumber, pickCol } from "../../../platforms/feishu/normalize/cells.js";

export const ACCOUNTS_SOURCE = "feishu:accounts";


function rawDirCandidates(): string[] {
  const primary = getFeishuRawDir();
  const shared = resolve(
    process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
    "feishu-raw",
  );
  const fromShop = resolve(primary, "..", "..", "..", "feishu-raw");
  return [...new Set([primary, shared, fromShop])];
}

function latestAccountsSnapshotPath(): string | null {
  for (const dir of rawDirCandidates()) {
    const lastPath = join(dir, "last-run.json");
    if (existsSync(lastPath)) {
      try {
        const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
          runId?: string;
        };
        if (last.runId) {
          const path = join(
            dir,
            "runs",
            last.runId,
            "accounts",
            "snapshot.json",
          );
          if (existsSync(path)) return path;
        }
      } catch {
        /* next */
      }
    }
    const runsDir = join(dir, "runs");
    if (!existsSync(runsDir)) continue;
    try {
      const runs = readdirSync(runsDir)
        .map((name) => {
          const path = join(runsDir, name, "accounts", "snapshot.json");
          if (!existsSync(path)) return null;
          return { path, mtime: statSync(path).mtimeMs };
        })
        .filter(Boolean) as Array<{ path: string; mtime: number }>;
      runs.sort((a, b) => b.mtime - a.mtime);
      if (runs[0]) return runs[0].path;
    } catch {
      /* next */
    }
  }
  return null;
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

export type AccountsBuildResult = {
  snapshotPath: string | null;
  nodes: number;
  edges: number;
  lookups: number;
};

export function buildAccountsPurchaseIntoDb(db: Database): AccountsBuildResult {
  const now = new Date().toISOString();
  const snapshotPath = latestAccountsSnapshotPath();
  // 不删共享 sku：只清采购订单/快递/本表 sheet
  purgeSourceTypes(db, ACCOUNTS_SOURCE, [
    "purchase_order",
    "tracking",
    "doc_sheet",
  ]);

  if (!snapshotPath) {
    return { snapshotPath: null, nodes: 0, edges: 0, lookups: 0 };
  }

  const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    sheets?: Array<{ title?: string; values?: unknown[][] }>;
  };
  const sheet = snap.sheets?.find(
    (s) => s.title === "产品采购" || (s.title ?? "").includes("采购"),
  );
  const values = sheet?.values ?? [];
  if (values.length < 2) {
    return { snapshotPath, nodes: 0, edges: 0, lookups: 0 };
  }

  const headers = headerIndexMap(values[0] ?? []);
  let nodes = 0;
  let edges = 0;
  let lookups = 0;

  const sheetId = nodeId("doc_sheet", "accounts/产品采购");
  upsertNode(db, {
    id: sheetId,
    type: "doc_sheet",
    label: "账目·产品采购",
    summary: `飞书产品采购 · 源 ${snapshotPath}`,
    source: ACCOUNTS_SOURCE,
    sourceRef: snapshotPath,
    shopId: null,
    payload: { sheet: "产品采购" },
    updatedAt: now,
  });
  nodes += 1;

  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const partnerSku = cellText(
      pickCol(row, headers, ["PSKU", "psku", "Partner SKU", "SKU"]),
    );
    if (!partnerSku || !isValidPartnerSku(partnerSku)) continue;

    const orderId = cellText(
      pickCol(row, headers, ["订单号", "1688订单号", "Order ID", "orderId"]),
    ).replace(/\s+/g, "");
    const trackingNo = cellText(
      pickCol(row, headers, ["快递单号", "物流单号", "运单号", "Tracking"]),
    ).replace(/\s+/g, "");
    const name = cellText(pickCol(row, headers, ["名称", "产品名称", "品名"]));
    const qty =
      parseNumber(pickCol(row, headers, ["数量", "采购数量", "件数"])) ?? 0;
    const unitCost =
      parseNumber(pickCol(row, headers, ["采购单价", "单价"])) ?? 0;
    const transitStatus = cellText(
      pickCol(row, headers, ["在途状态", "状态"]),
    );

    const sid = nodeId("sku", partnerSku);
    upsertNodeKeepIfExists(db, {
      id: sid,
      type: "sku",
      label: partnerSku,
      summary: clip(
        [partnerSku, name || null, qty ? `×${qty}` : null, orderId ? `订${orderId}` : null]
          .filter(Boolean)
          .join(" · "),
        120,
      ),
      source: ACCOUNTS_SOURCE,
      sourceRef: snapshotPath,
      shopId: null,
      payload: {
        partnerSku,
        name,
        qty,
        unitCost,
        orderId,
        trackingNo,
        transitStatus,
        fromPurchase: true,
      },
      updatedAt: now,
    });
    nodes += 1;
    upsertLookup(db, "partnerSku", partnerSku, sid);
    lookups += 1;

    if (orderId) {
      const oid = nodeId("purchase_order", orderId);
      upsertNode(db, {
        id: oid,
        type: "purchase_order",
        label: orderId,
        summary: clip(`采购订单 ${orderId} · ${partnerSku}`, 120),
        source: ACCOUNTS_SOURCE,
        sourceRef: snapshotPath,
        shopId: null,
        payload: { orderId, partnerSku, trackingNo },
        updatedAt: now,
      });
      nodes += 1;
      upsertLookup(db, "orderId", orderId, oid);
      lookups += 1;
      upsertEdge(db, {
        id: edgeId(sid, "ordered_as", oid),
        fromId: sid,
        toId: oid,
        rel: "ordered_as",
        evidence: qty ? `qty=${qty}` : null,
        updatedAt: now,
      });
      edges += 1;
    }

    if (trackingNo) {
      const tid = nodeId("tracking", trackingNo);
      upsertNode(db, {
        id: tid,
        type: "tracking",
        label: trackingNo,
        summary: clip(`快递 ${trackingNo} · ${partnerSku}`, 120),
        source: ACCOUNTS_SOURCE,
        sourceRef: snapshotPath,
        shopId: null,
        payload: { trackingNo, partnerSku, orderId },
        updatedAt: now,
      });
      nodes += 1;
      upsertLookup(db, "trackingNo", trackingNo, tid);
      lookups += 1;
      upsertEdge(db, {
        id: edgeId(sid, "tracked_by", tid),
        fromId: sid,
        toId: tid,
        rel: "tracked_by",
        evidence: "purchase_express",
        updatedAt: now,
      });
      edges += 1;
    }
  }

  return { snapshotPath, nodes, edges, lookups };
}
