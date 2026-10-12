#!/usr/bin/env node
/**
 * Outpost × 影刀 PC CLI 封装（给 Agent / 本机用）
 *
 * 依赖：本机已安装并登录影刀，CLI 默认
 *   C:\Program Files\ShadowBot\shadowbot.shell-cli.exe
 *
 * 用法：
 *   node scripts/yingdao-run.mjs health
 *   node scripts/yingdao-run.mjs apps
 *   node scripts/yingdao-run.mjs run market-intel
 *   node scripts/yingdao-run.mjs consumables [--demo] [--searches "a|b"] [--async]
 *   node scripts/yingdao-run.mjs status <taskId>
 *   node scripts/yingdao-run.mjs logs <taskId>
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(__dirname, "../config/yingdao-apps.json");

const MI_FLOW = "D:\\YingDao\\Flows\\outpost_noon_sa_market_intel";
const MI_APP_ID = "7d24894c-ca55-4fc6-a51d-ac4aae4bde89";

function loadCfg() {
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const envCli = process.env.YINGDAO_CLI?.trim();
  if (envCli) cfg.cliPath = envCli;
  if (!existsSync(cfg.cliPath)) {
    throw new Error(`找不到影刀 CLI: ${cfg.cliPath}（可设 YINGDAO_CLI）`);
  }
  return cfg;
}

function cli(args, { timeoutMs = 120_000 } = {}) {
  const cfg = loadCfg();
  const r = spawnSync(cfg.cliPath, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  let json = null;
  try {
    json = JSON.parse(out);
  } catch {
    const m = out.match(/\{[\s\S]*\}\s*$/);
    if (m) {
      try {
        json = JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
  }
  return {
    ok: r.status === 0 && (json?.ok !== false),
    status: r.status,
    raw: out,
    json,
    error: r.error ? String(r.error) : null,
  };
}

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function resolveApp(keyOrId) {
  const cfg = loadCfg();
  if (/^[0-9a-f-]{36}$/i.test(keyOrId)) {
    return { appId: keyOrId, appName: keyOrId, defaultWait: "30m0s" };
  }
  const hit = cfg.apps[keyOrId];
  if (!hit) {
    throw new Error(
      `未知应用别名 ${keyOrId}；可用: ${Object.keys(cfg.apps).join(", ")} 或 appId`,
    );
  }
  return hit;
}

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--demo") flags.demo = true;
    else if (a === "--async") flags.async = true;
    else if (a === "--searches" || a === "--search") flags.searches = argv[++i];
    else if (a === "--topN") flags.topN = Number(argv[++i]);
    else if (a === "--wait") flags.wait = argv[++i];
    else if (a === "--app") flags.app = argv[++i];
    else pos.push(a);
  }
  return { flags, pos };
}

function writeConsumablesRequest({ searches, topN, demo }) {
  const reqRoot =
    process.env.YINGDAO_REQUESTS_DIR?.trim() ||
    join(process.env.YINGDAO_ROOT || "D:\\YingDao", "Requests");
  for (const sub of ["pending", "done", "failed"]) {
    mkdirSync(join(reqRoot, sub), { recursive: true });
  }
  const list = searches
    ? String(searches)
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [
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
      ];
  const requestId = `req-${randomUUID().slice(0, 8)}`;
  const payload = {
    type: "mi_consumables",
    requestId,
    searches: list,
    topN: topN || 50,
    browser: "edge",
    demo: Boolean(demo),
    requestedAt: new Date().toISOString(),
    source: "yingdao-run.mjs",
  };
  const dest = join(reqRoot, "pending", `mi_consumables_${requestId}.json`);
  writeFileSync(dest, JSON.stringify(payload, null, 2), "utf8");
  return { payload, dest, reqRoot };
}

/** 把 Flows 源码同步进影刀已安装应用目录（替换旧 main.pybx） */
function syncMarketIntelApp() {
  const userId = "967598934150778882";
  const robots = [
    join("D:\\YingDao\\LocalData\\ShadowBot\\users", userId, "apps", MI_APP_ID, "xbot_robot"),
    join(homedir(), "AppData", "Local", "ShadowBot", "users", userId, "apps", MI_APP_ID, "xbot_robot"),
  ];
  const srcMain = join(MI_FLOW, "main.py");
  const srcBridge =
    existsSync(join(MI_FLOW, "outpost_bridge.py"))
      ? join(MI_FLOW, "outpost_bridge.py")
      : join("D:\\YingDao\\Flows\\_lib\\outpost_bridge.py");
  if (!existsSync(srcMain)) throw new Error(`缺少源码 ${srcMain}`);
  const synced = [];
  for (const robot of robots) {
    if (!existsSync(robot)) continue;
    copyFileSync(srcMain, join(robot, "main.py"));
    if (existsSync(srcBridge)) copyFileSync(srcBridge, join(robot, "outpost_bridge.py"));
    const pybx = join(robot, "main.pybx");
    const bak = join(robot, "main.pybx.bak");
    if (existsSync(pybx)) {
      if (!existsSync(bak)) renameSync(pybx, bak);
      else {
        try {
          unlinkSync(pybx);
        } catch {
          renameSync(pybx, join(robot, `main.pybx.bak.${Date.now()}`));
        }
      }
    }
    synced.push({
      robot,
      mainBytes: statSync(join(robot, "main.py")).size,
    });
  }
  if (!synced.length) {
    throw new Error("未找到影刀已安装 market-intel 应用目录，请先在影刀客户端打开过该应用");
  }
  return synced;
}

