/**
 * conversation-store 隔离单测
 * npx tsx src/modules/agent-hub/conversation-store.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OUTPOST_ROOT } from "../../shops/registry.js";
import {
  appendConversationTurn,
  assertTenantId,
  clearConversation,
  conversationFilePath,
  loadConversation,
} from "./conversation-store.js";

const uidA = "user-test-isola";
const uidB = "user-test-isolb";
const shop1 = "PRJ396770";
const shop2 = "PRJ482387";

for (const uid of [uidA, uidB]) {
  const root = join(OUTPOST_ROOT, "users", uid, "agent-hub");
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

assert.throws(() => assertTenantId("userId", "../etc"), /非法/);
assert.throws(() => assertTenantId("shopId", "a/b"), /非法/);
assert.equal(assertTenantId("shopId", "PRJ396770"), "PRJ396770");

const pathA1 = conversationFilePath(uidA, shop1);
const pathB1 = conversationFilePath(uidB, shop1);
assert.ok(pathA1.includes(join("users", uidA)));
assert.ok(pathB1.includes(join("users", uidB)));
assert.notEqual(pathA1, pathB1);
assert.notEqual(
  conversationFilePath(uidA, shop1),
  conversationFilePath(uidA, shop2),
);

appendConversationTurn({
  userId: uidA,
  shopId: shop1,
  question: "箱号 2508-01-N1-K 状态？",
  answer: "在途",
  keys: ["boxNo=2508-01-N1-K"],
});

const a1 = loadConversation(uidA, shop1);
assert.equal(a1.userId, uidA);
assert.equal(a1.shopId, shop1);
assert.equal(a1.messages.length, 2);

// 同店另一用户读不到
const b1 = loadConversation(uidB, shop1);
assert.equal(b1.messages.length, 0);

// 同用户另一店隔离
const a2 = loadConversation(uidA, shop2);
assert.equal(a2.messages.length, 0);

clearConversation(uidA, shop1);
assert.equal(loadConversation(uidA, shop1).messages.length, 0);

for (const uid of [uidA, uidB]) {
  const root = join(OUTPOST_ROOT, "users", uid, "agent-hub");
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

console.log("conversation-store.test.ts: ok");
