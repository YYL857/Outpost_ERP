# -*- coding: utf-8 -*-
"""python noon_login_autofill_otp_flag_test.py"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from noon_login_autofill import otp_auto_enabled

# 默认开
os.environ.pop("OUTPOST_NOON_OTP_AUTO", None)
assert otp_auto_enabled() is True

os.environ["OUTPOST_NOON_OTP_AUTO"] = ""
assert otp_auto_enabled() is True

os.environ["OUTPOST_NOON_OTP_AUTO"] = "1"
assert otp_auto_enabled() is True

for off in ("0", "false", "off", "no", "FALSE"):
    os.environ["OUTPOST_NOON_OTP_AUTO"] = off
    assert otp_auto_enabled() is False, off

print("noon_login_autofill otp flag ok")
