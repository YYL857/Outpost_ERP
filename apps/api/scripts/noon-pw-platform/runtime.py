# -*- coding: utf-8 -*-
"""Playwright 公共：launch + storage_state（禁止导出用 persistent_context）。"""
from __future__ import annotations

import os
from pathlib import Path

_BRIDGE_DIR = Path(r"D:\YingDao\Flows\_lib")
import sys

if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))

import outpost_bridge as bridge  # noqa: E402

LOG_DIR = Path(os.environ.get("YINGDAO_LOG_DIR", r"D:\YingDao\Logs"))
ADS_PROFILE = Path(
    os.environ.get(
        "OUTPOST_ADS_PW_PROFILE",
        r"D:\outpost-data\browser-profiles\noon-ads-pw",
    )
)
SELLER_PROFILE = Path(
    os.environ.get(
        "OUTPOST_SELLER_PW_PROFILE",
        r"D:\outpost-data\browser-profiles\noon-seller-pw",
    )
)
ADS_HOME = "https://admanager.noon.partners/en-sa/home"
SELLER_HOME = os.environ.get(
    "OUTPOST_YD_SALES_BASE",
    "https://reports.noon.partners/en/sales/",
).rstrip("/") + "/"


def pw_channel():
    channel = os.environ.get("OUTPOST_ADS_PW_CHANNEL", "chrome").strip() or None
    if channel in ("-", "none", "chromium"):
        return None
    return channel


def headless_default() -> bool:
    return os.environ.get("OUTPOST_ADS_PW_HEADLESS", "0").strip().lower() in (
        "1",
        "true",
        "yes",
    )


async def with_browser(
    *,
    profile: Path,
    persist: bool,
    headed: bool,
    fn,
    extra_args: list[str] | None = None,
):
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise SystemExit(
            "缺少 playwright。请: pip install -r requirements.txt && python -m playwright install chromium"
        ) from e

    state_path = profile / "storage_state.json"
    profile.mkdir(parents=True, exist_ok=True)
    channel = pw_channel()
    pw_dl = bridge.DOWNLOAD_DIR
    pw_dl.mkdir(parents=True, exist_ok=True)
    init_script = (
        "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
    )
    base_args = ["--disable-blink-features=AutomationControlled"]
    if extra_args:
        base_args = base_args + list(extra_args)

    async with async_playwright() as p:
        browser = None
        context = None
        try:
            if persist or not state_path.is_file():
                kwargs = dict(
                    user_data_dir=str(profile),
                    headless=not headed,
                    accept_downloads=True,
                    downloads_path=str(pw_dl),
                    viewport={"width": 1400, "height": 900},
                    args=base_args,
                    locale="en-US",
                    ignore_default_args=["--enable-automation"],
                )
                if channel:
                    kwargs["channel"] = channel
                context = await p.chromium.launch_persistent_context(**kwargs)
                await context.add_init_script(init_script)
                page = context.pages[0] if context.pages else await context.new_page()
                result = await fn(context, page)
                try:
                    await context.storage_state(path=str(state_path))
                except Exception:
                    pass
                return result

            launch_kw = dict(
                headless=not headed,
                args=base_args,
                ignore_default_args=["--enable-automation"],
            )
            if channel:
                launch_kw["channel"] = channel
            browser = await p.chromium.launch(**launch_kw)
            context = await browser.new_context(
                storage_state=str(state_path),
                accept_downloads=True,
                viewport={"width": 1400, "height": 900},
                locale="en-US",
            )
            await context.add_init_script(init_script)
            page = await context.new_page()
            return await fn(context, page)
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass
            if browser:
                try:
                    await browser.close()
                except Exception:
                    pass


async def goto_resilient(page, url: str) -> None:
    last = None
    for wait in ("domcontentloaded", "commit"):
        try:
            await page.goto(url, wait_until=wait, timeout=90_000)
            await page.wait_for_timeout(2500)
            return
        except Exception as e:
            last = e
            await page.wait_for_timeout(1500)
    raise RuntimeError(f"打开页面失败: {last}") from last


async def click_first(page, selectors: list[str], *, timeout_ms: int = 2500, label: str = "click"):
    last = None
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=timeout_ms)
            await loc.click(timeout=timeout_ms)
            print(f"[{label}] OK {sel[:90]}", flush=True)
            return sel
        except Exception as e:
            last = e
    raise RuntimeError(f"[{label}] 未命中，末次: {last}")
