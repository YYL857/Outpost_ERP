# -*- coding: utf-8 -*-
"""
Noon partners 登录页：自动填邮箱 / 可选密码 / 发码 / 回填 OTP。

受 OUTPOST_NOON_OTP_AUTO 控制；凭证来自环境变量。
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Callable

from email_otp import imap_configured, poll_noon_otp

LogFn = Callable[[str], None]


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def otp_auto_enabled() -> bool:
    return _env("OUTPOST_NOON_OTP_AUTO", "").lower() in ("1", "true", "yes", "on")


def login_email() -> str:
    return _env("OUTPOST_NOON_LOGIN_EMAIL") or _env("OUTPOST_NOON_OTP_IMAP_USER")


def login_password() -> str:
    return _env("OUTPOST_NOON_LOGIN_PASSWORD")


async def _first_visible(page, selectors: list[str], timeout_ms: int = 2500):
    for sel in selectors:
        loc = page.locator(sel).first
        try:
            await loc.wait_for(state="visible", timeout=timeout_ms)
            return loc
        except Exception:
            continue
    return None


async def _fill_if_empty(locator, value: str, log: LogFn, label: str) -> bool:
    if not value:
        return False
    try:
        cur = (await locator.input_value(timeout=2000)).strip()
    except Exception:
        cur = ""
    if cur and cur.lower() == value.lower():
        log(f"[otp-auto] {label} 已填好，跳过")
        return True
    await locator.click(timeout=3000)
    await locator.fill("")
    await locator.fill(value)
    log(f"[otp-auto] 已填 {label}")
    return True


async def _click_first(page, selectors: list[str], log: LogFn, label: str) -> bool:
    loc = await _first_visible(page, selectors, timeout_ms=2000)
    if not loc:
        return False
    try:
        await loc.click(timeout=4000)
        log(f"[otp-auto] 已点 {label}")
        return True
    except Exception as e:
        log(f"[otp-auto] 点击 {label} 失败: {e}")
        return False


async def _page_snip(page) -> str:
    try:
        return ((await page.inner_text("body")) or "")[:4000]
    except Exception:
        return ""


async def try_autofill_noon_login(
    page,
    *,
    log: LogFn,
    already_attempted: bool,
) -> dict:
    """
    若当前停在鉴权页，尝试自动完成邮箱 OTP。
    每个 wait 循环只完整跑一轮（already_attempted 防刷）。
    """
    if not otp_auto_enabled():
        return {"ok": False, "skipped": True, "reason": "OUTPOST_NOON_OTP_AUTO 未开"}
    if already_attempted:
        return {"ok": False, "skipped": True, "reason": "本轮已尝试过自动 OTP"}

    email_addr = login_email()
    if not email_addr:
        log("[otp-auto] 缺少 OUTPOST_NOON_LOGIN_EMAIL / IMAP_USER")
        return {"ok": False, "error": "缺少登录邮箱环境变量"}
    if not imap_configured():
        log("[otp-auto] 缺少 IMAP USER/PASS，无法取验证码")
        return {"ok": False, "error": "缺少 IMAP 凭证"}

    snip = await _page_snip(page)
    low = snip.lower()
    url = ""
    try:
        url = page.url or ""
    except Exception:
        pass
    log(f"[otp-auto] 开始自动登录 url={url[:120]}")

    # —— 邮箱 ——
    email_loc = await _first_visible(
        page,
        [
            'input[type="email"]',
            'input[name*="email" i]',
            'input[id*="email" i]',
            'input[placeholder*="email" i]',
            'input[autocomplete="username"]',
            'input[autocomplete="email"]',
            'input[type="text"]',
        ],
        timeout_ms=3500,
    )
    if email_loc:
        await _fill_if_empty(email_loc, email_addr, log, "email")
    else:
        log("[otp-auto] 未找到邮箱输入框（可能已在 OTP 步）")

    # —— 可选密码 ——
    pwd = login_password()
    if pwd:
        pwd_loc = await _first_visible(
            page,
            [
                'input[type="password"]',
                'input[name*="pass" i]',
                'input[id*="pass" i]',
            ],
            timeout_ms=1500,
        )
        if pwd_loc:
            await _fill_if_empty(pwd_loc, pwd, log, "password")

    # —— 触发发码 / Continue / Log in ——
    not_before = datetime.now(timezone.utc)
    clicked_send = await _click_first(
        page,
        [
            'button:has-text("Continue")',
            'button:has-text("Log in")',
            'button:has-text("Login")',
            'button:has-text("Sign in")',
            'button:has-text("Send")',
            'button:has-text("Send code")',
            'button:has-text("Send OTP")',
            'button:has-text("Resend")',
            'button:has-text("Resend code")',
            'a:has-text("Resend")',
            'button:has-text("Get code")',
            'button:has-text("Next")',
            'button[type="submit"]',
            'input[type="submit"]',
        ],
        log,
        "submit/send-code",
    )
    if clicked_send:
        # 发送请求发出后再等邮件，略提前 5s 防时钟
        not_before = datetime.now(timezone.utc)
        await page.wait_for_timeout(1500)
    else:
        # 可能已在 OTP 页（重发场景）：仍用当前时刻，不接受更旧邮件
        log("[otp-auto] 未点到发码按钮，按已在 OTP 页处理")

    # 若仍有邮箱框且无 OTP 框，再试一次 Continue
    otp_loc = await _first_visible(
        page,
        [
            'input[name*="otp" i]',
            'input[id*="otp" i]',
            'input[autocomplete="one-time-code"]',
            'input[inputmode="numeric"]',
            'input[placeholder*="code" i]',
            'input[placeholder*="OTP" i]',
            'input[placeholder*="验证码"]',
            'input[type="tel"]',
            'input[type="text"]',
        ],
        timeout_ms=4000,
    )
    if not otp_loc:
        await _click_first(
            page,
            [
                'button:has-text("Continue")',
                'button:has-text("Log in")',
                'button[type="submit"]',
            ],
            log,
            "continue-to-otp",
        )
        await page.wait_for_timeout(2000)
        otp_loc = await _first_visible(
            page,
            [
                'input[name*="otp" i]',
                'input[id*="otp" i]',
                'input[autocomplete="one-time-code"]',
                'input[inputmode="numeric"]',
                'input[placeholder*="code" i]',
                'input[placeholder*="验证码"]',
                'input[type="tel"]',
                'input[type="text"]',
            ],
            timeout_ms=5000,
        )

    if not otp_loc:
        snip2 = await _page_snip(page)
        log(f"[otp-auto] 未找到 OTP 输入框 snip={snip2[:200]!r}")
        return {"ok": False, "error": "页面未命中 OTP 输入框", "attempted": True}

    log("[otp-auto] 开始 IMAP 轮询验证码…")
    try:
        code = poll_noon_otp(not_before=not_before, log=log)
    except Exception as e:
        log(f"[otp-auto] IMAP 取码失败: {e}")
        return {"ok": False, "error": f"IMAP 取码失败: {e}", "attempted": True}

    await otp_loc.click(timeout=3000)
    await otp_loc.fill("")
    await otp_loc.fill(code)
    log("[otp-auto] 已回填 OTP")

    await _click_first(
        page,
        [
            'button:has-text("Verify")',
            'button:has-text("Confirm")',
            'button:has-text("Continue")',
            'button:has-text("Log in")',
            'button:has-text("Submit")',
            'button[type="submit"]',
        ],
        log,
        "verify-otp",
    )
    await page.wait_for_timeout(2500)
    return {"ok": True, "attempted": True, "codeLen": len(code)}
