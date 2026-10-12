/**
 * conversation-context 单元测试
 * npx tsx src/modules/agent-hub/conversation-context.test.ts
 */
import assert from "node:assert/strict";
import {
  extractBusinessKeys,
  prepareConversationContext,
} from "./conversation-context.js";

assert.ok(
  extractBusinessKeys("箱号 2508-01-N1-K 什么状态").some((k) =>
    k.includes("2508-01-N1-K"),
  ),
);
assert.ok(
  extractBusinessKeys("PSKU ABC12-XY 库存").some((k) =>
    k.includes("ABC12-XY"),
  ),
);
assert.ok(
  extractBusinessKeys("partnerSku=HFY-001").includes("partnerSku=HFY-001"),
);
assert.ok(!extractBusinessKeys("Catalog 概况如何").some((k) => k.startsWith("token")));

const short = prepareConversationContext([
  { role: "user", content: "箱号 2508-01-N1-K 什么状态？" },
  {
    role: "assistant",
    content: "该箱摘要显示在途。",
    keys: ["boxNo=2508-01-N1-K"],
  },
]);
assert.equal(short.meta.compressed, false);
assert.ok(short.meta.keys.some((k) => k.includes("2508-01-N1-K")));
assert.ok(
  short.prefixMessages.some(
    (m) => m.role === "system" && m.content.includes("会话指代"),
  ),
);
assert.ok(short.prefixMessages.some((m) => m.role === "user"));
assert.ok(short.prefixMessages.some((m) => m.role === "assistant"));

const longHistory = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  if (i % 2 === 0) {
    return {
      role: "user" as const,
      content: `第${n}问：箱号 2508-01-N${n}-K 状态？库存还有吗？金额 999`,
    };
  }
  return {
    role: "assistant" as const,
    content: `第${n}答：库存 ${100 + n}，金额 ${999 + n}，状态在途。`,
    keys: [`boxNo=2508-01-N${n}-K`],
  };
});

const long = prepareConversationContext(longHistory, {
  recentTurns: 4,
  compressAfter: 4,
  maxAcceptedTurns: 24,
});
assert.equal(long.meta.compressed, true);
assert.ok(long.meta.compressedTurns > 0);
assert.equal(long.meta.recentTurns, 4);
const summary = long.prefixMessages.find((m) => m.role === "system")?.content ?? "";
assert.ok(summary.includes("较早会话压缩"));
assert.ok(summary.includes("业务键"));
// 压缩摘要不应残留易腐数字事实
assert.ok(!/\b库存\s*\d+/.test(summary));
assert.ok(!summary.includes("金额 999"));
assert.ok(!/第\d+答/.test(summary));

console.log("conversation-context.test.ts: ok");
