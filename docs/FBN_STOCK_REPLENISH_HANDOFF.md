# 补货库存分仓 · 窗口交接

> 更新：2026-10-06 · **影刀 fbn-stock 下岗**。Live 分仓以 Impex `ledgerdetailedview` 为准，不另做爬虫。门户 Summary 仅人工/inbox 验数。见 [`PW_RPA_PLATFORM.md`](./PW_RPA_PLATFORM.md)。

> 2026-09-28 17:55 · ui 曾通；正式落盘 `portal-imports/fbn_*_{Y}.csv`。搭法 Skill：`.cursor/skills/yingdao-flow-build`。

## 任务目标

补货决策需要：**近库存（FBN 仓 vs noon Supermall 分列）+ 近 90 天销量**。  
两店：`PRJ482387`（HFY-KSA）、`PRJ396770`（HUI Beauty）。

## 已完成（勿重复造）

### A. Impex / 慧运营侧（已落地）

| 项 | 说明 |
|----|------|
| Impex Summary | `ledgersummaryview` **无分仓**，不能单独用它做 FBN/Supermall |
| Impex Detailed | `ledgerdetailedview` **能分仓**（`warehouse_code`+`fulfillment_type`，Σ `quantity_delta`≈门户结存） |
| 解析 | `apps/api/src/platforms/noon/portal/parsers.ts`：门户 `closing_stock`/`pbarcode`/`supermall`；Detailed 事务聚合 |
| 装配 | `inventory.supermall`、销量 **d90**；可售天 = `(fbn+supermall)/日均` |
| live 同步 | 空/缺分仓/过期(24h) 拉 `stock`（Detailed）；销量首拉默认 90 天 `OUTPOST_NOON_SALES_LOOKBACK_DAYS` |
| UI | Catalog / 补货页展示 FBN、Supermall、90 日销 |

### B. 影刀分仓导出（应用已建，ui 仍卡筛选）

| 项 | 路径 |
|----|------|
| 应用目录 | `D:\YingDao\Flows\outpost_noon_fbn_stock_export\` |
| 入口 | `main.py`（影刀「插入代码段」/`SNIPPET.py` 指向此文件） |
| README | 同目录 |
| 配置占位 | `apps/api/config/yingdao-apps.json` → `fbn-stock`（**appId 仍空**） |

**输出（按店）：**

```
D:\outpost-data\shops\{shopId}\portal-imports\
  fbn_inventory_ledger_summary_{Y}.csv
  fbn_vs_supermall_{Y}.csv
```

**MODE：**

| 值 | 行为 | 状态 |
|----|------|------|
| `inbox` | 读已下载 csv 汇总落盘 | **已通**（15:39 两店） |
| `demo` | 写样例表 | 已通 |
| `ui` | 真点门户 Generate 筛选 | **未通**（见下） |

**环境变量：**

| 变量 | 含义 |
|------|------|
| `OUTPOST_YD_FBN_STOCK_MODE` | `ui` / `inbox` / `demo` |
| `OUTPOST_YD_ADS_SHOPS` | 默认 `PRJ482387,PRJ396770` |
| `OUTPOST_YD_BROWSER` | 默认 `cef` |
| `OUTPOST_YD_FBN_ALLOW_EXISTING` | 默认 **关**。`1` 才允许点列表旧 Download（会下到同事旧表，**勿当成功**） |

## ui 实测时间线（本窗）

| 时间 | 结果 | 说明 |
|------|------|------|
| 早 | 卡 `Inventory` / 菜单 `['1','2']` | 分页误扫；类别/报表下拉未真正打开 |
| ~16:20 | 表面 done | **假成功**：没做筛选，点了列表已有 Summary View Download = 同事 **2026-09-27** 旧表；482387 空表头 `sku_rows=0`；396770 有 461 行但是旧数据 |
| 16:25 | 关旧表兜底；JS 改 `function (element,input)` | 修 `_uia_temp_function`；空表 deliver 报错 |
| 16:28 | 失败 | `打不开类别下拉 Select a category`（人眼可见，xpath/JS 找不到） |
| 16:30 | 已加 `[diag]` + 键盘 Tab/Down 打开类别 | 用户实测 |
| 16:33–16:36 | **假筛选 + 空表死循环** | 见下「16:36 根因」；代码已修，待再测 |

## 16:36 根因（已修，勿再点旧 Download）

日志铁证：

1. `[js] open category → ok:placeholder-raw` —— 点了文案但**下拉未开**（探针假阳）
2. `[js] option '…Summary View' → ok-contains:` + **整页表格 innerText** —— 误点后台列表行，不是模态 option
3. `[date] filled=0`；随后仍点模态 Generate
4. `_wait_and_download` 反复点**列表首行** Download → `Country` 空 / 仅表头 272B → 死循环

**代码改动（`outpost_noon_fbn_stock_export/main.py`）：**

- 打开下拉后必须 `[probe] options`（Finance/Inbound/Inventory）；禁 `placeholder-raw`
- option 只点 listbox/menu 精确短文案；`ok-contains` 一律不算成功
- 提交前校验模态不再有 `Select a category/report`
- 下载：对比 Generate 前 EXP 码，只点**新码**行；空表最多 2 次即停

## 当前卡点（换窗时）

1. 再跑 ui：日志应见 `[probe]`；失败应**早停**，不再刷空 csv  
2. 成功判据：完整 `1/6…6/6` + 新 EXP + csv 有数据行（非 272B）  
3. 失败优先贴：`[diag]` / `[probe]` / `[kbd]` / 停在哪一步  
4. inbox 人工仍可兜底；**不要**开 `ALLOW_EXISTING`  
5. **勿重做** Impex / Catalog UI / inbox 汇总

## 下一窗口建议动作

1. 分仓以 Impex Detailed 为准；不要填 fbn-stock appId、不要接生产 CLI  
2. 需验门户表时用人导出或 MODE=inbox，禁止当 live 主路径  
3. 门户销量走 Playwright `sales`（见销量交接）

## 关键文件

- `D:\YingDao\Flows\outpost_noon_fbn_stock_export\main.py` — ui 点击主逻辑  
- `D:\YingDao\Flows\outpost_noon_fbn_stock_export\SNIPPET.py` / `README.md`  
- `docs/YINGDAO_BRIDGE.md`  
- `D:\YingDao\Flows\GAP_MATRIX.md`  
- 计划原稿：`.cursor/plans/impex补货库存销量_*.plan.md`（勿当「未实现」）

## 范围约束

- 只动补货库存/销量/本影刀应用；勿顺手改广告、市场情报、飞书  
- 影刀密码不入库；浏览器须已登录 Partners  
- 对照写法可参考 `outpost_noon_ads_export`（xpath）+ `outpost_noon_guide_capture`（`function (element,input)` JS）
