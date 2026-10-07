# 全自动链路：Ads「昨天」按店导出 → 慧运营 Catalog 投产比

## 目标段

```
Ad Manager（按 shop 循环）
  → Campaigns → 日期=Yesterday → Export all campaigns
  → Downloads/{shopId}/_OVERVIEW_ALL_Report_{Y}_{Y}.xlsx
  → Exports/ads/{shopId}/ads_sku_{Y}_{Y}.csv
  → D:\outpost-data\shops\{shopId}\portal-imports\   ← 仅本店，禁止串店
  → 慧运营对该店 auto-ingest（域 ads）
  → state.adsFacts → Catalog 投产比
```

默认对接店：`PRJ482387`、`PRJ396770`（`OUTPOST_YD_ADS_SHOPS` 可覆盖）。

## 角色分工

| 段 | 谁做 | 说明 |
|----|------|------|
| 换店 + Yesterday + Export | **影刀**（单应用顺序循环） | URL `?project={shopId}&tab=campaigns`；弹层换店为 fallback |
| 另存为 | **影刀** `web.handle_save_dialog` | 落到 `D:\YingDao\Downloads\{shopId}\` |
| xlsx→CSV + 隔离投递 | **影刀 bridge** | `deliver_to_portal(..., shop_id=)`，**不写**全局 `portal-imports` |
| 识域入库 + 拼装 | **慧运营** | 扫当前店 `shops/{id}/portal-imports`；取最新 `ads_sku_*.csv` |

## 影刀怎么跑

应用：`D:\YingDao\Flows\outpost_noon_ads_export\`（部署/打包后同步 `main.py` + `_lib/outpost_bridge.py`）

| MODE | 用途 |
|------|------|
| `ui`（默认） | 两店顺序：Yesterday → Export → 按店投递 |
| `inbox` | 处理已下载文件；需 `OUTPOST_YD_ADS_SHOP` 或文件名前缀 `PRJ…_` |
| `demo` | 两店各写样例 CSV |

| 环境变量 | 含义 | 默认 |
|----------|------|------|
| `OUTPOST_YD_ADS_RANGE` | `yesterday` / `days` | `yesterday` |
| `OUTPOST_YD_ADS_SHOPS` | 逗号分隔 shopId | `PRJ482387,PRJ396770` |
| `OUTPOST_YD_ADS_SHOP` | inbox 单店 | 列表第一店 |
| `OUTPOST_YD_BROWSER` | chrome/cef/edge | chrome |

前提：本机 Chrome **已登录** Ad Manager。

## 慧运营怎么看

1. **先**跑影刀导出（两店 Yesterday → 各店 `portal-imports`）
2. API 在跑，切到目标店
3. Catalog → **汇总同步**（含 `ads_ingest`）或「扫目录」
4. 刷新 →「投产比」列

时效说明：广告默认是**昨天**单日报；销量/库存来自 Noon 近实时窗口。投产比列优先用落在近 7 日内的广告事实——若只有昨日报，数值≈昨日 ROAS，不要当成「过去 7 天累计广告」。若要对齐销量 7 日，影刀改导 Last 7 days，或每日累积昨日报。

最新文件：`shops/{shopId}/portal-imports/` 下 `ads_sku_*.csv` 按 mtime（bridge `latest_ads_csv`）。

## 相关代码

- 影刀：`D:\YingDao\Flows\outpost_noon_ads_export\main.py`
- 规范：`D:\YingDao\Flows\_lib\outpost_bridge.py`
- 慧运营解析：`apps/api/src/platforms/noon/portal/parsers.ts`
- 入库：`auto-ingest.ts`（只吃 csv/json/txt）

补跑入库（按当前活跃店）：

```powershell
cd D:\Outpost_ERP\apps\api
D:\devtools\nodejs\node.exe D:\Outpost_ERP\node_modules\tsx\dist\cli.mjs scripts\ingest-ads-once.mts
```
