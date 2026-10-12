---
name: yingdao-pc-cli
description: >-
  Operate local YingDao (影刀/ShadowBot) PC client via official CLI for the
  agent: list apps, run market-intel/ads/consumables flows, check task status.
  Use when the user asks to run 影刀, scrape Noon via YingDao, Sold Recently,
  or automate ShadowBot without manual clicks.
---

# 影刀 PC 端 · Agent 操作技能

本机 CLI：`C:\Program Files\ShadowBot\shadowbot.shell-cli.exe`（`YINGDAO_CLI` 可覆盖）。

**默认由 Agent 跑，不要让用户手动点影刀**（除非 health 失败）。

```bash
cd apps/api
node scripts/yingdao-run.mjs health
node scripts/yingdao-run.mjs sync-mi
node scripts/yingdao-run.mjs consumables --demo --searches "garbage bags"
node scripts/yingdao-run.mjs consumables --searches "garbage bags|coffee filters"
node scripts/yingdao-run.mjs consumables --async
node scripts/yingdao-run.mjs status <taskId>
node scripts/yingdao-run.mjs logs <taskId>
node scripts/yingdao-run.mjs run market-intel
node scripts/yingdao-run.mjs run ads-export
```

## 耗材自动流程

`consumables` 会：`sync-mi` → 写 `Requests/pending/mi_consumables_*.json` → CLI 启动「前哨-Noon沙特-市场情报投递」→ 应用消费 pending → inbox。

## 别名

见 `apps/api/config/yingdao-apps.json`。

## 注意

- 真跑需 Edge 能开 Noon；可 `--async` 后轮询
- health 失败时请用户打开影刀并登录（勿把密码写入仓库）
