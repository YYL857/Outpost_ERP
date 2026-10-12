# -*- coding: utf-8 -*-
"""广告 job：login 走统一一次登录；其余转调 noon-ads-export-pw。"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ADS_DIR = Path(__file__).resolve().parents[1].parent / "noon-ads-export-pw"
ROOT = Path(__file__).resolve().parents[1]


def run(cmd: str) -> int:
    if cmd == "login":
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from session_sync import run_unified_login

        return run_unified_login()

    main_py = ADS_DIR / "main.py"
    if not main_py.is_file():
        print(f"找不到 {main_py}", flush=True)
        return 2
    proc = subprocess.run(
        [sys.executable, str(main_py), cmd],
        cwd=str(ADS_DIR),
        env=os.environ.copy(),
    )
    return int(proc.returncode or 0)
