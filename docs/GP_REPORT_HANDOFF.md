# 两店四个月毛利汇总 · 任务交接（2026-09-29）

## 目标

对齐同事样板表口径，产出 **HUI Beauty（PRJ396770）**、**HFY-KSA（PRJ482387）** 的 **2026-06～09** 毛利/纯利汇总。  
汇率按用户指定 **1.76**。缺源不编造。

## 样板（口径真相）

| 文件 | 路径 |
|---|---|
| HFY 五月样板 | `D:\Desktop\HFY_report_26_05.xlsx` |
| HUI 五月样板（更关键） | `D:\Desktop\HUI_report_26_05.xlsx` |

HUI 五月表已核实：

- **营业额** = 账单 sheet `5月份账单` 里全部 **`Net Proceeds`** 加总（≠ Sales GMV）
- **VAT** = Details EN 含 `VAT` 的 Amount 求和（公式 `SUMIF`）
- **平台费** ≈ 营业额的一半（五月约 **54.1%**）；账单可直接加总的 Advertising+Referral+FBN Outbound+Return Admin ≈ 30,804，表内平台费写死 **36,022.74**（多出约 5,219，来源未在表内写明）
- **纯利** = `(营业额−平台费−VAT)×1.76 − 采购 − 国际运费 − 国内运费`
- 同事原话：「一半在平台跟 GMV」→ 指账单 Net Proceeds 口径下平台侧约占一半

## 当前交付物（桌面）

- `D:\Desktop\HUI_Beauty_四个月毛利汇总_26_06_09.xlsx`
- `D:\Desktop\HFY_KSA_四个月毛利汇总_26_06_09.xlsx`  
  （含「四个月汇总 / 平台费拆分 / 数据来源」；**2026-09-29 已按月账单口径重算**）

账单源（已备份）：

- `apps/api/scripts/_out/gp-sources/PRJ396770/noon_financeweb_statements_2026-06_09.csv`（HUI，合同 MPB854XPSESA）
- `apps/api/scripts/_out/gp-sources/PRJ482387/noon_financeweb_statements_2026-06_09.csv`（HFY，合同 MPC1YI6EAYSA）
- 原始下载：`D:\Downloads\noon_financeweb_statements.csv`（HFY）、`noon_financeweb_statements (1).csv`（HUI）

