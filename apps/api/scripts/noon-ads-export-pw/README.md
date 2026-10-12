# Noon Ads 导出 PoC（Playwright，对齐影刀策略）

目标：用本机持久化 Chromium 复现影刀 `outpost_noon_ads_export` 链路，验证能否脱离影刀 CLI 配额做无限次调试/定时。

## 对齐的官方步骤

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
日志：`D:\YingDao\Logs\ads_export_pw_*.log`

## 落盘路径（不要看 Chrome「下载记录」）

Chrome 里若出现一串 UUID，那是浏览器内部临时名，**不是**入库文件。正式路径：

| 阶段 | 路径 | 文件名 |
|------|------|--------|
| 原始表 | `D:\YingDao\Downloads\{shopId}\` | `{shopId}_campaigns-export_{from}_{to}.xlsx` |
| 规范 CSV | `D:\YingDao\Exports\ads\{shopId}\` | `ads_sku_{from}_{to}.csv` |
| 慧运营入库 | `D:\outpost-data\shops\{shopId}\portal-imports\` | `ads_sku_{from}_{to}.csv` |

两店示例（昨天 = 2026-10-05）：

- `D:\YingDao\Downloads\PRJ482387\PRJ482387_campaigns-export_2026-10-05_2026-10-05.xlsx`
- `D:\outpost-data\shops\PRJ482387\portal-imports\ads_sku_2026-10-05_2026-10-05.csv`

默认用本机 **Google Chrome**（`OUTPOST_ADS_PW_CHANNEL=chrome`）；没有则退回 Chromium。无头易被 Noon 掐，首次请 `login` 有头登录。

## 与影刀关系

- 落盘/规范 CSV **复用** `D:\YingDao\Flows\_lib\outpost_bridge.py`（与影刀同一口径）
- 本脚本 **不**调影刀 CLI；调试次数不限
- **生产主路径已是本脚本**（广告页一键导出 / 数据补洞 → `python main.py ui`）；影刀 `outpost_noon_ads_export` 仅可手工跑，仓库不再调用
