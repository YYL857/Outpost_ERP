/**
 * guardrails 单元自检：tsx src/modules/listing/guardrails.test.ts
 */
import {
  enforceGtinFromUser,
  runContentGuardrails,
} from "./guardrails.js";
import { emptyNoonContent } from "./types.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const c = emptyNoonContent();
  c.titleEn = "Test Band";
  c.titleAr = "اختبار";
  c.featureBulletsEn = ["a", "b", "c"];
  c.featureBulletsAr = ["ا", "ب", "ج"];
  c.gtin = "123";
  const g = runContentGuardrails(c, { gtinFromUser: "" });
  assert(!g.ok, "invented gtin should block");
  assert(
    g.blockers.some((x) => x.includes("GTIN")),
    "gtin blocker present",
  );
}

{
  const c = emptyNoonContent();
  c.titleEn = "Miracle cure device";
  c.titleAr = "جهاز";
  c.featureBulletsEn = ["a", "b", "c"];
  c.featureBulletsAr = ["ا", "ب", "ج"];
  const g = runContentGuardrails(c, { gtinFromUser: "" });
  assert(!g.ok, "medical hype should block");
}

{
  const c = enforceGtinFromUser(
    { ...emptyNoonContent(), gtin: "999" },
    "888",
  );
  assert(c.gtin === "888", "user gtin wins");
}

console.log("listing/guardrails.test.ts OK");
