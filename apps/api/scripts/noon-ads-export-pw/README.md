# Noon Ads 导出（Playwright）

用本机持久化浏览器登录 Ad Manager，导出 Campaigns Overview，规范为 `ads_sku_*.csv` 并投递到各店 `portal-imports`。

**生产主路径**已是 Playwright（广告页一键导出 / 数据补洞 / `pw-rpa` job `ads` → `python main.py ads ui`）。日常请优先用统一平台目录 [`noon-pw-platform`](../noon-pw-platform/README.md)；本目录为同链路的独立脚本与说明。

## 官方步骤对齐

```
admanager.noon.partners → ?project={shop}&tab=campaigns
  → Campaigns
  → Yesterday（或 Last 7 days）
  → Export campaigns（现入口；旧文案 Export all campaigns / Export Data→Campaign Overview 仍作兜底）
  → 下载 OVERVIEW xlsx
  → outpost_bridge 规范 ads_sku_*.csv
  → D:\outpost-data\shops\{shopId}\portal-imports\
```

## 安装（一次）

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-ads-export-pw
python -m pip install -r requirements.txt
python -m playwright install chromium
```

## 用法

```powershell
# 1) 有头登录（首次 / cookie 过期）：弹出 Chrome，在窗口里登录 Ad Manager；脚本检测到离开登录页后自动保存 profile
python main.py login

# 2) 只探测能否进页、页面上有哪些 Export 文案（不点导出）
python main.py probe

# 3) 真导出（默认昨天、两店）
python main.py ui

# 近 7 天
$env:OUTPOST_YD_ADS_RANGE="days"; $env:OUTPOST_YD_ADS_DAYS="7"; python main.py ui

# 单店
$env:OUTPOST_YD_ADS_SHOPS="PRJ482387"; python main.py ui
```

持久化 cookie：`D:\outpost-data\browser-profiles\noon-ads-pw\storage_state.json`  
日志默认：`D:\YingDao\Logs\ads_export_pw_*.log`（历史目录名，可用 `YINGDAO_LOG_DIR` 覆盖）

## 落盘路径（不要看 Chrome「下载记录」）

Chrome 里若出现一串 UUID，那是浏览器内部临时名，**不是**入库文件。正式路径：

| 阶段 | 路径 | 文件名 |
|------|------|--------|
| 原始表 | `D:\YingDao\Downloads\{shopId}\` | `{shopId}_campaigns-export_{from}_{to}.xlsx` |
| 规范 CSV | `D:\YingDao\Exports\ads\{shopId}\` | `ads_sku_{from}_{to}.csv` |
| 慧运营入库 | `D:\outpost-data\shops\{shopId}\portal-imports\` | `ads_sku_{from}_{to}.csv` |

前两级是桥接暂存（历史路径名，仅中间件使用）；**看板与补洞只认**各店 `portal-imports`。

两店示例（昨天 = 2026-10-05）：

- `D:\YingDao\Downloads\PRJ482387\PRJ482387_campaigns-export_2026-10-05_2026-10-05.xlsx`
- `D:\outpost-data\shops\PRJ482387\portal-imports\ads_sku_2026-10-05_2026-10-05.csv`

默认用本机 **Google Chrome**（`OUTPOST_ADS_PW_CHANNEL=chrome`）；没有则退回 Chromium。无头易被 Noon 掐，首次请 `login` 有头登录。

## 桥接

规范 CSV / 投递复用 `D:\YingDao\Flows\_lib\outpost_bridge.py`（历史目录，非产品名）。与 `noon-pw-platform` 同一入库口径。
