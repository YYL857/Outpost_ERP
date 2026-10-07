# 慧运营 × 影刀（RPA）桥接

Noon 对 Playwright/脚本反自动化时，**需要真人点击的导出**改由影刀完成，慧运营只消费落盘文件。

## 契约

```
影刀（单应用按店循环）导出「昨天」广告报表
  → D:\YingDao\Downloads\{shopId}\ + Exports\ads\{shopId}\
  → D:\outpost-data\shops\{shopId}\portal-imports\ads_sku_{Y}_{Y}.csv
  → 慧运营对该店 auto-ingest
  → Catalog 投产比
```

| 项 | 约定 |
|----|------|
| 影刀工作区 | `D:\YingDao\` |
| 热目录（按店） | `D:\outpost-data\shops\{shopId}\portal-imports` |
| Ads 规范名 | `ads_sku_YYYY-MM-DD_YYYY-MM-DD.csv`（昨天：from=to） |
| 对接店 | `PRJ482387`、`PRJ396770`（`OUTPOST_YD_ADS_SHOPS`） |
| 隔离 | 禁止写入全局 `portal-imports`；禁止写死单店目录 |
| 解析 | `apps/api/src/platforms/noon/portal/parsers.ts` |

## 影刀应用

详见 `D:\YingDao\Flows\CAPABILITY.md` 与 `GAP_MATRIX.md`。

| 空缺 | 影刀应用 |
|------|----------|
| Ads Campaign Overview（投产比） | `outpost_noon_ads_export`（Export all → 规范 CSV） |
| My Catalog Estimated Fees（佣金/出仓补缺） | 待建：打开 Partners Catalog → Export → `shops/{shopId}/portal-imports/catalog_est_fees_YYYY-MM-DD.csv`（慧运营域 `fee_estimates`，**不**写 `feeSnapshots`） |
| FBN Inventory 尺寸重量（规格补缺） | 待建：FBN Inventory → Export → `shops/{shopId}/portal-imports/fbn_dims_YYYY-MM-DD.csv`（域 `fbn_dims`，仅补空 `skuDims`） |
| SOP 失败时任意报表兜底 | `outpost_inbox_deliver` |
| Noon 沙特市场情报类目列表 | `outpost_noon_sa_market_intel` → `market-imports/noon/sa/inbox/yingdao` |

**Catalog 补缺规范名（禁止写全局 `portal-imports`）**

| 文件 | 域 | 落库 |
|------|-----|------|
| `catalog_est_fees_YYYY-MM-DD.csv` | `fee_estimates` | `feeEstimates`（财务不读） |
| `fbn_dims_YYYY-MM-DD.csv` | `fbn_dims` | `skuDims` 仅补空 |

全量导出链路说明：[`ADS_AUTO_PIPELINE.md`](./ADS_AUTO_PIPELINE.md)  
市场情报投递：[`MARKET_INTEL_YINGDAO.md`](./MARKET_INTEL_YINGDAO.md)

## 慧运营侧操作

1. 保证 API 在跑、热目录可写  
2. **NOON 接入** → 扫目录入库（或等待 watcher）  
3. **Catalog** → 刷新，看投产比列  

无匹配 SKU 时投产比为 `—`（样例 `N1-DEMO-SKU` 需换成真实 partnerSku）。

## 与 SOP 的关系

- Impex / 可用的 SOP：仍走慧运营自动同步  
- Ads 及被 Akamai 打断的门户导出：走影刀  
- 两边最终都进**当前店**的 `shops/{shopId}/portal-imports`（按店隔离）
