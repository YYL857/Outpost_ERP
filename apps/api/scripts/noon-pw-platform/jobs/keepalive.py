# -*- coding: utf-8 -*-
"""登录态：login=同窗一次登录双写；ui=快速软探测（先查 cookie，网络探测有硬超时）。"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import (  # noqa: E402
    ADS_HOME,
    ADS_PROFILE,
    LOG_DIR,
    SELLER_HOME,
    SELLER_PROFILE,
)
from session_sync import (  # noqa: E402
    _ads_ready,
    _seller_ready,
    has_sso_cookies,
    is_net_flake,
    ping_site,
    run_unified_login,
)


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _targets() -> list[str]:
    raw = os.environ.get("OUTPOST_PW_KEEPALIVE_TARGETS", "ads,seller")
    want = []
    for x in raw.lower().split(","):
        t = x.strip()
        if t in ("ads", "seller", "sales") and t not in want:
            want.append("seller" if t == "sales" else t)
    return want or ["ads", "seller"]


def _cookie_check(label: str, profile: Path) -> dict:
    state = profile / "storage_state.json"
    if not state.is_file():
        return {
            "ok": False,
            "label": label,
            "mode": "cookie",
            "error": f"无 {state.name}，请先打开登录窗口",
        }
    sso = has_sso_cookies(profile)
    mtime = datetime.fromtimestamp(state.stat().st_mtime).isoformat(timespec="seconds")
    return {
        "ok": sso,
        "label": label,
        "mode": "cookie",
        "sso": sso,
        "stateMtime": mtime,
        "error": None if sso else "未见 Noon SSO cookie（_npsid/_nprtnetid），请重新登录",
    }


async def _ping_budget(profile: Path, url: str, label: str, ready_fn, budget_sec: float) -> dict:
    """单站网络探测，整体不超过 budget_sec。"""
    import asyncio

    log(f"[soft] 网络探测 {label}（最多 {int(budget_sec)}s）…")
    try:
        return await asyncio.wait_for(
            ping_site(profile, url, label, ready_fn, quick=True),
            timeout=budget_sec,
        )
    except asyncio.TimeoutError:
        return {
            "ok": False,
            "label": label,
            "error": f"网络探测超时（{int(budget_sec)}s）",
            "netFlake": True,
        }


async def cmd_ui() -> dict:
    """
    软探测（要快、要结束）：
    1) 立刻查本地 storage_state / SSO cookie
    2) 可选短时无头打开站点（总预算约 50s，超时不当死循环）
    3) cookie 有效但网络抖动 → 仍算通过（带 warning），避免一直「运行中」
    """
    want = _targets()
    log(f"[soft] 开始软探测 targets={want}")

    ads_cookie = {"ok": True, "label": "ads", "skipped": True}
    seller_cookie = {"ok": True, "label": "seller", "skipped": True}
    cookie_checks = []
    if "ads" in want:
        log("[soft] ① 检查广告 cookie 文件…")
        ads_cookie = _cookie_check("ads", ADS_PROFILE)
        cookie_checks.append(ads_cookie)
        log(f"[soft] 广告 cookie ok={ads_cookie.get('ok')} {ads_cookie.get('error') or ''}")
    if "seller" in want:
        log("[soft] ① 检查卖家 cookie 文件…")
        seller_cookie = _cookie_check("seller", SELLER_PROFILE)
        cookie_checks.append(seller_cookie)
        log(f"[soft] 卖家 cookie ok={seller_cookie.get('ok')} {seller_cookie.get('error') or ''}")

    cookie_ok = all(c.get("ok") for c in cookie_checks) if cookie_checks else False
    if not cookie_ok:
        payload = {
            "mode": "pw-keepalive-soft",
            "ok": False,
            "ads": ads_cookie,
            "seller": seller_cookie,
            "error": "本地 cookie 不可用，请点「打开登录窗口（一次两边）」",
        }
        _write_log(payload)
        raise RuntimeError(payload["error"])

    # cookie 已过：网络探测失败也不卡死、不误判必须重登
    ads_net = {"ok": True, "label": "ads", "skipped": True}
    seller_net = {"ok": True, "label": "seller", "skipped": True}
    per_budget = 22.0
    if "ads" in want:
        ads_net = await _ping_budget(
            ADS_PROFILE, ADS_HOME, "ads", _ads_ready, per_budget
        )
        log(f"[soft] 广告网络 ok={ads_net.get('ok')} {str(ads_net.get('error') or ads_net.get('url') or '')[:120]}")
    if "seller" in want:
        seller_net = await _ping_budget(
            SELLER_PROFILE, SELLER_HOME, "seller", _seller_ready, per_budget
        )
        log(
            f"[soft] 卖家网络 ok={seller_net.get('ok')} "
            f"{str(seller_net.get('error') or seller_net.get('url') or '')[:120]}"
        )

    net_checks = [c for c in (ads_net, seller_net) if not c.get("skipped")]
    net_ok = all(c.get("ok") for c in net_checks) if net_checks else True
    auth_fail = any(c.get("authFail") for c in net_checks)
    net_flake = (not net_ok) and (not auth_fail) and any(
        c.get("netFlake") or is_net_flake(str(c.get("error") or "")) for c in net_checks
    )

    if auth_fail:
        payload = {
            "mode": "pw-keepalive-soft",
            "ok": False,
            "ads": ads_net if "ads" in want else ads_cookie,
            "seller": seller_net if "seller" in want else seller_cookie,
            "cookie": {"ads": ads_cookie, "seller": seller_cookie},
            "error": "网络探测落到登录页，cookie 已失效，请重新打开登录窗口",
        }
        _write_log(payload)
        raise RuntimeError(payload["error"])

    ok = True
    warning = None
    if not net_ok and net_flake:
        warning = (
            "本地 SSO cookie 有效；无头打开 Noon 遇网络/HTTP2/超时，"
            "未判失效。可直接导出试跑，或稍后再软探测。"
        )
        log(f"[soft] {warning}")
    elif not net_ok:
        warning = "本地 cookie 有效，但业务页未确认打开；可先试导出。"
        log(f"[soft] {warning}")

    payload = {
        "mode": "pw-keepalive-soft",
        "ok": ok,
        "ads": ads_net if "ads" in want else ads_cookie,
        "seller": seller_net if "seller" in want else seller_cookie,
        "cookie": {"ads": ads_cookie, "seller": seller_cookie},
        "probeOk": net_ok,
        "warning": warning,
    }
    _write_log(payload)
    log("[soft] 完成")
    return payload


def _write_log(payload: dict) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"pw_keepalive_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"[keepalive] soft wrote {p}")
    return p


def main(cmd: str) -> int:
    import asyncio

    if cmd == "login":
        return run_unified_login()
    if cmd in ("otp-probe", "otp_probe", "otpprobe"):
        from otp_login_probe import run_otp_login_probe

        return run_otp_login_probe()
    if cmd == "ui":
        try:
            # 整次软探测硬顶 70s，防止 UI 永远「运行中」
            r = asyncio.run(asyncio.wait_for(cmd_ui(), timeout=70))
            print(json.dumps(r, ensure_ascii=False, indent=2))
            return 0
        except asyncio.TimeoutError:
            log("[fatal] 软探测总超时 70s（已强制结束）。本地 cookie 请看「重新检查」；网络差时属正常。")
            return 1
        except Exception as e:
            log(f"[fatal] {e}")
            return 1
    log(
        "keepalive 用法: login | ui | otp-probe"
        "（otp-probe=清登录态后测邮箱 OTP 自动回填）"
    )
    return 2
