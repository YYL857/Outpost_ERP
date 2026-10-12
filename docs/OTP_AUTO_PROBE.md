# Noon 邮箱 OTP 自动登录 · 定时探测

## 做什么

模拟登录态已过期：清空 `storage_state` → 有头打开 Noon → 自动填邮箱 → IMAP 取验证码回填 → 登录后打开业务页截图留证。

## 明天怎么看结果

1. 打开：`D:\outpost-data\otp-auto-test\LATEST`
2. 第一行是 `PASS` 或 `FAIL`
3. 同目录下最新时间戳文件夹里有：
   - `PASS.txt` / `FAIL.txt` / `RESULT.txt`
   - `evidence_ads.png` / `evidence_seller.png`（登录后页面截图）
   - `result.json`

成功标准：清过 cookie 后能自动登录，且至少一张业务页截图不是登录页。

## 计划任务

- 名称：`OutpostNoonOtpAutoProbe`
- 时间：次日 **07:30**（本机时区）
- 命令：`D:\Outpost_ERP\apps\api\scripts\noon-pw-platform\run_otp_probe.bat`

手动再跑：

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py keepalive otp-probe
```
