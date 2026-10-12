/**
 * npx tsx src/platforms/feishu/accounts-write-guard.test.ts
 * 验证：账目表写接口可走白名单；权限错误带开通链接 hint。
 */
import assert from "node:assert/strict";
import { FeishuError, isFeishuError } from "./errors.js";
import { appendSheetRows, updateSheetRow } from "./http.js";

const fakeFetchOk: typeof fetch = async () =>
  new Response(
    JSON.stringify({ code: 0, msg: "ok", data: { updatedRange: "x" } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const fakeFetchBizDeny: typeof fetch = async () =>
  new Response(
    JSON.stringify({ code: 91403, msg: "forbidden permission" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

{
  const r = await updateSheetRow(
    "tok",
    "ACCOUNTS_TOKEN_OK",
    "sheet1!A2:B2",
    [["a", "b"]],
    fakeFetchOk,
  );
  assert.equal(r.updatedRange, "x");
}

{
  const r = await appendSheetRows(
    "tok",
    "ACCOUNTS_TOKEN_OK",
    "sheet1",
    [["a", "b"]],
    fakeFetchOk,
  );
  assert.ok(r);
}

{
  try {
    await updateSheetRow(
      "tok",
      "ACCOUNTS_TOKEN_OK",
      "sheet1!A2:B2",
      [["a"]],
      fakeFetchBizDeny,
    );
    assert.fail("expected permission error");
  } catch (e) {
    assert.ok(isFeishuError(e));
    assert.match(String((e as FeishuError).hint), /open\.feishu\.cn\/app/);
  }
}

try {
  await appendSheetRows("tok", "", "sheet1", [["a"]], fakeFetchOk);
  assert.fail("expected missing token");
} catch (e) {
  assert.ok(isFeishuError(e));
  assert.equal((e as FeishuError).code, "DOC_TOKEN_MISSING");
}

console.log("[accounts-write-guard] smoke ok");
