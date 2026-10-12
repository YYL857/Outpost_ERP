/**
 * 慧运营 → 影刀：耗材 Sold Recently 采集请求
 *
 * D:\YingDao\Requests\
 *   pending\mi_consumables_{requestId}.json
 *   done\...
 *   failed\...
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_CONSUMABLE_SEARCHES = [
  "garbage bags",
  "trash bags",
  "aluminum foil",
  "cling film",
  "ziplock bags",
  "wet wipes",
  "coffee filters",
  "coffee machine descaler",
  "cotton pads",
  "paper towels",
] as const;

export type ConsumablesScrapeRequest = {
  type: "mi_consumables";
  requestId: string;
  searches: string[];
  topN: number;
  browser: string;
  demo?: boolean;
  requestedAt: string;
  source?: string;
};

export type ConsumablesScrapeRequestStatus = {
  requestId: string;
  status: "pending" | "done" | "failed" | "unknown";
  path: string | null;
  payload: ConsumablesScrapeRequest | null;
  detail: string | null;
  finishedAt: string | null;
};

function requestsRoot() {
  const explicit = process.env.YINGDAO_REQUESTS_DIR?.trim();
  if (explicit) return resolve(explicit);
  const yd = process.env.YINGDAO_ROOT?.trim();
  if (yd) return resolve(join(yd, "Requests"));
  return resolve("D:\\YingDao\\Requests");
}

function ensureRequestDirs() {
  const root = requestsRoot();
  for (const sub of ["pending", "done", "failed"]) {
    const d = join(root, sub);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  return root;
}

function fileName(requestId: string) {
  return `mi_consumables_${requestId}.json`;
}

export function createConsumablesScrapeRequest(input: {
  searches?: string[];
  topN?: number;
  browser?: string;
  demo?: boolean;
  source?: string;
}): ConsumablesScrapeRequest {
  const searches = [
    ...new Set(
      (input.searches?.length
        ? input.searches
        : [...DEFAULT_CONSUMABLE_SEARCHES]
      )
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (!searches.length) throw new Error("searches 不能为空");
  const topN = Math.max(10, Math.min(80, Math.floor(input.topN ?? 50)));
  const requestId = `req-${randomUUID().slice(0, 8)}`;
  const payload: ConsumablesScrapeRequest = {
    type: "mi_consumables",
    requestId,
    searches,
    topN,
    browser: (input.browser || "edge").trim() || "edge",
    demo: Boolean(input.demo),
    requestedAt: new Date().toISOString(),
    source: input.source || "outpost",
  };
  const root = ensureRequestDirs();
  const dest = join(root, "pending", fileName(requestId));
  writeFileSync(dest, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function tryRead(path: string): ConsumablesScrapeRequest | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ConsumablesScrapeRequest;
    if (!raw?.requestId || raw.type !== "mi_consumables") return null;
    return raw;
  } catch {
    return null;
  }
}

export function getConsumablesScrapeRequestStatus(
  requestId: string,
): ConsumablesScrapeRequestStatus {
  const root = ensureRequestDirs();
  const name = fileName(requestId);
  for (const status of ["pending", "done", "failed"] as const) {
    const path = join(root, status, name);
    if (!existsSync(path)) continue;
    const payload = tryRead(path);
    let detail: string | null = null;
    if (status === "failed") {
      const err = join(root, "failed", name.replace(/\.json$/i, ".error.txt"));
      if (existsSync(err)) {
        try {
          detail = readFileSync(err, "utf8").slice(0, 2000);
        } catch {
          /* ignore */
        }
      }
    }
    let finishedAt: string | null = null;
    if (status !== "pending") {
      try {
        finishedAt = new Date(
          (awaitableStatMtime(path)),
        ).toISOString();
      } catch {
        finishedAt = null;
      }
    }
    return { requestId, status, path, payload, detail, finishedAt };
  }
  return {
    requestId,
    status: "unknown",
    path: null,
    payload: null,
    detail: null,
    finishedAt: null,
  };
}

function awaitableStatMtime(path: string): number {
  const { statSync } = require("node:fs") as typeof import("node:fs");
  return statSync(path).mtimeMs;
}

export function listConsumablesScrapeRequests(limit = 20): ConsumablesScrapeRequestStatus[] {
  const root = ensureRequestDirs();
  const out: ConsumablesScrapeRequestStatus[] = [];
  for (const status of ["pending", "done", "failed"] as const) {
    const dir = join(root, status);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/^mi_consumables_.*\.json$/i.test(f)) continue;
      const id = f.replace(/^mi_consumables_/i, "").replace(/\.json$/i, "");
      out.push(getConsumablesScrapeRequestStatus(id));
    }
  }
  out.sort((a, b) =>
    (b.payload?.requestedAt || "").localeCompare(a.payload?.requestedAt || ""),
  );
  return out.slice(0, Math.max(1, limit));
}

export function yingdaoConsumablesRequestsDir() {
  return ensureRequestDirs();
}
