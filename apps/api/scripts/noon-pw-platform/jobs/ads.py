# -*- coding: utf-8 -*-
"""广告 job：login 走统一一次登录；其余转调 noon-ads-export-pw。"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ADS_DIR = Path(__file__).resolve().parents[1].parent / "noon-ads-export-pw"
ROOT = Path(__file__).resolve().parents[1]


def _ensure_root() -> None:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


def _run_ads_script(cmd: str) -> tuple[int, str]:
    main_py = ADS_DIR / "main.py"
    if not main_py.is_file():
        msg = f"找不到 {main_py}"
        print(msg, flush=True)
        return 2, msg
    proc = subprocess.Popen(
        [sys.executable, "-u", str(main_py), cmd],
        cwd=str(ADS_DIR),
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    chunks: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        chunks.append(line)
        print(line, end="", flush=True)
    code = int(proc.wait() or 0)
    return code, "".join(chunks)


def _log(msg: str) -> None:
    print(msg, flush=True)


def run(cmd: str) -> int:
    _ensure_root()
    if cmd == "login":
        from session_sync import run_unified_login

        return run_unified_login()

    # 导出前：无 SSO cookie 则先统一登录，避免「开导出窗→撞墙关窗→再登录→再导出」三轮
    if cmd == "ui":
        from session_sync import (
            ADS_PROFILE,
            has_sso_cookies,
            try_recover_session_for_export,
        )

        if not has_sso_cookies(ADS_PROFILE):
            _log("[ads] preflight: 无 Ad Manager SSO cookie，先统一登录再导出")
            if not try_recover_session_for_export("ads ui preflight: 无 SSO cookie"):
                _log("[ads] preflight 登录失败，仍尝试导出（或窗内 OTP）")

    code, combined = _run_ads_script(cmd)
    if cmd != "ui" or code == 0:
        return code

    from session_sync import looks_like_auth_fail, try_recover_session_for_export

    if not looks_like_auth_fail(combined):
        return code
    # 导出脚本已在同窗试过 OTP（设了 TRIED）时不再关窗另起登录
    if not try_recover_session_for_export(combined):
        return code
    code2, _ = _run_ads_script(cmd)
    return code2
