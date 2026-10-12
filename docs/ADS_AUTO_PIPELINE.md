# 全自动链路：Ads「昨天」按店导出 → 慧运营 Catalog 投产比

## 目标段

```
Ad Manager（按 shop 循环）
  → Campaigns → 日期=Yesterday → Export all campaigns
  → Downloads/{shopId}/_OVERVIEW_ALL_Report_{Y}_{Y}.xlsx
  → Exports/ads/{shopId}/ads_sku_{Y}_{Y}.csv（含 atc）
  → D:\outpost-data\shops\{shopId}\portal-imports\   ← 仅本店，禁止串店
  → 慧运营对该店 auto-ingest（域 ads）
  → state.adsFacts（含 atc）→ Catalog 投产比 / Listing 优化漏斗
```

默认对接店：`PRJ482387`、`PRJ396770`（`OUTPOST_YD_ADS_SHOPS` 可覆盖）。

规范 CSV 列：`sku,campaign_name,from_date,to_date,spend,revenue,orders,views,clicks,atc`（ATC=加购；旧文件无此列时入库为 0）。

## 角色分工

| 段 | 谁做 | 说明 |
|----|------|------|
| 换店 + Yesterday + Export | **Playwright job ads** | `python main.py ads ui`；见 [`PW_RPA_PLATFORM.md`](./PW_RPA_PLATFORM.md) |
| 下载 | Playwright `expect_download` + CDP | `D:\YingDao\Downloads\{shopId}\` |
| xlsx→CSV + 隔离投递 | `outpost_bridge` | `deliver_to_portal(..., shop_id=)`，**不写**全局 `portal-imports` |
| 识域入库 + 拼装 | **慧运营** | 扫当前店 `shops/{id}/portal-imports`；取最新 `ads_sku_*.csv` |

## 怎么跑

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py ads ui
```

广告页「导出广告表」或 `POST /api/pw-rpa/ads/run`。影刀 `outpost_noon_ads_export` 仅手工。

| MODE | 用途 |
|------|------|
| `ui`（默认） | 两店顺序：Yesterday → Export → 按店投递 |
| `inbox` | 处理已下载文件；需 `OUTPOST_YD_ADS_SHOP` 或文件名前缀 `PRJ…_` |
| `demo` | 两店各写样例 CSV |

| 环境变量 | 含义 | 默认 |
|----------|------|------|
| `OUTPOST_YD_ADS_RANGE` | `yesterday` / `days` | `yesterday` |
| `OUTPOST_YD_ADS_DAYS` | `days` 模式下近 N 天（建议 7） | `yesterday` 时为 1；`days` 时默认 7 |
| `OUTPOST_YD_ADS_SHOPS` | 逗号分隔 shopId | `PRJ482387,PRJ396770` |
| `OUTPOST_YD_ADS_SHOP` | inbox 单店 | 列表第一店 |
| `OUTPOST_YD_BROWSER` | chrome/cef/edge | chrome |

### 双轨建议（Catalog 日更 + Listing 优化）

| 用途 | 影刀环境变量 | UI 选区 | 文件名示例 |
|------|--------------|---------|------------|
| Catalog 投产比日更 | `OUTPOST_YD_ADS_RANGE=yesterday` | Yesterday | `ads_sku_Y_Y.csv` |
| Listing 优化漏斗 | `OUTPOST_YD_ADS_RANGE=days` + `OUTPOST_YD_ADS_DAYS=7` | Last 7 days | `ads_sku_from_to.csv` |

同一 job 可用不同环境变量跑 Yesterday 与 Last 7 days。前提：本机 Chrome **已登录** Ad Manager（`python main.py ads login`）。

## 慧运营怎么看

1. **先**跑 Playwright 广告导出（两店 Yesterday → 各店 `portal-imports`）
2. API 在跑，切到目标店
3. Catalog → **汇总同步**（含 `ads_ingest`）或「扫目录」
4. 刷新 →「投产比」列

时效说明：

- 广告默认定时建议 **Yesterday** 单日报，供 Catalog 投产比日更。
- Listing 优化建议另跑一趟 **Last 7 days**（`OUTPOST_YD_ADS_RANGE=days`，`OUTPOST_YD_ADS_DAYS=7`），否则 CTR/CVR/ATC 样本过噪。
- 投产比列优先用落在近 7 日内的广告事实——若只有昨日报，数值≈昨日 ROAS，不要当成「过去 7 天累计广告」。

最新文件：`shops/{shopId}/portal-imports/` 下 `ads_sku_*.csv` 按 mtime（bridge `latest_ads_csv`）。

## 相关代码

- Playwright：`apps/api/scripts/noon-pw-platform/`（ads 转调 `noon-ads-export-pw`）
- 规范：`D:\YingDao\Flows\_lib\outpost_bridge.py`
- 慧运营解析：`apps/api/src/platforms/noon/portal/parsers.ts`
- 入库：`auto-ingest.ts`（只吃 csv/json/txt）

### 页面触发导出

广告页「导出广告表」→ `POST /api/pw-rpa/ads/run`（兼容 `/api/ads/yingdao-export/run`）。**不再写** `Requests/pending`。Watcher `outpost_ads_export_watcher` 已下岗。

Listing 「拉取广告表」走 `/api/ads/ensure-export`，背后同样是 Playwright。


```powershell
cd D:\Outpost_ERP\apps\api
D:\devtools\nodejs\node.exe D:\Outpost_ERP\node_modules\tsx\dist\cli.mjs scripts\ingest-ads-once.mts
```
