# Noon Playwright 爬虫平台

生产里「必须点门户导出」的链路由本目录调度：`ads` / `sales` / `keepalive`；另有试跑中的 `ads-budget`（峰期改预算，默认仅 `PRJ488078`）。  
ads/sales 落盘经桥接投递到各店 `D:\outpost-data\shops\{shopId}\portal-imports\`，再 auto-ingest 进 `state.json`。

完整说明见仓库 [`docs/PW_RPA_PLATFORM.md`](../../../../docs/PW_RPA_PLATFORM.md)。  
预算峰期切换见 [`docs/ADS_BUDGET_PEAK_HANDOFF.md`](../../../../docs/ADS_BUDGET_PEAK_HANDOFF.md)。

```powershell
python -m pip install -r requirements.txt
python -m playwright install chromium
python main.py ads login
python main.py sales login
python main.py ads ui
python main.py sales ui
python main.py keepalive ui
python main.py ads-budget probe
python main.py ads-budget sync --refresh-baseline
python main.py ads-budget apply --dry-run
```

| job | 入库文件（portal-imports） |
|-----|---------------------------|
| ads | `ads_sku_{from}_{to}.csv` |
| sales | `sales_export_{from}_{to}.csv` |
| keepalive | 无业务文件（刷新 cookie） |
| ads-budget | 不进 portal-imports；写 `shops/{id}/ads-budget/baseline.csv` |

API：`POST /api/pw-rpa/:job/run`（需 admin；`ads-budget` 首期仅 CLI）。订单 / 库存 / 价库等仍走 Partner Impex，不经本平台。
