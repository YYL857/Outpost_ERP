# 影刀工具链归档（非日更）

生产日更：Playwright 平台 [`PW_RPA_PLATFORM.md`](./PW_RPA_PLATFORM.md) + Noon Impex + 飞书。  
下列应用**仓库不再调用**，可留在 `D:\YingDao\Flows` 手工跑。

| Flow / 应用 | 原用途 | 现状态 |
|-------------|--------|--------|
| `outpost_noon_ads_export` | 广告导出 | 生产 → job `ads` |
| `outpost_ads_export_watcher` | 消费 `Requests/pending/ads_export_*` | 生产不再写 pending |
| `outpost_noon_ads_keepalive` / `noon-keepalive` | Ad Manager 保活 | 生产 → job `keepalive` |
| `outpost_noon_sales_export` | 门户 Sales | 生产 → job `sales` |
| `outpost_noon_fbn_stock_export` | 门户分仓 Summary | 下岗；Impex Detailed |
| `outpost_noon_guide_capture` / `noon-align` | 后台向导截图 | 非日更；需要时再迁 |
| `outpost_inbox_deliver` | SOP 失败兜底投递 | 归档 |
| `outpost_demo_bounds` | 边界演示 | 归档 |
| `flow_noon_*` | 旧 FLOW 平台 | 非 Outpost 生产 |

仍用影刀：`outpost_noon_sa_market_intel`、`outpost_noon_sa_consumables`、`outpost_mi_consumables_watcher`。