历史明细（可选参考）：曾生成过 `D:\Desktop\gp_reports_26_06_09\` 下 8 份月报（若还在）。

## 我们算过什么 / 和样板差在哪

| 字段 | 现用源 | 样板要的源 | 状态 |
|---|---|---|---|
| 营业额 | 月账单 Σ Net Proceeds | **月账单 Net Proceeds** | **已对齐** |
| 平台费 | 账单四费：Advertising+Referral+FBN Outbound+Return Admin | **月账单**费用行 | **已按账单加总**；五月样板写死 36022.74 vs 同口径≈30803.75，**差额未补** |
| VAT | 月账单 VAT Payable 绝对值 | 月账单 VAT Payable | **已对齐** |
| 采购 | 飞书产品表采购单价 × 当月销量 | 同思路（样板用「最新采购单价」） | 沿用 |
| 头程 | 飞书装箱票级实付摊 PSKU × 销量 | 样板用票件列 AF/AG | 沿用（分摊口径略不同） |
| 包装 | 飞书「产品包装采购」 | 样板五月无此列；我们有加 | 沿用 |
| 汇率 | 1.76 | HUI 五月即 1.76 | 已对齐 |
| 9 月完整度 | 两店账单末段均为 2026-09-23 | 整月 | **可能缺月末段** |

## 本地已有、可复用的数据

- 飞书 raw：`D:\outpost-data\feishu-raw\runs\2026-09-29T03-47-13-498Z_260f2443\`（含 **产品包装采购**）
- Impex 已拉：`D:\Outpost_ERP\apps\api\scripts\_out\gp-sources\{PRJ396770,PRJ482387}\`  
  - `sales_2026-06-01_2026-09-29.csv`  
  - `fees.csv`（Transaction View，**≠** Statement）
- portal sales：`D:\outpost-data\shops\{shop}\portal-imports\sales_export_2026-07-02_2026-09-29.csv`
- 广告影刀有链路 `ads-export`，本地 `ads_sku_*.csv` / `adsFacts` **只有偏 8–9 月碎片**，不够 6–9 整月，且 **spend ≠ 账单 Advertising Fee**
- 配置已加包装 sheet：`apps/api/config/feishu.docs.json` → accounts 含「产品包装采购」

## 脚本

- 汇总重建：`apps/api/scripts/_rebuild_gp_summary_fx176.py`
- 完整月报生成：`apps/api/scripts/_build_gp_reports.py`
- 抽检：`apps/api/scripts/_spotcheck_jul_hfy.py`
- 拉源：`apps/api/scripts/_gp-pull-sources.mts`、`_gp-pull-invoices.mts`  
  （invoices Impex 要 `start_date/end_date/contract_order_nrs`，曾 400 失败）

## 已完成（2026-09-29）

1. 两店 financeweb statements CSV 已收齐并备份到 `gp-sources`
2. 按样板重算桌面两张汇总：营业额=ΣNet Proceeds；平台费=账单四费加总（**不补**五月写死差额）；VAT=ΣVAT；汇率 1.76；采购/头程/包装沿用飞书
3. 「数据来源」页已改为账单口径说明
4. HUI 五月自测：Net Proceeds=66574.25、VAT=4698.8 已复现

## 已产品化（2026-09-30）

- AppState `settlementMonths` + portal 导入域 `statements`（文件名含 `financeweb_statements` / `statements_`）
- `GET /api/finance/settlement`：月表 Net Proceeds / 四费 / VAT / 覆盖日期；纯利 = `(NP−费−VAT)×fx − 采购 − 头程`（采购/头程来自 `salesFacts×skuLocalCosts`，包装暂 0）
- 财务页「结算对账」分区；经营概览仍保留且标明非账单口径
- 聚合逻辑：`apps/api/src/modules/finance/statement-settlement.ts`（对齐本脚本 `load_statement`）

## 月度关账 SOP（第一期，2026-10-06）

正式「本月收益」只认 **次月 5 日关账快照**，不是月底当天的草稿。

1. **每月 1～2 日**：销量可先齐（Impex / 门户 sales）。这是经营口径，**不要**当关账营业额。
2. **每月 3～5 日**：两店 Noon **Payments → Statements** 下载 `noon_financeweb_statements_*.csv`（日期含上月全月），放入对应店 `portal-imports`（文件名须含 `financeweb_statements`）。
3. **齐套标准**：上月最后一段 Reference 日期 = 该月最后一天（如 9 月要有 `…SA20260930`），财务页覆盖不再显示「未满月」。
4. **关账**：财务页「关账上月」，或等调度 `gp-month-close` 在 **上海时间 5 日 10:00** 自动关（门禁不过则告警，不造数）。3 日提醒缺月末段，8 日仍未关升级。
5. **终稿**：`gpMonthCloses` 冻结数字；再导入 CSV 只更新草稿。要改已关账月必须「更正关账」`replace: true`。

公式不变：`纯利=(Net Proceeds−平台四费−VAT)×锁定汇率−采购−头程−包装`。包装暂 0。Impex 无 Statements 类目，第一期不自动拉账单。

## 仍可追问用户（非阻塞）

- 同事五月平台费写死 **36022.74** vs 账单四费 **≈30803.75**：多出约 **5219** 来源不明；本表未补。若要对齐同事表，需对方说明差额构成。
- 两店 9 月账单 statement 末段停在 **2026-09-23**；若还有月末段，导出后可重跑 `_rebuild_gp_summary_fx176.py`

## 明确不要做

- 不用 `0.5kg` 伪头程
- 不用 Transaction View 冒充 Statement 平台费（除非用户书面改口径）
- 不把未说明来源的差额写进平台费
