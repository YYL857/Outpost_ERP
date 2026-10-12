# -*- coding: utf-8 -*-
"""
Noon Playwright 爬虫平台：python main.py <job> [ui|login|probe]

job:
  ads        Ad Manager 广告导出（转调 noon-ads-export-pw）
  sales      Seller Lab 销量导出 → portal-imports/sales_export_*.csv
  keepalive  login=统一登录；ui=软探测；otp-probe=清 cookie 测邮箱 OTP 自动回填

落盘一律经 outpost_bridge 进各店 portal-imports。
市场情报 / 耗材（买家商城前台）仍走影刀，不在此平台。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

JOBS = ("ads", "sales", "keepalive")
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def _load_dotenv() -> None:
    """把仓库根 / apps/api 的 .env 灌进 os.environ（已有键不覆盖）。"""
    roots = [
        HERE.parents[3] / ".env",  # Outpost_ERP/.env
        HERE.parents[1] / ".env",  # apps/api/.env
    ]
    for path in roots:
        if not path.is_file():
            continue
        try:
            raw = None
            for enc in ("utf-8-sig", "utf-8", "gbk"):
                try:
                    raw = path.read_text(encoding=enc)
                    break
                except UnicodeDecodeError:
                    continue
            if raw is None:
                raise RuntimeError("无法用 utf-8/gbk 解码")
            for line in raw.splitlines():
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, _, v = s.partition("=")
                k = k.strip()
                v = v.strip().strip("'").strip('"')
                if k and k not in os.environ:
                    os.environ[k] = v
        except Exception as e:
            print(f"[env] 读取 {path} 失败: {e}", flush=True)


def main(argv: list[str] | None = None) -> int:
    _load_dotenv()
    args = list(argv if argv is not None else sys.argv[1:])
    if not args or args[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    job = args[0].strip().lower()
    cmd = (args[1] if len(args) > 1 else "ui").strip().lower()
    if job not in JOBS:
        print(f"未知 job {job}；可选 {', '.join(JOBS)}", flush=True)
        return 2
    if job == "ads":
        from jobs.ads import run

        return run(cmd)
    if job == "sales":
        from jobs.sales import main as sales_main

        return sales_main(cmd)
    if job == "keepalive":
        from jobs.keepalive import main as ka_main

        return ka_main(cmd)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
