# Noon 后台向导 · Playwright 补链

一次性工具（**不是** `pw-rpa` 生产 job）。用 Seller Lab `storage_state` 打开汉堡菜单，采齐 pending 板块的落地 URL + 截图，供回写 `apps/web/src/lib/noon-seller-guide.ts`。

## 覆盖板块

| SECTION | 内容 |
|---------|------|
| `payments` | Statements / SOA / Invoices / Transaction View / Exports |
| `fbp` | Fulfilled by Partner 11 子项（先种子 picklist 再扫同域） |
| `health` | Account Health → Reputation Management |
| `vantage` | Vantage Analytics |
| `all` | 以上全部（默认） |

## 前置

1. Seller Lab profile：`D:\outpost-data\browser-profiles\noon-seller-pw\`（默认 **persistent** 打开该目录）
2. Playwright：`pip install playwright`；建议本机 Chrome（`OUTPOST_ADS_PW_CHANNEL=chrome`）

Cookie 失效时脚本会有头等待最多 180s 让你登录；也可先：

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py sales login
```

## 运行

```powershell
cd D:\Outpost_ERP\apps\api
$env:OUTPOST_YD_GUIDE_SHOP="PRJ396770"
$env:OUTPOST_YD_GUIDE_SECTION="all"   # 或 payments / fbp / health / vantage
python scripts/noon-guide-capture-pw/main.py
```

可选：

- `OUTPOST_GUIDE_PW_HEADLESS=1` — 无头（默认有头）
- `OUTPOST_GUIDE_PW_PERSIST=0` — 不用用户目录，只读 `storage_state.json`
- `OUTPOST_GUIDE_PW_LOGIN_WAIT=180` — 登录等待秒数
- `OUTPOST_SELLER_PW_PROFILE` — 覆盖 profile 目录
- `OUTPOST_YD_GUIDE_OUT` — 覆盖落盘根（默认 `D:\outpost-data\noon-guide-capture`）

## 输出

```
D:\outpost-data\noon-guide-capture\{shopId}\
  RUN.txt
  capture-summary.json
  {section}\
    manifest.csv
    manifest.jsonl
    manifest.json
    shots\*.png
```

`landing_template` 已把 `project=` 换成 `{project}`，可直接贴进向导 TS。

成功判定：离开 Store Dashboard `/home`，且非 fault/登录页。失败项保持 pending，勿空写 confirmed。

不注册 `/api/pw-rpa` 第四 job；与广告/销量生产导出无关。
