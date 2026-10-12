@echo off
REM Noon 邮箱 OTP 自动登录探测（计划任务入口）
setlocal
cd /d D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
if not exist "D:\outpost-data\otp-auto-test" mkdir "D:\outpost-data\otp-auto-test"
echo ===== OTP probe start %DATE% %TIME% =====>> "D:\outpost-data\otp-auto-test\scheduler.log"
"C:\Users\admin\AppData\Local\Programs\Python\Python311\python.exe" main.py keepalive otp-probe >> "D:\outpost-data\otp-auto-test\scheduler.log" 2>&1
set EC=%ERRORLEVEL%
echo ===== OTP probe end ec=%EC% %DATE% %TIME% =====>> "D:\outpost-data\otp-auto-test\scheduler.log"
exit /b %EC%
