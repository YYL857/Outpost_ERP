# 销量导出 + 补货计划 · 窗口交接

> 更新：2026-10-06 · **生产改 Playwright job `sales`**（`python main.py sales ui` / 补货页「导出销量表」）。影刀 `outpost_noon_sales_export` 仅手工。Impex productviews **不动**。详见 [`PW_RPA_PLATFORM.md`](./PW_RPA_PLATFORM.md)。

> 2026-09-29 14:16 · Sales 导全量+落盘清洗已通；补货页去掉「建议补」、孤儿品名/规格/时效已改。

## 任务目标

补货要：**FBN/Supermall 分仓库存（已通）+ 门户 Sales 口径销量（Delivered/Processing/Shipped · 近 90 天）**。  
两店：`PRJ482387`（HFY-KSA）、`PRJ396770`（HUI Beauty）。

**官方 Impex `productviewsandsalesdata` ≠ 门户 Sales 页**。补货对齐门户口径必须走影刀，不能只用 Impex。

---

## 已完成（勿重复造）

### A. 影刀 Sales 导出（已通）

| 项 | 说明 |
|----|------|
| 目录 | `D:\YingDao\Flows\outpost_noon_sales_export\` |
| 影刀应用 | 「N1、N2店铺销量查询链路」 |
| appId | `7f8690f4-1903-407b-a95f-6914450c796c`（已写入 `yingdao-apps.json` → `sales-export`） |
| MODE | `OUTPOST_YD_SALES_MODE` = `demo` \| `inbox` \| `ui` |
| 落盘 | `D:\outpost-data\shops\{shopId}\portal-imports\sales_export_{from}_{to}.csv` |

**ui 定稿路径（禁止再折腾 Status 勾选）：**

1. 深链只带日期（**不带 `status=`**）  
2. 日期齐则跳过日历，否则点日历  
3. **不点 Status** → Export → New export → 等落盘 / 弹窗关后最多 3 次重开 Export  
4. `deliver` 时 **`[clean]`**：只留 Delivered / Processing / Shipped  

**实测（2026-09-29 ~13:42）：**

| 店 | 原始 Downloads | 清洗后 portal-imports | status |
|----|----------------|----------------------|--------|
| PRJ482387 | 1674（含 CIR/取消等） | **1471** | 仅三态 |
| PRJ396770 | 4318 | **3823** | 仅三态 |

日志应见：`跳过 Status 点选` → `New export` → `[clean] kept=… dropped=…` → `[deliver]`。

**别混：** 销量 = `outpost_noon_sales_export` / `OUTPOST_YD_SALES_MODE`；库存 = `fbn_stock_export` / `OUTPOST_YD_FBN_STOCK_MODE`。

> Status UI 勾选曾多轮失败（Clear 关面板、假 ok、`no:unchecked`），用户拍板：**放弃点选，导后清洗**。旧 Status 点选代码仍在 `main.py` 里但 `run_ui` 已不调用——不要再打开 FORCE_CLICK 去勾三态。

### B. 灌入 state（已跑通）

```bash
cd apps/api
npx tsx scripts/apply-portal-replenish-exports.mts
```

- 三态行 → `salesFacts`（整表覆盖）；落盘已洗过则 `lineDropped=0`  
- 最新 `fbn_inventory_ledger_summary_*.csv` → `stock`  
- 最近一次：396770 → **2647** facts；482387 → **915** facts  
- 改完须 **重启 API / 切店 / 补货页刷新** 才进内存

正式表：

```
D:\outpost-data\shops\PRJ482387\portal-imports\sales_export_2026-07-02_2026-09-29.csv
D:\outpost-data\shops\PRJ396770\portal-imports\sales_export_2026-07-02_2026-09-29.csv
```

### C. 补货页（本窗后半已改，待目视）

**用户诉求：**「未在线 Catalog」不能只有 PSKU+感叹号；要品名/规格/店；时效跟 Catalog；**不要系统建议补几件**，全量列出、紧急标红靠前。

| 改动 | 位置 |
|------|------|
| 孤儿 SKU 品名 ← 飞书日报/采购 `productName`（如 `恐龙新生儿襁褓巾-彩色`） | `apps/api/src/modules/catalog/list-items.ts` |
| 装配缓存指纹含飞书/采购 | `apps/api/src/modules/catalog/query.ts` |
| API：规格、店名、offline 说明、库存/销量时效；**去掉 suggestQty**；默认不按 urgent 过滤 | `apps/api/src/modules/replenish/replenish.routes.ts` |
| UI：默认「全部」、无「建议」列、规格列、紧急标红、FreshnessBar | `apps/web/src/pages/ReplenishPage.tsx` + `styles.css` + `api.ts` 类型 |

**「未在线 Catalog」含义：** 有销量/库存（或飞书），但 **不在 Noon Catalog 导出主档** → 无站内主图属预期；品名靠飞书/采购。例：`N1SAQBJ002MLT` @ PRJ396770。

### D. 库存影刀（姊妹，已通）

见 `docs/FBN_STOCK_REPLENISH_HANDOFF.md`。勿与 Sales 变量/目录串。

---

## 下一窗优先

1. **重启 API**（或切店 reload），打开 `/replenish` 目视：  
   - 默认「全部」、无「建议补」列  
   - 紧急行粉红底 +「紧急」标签靠前  
   - 顶部库存/销量「今天是否已入库」  
   - PRJ396770 搜 `N1SAQBJ002MLT` → 中文名 + 规格，非裸 PSKU  
2. 门户销量请跑 Playwright `sales`（深链日期、不点 Status、落盘后三态清洗）。  
3. 可选：孤儿仍无图——需 Catalog 同步进店或另接图源（未做）。  
4. 影刀 CLI 仅手工兜底，生产不再 spawn `sales-export`。

---

## 关键文件

| 路径 | 用途 |
|------|------|
| `D:\YingDao\Flows\outpost_noon_sales_export\main.py` | ui 日期+Export+clean |
| `D:\YingDao\Flows\outpost_noon_sales_export\SNIPPET.py` | 影刀粘贴段 |
| `apps/api/config/yingdao-apps.json` | `sales-export.appId` |
| `apps/api/scripts/apply-portal-replenish-exports.mts` | 导表 → state |
| `apps/api/src/modules/catalog/list-items.ts` | 孤儿品名 |
| `apps/api/src/modules/replenish/replenish.routes.ts` | 补货 API |
| `apps/web/src/pages/ReplenishPage.tsx` | 补货 UI |
| `docs/FBN_STOCK_REPLENISH_HANDOFF.md` | 库存姊妹 |

---

## 影刀代码段（销量 · 定稿）

```python
import os
os.environ["OUTPOST_YD_SALES_MODE"] = "ui"
os.environ["OUTPOST_YD_SALES_FORCE_CLICK"] = "0"  # 0=深链日期；勿开 Status 勾选
os.environ.setdefault("OUTPOST_YD_ADS_SHOPS", "PRJ482387,PRJ396770")
os.environ.setdefault("OUTPOST_YD_SALES_LOOKBACK_DAYS", "90")
os.environ.setdefault("OUTPOST_YD_BROWSER", "cef")
import runpy
runpy.run_path(
    r"D:\YingDao\Flows\outpost_noon_sales_export\main.py",
    run_name="__main__",
)
```

或：`node scripts/yingdao-run.mjs run sales-export --async`（额度够时）。

---

## 范围约束

- 只动销量导出 / 补货页 / list-items / apply 脚本；勿顺手改广告、市场情报  
- 遵守 `touch-only-task-scope`  
- Skill：`.cursor/skills/yingdao-flow-build/SKILL.md`、`yingdao-pc-cli`
