# Noon 广告预算峰期切换 · 交接

试店打磨链路；**默认只跑 `PRJ488078`**。设计兼容多店（白名单扩店），稳定后再开主力店。

## 两态（北京时间）

| 模式 | CST | 动作 |
|------|-----|------|
| offpeak | 09:00–16:00 | Live 预算 → **5** |
| peak | 00:00–05:00 | 预算 → **baseline**（人为高峰值） |
| idle | 其余 | 不改 |

## 命令

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform

# 登录（与 ads 共用 noon-ads-pw profile）
python main.py ads-budget login

# 探针：进店、筛 Live、读样例预算（不改）
python main.py ads-budget probe

# 日常同步：刷新 lastSeen，不覆盖 baseline
python main.py ads-budget sync

# 人工确认高峰预算已设好后：写入/刷新 baseline
python main.py ads-budget sync --refresh-baseline

# 按当前北京时间 apply；干跑
python main.py ads-budget apply --dry-run
python main.py ads-budget apply --mode offpeak --dry-run
python main.py ads-budget apply --mode peak

# 只重试上次失败
python main.py ads-budget apply --only-failed
```

## 环境变量

| 变量 | 默认 | 含义 |
|------|------|------|
| `OUTPOST_ADS_BUDGET_SHOPS` | `PRJ488078` | 白名单；未列出的店跳过 |
| `OUTPOST_ADS_BUDGET_BATCH` | `15` | 分批改预算大小 |
| `OUTPOST_ADS_BUDGET_SCROLL_ROUNDS` | `120` | 边滚边累加的最大滚动步数（非翻页） |
| `OUTPOST_ADS_BUDGET_MAX_PAGES` | `50` | 若存在真分页 Next 时的翻页上限 |
| `OUTPOST_DATA_ROOT` | `D:\outpost-data` | 基准表根目录 |
| `OUTPOST_ADS_PW_HEADLESS` | `0` | 无头易被掐，试跑保持有头 |

### 大体量店（滚动为主；分页仅兜底）

Noon Campaigns 表是**表内向下滚动 / 虚拟列表**加载，不是「Showing + Next」分页。

| 步骤 | 策略 |
|------|------|
| **sync / probe** | 滚一屏 → 抓可见行累加 campaignId → 再滚；连续多轮无新 id 或达到顶栏 `Live N` 则停。有真 Next 才翻页 |
| **apply** | 优先 `Search campaigns` 搜 `campaignId`（不依赖当前滚动位置） |

试店几条时通常 1～2 轮滚动即稳定，与大体量店同一路径。

## 落盘（不进 adsFacts）· 唯一权威源

```
D:\outpost-data\shops\{shopId}\ads-budget\
  baseline.csv     # 用户表 = 定时任务同一源（前端 CRUD / apply 共用）
  last_run.json    # 最近一次 apply 结果（失败可 --only-failed）
