/**
 * npx tsx src/auth/sessions-presence.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUTPOST_ROOT } from "../shops/registry.js";
import {
  ONLINE_WINDOW_MS,
  listUserPresence,
} from "./sessions.js";

const dir = join(OUTPOST_ROOT, "sessions");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const tokenOnline = "a".repeat(64);
const tokenOffline = "b".repeat(64);
const now = Date.now();

const onlinePath = join(dir, `${tokenOnline}.json`);
const offlinePath = join(dir, `${tokenOffline}.json`);

writeFileSync(
  onlinePath,
  JSON.stringify({
    token: tokenOnline,
    userId: "u-online",
    createdAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 86400_000).toISOString(),
    lastSeenAt: new Date(now - 30_000).toISOString(),
  }),
  "utf8",
);
writeFileSync(
  offlinePath,
  JSON.stringify({
    token: tokenOffline,
    userId: "u-offline",
    createdAt: new Date(now - 3600_000).toISOString(),
    expiresAt: new Date(now + 86400_000).toISOString(),
    lastSeenAt: new Date(now - ONLINE_WINDOW_MS - 60_000).toISOString(),
  }),
  "utf8",
);

try {
  const map = listUserPresence(now);
  assert.equal(map.get("u-online")?.online, true);
  assert.equal(map.get("u-offline")?.online, false);
  console.log("[sessions-presence] smoke ok");
} finally {
  try {
    unlinkSync(onlinePath);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(offlinePath);
  } catch {
    /* ignore */
  }
}
