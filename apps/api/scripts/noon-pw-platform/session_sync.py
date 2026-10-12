# -*- coding: utf-8 -*-
"""
Noon 伙伴后台：一次登录复用。

策略（偏稳，不赌「只拷 cookie」）：
1. 同一个有头 Chrome（挂在广告 profile）里先开 Ad Manager，等你完成 OTP
   （OUTPOST_NOON_OTP_AUTO=1 时自动填邮箱 + IMAP 取验证码回填）
2. 同窗再开 Seller/Reports，吃同一套 SSO（多数情况不用再收验证码；若仍停在登录页继续等）
3. 两个站都确认已离开鉴权页后，把当前 context 的 storage_state 双写到
   noon-ads-pw 与 noon-seller-pw
4. 关掉有头窗后，分别用两套 storage_state 无头探测；任一失败则整体失败
   （防止「窗里看着过了、落盘其实不能用」）

导出仍用两套 profile/state，避免广告与销量并发抢同一 user_data_dir。
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

from noon_login_autofill import otp_auto_enabled, try_autofill_noon_login
from runtime import (
    ADS_HOME,
    ADS_PROFILE,
    LOG_DIR,
    SELLER_HOME,
    SELLER_PROFILE,
    with_browser,
)

LOGIN_WAIT_SEC = 900
PING_TIMEOUT_MS = 60_000


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def is_auth_gate(url: str = "", snip: str = "", title: str = "") -> bool:
    u = (url or "").lower()
    s = f"{snip or ''} {title or ''}".lower()
    url_hits = (
        "login.noon.partners",
        "accounts.google.com",
        "accounts.google.",
        "signin.google",
        "oauth2.googleapis",
        "/signin",
        "/sign-in",
        "/otp",
    )
    if any(x in u for x in url_hits):
        return True
    if "login" in u and ("noon.partners" in u or "google." in u):
        return True
    text_hits = (
        "log in with otp",
        "login with otp",
        "partners login",
        "verification code",
        "verify your email",
        "enter the code",
        "one-time password",
        "otp sent",
        "验证码",
    )
    return any(x in s for x in text_hits)


def _ads_ready(url: str) -> bool:
    u = (url or "").lower()
    return "admanager.noon.partners" in u and not is_auth_gate(u)


def _seller_ready(url: str) -> bool:
    u = (url or "").lower()
    if is_auth_gate(u):
        return False
    # 销量导出落地站；勿用过宽的 noon.partners 以免误判 toolbar 等
    return "reports.noon.partners" in u or "directship.noon.partners" in u


def is_net_flake(err: str | None) -> bool:
    e = (err or "").lower()
    keys = (
        "err_http2",
        "http2_protocol",
        "net::err_",
        "err_connection",
        "err_tunnel",
        "err_ssl",
        "err_network",
        "err_timed_out",
        "timeout",
        "ns_error_net",
    )
    return any(k in e for k in keys)


def has_sso_cookies(profile: Path) -> bool:
    state = profile / "storage_state.json"
    if not state.is_file():
        return False
    try:
        data = json.loads(state.read_text(encoding="utf-8"))
    except Exception:
        return False
    names = set()
    for c in data.get("cookies") or []:
        dom = (c.get("domain") or "").lower()
        if "noon.partners" not in dom:
            continue
        names.add(str(c.get("name") or ""))
    return bool(names & {"_npsid", "_nprtnetid", "npsid"})


async def goto_once(
    page, url: str, *, attempts: int = 1, timeout_ms: int = 90_000
) -> None:
    """导航；已在鉴权页绝不 goto。网络抖动可多试几轮（不会在 OTP 页重试）。"""
    try:
        cur = page.url or ""
    except Exception:
        cur = ""
    if is_auth_gate(cur):
        log(f"[goto] 已在鉴权页，跳过导航 url={cur[:120]}")
        return
    last = None
    rounds = max(1, int(attempts))
    for attempt in range(1, rounds + 1):
        for wait in ("domcontentloaded", "commit"):
            try:
                await page.goto(url, wait_until=wait, timeout=timeout_ms)
                await page.wait_for_timeout(2000)
                return
            except Exception as e:
                last = e
                try:
                    if is_auth_gate(page.url or ""):
                        log("[goto] 导航异常但已落在鉴权页，停止重试")
                        return
                except Exception:
                    pass
                # 有时 HTTP2 炸了但 URL 已到业务域
                try:
                    u = page.url or ""
                    if u and not is_auth_gate(u) and (
                        "admanager.noon.partners" in u.lower()
                        or "reports.noon.partners" in u.lower()
                    ):
                        log(f"[goto] 异常但已在业务域，继续: {u[:120]}")
                        return
                except Exception:
                    pass
                log(f"[goto] attempt={attempt}/{rounds} wait={wait} 失败: {e}")
                await page.wait_for_timeout(1200 * attempt)
    raise RuntimeError(f"打开失败: {url} · {last}") from (
        last if isinstance(last, BaseException) else None
    )


async def wait_left_auth(
    page,
    *,
    ready_fn,
    label: str,
    timeout_sec: int = LOGIN_WAIT_SEC,
    allow_otp_auto: bool = True,
) -> dict:
    deadline = time.time() + timeout_sec
    last_url = ""
    otp_attempted = False
    otp_error: str | None = None
    while time.time() < deadline:
        try:
            url = page.url or ""
        except Exception as e:
            log(f"[wait:{label}] 读 url 失败: {e}")
            await page.wait_for_timeout(3000)
            continue
        if url != last_url:
            log(f"[wait:{label}] url={url[:140]}")
            last_url = url
        if ready_fn(url):
            await page.wait_for_timeout(1500)
            return {"ok": True, "url": page.url}
        # 仍停在鉴权页：自动邮箱 OTP（每 label 只完整尝试一次）
        if (
            allow_otp_auto
            and otp_auto_enabled()
            and not otp_attempted
            and is_auth_gate(url)
        ):
            result = await try_autofill_noon_login(
                page, log=log, already_attempted=otp_attempted
            )
            if result.get("attempted") or result.get("ok"):
                otp_attempted = True
            if result.get("error"):
                otp_error = str(result["error"])
                log(f"[wait:{label}] 自动 OTP: {otp_error}")
            elif result.get("ok"):
                log(f"[wait:{label}] 自动 OTP 已提交，继续等待离开鉴权页")
            await page.wait_for_timeout(2000)
            continue
        await page.wait_for_timeout(3000)
    err = f"{label} 等待超时（{timeout_sec}s）"
    if otp_error:
        err = f"{err}；自动 OTP: {otp_error}"
    elif otp_auto_enabled() and not otp_attempted:
        err = f"{err}；未触发自动 OTP（页面可能未识别为鉴权页）"
    return {"ok": False, "url": getattr(page, "url", ""), "error": err}


async def save_state_both(context) -> list[str]:
    written = []
    for profile in (ADS_PROFILE, SELLER_PROFILE):
        profile.mkdir(parents=True, exist_ok=True)
        path = profile / "storage_state.json"
        await context.storage_state(path=str(path))
        written.append(str(path))
        log(f"[state] 已写入 {path}")
    return written


async def ping_site(
    profile: Path,
    url: str,
    label: str,
    ready_fn,
    *,
    quick: bool = False,
) -> dict:
    """无头探测；quick=软探测用（1 轮、短超时），避免一直运行中。"""
    state = profile / "storage_state.json"
    if not state.is_file():
        return {"ok": False, "label": label, "error": f"无 {state}"}

    rounds = 1 if quick else 2
    nav_timeout = 12_000 if quick else 35_000
    nav_attempts = 1 if quick else 2
    wait_loops = 4 if quick else 6

    last: dict = {"ok": False, "label": label, "error": "未探测"}
    for round_i in range(1, rounds + 1):
        async def run(context, page, _round=round_i):
            await goto_once(
                page, url, attempts=nav_attempts, timeout_ms=nav_timeout
            )
            for _ in range(wait_loops):
                u = page.url or ""
                if is_auth_gate(u):
                    return {
                        "ok": False,
                        "label": label,
                        "url": u,
                        "error": "落在登录/OTP 页",
                        "authFail": True,
                    }
                if ready_fn(u):
                    try:
                        await context.storage_state(path=str(state))
                    except Exception as e:
                        log(f"[ping:{label}] 回写 state 跳过: {e}")
                    return {"ok": True, "label": label, "url": u, "round": _round}
                await page.wait_for_timeout(800)
            u = page.url or ""
            ok = ready_fn(u) and not is_auth_gate(u)
            return {
                "ok": ok,
                "label": label,
                "url": u,
                "error": None if ok else "未进入业务页",
                "round": _round,
            }

        try:
            last = await with_browser(
                profile=profile,
                persist=False,
                headed=False,
                fn=run,
                extra_args=["--disable-http2"],
            )
        except Exception as e:
            last = {
                "ok": False,
                "label": label,
                "error": str(e),
                "netFlake": is_net_flake(str(e)),
                "round": round_i,
            }
        if last.get("ok"):
            return last
        if last.get("authFail"):
            return last
        err = str(last.get("error") or "")
        last["netFlake"] = is_net_flake(err)
        log(f"[ping:{label}] round={round_i} 未过: {err[:160]}")
        if not quick:
            await asyncio_sleep(2.0 * round_i)
    return last


async def asyncio_sleep(sec: float) -> None:
    import asyncio

    await asyncio.sleep(sec)


async def _unified_login_async() -> dict:
    log(
        "[unified] 一次登录：同窗先广告后卖家，再双写 storage_state，"
        "最后无头探测两边都必须过。"
    )

    async def run(context, page):
        if otp_auto_enabled():
            log(
                "[unified] ① 打开 Ad Manager — OUTPOST_NOON_OTP_AUTO=1，"
                "将自动填邮箱并从 IMAP 取验证码（有头窗仍会弹出）"
            )
        else:
            log("[unified] ① 打开 Ad Manager — 请在此窗完成邮箱验证码（只这一次）")
        await goto_once(page, ADS_HOME)
        ads_wait = await wait_left_auth(
            page, ready_fn=_ads_ready, label="ads", timeout_sec=LOGIN_WAIT_SEC
        )
        if not ads_wait.get("ok"):
            return {
                "ok": False,
                "stage": "ads-login",
                "error": ads_wait.get("error") or "广告未登录",
                "ads": ads_wait,
            }

        log(
            "[unified] ② 同窗打开卖家 Reports — 复用 SSO；"
            "若仍停在登录页请再确认一次（通常不必重收验证码）"
        )
        await goto_once(page, SELLER_HOME)
        seller_wait = await wait_left_auth(
            page,
            ready_fn=_seller_ready,
            label="seller",
            timeout_sec=LOGIN_WAIT_SEC,
        )
        # SSO 有时先停在伙伴门户首页：再推一次 Reports（不在鉴权页时才推，避免冲 OTP）
        if not seller_wait.get("ok"):
            try:
                cur = page.url or ""
            except Exception:
                cur = ""
            if cur and not is_auth_gate(cur):
                log("[unified] 卖家未到 Reports，再导航一次（非鉴权页）")
                await goto_once(page, SELLER_HOME)
                seller_wait = await wait_left_auth(
                    page,
                    ready_fn=_seller_ready,
                    label="seller-retry",
                    timeout_sec=min(180, LOGIN_WAIT_SEC),
                )
        if not seller_wait.get("ok"):
            return {
                "ok": False,
                "stage": "seller-login",
                "error": seller_wait.get("error") or "卖家未登录",
                "ads": ads_wait,
                "seller": seller_wait,
            }

        log("[unified] ③ 双写 ads + seller storage_state（同一会话，含两站 cookie）")
        written = await save_state_both(context)
        return {
            "ok": True,
            "stage": "saved",
            "ads": ads_wait,
            "seller": seller_wait,
            "written": written,
        }

    # 有头挂在广告 profile：登录态进 Chrome 配置；state 文件双写给销量导出用
    headed = await with_browser(
        profile=ADS_PROFILE, persist=True, headed=True, fn=run
    )
    if not headed.get("ok"):
        return {
            "ok": False,
            "mode": "unified-login",
            **headed,
        }

    log("[unified] ④ 落盘后无头探测（网络抖动会重试；鉴权失败才真失败）")
    ads_ping = await ping_site(ADS_PROFILE, ADS_HOME, "ads", _ads_ready)
    seller_ping = await ping_site(
        SELLER_PROFILE, SELLER_HOME, "seller", _seller_ready
    )
    ping_ok = bool(ads_ping.get("ok") and seller_ping.get("ok"))
    auth_fail = bool(ads_ping.get("authFail") or seller_ping.get("authFail"))
    sso_ok = has_sso_cookies(ADS_PROFILE) and has_sso_cookies(SELLER_PROFILE)
    net_only = (not ping_ok) and (not auth_fail) and (
        is_net_flake(str(ads_ping.get("error") or ""))
        or is_net_flake(str(seller_ping.get("error") or ""))
        or bool(ads_ping.get("netFlake"))
        or bool(seller_ping.get("netFlake"))
    )
    # 有头两边都进业务页 + 双写 SSO cookie 已在：无头 HTTP2 抖动不判登录失败
    ok = ping_ok or (bool(headed.get("ok")) and sso_ok and net_only and not auth_fail)
    payload = {
        "ok": ok,
        "mode": "unified-login",
        "headed": headed,
        "ads": ads_ping,
        "seller": seller_ping,
        "ssoCookies": sso_ok,
        "probeOk": ping_ok,
    }
    if ok and not ping_ok:
        payload["warning"] = (
            "有头登录与 cookie 双写已成功；无头探测遇 Noon 网络/HTTP2 抖动未通过，"
            "未判失败。稍后可点「软探测」复查，或直接导出试跑。"
        )
        log(f"[unified] {payload['warning']}")
    if not ok:
        payload["error"] = (
            "登录未确认："
            f"adsPing={ads_ping.get('ok')} sellerPing={seller_ping.get('ok')} "
            f"authFail={auth_fail} sso={sso_ok}。"
            "若仍停在登录页请重开登录窗；若只是网络错误可稍后软探测。"
        )
    return payload


def run_unified_login() -> int:
    import asyncio

    try:
        payload = asyncio.run(_unified_login_async())
    except Exception as e:
        log(f"[unified] fatal: {e}")
        payload = {"ok": False, "mode": "unified-login", "error": str(e)}

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"pw_unified_login_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"[unified] wrote {p}")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if not payload.get("ok"):
        log(f"[unified] FAIL: {payload.get('error') or payload}")
        return 1
    log("[unified] OK：广告+卖家 storage_state 均已探测通过")
    return 0
