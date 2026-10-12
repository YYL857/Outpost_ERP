# -*- coding: utf-8 -*-
"""本地：python email_otp_test.py"""
from __future__ import annotations

from email_otp import extract_otp_code, _looks_like_noon_otp


def main() -> None:
    assert extract_otp_code("Your verification code is 482913") == "482913"
    assert extract_otp_code("验证码：123456，5 分钟内有效") == "123456"
    assert _looks_like_noon_otp("noreply@noon.com", "OTP", "code 111222")
    assert not _looks_like_noon_otp("promo@shop.com", "Sale", "no code here")
    print("email_otp_test ok")


if __name__ == "__main__":
    main()
