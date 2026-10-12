/**
 * npx tsx src/modules/audit/append.test.ts
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit } from "./append.js";
import { listAuditEvents, readDailySummary } from "./query.js";
import { parseModuleAction } from "./middleware.js";
import { sanitizeBody } from "./sanitize.js";
import { eventsFileForDay, dailyFileForDay } from "./paths.js";
import { shanghaiDay } from "./day.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "outpost-audit-"));
process.env.OUTPOST_AUDIT_DIR = dir;

{
  const scrubbed = sanitizeBody({
    username: "alice",
    password: "secret",
    token: "abc",
    qty: 3,
  });
  assert(scrubbed?.password === "[redacted]", "password redacted");
  assert(scrubbed?.token === "[redacted]", "token redacted");
  assert(scrubbed?.qty === 3, "qty kept");
}

{
  const a = parseModuleAction("/api/purchase/arrival-confirm", "POST");
  assert(a.module === "purchase", "module purchase");
  assert(a.action === "arrival-confirm", "action arrival-confirm");
  const b = parseModuleAction("/api/auth/users/abc-def-12345678", "PATCH");
  assert(b.module === "auth", "module auth");
  assert(b.action === "users.:id", `action users.:id got ${b.action}`);
  const c = parseModuleAction("/api/purchase/ledger/rows", "POST");
  assert(c.module === "purchase", "ledger module");
  assert(c.action === "ledger.rows", `ledger action got ${c.action}`);
}

{
  const day = shanghaiDay();
  const ev = appendAudit({
    actor: { id: "u1", username: "purchase_zhang", role: "purchase" },
    shopId: "PRJ396770",
    module: "purchase",
    action: "arrival-confirm",
    method: "POST",
    path: "/api/purchase/arrival-confirm",
    statusCode: 200,
    summary: "到齐 黄色胶带 80/80，已清出待处理",
    entityType: "purchaseArrivalReceipt",
    entityId: "o:123|SKU1",
    detail: { cleared: true, receivedQty: 80 },
  });
  assert(ev.day === day, "day matches");
  assert(existsEvents(day), "events file exists");

  const listed = listAuditEvents({ day, module: "purchase" });
  assert(listed.total === 1, "one event");
  assert(
    listed.events[0]?.summary.includes("到齐"),
    "summary readable",
  );

  const daily = readDailySummary(day);
  assert(daily.totalEvents === 1, "daily total 1");
  assert(daily.byModule.purchase === 1, "byModule purchase");
  assert(daily.byActor.purchase_zhang === 1, "byActor");
  assert(daily.ok === 1, "ok count");

  appendAudit({
    actor: { id: "u1", username: "purchase_zhang", role: "purchase" },
    shopId: "PRJ396770",
    module: "purchase",
    action: "arrival-confirm",
    method: "POST",
    path: "/api/purchase/arrival-confirm",
    statusCode: 200,
    summary: "确认到货 SKU2 → 30/50",
  });
  const daily2 = readDailySummary(day);
  assert(daily2.totalEvents === 2, "daily total 2");
}

function existsEvents(day: string) {
  try {
    readFileSync(eventsFileForDay(day), "utf8");
    readFileSync(dailyFileForDay(day), "utf8");
    return true;
  } catch {
    return false;
  }
}

rmSync(dir, { recursive: true, force: true });
console.log("audit.append.test.ts OK");