```

### 列职责（写死，避免乱数据）

| 列 | 谁写 | 含义 |
|----|------|------|
| `baselineBudget` | **仅** 前端 UI / 计算任务 / 显式「刷新基准」 | 高峰要回调的目标（权威） |
| `lastSeenBudget` / `mode` | **仅** 日常 `sync` / `apply` 观测 | 页面现状，禁止当目标 |
| `updatedBy` | 写入方标记 | `ui` / `calc` / `sync-refresh` |
| `campaignId` | 主键 | 同一 PSKU 可多活动；勿只按 PSKU 存 |
| `psku` | 展示/检索 | 活动名前缀 |

**禁止**在低峰用日常 `sync` 覆盖 `baselineBudget`（页面已是 5）。只有 `--refresh-baseline` / 前端「刷新基准」才写目标列。

前端：Pw Studio → 广告预算 →「权威预算表」  
API：`GET/POST/PATCH/DELETE /api/pw-rpa/ads-budget/baseline`

新 Live 无目标 → `needsBaseline=1`，peak apply **跳过**并打日志；表内标红「缺目标」。

## 与现有 ads 导出关系

| | ads 导出 | ads-budget |
|--|----------|------------|
| job | `ads` | `ads-budget` |
| 用途 | 投产比 / Listing | 峰期改日预算 |
| 落盘 | portal-imports `ads_sku_*.csv` | `ads-budget/baseline.csv` |
| 改 Noon | 否 | 是 |

共用 cookie：`D:\outpost-data\browser-profiles\noon-ads-pw\`。

## 定时（试店过夜回调）

API 启动时会挂墙钟调度（上海时区），配置落盘：

`D:\outpost-data\pw-rpa\ads-budget-schedule.json`

| 槽位 | 默认时刻 | 动作 |
|------|----------|------|
| peak | **00:10** | `apply --mode peak` → 预算拉回 baseline |
| offpeak | **09:10** | `apply --mode offpeak` → 压到 5 |

### 过夜启动（禁止 watch）

墙钟挂在 **API 子进程**上。`npm run dev`（`tsx watch`）改文件或子进程退出会杀进程重载，不适配过夜。

| 方式 | 命令 |
|------|------|
| **推荐过夜** | `powershell -NoProfile -ExecutionPolicy Bypass -File D:\Outpost_ERP\apps\api\scripts\start-api-overnight.ps1` |
| 等价无 watch | `cd D:\Outpost_ERP\apps\api` → `npm run start:runtime` |
| 禁止过夜 | `npm run dev` / `tsx watch src/index.ts` |

- 过夜日志：`D:\outpost-data\pw-rpa\api-overnight.log`
- 开发热重载请**另开** watch 窗口，不要与过夜调度共用同一 `tsx watch` 父进程
- 前端：Pw Studio → 广告预算 →「运行历史」；API：`GET /api/pw-rpa/ads-budget/runs`

- 默认**开启**；关掉：`OUTPOST_ADS_BUDGET_SCHEDULE=0` 或改 json 里 `enabled: false`
- **API 进程应过夜常开**；若半夜/早上才起来，会**当日补跑**：
  - peak：错过 00:10 短窗后，在 **09:10 前**仍会补一次拉回 baseline
  - offpeak：错过 09:10 短窗后，在 **16:00 前**仍会补一次压到 5
  - **仅成功**才写入 `lastPeakDay` / `lastOffpeakDay`；失败当天仍可在 catch-up 窗口再试
  - 调度启动时立刻 `tick()` 一次，不必再等 60s
- 登录态（**sync / apply / probe 共用**）：
  1. 启动前检查 Ad Manager SSO cookie，没有则统一登录（IMAP OTP）
  2. 进页若落在登录/OTP，抛错后同样走 `try_recover_session_for_export` 再整轮重试
  3. 无人值守**默认开**（IMAP + 登录邮箱）；仅 `OUTPOST_NOON_OTP_AUTO=0` 才关。登录失败不弹窗等人手填
  4. 登录页两种态都要会：**(a)** 邮箱(+密码)+发码+OTP；**(b)** Welcome Back 选账号（无输入框）。  
     Welcome Back 优先点 **Use a different account** → 邮箱表单（Continue with this user 常点了不前进）；统一登录有头成功且 SSO 已双写后，无头探测改为软探，失败不挡后续 apply。
- 白名单默认仅 `PRJ488078`

今晚验收：当前预算已是 5 → 明早看两品是否已回到 baseline（表内 10）。

### 明早先看这些日志（成功时间）

优先：Pw Studio → **广告预算** →「运行历史」（读同一 jsonl）。

| 文件 | 用途 |
|------|------|
| `D:\outpost-data\pw-rpa\ads-budget-last.txt` | **一眼看**：北京时间完成时刻 + ok |
| `D:\outpost-data\pw-rpa\ads-budget-last.json` | 同上，完整 JSON |
| `D:\outpost-data\pw-rpa\ads-budget-runs.jsonl` | 历史追加（每次一行）；前端同源 |
| `D:\outpost-data\shops\PRJ488078\ads-budget\runs.jsonl` | 按店历史 |
| `D:\outpost-data\pw-rpa\ads-budget-schedule.json` | 定时槽 lastRunAt / lastOk / lastSlot |
| `D:\outpost-data\pw-rpa\api-overnight.log` | 过夜 API 进程 stdout/stderr |
| `D:\YingDao\Logs\ads_budget_runs.jsonl` | 同上历史副本 |

## 试店 → 主力店

1. `PRJ488078`：probe → sync --refresh-baseline → apply dry-run → 真 apply offpeak/peak  
2. 连续多天无误伤、降预算时效可接受  
3. 扩店：`OUTPOST_ADS_BUDGET_SHOPS=PRJ488078,PRJ…`，先 dry-run  

## 已知风险

- Noon 文档：提高预算立即生效；**降低预算最长约 24h** — 试店 Phase 0 必须实测  
- UI 选择器变更 → 先 `probe` 再 apply  
- 官方无 Ads 预算 API；本链路为 Playwright UI  

## 代码

- `apps/api/scripts/noon-pw-platform/ads_budget/`
- `apps/api/scripts/noon-pw-platform/jobs/ads_budget.py`
- 入口：`python main.py ads-budget …`
