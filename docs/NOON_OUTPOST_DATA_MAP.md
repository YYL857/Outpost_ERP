# NOON → 慧运营数据域映射

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

| NOON 来源 | SyncDomain | 落库 | 同步方式 | 慧运营主页面 | 可引用页 |
|-----------|------------|------|----------|------------|----------|
| Catalog Exports `*_live.csv` / `*_notlive.csv` | `catalog` | `state.catalog` | **live**：Impex `catalogexport`；portal：SOP | **Catalog** | 链接上架 |
| Inventory / FBN detailed | `stock` | `state.stock` | **live**：catalog 内嵌 hints / FBN Impex；portal：SOP | **Catalog**（库存列） | 补货计划、发货管理（二期独立页） |
| Orders（Seller Lab 订单） | `orders` | `state.orders` | **live**：Impex `ordersexport`；portal：SOP/会话 | **销量统计**（订单履约）、**同步健康** | Best Sell、财务报表收入 |
| Sales / Product views & sales | `sales` | `state.salesFacts` | **live**：Impex `productviewsandsalesdata`（已接线）；失败时影刀/SOP CSV | **销量统计**（SKU×日销量主数据） | Catalog 3/7/14/30 日窗口（件数+GMV） |
| Transaction View（item level） | `fees` | `state.feeSnapshots` | **live**：Impex `transactionviewreportonitemlevel`（已接线）；失败时影刀/SOP CSV | **财务报表**（平台佣金/出库费） | Catalog 毛利列 |
| My Catalog Estimated Fees（FBN/FBP） | `fee_estimates`（非 SyncDomain） | `state.feeEstimates` | Impex catalog CSV 含列则顺带解析；否则影刀 Export → `catalog_est_fees_*.csv` | **仅 Catalog 补缺** | 不进财务报表 |
| FBN Inventory Dimensions | `fbn_dims`（非 SyncDomain） | `state.skuDims`（`source=noon:fbn_inventory`，仅补空） | Impex/库存 Export 含尺寸列则顺带；否则影刀 → `fbn_dims_*.csv` | **Catalog 规格补缺** | 飞书产品表优先 |
| Noon Ads Campaign Overview（SKU sheet CSV） | `ads` | `state.adsFacts` | **无官方 Impex** → **影刀** Export all → portal-imports；见 [`YINGDAO_BRIDGE.md`](./YINGDAO_BRIDGE.md) | **广告管理**（主存） | **Catalog 投产比**（ROAS=ΣRevenue/ΣSpend） |

### 语义拆分（勿混）

| 数据 | 含义 | 不要当成 |
|------|------|----------|
| `orders` | 订单履约单据 | 不是 SKU 日销量主表 |
| `salesFacts` | 平台销售报表（SKU×日） | 不是财务科目 |
| `feeSnapshots` | 佣金率/出库费等平台费用（Transaction View） | 不是本地头程/采购成本；不是 Estimated Fees |
| `feeEstimates` | My Catalog Estimated Fees 估费补缺 | 不得覆盖 `feeSnapshots`；财务页不读 |
| `adsFacts` | 广告 SKU 区间花费/归因收入 | 不是全站销量；ROAS 用 Σ 重算 |
| `catalog` | 在线/不在线商品主档 | 不是库存账本 |
| `stock` | 仓存/在途 | 不是销量；尺寸走 `skuDims` 补缺 |
| `skuDims` | 尺寸重量（飞书产品优先，装箱/FBN 仅补空） | 不是库存数量 |

---

## 第二期及以后（映射先登记，页面多为占位）

| NOON 来源（种子/待核实） | SyncDomain | 慧运营主页面 | Wave |
|--------------------------|------------|------------|------|
| Ads / Noon Ads | `ads` | 广告管理（主）+ Catalog 投产比列 | 2（入库已通；导出走影刀，UI 全自动待元素捕获） |
| Campaigns / promos | `campaigns` | 活动管理 | 2 |
| Shipments / inbound / PO | `supply`（可再拆） | 采购管理 / 补货计划 / 发货管理 | 2 |
| Pricing | `pricing` | Catalog 定价列（未实现） | 2 |
| Settlements / Finance portal | `fees` 或独立 `settlements` | 财务报表（结算明细） | 2 |

亚马逊上架、1688 上架、选品助手：**非 NOON 源**，不走本映射。

---

## 慧运营侧栏对照

| 慧运营页面 | 主要吃哪些 SyncDomain |
|----------|------------------------|
| NOON 接入 | 配置 + SOP 编排（非业务展示） |
| 同步健康 | 各域条数 / job / inbox |
| Catalog | catalog + stock +（引用）sales + fees + ads |
| 销量统计 | **sales（主）** + orders（履约补充） |
| 财务报表 | **fees（平台费用）** + orders 收入 + 本地运费/测评 |
| Best Sell | orders / sales（汇总） |
| 链接上架 | catalog SKU 列表 |
| 广告管理 | **ads（主）**；Catalog 只引用投产比 |

---

## 当前错位与纠正

| 问题 | 纠正 |
|------|------|
| 销量页只读 `orders` | 主读 `salesFacts`，订单作履约补充 |
| 财务页不用 `feeSnapshots` | 分栏展示平台佣金/出库费 |
| SOP 无 orders | 增加可选 `/orders` Export；仍保留会话拉取 |
| 一键同步语义含糊 | NOON 接入页列出分域映射状态 |

---

## 冲突时官方最新导出优先

Catalog 多源拼装时，字段以主源为准，冲突按下表权重（数字越小越高）：

| 优先级 | 源 | 写入字段 |
|--------|-----|----------|
| 1 | Noon 官方 Catalog 导出（Impex / 影刀落入的同源 CSV） | **售价**、标题、SKU、在售、库存 hints |
| 2 | Noon Transaction View | 佣金率、出仓费 |
| 3 | Estimated Fees **仅 FBN** | TV 缺佣金/出仓时补缺；**忽略 FBP** |
| 4 | 飞书 | 采购价、运输方式、尺寸、货物类型；**禁止**在线价覆盖售价 |
| 5 | 影刀 | 广告 facts |
| 6 | 首页运输配置 | 空运/海运费率、汇率、体积重除数 |

售价规则：`upsertCatalog` 拒绝更旧的 `updatedAt`；价列优先 `active_price` → `sale_price` → `offer_price` → `price`。

---

## 相关文件

- 探测脚本：[`scripts/noon-discover/`](../scripts/noon-discover/)
- SOP：[`apps/api/src/platforms/noon/portal/sop-selectors.json`](../apps/api/src/platforms/noon/portal/sop-selectors.json)
- 入库识域：[`parsers.ts`](../apps/api/src/platforms/noon/portal/parsers.ts) `detectDomainFromFilename`
