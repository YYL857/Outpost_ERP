# -*- coding: utf-8 -*-
"""
Noon partners 登录页：自动填邮箱 / 可选密码 / 发码 / 回填 OTP。

默认无人值守开启（撞登录墙就 IMAP 取码）；仅 OUTPOST_NOON_OTP_AUTO=0 才关。
凭证来自环境变量。
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
    """默认开。只有显式 0/false/off/no 才关——禁止再靠「忘记开开关」掉回人工登录。"""
    v = _env("OUTPOST_NOON_OTP_AUTO", "1").lower()
    if v in ("0", "false", "off", "no"):
        return False
    return True


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
        # Noon Continue 在邮箱未填时是 disabled；硬点只会空转超时
        try:
            if not await loc.is_enabled(timeout=800):
                log(f"[otp-auto] 跳过 {label}：按钮 disabled（多半还没填邮箱）")
                return False
        except Exception:
            pass
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


_CONTINUE_CTA_MARKERS = (
    "continue with this user",
    "使用此用户继续",
    "继续使用此用户",
    "使用此账号继续",
)


def _looks_like_saved_account_picker(snip: str) -> bool:
    """登录第二种态：Welcome Back 选已存账号，无邮箱/密码输入框。"""
    low = (snip or "").lower()
    if any(m in low for m in _CONTINUE_CTA_MARKERS):
        return True
    if "welcome back" in low and "use a different account" in low:
        return True
    if "欢迎回来" in (snip or "") and (
        "其他账号" in (snip or "") or "其他帐户" in (snip or "")
    ):
        return True
    return False


def _has_continue_cta(snip: str) -> bool:
    low = (snip or "").lower()
    return any(m in low for m in _CONTINUE_CTA_MARKERS)


async def _dismiss_translate_overlay(page, log: LogFn) -> None:
    """谷歌翻译浮层可能挡住 Continue；尽量关掉。"""
    for sel in (
        'button[aria-label="Close"]',
        'button[aria-label="关闭"]',
        '.VIpgJd-ZVi9od-xlTo9b',
        '#\\:1\\.close',
    ):
        try:
            loc = page.locator(sel).first
            if await loc.count() and await loc.is_visible(timeout=400):
                await loc.click(timeout=1000, force=True)
                log("[otp-auto] 已尝试关闭翻译浮层")
                await page.wait_for_timeout(300)
                return
        except Exception:
            continue
    try:
        await page.evaluate(
            """() => {
              document.querySelectorAll('.skiptranslate, #goog-gt-tt, .goog-te-banner-frame')
                .forEach((el) => { el.style.display = 'none'; });
            }"""
        )
    except Exception:
        pass


async def _still_on_saved_account_picker(page) -> bool:
    snip = await _page_snip(page)
    return _looks_like_saved_account_picker(snip)


async def _wait_left_saved_account_picker(page, log: LogFn, timeout_ms: int = 20000) -> bool:
    """
    点击后等待真正前进。只认正向信号：
    - 离开 login.noon.partners
    - 出现邮箱 / 密码 / OTP 输入框
    禁止把「CTA 短暂消失」当成成功（React 重绘后会再冒出 Welcome Back）。
    """
    deadline = datetime.now(timezone.utc).timestamp() + timeout_ms / 1000
    saw_cta_again = False
    while datetime.now(timezone.utc).timestamp() < deadline:
        try:
            url = (page.url or "").lower()
        except Exception:
            url = ""
        if url and "login.noon.partners" not in url and "accounts.google." not in url:
            log(f"[otp-auto] Welcome Back：已离开登录域 url={url[:100]}")
            return True
        if await _first_visible(
            page,
            [
                'input[autocomplete="one-time-code"]',
                'input[inputmode="numeric"]',
                'input[name*="otp" i]',
                'input[type="email"]',
                'input[type="password"]',
            ],
            timeout_ms=400,
        ):
            log("[otp-auto] Welcome Back：已出现邮箱/OTP/密码框")
            return True
        snip = await _page_snip(page)
        if _has_continue_cta(snip):
            saw_cta_again = True
        await page.wait_for_timeout(700)
    snip = await _page_snip(page)
    log(
        f"[otp-auto] Welcome Back：等待前进超时 sawCtaAgain={saw_cta_again} "
        f"snip={snip[:180]!r}"
    )
    return False


_EMAIL_INPUT_SELECTORS = [
    'input[type="email"]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="phone" i]',
    'input[placeholder*="username" i]',
    'input[placeholder*="邮箱"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="text"]',
]


async def _wait_for_login_surface(page, log: LogFn, timeout_ms: int = 12000) -> str:
    """
    等登录页稳定出一种表面：email_form / saved_picker / otp / unknown。
    有空邮箱输入框时优先认 email_form（标题也写 Welcome Back 的空表单）。
    """
    deadline = datetime.now(timezone.utc).timestamp() + timeout_ms / 1000
    while datetime.now(timezone.utc).timestamp() < deadline:
        # 先认输入框：空 Welcome Back「Enter your phone/email」不是选账号卡
        if await _first_visible(
            page,
            [
                'input[autocomplete="one-time-code"]',
                'input[inputmode="numeric"]',
                'input[name*="otp" i]',
            ],
            timeout_ms=300,
        ):
            return "otp"
        if await _first_visible(page, _EMAIL_INPUT_SELECTORS, timeout_ms=300):
            return "email_form"
        snip = await _page_snip(page)
        if _has_continue_cta(snip) or (
            "welcome back" in snip.lower() and "@" in snip
        ):
            return "saved_picker"
        await page.wait_for_timeout(500)
    snip = await _page_snip(page)
    if await _first_visible(page, _EMAIL_INPUT_SELECTORS, timeout_ms=800):
        return "email_form"
    if _looks_like_saved_account_picker(snip):
        return "saved_picker"
    log(f"[otp-auto] 登录表面未稳定 snip={snip[:120]!r}")
    return "unknown"


async def _js_click_continue_with_user(page, email_addr: str, log: LogFn) -> bool:
    """DOM 级点击：绕过被遮挡 / 非 button 的可点行；兼容中英文 CTA。"""
    try:
        ok = await page.evaluate(
            """(email) => {
              const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
              const ctaRe = /continue with this user|使用此用户继续|继续使用此用户|使用此账号继续/i;
              const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'));
              let target = nodes.find((el) => ctaRe.test(norm(el.textContent)) && norm(el.textContent).length < 80);
              if (!target && email) {
                const card = nodes.find((el) => {
                  const t = norm(el.textContent);
                  return t.includes(email) && ctaRe.test(t) && t.length < 280;
                });
                if (card) {
                  target = Array.from(card.querySelectorAll('button, a, [role="button"], div, span'))
                    .find((el) => ctaRe.test(norm(el.textContent)) && norm(el.textContent).length < 80) || card;
                }
              }
              // 仅有邮箱卡片时点卡片
              if (!target && email) {
                target = nodes.find((el) => {
                  const t = norm(el.textContent);
                  return t.includes(email) && /@/.test(t) && t.length < 200;
                });
              }
              if (!target) return false;
              target.scrollIntoView({ block: 'center', inline: 'center' });
              target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              target.click();
              return true;
            }""",
            email_addr or "",
        )
    except Exception as e:
        log(f"[otp-auto] Welcome Back：JS 点击失败: {e}")
        return False
    if ok:
        log("[otp-auto] Welcome Back：JS 点击 Continue/账号卡")
    return bool(ok)


async def _try_continue_saved_account(page, email_addr: str, log: LogFn) -> bool:
    """
    Welcome Back 页：点「Continue with this user」（或中文等价 / 邮箱卡），
    并以「是否离开选账号页」为准（允许 CTA 先消失的过渡态）。
    """
    await _dismiss_translate_overlay(page, log)

    async def _goto_email_form_via_different_account() -> bool:
        for label in ("Use a different account", "使用其他账号", "使用其他帐户"):
            try:
                loc = page.get_by_text(label, exact=False).first
                await loc.wait_for(state="visible", timeout=2000)
                await loc.click(timeout=4000, force=True)
                log(f"[otp-auto] Welcome Back：改走「{label}」→ 邮箱表单")
                # 换账号后：Noon 邮箱框常是 type=text + placeholder，不是 type=email。
                # 必须用完整选择器；否则会误以为「只有 Continue」去点 disabled 按钮空转。
                for _ in range(20):
                    if await _first_visible(
                        page,
                        _EMAIL_INPUT_SELECTORS,
                        timeout_ms=500,
                    ):
                        log("[otp-auto] Welcome Back：已到邮箱表单")
                        return True
                    # 中间态只有可点的 Continue：点一下推进；disabled 则跳过等待重绘
                    await _click_first(
                        page,
                        [
                            'button:text-is("Continue")',
                            'button:has-text("Continue"):not(:has-text("Continue with this user"))',
                            'button[type="submit"]',
                        ],
                        log,
                        "continue-after-different-account",
                    )
                    await page.wait_for_timeout(800)
            except Exception:
                continue
        return False

    # 实测 Continue with this user 常点了不前进；优先换账号走标准邮箱表单更稳
    if await _goto_email_form_via_different_account():
        return True

    cta_texts = (
        "Continue with this user",
        "使用此用户继续",
        "继续使用此用户",
        "使用此账号继续",
    )

    # 回退：再试 CTA / 账号卡 / JS（短超时）
    for label in cta_texts:
        try:
            loc = page.get_by_text(label, exact=True).first
            await loc.wait_for(state="visible", timeout=1500)
            await loc.click(timeout=4000, force=True)
            log(f"[otp-auto] Welcome Back：已点 CTA「{label}」")
            if await _wait_left_saved_account_picker(page, log, timeout_ms=6000):
                return True
        except Exception:
            continue

    if await _js_click_continue_with_user(page, email_addr, log):
        if await _wait_left_saved_account_picker(page, log, timeout_ms=6000):
            return True

    # CTA 试完仍失败时再试一次换账号
    if await _goto_email_form_via_different_account():
        return True

    return False


async def _fill_otp_inputs(page, code: str, log: LogFn) -> bool:
    """
    Noon OTP 常见为 6 个单格；整串 fill 到第一格会只剩一位或行为异常。
    优先逐格填；否则键盘敲进焦点框（触发 auto-advance）。
    """
    if not code or not code.isdigit():
        return False
    selectors = [
        'input[autocomplete="one-time-code"]',
        'input[inputmode="numeric"]',
        'input[name*="otp" i]',
        'input[id*="otp" i]',
        'input[type="tel"]',
    ]
    boxes = None
    for sel in selectors:
        loc = page.locator(sel)
        try:
            n = await loc.count()
        except Exception:
            n = 0
        if n >= len(code):
            boxes = loc
            break
        if n == 1 and len(code) >= 4:
            boxes = loc
            break
    if boxes is None:
        return False

    n = await boxes.count()
    try:
        if n >= len(code):
            for i, ch in enumerate(code):
                box = boxes.nth(i)
                await box.click(timeout=2000)
                await box.fill("")
                await box.fill(ch)
            log(f"[otp-auto] 已逐格回填 OTP（{n} 框）")
            return True
        # 单框：先清空再按键输入，兼容 maxlength / 分发逻辑
        box = boxes.first
        await box.click(timeout=3000)
        await box.fill("")
        await box.press_sequentially(code, delay=40)
        log("[otp-auto] 已按键回填 OTP（单框）")
        return True
    except Exception as e:
        log(f"[otp-auto] OTP 回填异常: {e}")
        return False


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
        return {
            "ok": False,
            "skipped": True,
            "reason": "OUTPOST_NOON_OTP_AUTO=0（已显式关闭无人值守）",
        }
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

    surface = await _wait_for_login_surface(page, log)
    log(f"[otp-auto] 登录表面={surface}")

    # —— 第二种态：Welcome Back 选账号（无邮箱/密码框）——
    if surface == "saved_picker" or _looks_like_saved_account_picker(snip):
        log("[otp-auto] 识别到 Welcome Back 选账号页（无输入框）")
        if not await _try_continue_saved_account(page, email_addr, log):
            return {
                "ok": False,
                "error": "Welcome Back 页未能离开（Continue / 换账号均无效）",
                "attempted": True,
                "retryable": True,
            }
        snip = await _page_snip(page)
        # 若仍像选账号页且无邮箱框，不要继续点发码（会空转）
        if _has_continue_cta(snip) and not await _first_visible(
            page,
            ['input[type="email"]', 'input[name*="email" i]'],
            timeout_ms=800,
        ):
            return {
                "ok": False,
                "error": "Welcome Back 点击后页面未前进",
                "attempted": True,
                "retryable": True,
            }

    # Welcome Back 点完后：会话若仍有效可能已离开 login.noon.partners
    try:
        cur_url = (page.url or "").lower()
    except Exception:
        cur_url = ""
    if cur_url and "login.noon.partners" not in cur_url and "accounts.google." not in cur_url:
        log(f"[otp-auto] 已离开登录域，视为会话恢复成功 url={cur_url[:120]}")
        return {"ok": True, "attempted": True, "resumedSession": True}

    # —— 邮箱（第一种态：标准登录表单，含空 Welcome Back）——
    email_loc = await _first_visible(
        page,
        _EMAIL_INPUT_SELECTORS,
        timeout_ms=3500,
    )
    if email_loc:
        filled = await _fill_if_empty(email_loc, email_addr, log, "email")
        if not filled:
            # 框里可能有脏值：强制覆盖
            try:
                await email_loc.click(timeout=2000)
                await email_loc.fill("")
                await email_loc.fill(email_addr)
                log(f"[otp-auto] 已强制填入 email={email_addr}")
            except Exception as e:
                log(f"[otp-auto] 强制填邮箱失败: {e}")
    else:
        log("[otp-auto] 未找到邮箱输入框（可能已在 OTP 步或刚点过保存账号）")

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
    # 注意：不要用泛匹配 "Continue"；且仍在 Welcome Back 时禁止点发码
    not_before = datetime.now(timezone.utc)
    if await _still_on_saved_account_picker(page):
        return {
            "ok": False,
            "error": "仍在 Welcome Back，跳过发码",
            "attempted": True,
            "retryable": True,
        }
    clicked_send = await _click_first(
        page,
        [
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
            'button:text-is("Continue")',
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

    if not code or not code.isdigit() or len(set(code)) == 1:
        log(f"[otp-auto] 拒绝异常 OTP（len={len(code) if code else 0}）")
        return {"ok": False, "error": "IMAP 取到异常验证码", "attempted": True}

    filled = await _fill_otp_inputs(page, code, log)
    if not filled:
        await otp_loc.click(timeout=3000)
        await otp_loc.fill("")
        await otp_loc.fill(code)
        log("[otp-auto] 已回填 OTP（单框 fallback）")
    log(f"[otp-auto] OTP 已写入（{code[0]}***{code[-1]}，{len(code)} 位）")

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
