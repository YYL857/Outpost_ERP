/**
 * tsx src/modules/pw-rpa/session-status.test.ts
 */
import assert from "node:assert/strict";
import { assessCookies } from "./session-status.js";

const now = Date.parse("2026-10-07T03:00:00.000Z");
const warn = 48 * 60 * 60 * 1000;

{
  const r = assessCookies([], now, warn);
  assert.equal(r.level, "missing");
}

{
  const r = assessCookies(
    [{ name: "a", domain: ".noon.partners", expires: -1 }],
    now,
    warn,
  );
  assert.equal(r.level, "unknown");
  assert.equal(r.persistentCookieCount, 0);
}

{
  const exp = Math.floor(now / 1000) - 60;
  const r = assessCookies(
    [{ name: "a", domain: "admanager.noon.partners", expires: exp }],
    now,
    warn,
  );
  assert.equal(r.level, "expired");
}

{
  const exp = Math.floor(now / 1000) + 3600;
  const r = assessCookies(
    [{ name: "a", domain: ".noon.partners", expires: exp }],
    now,
    warn,
  );
  assert.equal(r.level, "expiring");
}

{
  const exp = Math.floor(now / 1000) + 10 * 24 * 3600;
  const r = assessCookies(
    [
      { name: "a", domain: ".noon.partners", expires: exp },
      { name: "noise", domain: "example.com", expires: now / 1000 - 1 },
    ],
    now,
    warn,
  );
  assert.equal(r.level, "ok");
  assert.equal(r.cookieCount, 1);
}

console.log("pw-rpa session-status ok");
