# Noon 登录 OTP + 广告/销量导出 · 窗口交接

> 更新：2026-10-12 18:23（本窗结束，换窗继续）

**下一窗先读本文 + [`OTP_AUTO_PROBE.md`](./OTP_AUTO_PROBE.md) + [`PW_RPA_HANDOFF.md`](./PW_RPA_HANDOFF.md)。**

---

## 本窗结论（一句话）

- **广告 / 销量 Playwright 导出：已实测通**（两老老店）。
- **切店 bug 已修**（曾误点广告主头，应认顶栏 `PRJ…` / URL `project=`）。
- **邮箱 OTP 自动回填：代码+`.env` 已接好，端到端「过期→取码→登录」尚未人工验完**；已挂**明天 07:30** 计划任务自动测。

---

## 明天早上优先看（用户会来检查）

1. 打开 `D:\outpost-data\otp-auto-test\LATEST` → 第一行 `PASS` / `FAIL`
2. 同目录最新时间戳文件夹：`RESULT.txt`、`evidence_*.png`、`result.json`
3. 计划任务名：`OutpostNoonOtpAutoProbe`（2026-10-13 **07:30** 一次）
4. 机器须开机且已登录 Windows（有头 Chrome）

探针命令（手动）：

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py keepalive otp-probe
```

成功标准：清掉 `storage_state` 后，自动填邮箱 + IMAP 取码回填，并能打开业务页留下截图证据。

---

## 本窗已完成

### A. 邮箱 OTP 无人值守（代码）

| 项 | 路径 |
|----|------|
| IMAP 取码 | `apps/api/scripts/noon-pw-platform/email_otp.py` |
| 页上填邮箱/OTP | `noon_login_autofill.py` |
| 接入统一登录 | `session_sync.py`（`OUTPOST_NOON_OTP_AUTO=1`） |
| 探针 | `otp_login_probe.py` + `keepalive otp-probe` |
| 计划任务 bat | `run_otp_probe.bat` |
| env 模板 | 根目录 `.env.example` |
| 说明 | `docs/OTP_AUTO_PROBE.md` |

本机 `.env`（**勿提交**）已含：

- `OUTPOST_NOON_OTP_AUTO=1`
- `OUTPOST_NOON_LOGIN_EMAIL` / `IMAP_USER` = `17727538283@163.com`
- `OUTPOST_NOON_OTP_IMAP_PASS` = 网易客户端授权码（曾出现在聊天截图，若担心泄露可在 163 设置里重新生成并改 `.env`）

`.env` 曾 GBK/UTF-8 混码导致读失败，已改写为 UTF-8；`main.py` `_load_dotenv` 支持 utf-8/gbk。

### B. 切店修复（广告实测踩坑）

- 文件：`apps/api/scripts/noon-pw-platform/shop_switch.py`
- 错误：点了 Ad Manager **下方** `100252 \| HUI Beauty`（广告主）
- 正确：顶栏 **PRJ396770 / 店名**；URL 已带 `project=PRJ…` 且无权限弹窗 → 直接认在店

### C. 导出实测（2026-10-12）

| 链路 | 店铺 | 结果 |
|------|------|------|
| ads `yesterday` | PRJ396770 / PRJ482387 | **成功** 590 / 186 行 → portal-imports |
| sales 近 7 天 | 同上 | **成功** kept 304 / 142 → portal-imports |

销量也用同一 `ensure_shop`；Seller Lab 深链带 `project=`，未复现广告那种误点。

### D. 定时任务现状（此前对话）

仍挂在 API `:8787` 的（用户要求保留的）：Noon 轮询、汇总同步、店内晨报、月度毛利关账、**PW ads/sales 日更**。  
已关：市场情报发现/采集、Inbox 监视。  
市场情报晨报本来就关。

广告/销量定时这几天曾因 **cookie 过期** + **sales 被 ads busy** 失败；本窗登录续上并修切店后，手工导出已通。定时日更是否稳定取决于 cookie / OTP 探针结果。

---

## 明确未完成 / 勿重复造

1. **OTP 端到端**：本窗 `keepalive login` 时旧 cookie 仍有效，**没真正走完 IMAP 取码**；靠明天 07:30 `otp-probe` 验证。
2. **导出撞登录墙不会自动重登**（计划明确本期不做）。
3. **无头探测易 HTTP2 超时**：统一登录有时 headed 已成功但总 `ok=false`；探针成功以业务页截图为准，勿死盯无头 ping。
4. Impex ≠ 门户 Sales；月底关账仍认 Statements，不是这两条爬虫。

---

## 下一窗可做

1. 读 `LATEST`：若 FAIL，看 `scheduler.log` + `result.json`（IMAP / 选择器 / 登录页变化）。
2. PASS 后：可考虑定时失败时触发 `otp-probe`/`login` 再导出（需用户拍板）。
3. 定时 ads/sales 店铺列表建议只留两家老店，避免空店拖垮整单。
4. 不要：用 Playwright 爬买家商城；重开已封存市场渠道；把授权码写进 git。

---

## 关键命令速查

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py keepalive otp-probe   # 强制清 cookie + OTP 测
python main.py keepalive login       # 统一登录（可自动 OTP）
python main.py ads ui                # 广告导出
python main.py sales ui              # 销量导出
schtasks /Query /TN OutpostNoonOtpAutoProbe
```

Cookie：

- `D:\outpost-data\browser-profiles\noon-ads-pw\storage_state.json`
- `D:\outpost-data\browser-profiles\noon-seller-pw\storage_state.json`
