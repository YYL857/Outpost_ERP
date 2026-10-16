# Listing 宣传图 · 本机键鼠唤起 Cursor

每人电脑各自跑 Outpost API；点「生成宣传图」后：

1. 拼好 `prompt.md` + `refs/` 投递到任务目录  
2. 本脚本用键鼠打开本机 Cursor、粘贴提示词并发送  
3. Cursor Agent 按提示词读 `refs/`、把 jpg 写入 `out/`  
4. Outpost 轮询 `out/` 回填审核  

**不用** `CURSOR_API_KEY` / Cursor 官方 SDK。

## 多人 / 局域网（重要）

键鼠出图和「打开文件夹」都跑在 **API 进程所在电脑**。  
别人用 `http://你的IP:5173` 点生成，会弹你电脑上的 Cursor——因此：

- **推荐本机全自动**：每人在自己电脑启动 Outpost，用 `http://localhost:5173` 打开，键鼠唤起本机 Cursor
- **共享 ERP（局域网 IP）**：非 localhost 时**禁止**远程键鼠 / 打开资源管理器；页面提供「下载任务包」→ 本机 Cursor 出图 →「上传成品图」
- 仅调试可设 `LISTING_PROMO_RPA_ALLOW_REMOTE=1`（不推荐）

## 本机前置

- 已安装 Cursor，并已登录  
- `cursor` 在 PATH，或设置 `CURSOR_EXE`（指向 `Cursor.exe` 或 `cursor.cmd`）  
- 出图期间尽量不要抢键盘/鼠标（脚本会粘贴并发送）

## 手动试跑

```powershell
cd apps/api/scripts/listing-promo-cursor-rpa
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 -JobDir "D:\Outpost_ERP\.tmp_listing_promo_inbox\promo-xxx"
```

## 环境变量

| 变量 | 含义 | 默认 |
|------|------|------|
| `LISTING_PROMO_DRIVER` | `rpa`（默认）/ `folder`（只投递不唤起）/ `sdk` | `rpa` |
| `LISTING_PROMO_RPA` | `0` 关闭键鼠（等同只 folder） | 开 |
| `CURSOR_EXE` | Cursor 可执行文件路径 | 自动找 |
| `LISTING_PROMO_RPA_CLICK_X` | 点击输入框相对窗口 X（0–1） | `0.82`（右侧 Agent） |
| `LISTING_PROMO_RPA_CLICK_Y` | 点击输入框相对窗口 Y（0–1） | `0.78`（面板底，避开终端） |
| `LISTING_PROMO_RPA_OPEN_KEYS` | 可选；默认**不发** Ctrl+L/I（会关掉对话） | 空 |
| `LISTING_PROMO_RPA_SEND` | 发送键 | `{ENTER}`（Agent 普通回车发送；勿用 `^{ENTER}`） |
| `LISTING_PROMO_RPA_WAIT_MS` | 打开后等待 | `10000` |
| `LISTING_PROMO_RPA_NO_SEND` | `1` 只粘贴不发送 | 关 |

脚本会：`--disable-workspace-trust` 打开任务目录 → 聚焦 → **点击右侧 Agent 输入框** → Ctrl+V → 再点输入框 → Enter。  
底部是终端，不要点窗口最下方。点偏了可调 `LISTING_PROMO_RPA_CLICK_X/Y`。排查看任务目录 `rpa-debug.log`。  
若 `.env` 里仍写着 `LISTING_PROMO_RPA_SEND=^{ENTER}`，请删掉或改成 `{ENTER}`，否则会再次卡在「已粘贴未发送」。

## 乱码说明

粘贴进 Cursor 的**引导语必须用英文**（脚本已如此）。Windows PowerShell 5 在无 BOM 时会把脚本里的中文按系统码页误读，导致剪贴板乱码；`prompt.md` 正文用 UTF-8 读取，一般正常。若改脚本请保存为 **UTF-8 带 BOM**。
