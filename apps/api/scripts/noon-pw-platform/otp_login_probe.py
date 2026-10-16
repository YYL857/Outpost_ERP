# -*- coding: utf-8 -*-
"""
[已退役] 邮箱 OTP 无人值守探针。

生产路径已并入：
  python main.py keepalive login
  / ads|sales|ads-budget 撞登录墙 → session_sync.try_recover_session_for_export

勿再挂 keepalive otp-probe。需要自测 OTP 时直接跑：
  python main.py ads-budget login
  或 python main.py keepalive login
"""
from __future__ import annotations


def run_otp_login_probe() -> int:
    print(
        "[otp-probe] 已退役：请用 python main.py keepalive login "
        "（无人值守默认开 + IMAP；OTP_AUTO=0 才关）",
        flush=True,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(run_otp_login_probe())
