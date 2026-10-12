/**
 * npx tsx src/auth/permissions.test.ts
 */
import assert from "node:assert/strict";
import {
  AGENT_TOOL_CAPABILITY,
  canUseOpsInterpret,
  capabilityForOpsSurface,
  hasCapability,
} from "./permissions.js";
import { toolsForAsk } from "../modules/agent-hub/openai-tools.js";

assert.equal(hasCapability("admin", "finance.read"), true);
assert.equal(hasCapability("ops", "finance.read"), false);
assert.equal(hasCapability("ops_lead", "sales.read"), true);
assert.equal(hasCapability("ops", "sales.read"), false);
assert.equal(hasCapability("purchase", "purchase.read"), true);
assert.equal(hasCapability("purchase", "purchase.write"), true);
assert.equal(hasCapability("ops", "purchase.read"), false);
assert.equal(hasCapability("ops", "purchase.write"), false);
assert.equal(hasCapability("ops_lead", "purchase.write"), false);
assert.equal(hasCapability("ops", "catalog.cost"), false);
assert.equal(hasCapability("ops", "catalog.bulk"), false);
assert.equal(hasCapability("ops", "dashboard.read"), true);
assert.equal(hasCapability("ops", "replenish.read"), true);

assert.equal(capabilityForOpsSurface("finance"), "finance.read");
assert.equal(capabilityForOpsSurface("sales"), "sales.read");
assert.equal(canUseOpsInterpret("ops"), true);
assert.equal(canUseOpsInterpret("purchase"), true);

const opsTools = toolsForAsk({ role: "ops", allowMutate: false });
assert.ok(!opsTools.some((t) => t.id === "finance.query"));
assert.ok(!opsTools.some((t) => t.id === "sales.query"));
assert.ok(!opsTools.some((t) => t.id === "purchase.list"));
assert.ok(!opsTools.some((t) => t.id === "catalog.query"));
assert.ok(opsTools.some((t) => t.id === "dashboard.overview"));
assert.ok(opsTools.some((t) => t.id === "replenish.query"));
assert.ok(opsTools.some((t) => t.id === "shipping.board"));
assert.ok(opsTools.some((t) => t.id === "ops.interpret"));

const purchaseTools = toolsForAsk({ role: "purchase", allowMutate: false });
assert.ok(purchaseTools.some((t) => t.id === "purchase.list"));
assert.ok(!purchaseTools.some((t) => t.id === "finance.query"));
assert.ok(!purchaseTools.some((t) => t.id === "sales.query"));

const adminTools = toolsForAsk({ role: "admin", allowMutate: true });
assert.ok(adminTools.some((t) => t.id === "finance.query"));
assert.ok(adminTools.some((t) => t.id === "wiki.rebuild"));
assert.equal(AGENT_TOOL_CAPABILITY["finance.query"], "finance.read");

console.log("[permissions] smoke ok");
