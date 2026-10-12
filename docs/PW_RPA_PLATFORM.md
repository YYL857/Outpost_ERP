# Noon Playwright 爬虫平台

窗口交接（换窗先读）：[`PW_RPA_HANDOFF.md`](./PW_RPA_HANDOFF.md)

生产里「必须点门户导出」的链路由本平台调度，数据仍进慧运营：各店 `portal-imports` → auto-ingest / 汇总同步。

**官方 Impex / 飞书不动。** 买家商城前台（市场情报 / 耗材 Sold Recently）**仍走影刀**，不用 Playwright 替换。

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py ads ui
python main.py sales ui
python main.py keepalive ui
python main.py ads login
python main.py sales login
```

API（需 admin）：`POST /api/pw-rpa/:job/run`，`GET /api/pw-rpa/:job/status`。广告页旧路径 `/ads/yingdao-export/*` 转调 job `ads`。

| job | 落盘 | 入库 |
|-----|------|------|
| ads | `ads_sku_{from}_{to}.csv` | adsFacts（导出结束自动入库最新表） |
| sales | `sales_export_{from}_{to}.csv` | salesFacts（导出结束自动入库最新表） |
| keepalive | 无业务文件 | 刷新 `noon-ads-pw` + `noon-seller-pw` cookie |

Cookie 分站点：Ad Manager ≠ Seller Lab。浏览器必须 `launch + storage_state`。复用 `D:\YingDao\Flows\_lib\outpost_bridge.py`。

定时保活已下线（不再自动弹 Chrome）；需续 cookie 时手工跑 `python main.py keepalive ui`。

## 影刀下岗范围

| 别名 | 状态 |
|------|------|
| ads-export | 生产不再调用 |
| sales-export | 生产不再调用 |
| noon-keepalive | 生产不再调用 |
| fbn-stock | 下岗，分仓用 Impex Detailed |
| noon-align / inbox / demo | 归档，非日更 |
| market-intel / consumables | **仍用影刀**（买家商城前台） |

手工 `yingdao-run.mjs run ads-export` 仍可跑，会打废弃警告。
