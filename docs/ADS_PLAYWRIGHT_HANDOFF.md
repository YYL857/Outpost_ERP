# Noon Ads Playwright 替换影刀 · 窗口交接

> 更新：2026-10-06 · 广告已收编进 `noon-pw-platform` job `ads`（`python main.py ads ui`）。全链路见 [`PW_RPA_PLATFORM.md`](./PW_RPA_PLATFORM.md)。

**广告导出生产走 Playwright；其它影刀（市场情报/耗材）仍保留。**

---

## 本窗口目标（已完成）

生产里所有「触发广告导出」改为：

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py ads ui
```

落盘仍是店隔离 `portal-imports/ads_sku_*.csv`，再「同步广告」入库。  
**不再 spawn 影刀 CLI `ads-export`，不再写 `Requests/pending/ads_export_*.json`。**

完成标准：广告页一键导出、数据补洞缺 ads 时，都只跑 Playwright；影刀 `outpost_noon_ads_export` 不再被本仓库调用。

---

## 已改文件（touch-only）

| 入口 | 现在 |
|------|------|
| `apps/api/src/modules/ads/ads-pw-cli.ts` | **新建**：spawn `python main.py ui`，支持 shops/range/days 环境变量 |
| `apps/api/src/modules/ads/yingdao-cli.ts` | 薄别名 → ads-pw-cli（兼容旧 import） |
| `apps/api/src/modules/ads/ads.routes.ts` | `/yingdao-export/run` + ensure/request-export 背后改 Playwright；文案去「影刀」 |
| `apps/api/src/modules/sync/data-backfill.ts` | 一键补齐改为扫本地 portal-imports（不自动开 Playwright/Impex）；缺数给取数指引 |
| `apps/web/src/pages/AdsPage.tsx` | 「导出广告表」 |
| `apps/web/src/api.ts` | `runAdsPwExport`（旧名保留 deprecated） |
| `apps/web/src/pages/ListingOptimizePanel.tsx` | 文案跟 ensure-export 对齐 |
| `apps/web/src/pages/SyncHealthPage.tsx` | 补洞确认文案 |

未动：市场情报/耗材影刀、Impex、飞书。  
**继续复用** `D:\YingDao\Flows\_lib\outpost_bridge.py`。平台调度：`apps/api/src/modules/pw-rpa/`。

---

## 明确不要动（仍有效）

- 其它影刀：`market-intel`、销量、FBN、keepalive、noon-align
- 不要改 `parseAdsContent` 丢 0 花费行
- 不要接 Scrapling / 直连 `advertising.noon.com`
- 不要重做登录/点击链
- 不要为 Brand 广告加新口径
- 不要改飞书 / Catalog 拼装 / 市场情报

---

## 接线注意

- 浏览器必须 **launch + storage_state**，不要 `launch_persistent_context`
- 环境变量：`OUTPOST_YD_ADS_SHOPS` / `RANGE` / `DAYS`；另有 `OUTPOST_ADS_PW_*`、`OUTPOST_ADS_PW_PYTHON`
- 补洞多日缺口：`OUTPOST_YD_ADS_RANGE=days`；单日 yesterday
- cookie 过期：`python main.py login`

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-ads-export-pw
python main.py login
python main.py ui
```

---

## 落盘

| 阶段 | 路径 |
|------|------|
| 原表 | `D:\YingDao\Downloads\{shopId}\` |
| 规范 CSV | `D:\YingDao\Exports\ads\{shopId}\ads_sku_{from}_{to}.csv` |
| 入库 | `D:\outpost-data\shops\{shopId}\portal-imports\ads_sku_{from}_{to}.csv` |

---

## 验收清单

1. ✅ 广告页一键导出走 Playwright（`ads-pw-cli` spawn python），不出现影刀 CLI
2. ✅ 补洞缺 ads **不写** pending，不 spawn `ads-export`
3. ⬜ 两店落到各自 portal-imports；汇总同步后 adsFacts 覆盖昨天（需本机实跑确认）
4. ✅ 仓库生产路径不再调用 `yingdao-run.mjs run ads-export`（手工仍可跑）
