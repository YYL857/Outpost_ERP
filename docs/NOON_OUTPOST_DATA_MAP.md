# NOON → 前哨数据域映射

原则：**一源一域、一域一主页面**。Catalog 只做商品拼装视图，可引用库存/销量/费用字段，但不是这些域的主存页。

> 探测状态（2026-09-15）：实时爬取因 Akamai `fault filter abort` 失败。下表基于现有 SOP（[`sop-selectors.json`](../apps/api/src/platforms/noon/portal/sop-selectors.json)）、种子 URL 与已入库样例 CSV。重新登录后请再跑：
>
> ```powershell
> node scripts/noon-discover/discover-nav.mjs
> node scripts/noon-discover/discover-pages.mjs
> node scripts/noon-discover/discover-network.mjs
> ```
>
> 输出：`scripts/noon-discover/out/`（含 `mapping-draft.json`）

---

## 第一期（经营核心）

| NOON 来源 | SyncDomain | 落库 | 同步方式 | 前哨主页面 | 可引用页 |
|-----------|------------|------|----------|------------|----------|
| Catalog Exports `*_live.csv` / `*_notlive.csv` | `catalog` | `state.catalog` | SOP → portal-imports | **Catalog** | 链接上架 |
| Inventory / FBN detailed | `stock` | `state.stock` | SOP | **Catalog**（库存列） | 补货计划、发货管理（二期独立页） |
| Orders（Seller Lab 订单） | `orders` | `state.orders` | 会话/XHR 或手工；SOP 尝试 `/orders` Export | **销量统计**（订单履约）、**同步健康** | Best Sell、财务报表收入 |
| Sales export | `sales` | `state.salesFacts` | SOP `/sales` | **销量统计**（SKU×日销量主数据） | Catalog 3/7/14/30 日窗口 |
| Transaction View | `fees` | `state.feeSnapshots` | SOP `/transaction-view` | **财务报表**（平台佣金/出库费） | Catalog 毛利列 |

### 语义拆分（勿混）

| 数据 | 含义 | 不要当成 |
|------|------|----------|
| `orders` | 订单履约单据 | 不是 SKU 日销量主表 |
| `salesFacts` | 平台销售报表（SKU×日） | 不是财务科目 |
| `feeSnapshots` | 佣金率/出库费等平台费用 | 不是本地头程/采购成本 |
| `catalog` | 在线/不在线商品主档 | 不是库存账本 |
| `stock` | 仓存/在途 | 不是销量 |

---

## 第二期及以后（映射先登记，页面多为占位）

| NOON 来源（种子/待核实） | SyncDomain | 前哨主页面 | Wave |
|--------------------------|------------|------------|------|
| Ads / Noon Ads | `ads` | 广告管理 | 2 |
| Campaigns / promos | `campaigns` | 活动管理 | 2 |
| Shipments / inbound / PO | `supply`（可再拆） | 采购管理 / 补货计划 / 发货管理 | 2 |
| Pricing | `pricing` | Catalog 定价列（未实现） | 2 |
| Settlements / Finance portal | `fees` 或独立 `settlements` | 财务报表（结算明细） | 2 |

亚马逊上架、1688 上架、选品助手：**非 NOON 源**，不走本映射。

---

## 前哨侧栏对照

| 前哨页面 | 主要吃哪些 SyncDomain |
|----------|------------------------|
| NOON 接入 | 配置 + SOP 编排（非业务展示） |
| 同步健康 | 各域条数 / job / inbox |
| Catalog | catalog + stock +（引用）sales + fees |
| 销量统计 | **sales（主）** + orders（履约补充） |
| 财务报表 | **fees（平台费用）** + orders 收入 + 本地运费/测评 |
| Best Sell | orders / sales（汇总） |
| 链接上架 | catalog SKU 列表 |
| 广告/活动/采购/补货/发货 | 二期；当前占位，禁止硬灌进 Catalog |

---

## 当前错位与纠正

| 问题 | 纠正 |
|------|------|
| 销量页只读 `orders` | 主读 `salesFacts`，订单作履约补充 |
| 财务页不用 `feeSnapshots` | 分栏展示平台佣金/出库费 |
| SOP 无 orders | 增加可选 `/orders` Export；仍保留会话拉取 |
| 一键同步语义含糊 | NOON 接入页列出分域映射状态 |

---

## 相关文件

- 探测脚本：[`scripts/noon-discover/`](../scripts/noon-discover/)
- SOP：[`apps/api/src/platforms/noon/portal/sop-selectors.json`](../apps/api/src/platforms/noon/portal/sop-selectors.json)
- 入库识域：[`parsers.ts`](../apps/api/src/platforms/noon/portal/parsers.ts) `detectDomainFromFilename`
