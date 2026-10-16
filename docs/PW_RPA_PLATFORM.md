# Noon Playwright 爬虫平台

窗口交接（换窗先读）：[`PW_RPA_HANDOFF.md`](./PW_RPA_HANDOFF.md)

生产里「必须点门户导出」的链路由本平台调度，数据进慧运营：各店 `portal-imports` → auto-ingest / 汇总同步。

**官方 Impex / 飞书不动。** 买家商城前台（市场情报 / 耗材 Sold Recently）不在本平台，另线处理。

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py ads ui
python main.py sales ui
python main.py keepalive ui
python main.py ads login
python main.py sales login
# 广告预算峰期切换（默认仅 PRJ488078；详见 ADS_BUDGET_PEAK_HANDOFF.md）
python main.py ads-budget probe
python main.py ads-budget sync --refresh-baseline
python main.py ads-budget apply --dry-run
```

API（需 admin）：`POST /api/pw-rpa/:job/run`，`GET /api/pw-rpa/:job/status`。广告页兼容路径 `/ads/yingdao-export/*` 转调 job `ads`（路由别名，非产品名）。

| job | 落盘 | 入库 |
|-----|------|------|
| ads | `ads_sku_{from}_{to}.csv` | adsFacts（导出结束自动入库最新表） |
| sales | `sales_export_{from}_{to}.csv` | salesFacts（导出结束自动入库最新表） |
| keepalive | 无业务文件 | 刷新 `noon-ads-pw` + `noon-seller-pw` cookie |
| ads-budget | `shops/{id}/ads-budget/baseline.csv` | 不进 adsFacts；峰期/低峰改 Live 日预算；API 墙钟定时 peak@00:10 / offpeak@09:10（试店，见 [`ADS_BUDGET_PEAK_HANDOFF.md`](./ADS_BUDGET_PEAK_HANDOFF.md)） |

Cookie 分站点：Ad Manager ≠ Seller Lab。浏览器必须 `launch + storage_state`。  
桥接库：`D:\YingDao\Flows\_lib\outpost_bridge.py`（历史目录名；原始表/规范 CSV 暂存其 Downloads/Exports，**权威入库**为各店 `portal-imports`）。

定时保活已下线（不再自动弹 Chrome）；需续 cookie 时手工跑 `python main.py keepalive ui`。

## 生产调度范围

| 能力 | 状态 |
|------|------|
| ads 导出 | Playwright 生产主路径 |
| sales 门户导出 | Playwright 生产主路径 |
| cookie keepalive | 手工 Playwright |
| FBN 分仓库存 | Impex Detailed（非本平台） |
| 订单 / 销售报表 / 价库 / 费用 | Impex live（非本平台） |
| 市场情报 / 耗材前台 | 另线（非本平台） |