function cmdSyncMi() {
  const synced = syncMarketIntelApp();
  printJson({ ok: true, synced });
  process.exit(0);
}

function cmdHealth() {
  const a = cli(["system", "health"]);
  const b = cli(["auth", "current"]);
  printJson({
    health: a.json?.data || a.raw,
    auth: b.json?.data || b.raw,
    ok: a.ok && b.ok && b.json?.data?.loggedIn,
  });
  process.exit(a.ok && b.ok && b.json?.data?.loggedIn ? 0 : 1);
}

function cmdApps() {
  const r = cli(["console", "app", "--page-size", "50"]);
  printJson(r.json || { raw: r.raw });
  process.exit(r.ok ? 0 : 1);
}

function cmdRun(appKey, flags) {
  const app = resolveApp(appKey);
  if (app.deprecated) {
    console.error(
      `[yingdao-run] 警告：别名 ${appKey} 已从生产下岗，改用 Playwright 平台：cd apps/api/scripts/noon-pw-platform && python main.py <ads|sales|keepalive> ui（见 docs/PW_RPA_PLATFORM.md）。仍将启动影刀（仅手工）。`,
    );
  }
  const wait = flags.wait || app.defaultWait || "30m0s";
  const args = [
    "--timeout",
    "60s",
    "console",
    "task",
    "run",
    "--app-id",
    app.appId,
    "--app-type",
    "developed",
  ];
  if (flags.async) args.push("--async");
  else {
    args.push("--wait-timeout", wait);
    args.push("--poll-interval", "3s");
    args.push("--log-limit", "300");
  }
  // sync 可能很长：按 wait 估超时
  const waitMs = (() => {
    const m = String(wait).match(/^(\d+)(m|s|h)/i);
    if (!m) return 45 * 60_000;
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u === "h") return (n + 0.2) * 3600_000;
    if (u === "m") return (n + 1) * 60_000;
    return (n + 30) * 1000;
  })();
  console.error(`[yingdao-run] start ${app.appName || appKey} ${app.appId} wait=${wait} async=${!!flags.async}`);
  const r = cli(args, { timeoutMs: flags.async ? 120_000 : waitMs });
  printJson({
    app,
    ok: r.ok,
    status: r.status,
    error: r.error,
    result: r.json || r.raw,
  });
  process.exit(r.ok ? 0 : 1);
}

function cmdConsumables(flags) {
  let synced = null;
  try {
    synced = syncMarketIntelApp();
    console.error(`[yingdao-run] synced market-intel → ${synced.length} robot dir(s)`);
  } catch (e) {
    console.error(`[yingdao-run] sync warn: ${e.message || e}`);
  }
  const written = writeConsumablesRequest(flags);
  console.error(`[yingdao-run] wrote ${written.dest}`);
  // 复用已导入影刀的「市场情报」应用；启动时会消费 pending
  cmdRun("market-intel", {
    ...flags,
    wait: flags.wait || "45m0s",
  });
}

function cmdStatus(taskId) {
  const r = cli(["console", "task", "status", "--task-id", taskId]);
  printJson(r.json || { raw: r.raw });
  process.exit(r.ok ? 0 : 1);
}

function cmdLogs(taskId) {
  const r = cli(["console", "task", "logs", "--task-id", taskId, "--limit", "100"]);
  printJson(r.json || { raw: r.raw });
  process.exit(r.ok ? 0 : 1);
}

function cmdStop(taskId) {
  const r = cli(["console", "task", "stop", "--task-id", taskId]);
  printJson(r.json || { raw: r.raw });
  process.exit(r.ok ? 0 : 1);
}

function usage() {
  console.log(`yingdao-run.mjs — Outpost 影刀 PC CLI

  health
  apps
  sync-mi                          # Flows → 已安装 market-intel 应用目录
  run <alias|appId> [--async] [--wait 45m0s]
  consumables [--demo] [--searches "a|b"] [--async] [--wait 45m0s]
  status <taskId>
  logs <taskId>
  stop <taskId>

aliases: market-intel（生产）| ads-export/sales-export/noon-keepalive（已下岗，仅手工）| noon-align
生产 RPA: apps/api/scripts/noon-pw-platform  见 docs/PW_RPA_PLATFORM.md
config: apps/api/config/yingdao-apps.json
`);
}

const { flags, pos } = parseArgs(process.argv.slice(2));
const cmd = pos[0] || "help";

try {
  if (cmd === "health") cmdHealth();
  else if (cmd === "apps") cmdApps();
  else if (cmd === "sync-mi") cmdSyncMi();
  else if (cmd === "run") cmdRun(pos[1] || flags.app || "market-intel", flags);
  else if (cmd === "consumables") cmdConsumables(flags);
  else if (cmd === "status") cmdStatus(pos[1]);
  else if (cmd === "logs") cmdLogs(pos[1]);
  else if (cmd === "stop") cmdStop(pos[1]);
  else {
    usage();
    process.exit(cmd === "help" || cmd === "-h" ? 0 : 2);
  }
} catch (e) {
  console.error(String(e?.stack || e));
  process.exit(1);
}
