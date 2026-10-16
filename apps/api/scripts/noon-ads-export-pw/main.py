# -*- coding: utf-8 -*-
"""
Noon Ads 导出 PoC（Playwright）— 对照影刀 outpost_noon_ads_export。

落盘（禁止写用户「下载」目录）：
  1) 原始 xlsx  D:\\YingDao\\Downloads\\{shopId}\\{shopId}_campaigns-export_{from}_{to}.xlsx
  2) 规范 csv   D:\\YingDao\\Exports\\ads\\{shopId}\\ads_sku_{from}_{to}.csv
  3) 入库投递   D:\\outpost-data\\shops\\{shopId}\\portal-imports\\ads_sku_{from}_{to}.csv
Cookie：D:\\outpost-data\\browser-profiles\\noon-ads-pw\\storage_state.json
日志：  D:\\YingDao\\Logs\\ads_export_pw_*.log
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

# 复用影刀 bridge（同一规范 CSV / portal 落盘）
_BRIDGE_DIR = Path(r"D:\YingDao\Flows\_lib")
if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))

import outpost_bridge as bridge  # noqa: E402

_PW_DIR = Path(__file__).resolve().parent.parent / "noon-pw-platform"
if str(_PW_DIR) not in sys.path:
    sys.path.insert(0, str(_PW_DIR))
from shop_switch import ensure_shop  # noqa: E402

ADS_HOME = "https://admanager.noon.partners/en-sa/home"
PROFILE_DIR = Path(
    os.environ.get(
        "OUTPOST_ADS_PW_PROFILE",
        r"D:\outpost-data\browser-profiles\noon-ads-pw",
    )
)
STATE_PATH = PROFILE_DIR / "storage_state.json"
LOG_DIR = Path(os.environ.get("YINGDAO_LOG_DIR", r"D:\YingDao\Logs"))
CMD = (sys.argv[1] if len(sys.argv) > 1 else "probe").strip().lower()

ADS_RANGE_MODE = os.environ.get("OUTPOST_YD_ADS_RANGE", "yesterday").strip().lower()
ADS_WINDOW_DAYS = int(
    os.environ.get(
        "OUTPOST_YD_ADS_DAYS",
        "7" if ADS_RANGE_MODE in ("days", "window", "rolling", "7", "last7") else "1",
    )
)
ADS_FROM = os.environ.get("OUTPOST_YD_ADS_FROM", "").strip()
ADS_TO = os.environ.get("OUTPOST_YD_ADS_TO", "").strip()
ADS_PRESET_CLICK = {
    "today": ("Today", "今天"),
    "yesterday": ("Yesterday", "昨天"),
    "last7": ("Last 7 days", "近7天"),
    "7": ("Last 7 days", "近7天"),
    "days": ("Last 7 days", "近7天"),
    "window": ("Last 7 days", "近7天"),
    "rolling": ("Last 7 days", "近7天"),
    "last30": ("Last 30 days", "近30天"),
    "30": ("Last 30 days", "近30天"),
    "last90": ("Last 90 days", "近90天"),
    "90": ("Last 90 days", "近90天"),
    "ytd": ("Year to Date", "Year to Date"),
    "year": ("Year to Date", "Year to Date"),
    "all": ("All time", "All time"),
    "alltime": ("All time", "All time"),
    "custom": ("Custom range", "Custom range"),
}
SHOP_IDS = bridge.parse_shop_ids()
HEADLESS = os.environ.get("OUTPOST_ADS_PW_HEADLESS", "0").strip().lower() in (
    "1",
    "true",
    "yes",
)


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)


def ads_url(shop_id: str | None = None) -> str:
    base = f"{ADS_HOME}?mpCode=noon&tab=campaigns"
    if shop_id:
        return f"{ADS_HOME}?project={shop_id.strip().upper()}&mpCode=noon&tab=campaigns"
    return base


def write_fail_log(payload: dict) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"ads_export_pw_fail_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def write_ok_log(payload: dict) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"ads_export_pw_ok_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


async def _page_diag(page) -> dict:
    """对齐影刀 [diag] export-labels：URL + 登录迹象 + 导出相关可见文案。"""
    try:
        data = await page.evaluate(
            """() => {
              const body = (document.body && document.body.innerText) || '';
              const low = (body + ' ' + location.href).toLowerCase();
              const loginHints = ['sign in','log in','登录','login.noon.partners'];
              const loginHits = loginHints.filter(h => low.includes(h)).length;
              // 勿用裸 \\b418\\b：业务文案/广告 ID 易误伤；只认明确风控句
              const blocked =
                low.includes('fault filter abort') ||
                low.includes('error 418') ||
                low.includes('http 418') ||
                /\\b418\\s*i'?m\\s+a\\s+teapot\\b/.test(low);
              function vis(el) {
                if (!el || !el.getClientRects) return false;
                if (el.getClientRects().length === 0) return false;
                const st = getComputedStyle(el);
                if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
                return true;
              }
              function norm(s){ return (s||'').replace(/\\s+/g,' ').trim(); }
              const labels = [];
              const nodes = document.querySelectorAll('button,a,[role="button"],[role="menuitem"],span,div,li');
              for (const n of nodes) {
                if (!vis(n)) continue;
                if (n.children && n.children.length > 6) continue;
                const t = norm(n.innerText || n.textContent || n.getAttribute('aria-label') || '');
                if (!t || t.length > 48) continue;
                if (!/export|overview|campaign|yesterday|下载|导出|昨天/i.test(t)) continue;
                if (!labels.includes(t)) labels.push(t);
                if (labels.length >= 30) break;
              }
              return {
                url: location.href,
                title: document.title || '',
                blocked,
                loginHits,
                labels,
                iframeCount: document.querySelectorAll('iframe').length,
                bodyLen: body.length,
                snip: body.replace(/\\s+/g,' ').trim().slice(0, 280),
              };
            }"""
        )
        return data if isinstance(data, dict) else {"raw": str(data)}
    except Exception as e:
        return {"error": str(e), "url": page.url if page else ""}


class AdsShopSkipped(Exception):
    """当前 Ad Manager 账号无权访问该 project，跳过继续下一店。"""


async def _page_blob(page) -> str:
    try:
        d = await _page_diag(page)
        return f"{d.get('snip') or ''} {d.get('title') or ''} {d.get('url') or ''}".lower()
    except Exception:
        return (page.url or "").lower()


def _is_permission_denied_text(blob: str) -> bool:
    t = (blob or "").lower()
    return (
        "sufficient permissions" in t
        or "do not have sufficient permission" in t
        or "没有足够权限" in t
        or "无权查看" in t
        or "无权访问" in t
    )


async def _dismiss_org_modal(page) -> bool:
    """关掉 All Organizations / 权限弹窗，避免挡住后续切店。"""
    closed = False
    for sel in (
        "button:has-text('Close')",
        "button:has-text('关闭')",
        "[role='dialog'] button:has-text('Close')",
        "[aria-label='Close']",
    ):
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=1200)
            await loc.click(timeout=1500)
            closed = True
            log(f"[perm] 关闭组织弹窗 {sel[:60]}")
            await page.wait_for_timeout(600)
            break
        except Exception:
            continue
    if not closed:
        try:
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(400)
        except Exception:
            pass
    return closed


async def _dismiss_onboarding(page) -> None:
    """关掉 Bulk Update / Product Max 等遮罩（会挡住日期下拉与导出）。"""
    for step in range(10):
        clicked = False
        # Product Max 全屏弹窗：优先 Not Now / 关闭
        for sel in (
            "button:has-text('Not Now')",
            "a:has-text('Not Now')",
            "text=Not Now",
            "[role='dialog'] button:has-text('Not Now')",
            "[role='dialog'] button[aria-label*='lose' i]",
            "[role='dialog'] button:has-text('×')",
        ):
            try:
                loc = page.locator(sel).first
                if await loc.is_visible(timeout=400):
                    await loc.click(timeout=1500, force=True)
                    log(f"[onboard] 关掉 Product Max/弹窗 {sel[:40]} step={step}")
                    clicked = True
                    await page.wait_for_timeout(500)
                    break
            except Exception:
                continue
        if not clicked:
            try:
                tip = page.get_by_text("Product Max", exact=False).first
                if await tip.is_visible(timeout=300):
                    await page.keyboard.press("Escape")
                    await page.wait_for_timeout(400)
                    log(f"[onboard] Escape 关 Product Max step={step}")
                    clicked = True
            except Exception:
                pass
        for sel in (
            "text=/\\d+\\s+of\\s+\\d+/i >> xpath=ancestor::div[contains(@class,'tour') or contains(@class,'popover') or contains(@class,'tooltip')][1] >> button[aria-label*='lose' i]",
            "[class*='tour'] button[aria-label*='lose' i]",
            "[class*='popover'] button[aria-label*='lose' i]",
            "button:has-text('Next')",
            "button:has-text('Skip')",
            "button:has-text('Got it')",
            "button:has-text('Done')",
            "[role='dialog'] button:has-text('Next')",
        ):
            try:
                loc = page.locator(sel).first
                if not await loc.is_visible(timeout=350):
                    continue
                await loc.click(timeout=1200, force=True)
                log(f"[onboard] 点掉引导 {sel[:50]} step={step}")
                clicked = True
                await page.wait_for_timeout(450)
                break
            except Exception:
                continue
        if not clicked:
            try:
                tip = page.get_by_text(
                    re.compile(r"Update many campaigns|\d+\s+of\s+\d+", re.I)
                ).first
                if await tip.is_visible(timeout=300):
                    await page.keyboard.press("Escape")
                    await page.wait_for_timeout(400)
                    log(f"[onboard] Escape 关掉引导 step={step}")
                    clicked = True
            except Exception:
                pass
        if not clicked:
            break


async def _assert_shop_accessible(page, shop_id: str) -> None:
    blob = await _page_blob(page)
    if _is_permission_denied_text(blob):
        await _dismiss_org_modal(page)
        raise AdsShopSkipped(
            f"Ad Manager 账号无权访问 {shop_id.strip().upper()}。"
            "请在该账号下开通项目，或从广告导出店铺列表中移除。"
        )


def _is_authproxy_timeout(d: dict) -> bool:
    blob = f"{d.get('snip') or ''} {d.get('title') or ''} {d.get('url') or ''}".lower()
    return "authproxy" in blob and ("timeout" in blob or "upstream" in blob)


def _is_auth_gate(url: str = "", snip: str = "", title: str = "") -> bool:
    """登录 / OTP / Google SSO 等鉴权页：禁止再 page.goto，否则会冲掉邮箱验证码。"""
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
    # 裸 /login 易误伤业务 path，只认鉴权域
    if "login" in u and ("noon.partners" in u or "google." in u):
        return True
    text_hits = (
        "log in with otp",
        "login with otp",
        "partners login",
        "verification code",
        "verify your email",
        "verify your identity",
        "enter the code",
        "enter code",
        "one-time password",
        "one time password",
        "otp sent",
        "验证码",
    )
    return any(x in s for x in text_hits)


async def _assert_not_blocked(page) -> None:
    d = await _page_diag(page)
    if _is_authproxy_timeout(d):
        raise RuntimeError(
            "NOON authproxy timeout（上游 30s 超时，页面未加载）。"
            "多半是网络/代理抖动，稍后重试或换网络后再跑广告导出。"
            f" snip={(d.get('snip') or '')[:120]}"
        )
    if d.get("blocked"):
        raise RuntimeError(
            "NOON fault filter abort / 418。请用 `python main.py login` 在有头窗口登录后重试。"
        )
    labels = " ".join(d.get("labels") or []).lower()
    snip = (d.get("snip") or "").lower()
    blob = f"{snip} {d.get('title') or ''} {d.get('url') or ''}".lower()
    if _is_permission_denied_text(blob):
        # 由调用方按店跳过；此处不抛通用登录错
        return
    if int(d.get("loginHits") or 0) >= 2 and "export" not in labels and "campaign" not in snip:
        raise RuntimeError(
            "疑似未登录 Ad Manager。请先 `python main.py login`。"
            f" diag={json.dumps(d, ensure_ascii=False)[:400]}"
        )


async def _click_first(page, selectors: list[str], *, timeout_ms: int = 2500, label: str = "click"):
    last = None
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=timeout_ms)
            try:
                await loc.click(timeout=timeout_ms)
            except Exception:
                # 引导遮罩挡点击时强制点
                await loc.click(timeout=timeout_ms, force=True)
            log(f"[{label}] OK {sel[:90]}")
            return sel
        except Exception as e:
            last = e
    raise RuntimeError(f"[{label}] 未命中，末次: {last}")


async def _goto_campaigns(page) -> None:
    url = (page.url or "").lower()
    if "tab=campaigns" in url:
        log("[tab] 已在 Campaigns URL，跳过")
        return
    log("[tab] Campaigns")
    try:
        await _click_first(
            page,
            [
                "role=tab[name='Campaigns']",
            ],
            timeout_ms=5000,
            label="tab",
        )
        await page.wait_for_timeout(1500)
    except Exception as e:
        log(f"[tab] 跳过/已在页: {e}")


def _ads_file_dates() -> tuple[str, str]:
    if ADS_FROM and ADS_TO:
        a, b = ADS_FROM, ADS_TO
        return (a, b) if a <= b else (b, a)
    return bridge.resolve_ads_date_range(mode=ADS_RANGE_MODE, days=ADS_WINDOW_DAYS)


def _preset_click_labels() -> tuple[str, str]:
    # days/window 必须按天数选预设；勿先命中 ADS_PRESET_CLICK["days"]=Last 7
    if ADS_RANGE_MODE in ("days", "window", "rolling"):
        if ADS_WINDOW_DAYS >= 85:
            return "Last 90 days", "近90天"
        if ADS_WINDOW_DAYS >= 25:
            return "Last 30 days", "近30天"
        if ADS_WINDOW_DAYS >= 6:
            return "Last 7 days", "近7天"
        if ADS_WINDOW_DAYS <= 1:
            return "Yesterday", "昨天"
        return "Custom range", "Custom range"
    if ADS_RANGE_MODE in ADS_PRESET_CLICK:
        return ADS_PRESET_CLICK[ADS_RANGE_MODE]
    return "Yesterday", "昨天"


def _date_picker_root(page):
    """只在日期弹层内找输入框，绝不碰 Search campaigns。"""
    # 优先：含 Start date 的弹层（Noon Custom range）
    with_start = page.locator(
        "[role='dialog'], [data-radix-popper-content-wrapper], "
        "[class*='Popover'], [class*='popover'], [class*='datepicker' i], "
        "[class*='DatePicker'], [class*='date-picker' i]"
    ).filter(
        has=page.get_by_text(re.compile(r"Start\s*date|End\s*date", re.I))
    )
    return with_start.first


async def _click_calendar_day(root, day: int) -> bool:
    """点日历格子上的日号（同日起止则点两次 = 起+止）。"""
    day_re = re.compile(rf"^\s*{day}\s*$")
    candidates = [
        root.get_by_role("gridcell", name=day_re),
        root.locator(f"[role='gridcell']:text-is('{day}')"),
        root.locator(f"button:text-is('{day}')"),
        root.locator(f"td:text-is('{day}')"),
    ]
    for loc in candidates:
        try:
            cell = loc.first
            if not await cell.is_visible(timeout=800):
                continue
            await cell.click(timeout=2000)
            return True
        except Exception:
            continue
    return False


async def _click_custom_apply(page, root) -> bool:
    """
    Custom range 选完日期后点 Apply（人手必点；漏点则区间不生效）。
    优先弹层内按钮，避免点到页面其它 Apply。
    """
    apply_re = re.compile(r"^\s*Apply\s*$", re.I)
    candidates = [
        root.get_by_role("button", name=apply_re),
        root.locator("button").filter(has_text=apply_re),
        root.get_by_text(apply_re),
        page.get_by_role("button", name=apply_re),
        page.locator("[role='dialog'] button").filter(has_text=apply_re),
        page.locator("button").filter(has_text=apply_re),
    ]
    for loc in candidates:
        try:
            btn = loc.first
            await btn.wait_for(state="visible", timeout=2500)
            try:
                await btn.click(timeout=2500)
            except Exception:
                await btn.click(timeout=2500, force=True)
            log("[date] Apply 已点击")
            return True
        except Exception:
            continue
    return False


async def _fill_custom_range(page, from_ymd: str, to_ymd: str) -> None:
    from_d = datetime.strptime(from_ymd, "%Y-%m-%d")
    to_d = datetime.strptime(to_ymd, "%Y-%m-%d")
    start_txt = from_d.strftime("%d/%m/%Y")
    end_txt = to_d.strftime("%d/%m/%Y")
    root = _date_picker_root(page)
    try:
        await root.wait_for(state="visible", timeout=4000)
    except Exception as e:
        raise RuntimeError(
            "Custom range 弹层未打开（勿往 Search campaigns 填日期）"
        ) from e

    filled = False
    # 优先日历点选：同日起止双击同一天（与人手一致）
    same_day = from_ymd == to_ymd
    if await _click_calendar_day(root, from_d.day):
        await page.wait_for_timeout(200)
        if same_day:
            filled = await _click_calendar_day(root, from_d.day)
            if filled:
                log(f"[date] 日历同日双击 day={from_d.day}")
        else:
            filled = await _click_calendar_day(root, to_d.day)
            if filled:
                log(f"[date] 日历点选 {from_d.day}..{to_d.day}")
            else:
                log("[date] 日历终点未点中，改填 Start/End 输入框")
                filled = False

    if not filled:
        start_sels = (
            "input[placeholder*='Start' i]",
            "input[aria-label*='Start' i]",
            "input[placeholder*='From' i]",
        )
        end_sels = (
            "input[placeholder*='End' i]",
            "input[aria-label*='End' i]",
            "input[placeholder*='To' i]",
        )
        for start_sel in start_sels:
            try:
                loc = root.locator(start_sel).first
                await loc.wait_for(state="visible", timeout=2500)
                await loc.click(timeout=2000)
                await loc.fill(start_txt)
                filled = True
                break
            except Exception:
                continue
        if filled:
            for end_sel in end_sels:
                try:
                    loc = root.locator(end_sel).first
                    await loc.wait_for(state="visible", timeout=2000)
                    await loc.click(timeout=2000)
                    await loc.fill(end_txt)
                    break
                except Exception:
                    continue
        else:
            # 弹层内可见 input，排除 Search campaigns
            vis = root.locator(
                "input:visible:not([placeholder*='Search' i]):not([placeholder*='campaign' i])"
            )
            n = await vis.count()
            if n >= 2:
                await vis.nth(0).click()
                await vis.nth(0).fill(start_txt)
                await vis.nth(1).click()
                await vis.nth(1).fill(end_txt)
                filled = True
                log("[date] 用弹层内前两个非搜索 input 填起止")

    if not filled:
        raise RuntimeError("Custom range 未找到日期输入框/日历（已避开搜索栏）")

    # 双击/填完日期后必须点 Apply，否则区间不会生效
    await page.wait_for_timeout(300)
    applied = await _click_custom_apply(page, root)
    if not applied:
        raise RuntimeError("Custom range 已选日期但未点到 Apply")
    log("[date] 已点 Apply，等待区间生效")
    await page.wait_for_timeout(800)


async def _select_date(page) -> None:
    target, zh = _preset_click_labels()
    from_ymd, to_ymd = _ads_file_dates()
    log(f"[date] 选择 {target}（文件名 {from_ymd}..{to_ymd}）")
    await _dismiss_onboarding(page)
    # 已是目标区间且无引导遮罩 → 跳过重选（Custom 仍须按文件名重填）
    if target != "Custom range":
        try:
            tip_on = False
            try:
                tip = page.get_by_text(re.compile(r"\d+\s+of\s+\d+", re.I)).first
                tip_on = await tip.is_visible(timeout=300)
            except Exception:
                tip_on = False
            if not tip_on:
                cur = page.get_by_role(
                    "button", name=re.compile(re.escape(target), re.I)
                ).first
                if await cur.is_visible(timeout=800):
                    txt = (await cur.inner_text() or "").strip().lower()
                    if target.lower() in txt:
                        log(f"[date] 页面已显示 {target!r}，跳过重选")
                        return
        except Exception:
            pass
    # 先点「当前」区间触发器（Last 30 days 等），勿用 Custom range / combobox（易打到搜索）
    trigger_sels = [
        "button:has-text('Last 30 days')",
        "button:has-text('Last 7 days')",
        "button:has-text('Last 90 days')",
        "button:has-text('Yesterday')",
        "button:has-text('Today')",
        "button:has-text('Year to Date')",
        "button:has-text('All time')",
        "[role=button]:has-text('Last 30 days')",
        "[role=button]:has-text('Last 7 days')",
        "[role=button]:has-text('Yesterday')",
        "text=Last 30 days",
        "text=Last 7 days",
        "text=Last 90 days",
        "text=Yesterday",
        "text=Today",
        "[data-testid*='date' i]",
    ]
    if target != "Custom range":
        trigger_sels = [
            f"button:has-text('{target}')",
            f"[role=button]:has-text('{target}')",
            f"text={target}",
            *trigger_sels,
        ]
    try:
        await _click_first(
            page,
            trigger_sels,
            timeout_ms=5000,
            label="date-trigger",
        )
    except Exception as e:
        log(f"[date] 打开区间失败: {e}")
        await _capture_fail_snapshot(page, "DATE", "date-trigger", e)
        raise

    await page.wait_for_timeout(600)
    await _dismiss_onboarding(page)
    pick_ok = False
    try:
        await _click_first(
            page,
            [
                f"role=option[name='{target}']",
                f"role=menuitem[name='{target}']",
                f"li:has-text('{target}')",
                f"[role='listbox'] >> text={target}",
                f"[role='menu'] >> text={target}",
                f"[role='dialog'] >> text={target}",
                f"button:has-text('{target}')",
                f"text={target}",
                f"text={zh}",
            ],
            timeout_ms=5000,
            label="date-pick",
        )
        pick_ok = True
    except Exception as e:
        await _dismiss_onboarding(page)
        if target == "Custom range":
            # Custom 必须点中选项；不能「页面上还有 Last 30」就当成功再去搜栏填日期
            await _capture_fail_snapshot(page, "DATE", "date-pick", e)
            raise RuntimeError(
                f"未能点中 Custom range 选项（勿填搜索栏）: {e}"
            ) from e
        cur_ok = False
        for label in (target, "Last 7 days", "Last 30 days", "Yesterday"):
            try:
                loc = page.get_by_role(
                    "button", name=re.compile(re.escape(label), re.I)
                ).first
                if await loc.is_visible(timeout=600):
                    cur_ok = True
                    log(f"[date] pick 失败但页面已有 {label!r}，继续导出: {e}")
                    break
            except Exception:
                continue
        if not cur_ok:
            await _capture_fail_snapshot(page, "DATE", "date-pick", e)
            raise
    if target == "Custom range":
        if not pick_ok:
            raise RuntimeError("Custom range 选项未选中")
        await page.wait_for_timeout(400)
        await _fill_custom_range(page, from_ymd, to_ymd)
    await page.wait_for_timeout(2000)


def _short_diag(d: dict) -> str:
    return (
        f"url={(d.get('url') or '')[:120]} | labels={d.get('labels')} | "
        f"blocked={d.get('blocked')} loginHits={d.get('loginHits')}"
    )


async def _capture_fail_snapshot(
    page, shop_id: str, stage: str, err: BaseException | str
) -> dict:
    """失败/跳过时落盘 PNG + JSON，便于定位卡点。"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    sid = (shop_id or "UNKNOWN").strip().upper() or "UNKNOWN"
    safe_stage = re.sub(r"[^\w\-]+", "_", stage)[:40]
    base = LOG_DIR / f"ads_snap_{sid}_{safe_stage}_{ts}"
    d = await _page_diag(page)
    shot = Path(str(base) + ".png")
    meta = Path(str(base) + ".json")
    try:
        await page.screenshot(path=str(shot), full_page=False)
        d["screenshot"] = str(shot)
    except Exception as e:
        d["screenshotError"] = str(e)
    payload = {
        "time": datetime.now().isoformat(),
        "shop_id": sid,
        "stage": stage,
        "error": str(err),
        "diag": d,
    }
    try:
        meta.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        d["meta"] = str(meta)
    except Exception as e:
        d["metaError"] = str(e)
    log(f"[snap] {sid}/{stage} → {shot.name} | {_short_diag(d)}")
    return d


async def _click_export(page) -> None:
    """对齐影刀：先 Export campaigns，否则 Export Data → Campaign Overview。"""
    log("[export] 打开导出")
    await _dismiss_onboarding(page)
    try:
        await _click_first(
            page,
            [
                "role=button[name='Export campaigns']",
                "button:has-text('Export campaigns')",
                "a:has-text('Export campaigns')",
                "text=Export campaigns",
                "role=button[name='Export all campaigns']",
                "button:has-text('Export all campaigns')",
                "text=Export all campaigns",
            ],
            timeout_ms=4000,
            label="export-direct",
        )
        return
    except Exception as e:
        log(f"[export] 无 Export campaigns → Export Data 菜单: {e}")

    d = await _page_diag(page)
    log(f"[diag] {_short_diag(d)}")

    await _click_first(
        page,
        [
            "role=button[name='Export Data']",
            "button:has-text('Export Data')",
            "role=button[name='Export']",
            "button:has-text('Export')",
            "text='Export Data'",
        ],
        timeout_ms=4000,
        label="export-menu",
    )
    await page.wait_for_timeout(800)
    await _click_first(
        page,
        [
            "role=menuitem[name=/Campaign Overview/i]",
            "role=option[name=/Campaign Overview/i]",
            "text='Campaign Overview'",
            "text=/Campaign Overview/i",
            "text='Export all campaigns'",
            "text='Export campaigns'",
        ],
        timeout_ms=4000,
        label="export-item",
    )


async def _export_one_shop(context, page, shop_id: str, from_date: str, to_date: str) -> dict:
    sid = shop_id.strip().upper()
    bridge.ensure_dirs([sid])
    dest_dir = bridge.shop_download_dir(sid)
    dest_dir.mkdir(parents=True, exist_ok=True)

    url = ads_url(sid)
    log(f"[shop] {sid} → {url}")
    await _goto_resilient(page, url)
    try:
        await page.wait_for_load_state("networkidle", timeout=20_000)
    except Exception:
        pass
    try:
        await page.locator("text=Campaigns").first.wait_for(state="visible", timeout=25_000)
    except Exception:
        pass
    await page.wait_for_timeout(1500)
    # 进店后若仍是 authproxy/空页，再强制刷新一次
    d0 = await _page_diag(page)
    if _is_authproxy_timeout(d0) or int(d0.get("bodyLen") or 0) < 200:
        log(f"[shop] 首屏异常，重开 {sid}: snip={(d0.get('snip') or '')[:80]!r}")
        await _goto_resilient(page, url)
        await page.wait_for_timeout(1500)
    await _dismiss_onboarding(page)
    await _assert_not_blocked(page)
    # URL 已带 project= 但账号无权限时会出现 All Organizations 弹窗；
    # 不能只靠 URL 判断「已在该店」。
    await _assert_shop_accessible(page, sid)
    try:
        await ensure_shop(page, sid, kind="ads")
    except RuntimeError as e:
        msg = str(e)
        # 仅「无权限 / 下拉找不到该店」视为跳过；切店器打不开是真故障
        if "无权限" in msg or (
            "找不到店铺" in msg and "无法打开店铺切换器" not in msg
        ):
            await _dismiss_org_modal(page)
            await _capture_fail_snapshot(page, sid, "perm-skip", e)
            raise AdsShopSkipped(
                f"Ad Manager 账号无权或不含 {sid}：{msg}"
            ) from e
        await _capture_fail_snapshot(page, sid, "shop-switch", e)
        raise
    await _assert_shop_accessible(page, sid)

    await _goto_campaigns(page)
    await _select_date(page)

    dest = dest_dir / f"{sid}_campaigns-export_{from_date}_{to_date}.xlsx"
    log(f"[download] 目标 {dest}")
    before_names = {p.name for p in dest_dir.glob("*") if p.is_file()}
    since = time.time() - 2

    # 只允许落到本店目录；不用 allowAndName（否则 Chrome 下载记录是 UUID）
    try:
        cdp = await context.new_cdp_session(page)
        await cdp.send(
            "Browser.setDownloadBehavior",
            {
                "behavior": "allow",
                "downloadPath": str(dest_dir),
                "eventsEnabled": True,
            },
        )
    except Exception as e:
        log(f"[download] CDP allow 跳过: {e}")

    download = None
    try:
        async with page.expect_download(timeout=120_000) as dl_info:
            await _click_export(page)
        download = await dl_info.value
        try:
            fail = await download.failure()
            if fail:
                log(f"[download] Playwright failure: {fail}")
        except Exception:
            pass
        try:
            await download.save_as(str(dest))
        except Exception as e:
            log(f"[download] save_as 失败: {e}")
    except Exception as e:
        log(f"[download] expect_download 异常: {e}，改扫目录")
        await _click_export(page)

    # persistent 下 Chrome 常直接落盘 campaigns-export-YYYYMMDD-BJ_*.xlsx，
    # save_as 可能写出 0 字节；以目录里新文件为准。
    picked: Path | None = None
    if dest.is_file() and dest.stat().st_size >= 100:
        picked = dest
    else:
        candidates = []
        for p in dest_dir.glob("*"):
            if not p.is_file():
                continue
            if p.suffix.lower() not in (".xlsx", ".xls", ".csv"):
                continue
            if "campaign" not in p.name.lower() and "export" not in p.name.lower():
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            if st.st_size < 100:
                continue
            if p.name in before_names and st.st_mtime < since:
                continue
            candidates.append(p)
        if not candidates and download is not None:
            try:
                tmp = await download.path()
                if tmp and Path(tmp).is_file() and Path(tmp).stat().st_size >= 100:
                    candidates.append(Path(tmp))
            except Exception:
                pass
        if candidates:
            picked = max(candidates, key=lambda x: x.stat().st_mtime)
            if picked.resolve() != dest.resolve():
                try:
                    if dest.is_file():
                        dest.unlink()
                except OSError:
                    pass
                shutil.copy2(picked, dest)
                picked = dest
                log(f"[download] 从落盘文件回收 → {dest.name}")
    if picked is None or not picked.is_file() or picked.stat().st_size < 100:
        raise RuntimeError(
            f"下载文件异常: {dest}（目录内未见可用 campaigns-export）"
        )
    dest = picked
    log(f"[download] {sid} → {dest} ({dest.stat().st_size} bytes)")

    rng = bridge.parse_date_range_from_name(dest.name)
    f, t = rng if rng else (from_date, to_date)

    result = bridge.process_ads_and_deliver(
        dest, from_date=f, to_date=t, days=ADS_WINDOW_DAYS, shop_id=sid
    )
    result["shop_id"] = sid
    result["mode"] = "pw-ui"
    result["from_date"] = f
    result["to_date"] = t
    log(f"[done][{sid}] portal={result.get('portal')} rows={result.get('rows')}")
    return result


def _auth_gate_from_diag(d: dict, page_url: str = "") -> bool:
    return _is_auth_gate(
        url=str(d.get("url") or page_url or ""),
        snip=str(d.get("snip") or ""),
        title=str(d.get("title") or ""),
    )


# 导出进程内：撞登录墙只自动 OTP 一次，避免死循环发码
_EXPORT_INPAGE_OTP_TRIED = False


async def _try_inpage_otp_for_export(page, *, where: str) -> bool:
    """
    导出撞鉴权页：在当前浏览器窗直接无人值守邮箱登录，不关窗、不另起「登录态」链路。
    成功返回 True（调用方继续导出）；失败返回 False。
    """
    global _EXPORT_INPAGE_OTP_TRIED
    if _EXPORT_INPAGE_OTP_TRIED:
        return False
    try:
        from noon_login_autofill import otp_auto_enabled
        from session_sync import wait_left_auth
    except ImportError as e:
        log(f"[auth] 无法加载无人值守模块: {e}")
        return False
    if not otp_auto_enabled():
        log("[auth] OUTPOST_NOON_OTP_AUTO=0，导出窗内不自动登录")
        return False
    _EXPORT_INPAGE_OTP_TRIED = True
    log(f"[auth] {where}：会话过期，当前窗无人值守邮箱登录（不关窗重启）")

    def _ads_ready(url: str) -> bool:
        u = (url or "").lower()
        return "admanager.noon.partners" in u and not _is_auth_gate(url=u)

    waited = await wait_left_auth(
        page, ready_fn=_ads_ready, label="ads-export-otp", timeout_sec=900
    )
    if waited.get("ok"):
        # 成功才打标，避免外层再开一轮；失败则留给 jobs/ads 统一登录兜底
        os.environ["OUTPOST_NOON_EXPORT_LOGIN_TRIED"] = "1"
        log(f"[auth] 窗内登录成功 url={(waited.get('url') or '')[:120]}")
        return True
    log(f"[auth] 窗内登录失败: {waited.get('error') or waited}")
    return False


async def _stop_if_auth_gate(page, *, allow_login_page: bool, where: str) -> bool:
    """
    若当前已在登录/OTP/Google 页：
    - login 流程（allow_login_page）：停住导航，返回 True
    - 导出流程：先尝试当前窗无人值守 OTP；成功则返回 False 继续；失败再抛错
    """
    url_now = ""
    try:
        url_now = page.url or ""
    except Exception:
        url_now = ""
    # URL 已能判定时不必再 evaluate，避免多余抖动
    if _is_auth_gate(url=url_now):
        on_gate = True
        d = {"url": url_now}
    else:
        try:
            d = await _page_diag(page)
        except Exception:
            d = {"url": url_now}
        on_gate = _auth_gate_from_diag(d, url_now)
    if not on_gate:
        return False
    if allow_login_page:
        log(f"[goto] {where}：落在登录/OTP 页，停止导航以免冲掉验证码 url={(d.get('url') or url_now)[:120]}")
        return True
    if await _try_inpage_otp_for_export(page, where=where):
        return False
    raise RuntimeError(
        "Ad Manager 会话已过期，停在登录/OTP 页；窗内无人值守登录未成功。"
        "请到 Playwright 工作室「登录态」一次登录，"
        "或：cd apps/api/scripts/noon-pw-platform && python main.py ads login"
        f"。url={(d.get('url') or url_now)[:100]}"
    )


async def _goto_resilient(
    page, url: str, *, allow_login_page: bool = False
) -> None:
    """Noon 对自动化常见 HTTP2/断连/authproxy；多策略重试。

    鉴权页（Noon 登录 / 邮箱 OTP / Google SSO）一律禁止再 page.goto，
    否则会刷新掉用户正在等的验证码。
    """
    last = None
    for attempt in range(1, 4):
        # 重试前若已在鉴权页，绝不能再 goto
        if await _stop_if_auth_gate(
            page, allow_login_page=allow_login_page, where=f"retry-check#{attempt}"
        ):
            return
        for wait in ("domcontentloaded", "commit"):
            try:
                await page.goto(url, wait_until=wait, timeout=90_000)
                await page.wait_for_timeout(2500)
                if await _stop_if_auth_gate(
                    page, allow_login_page=allow_login_page, where="after-goto"
                ):
                    return
                d = await _page_diag(page)
                if _auth_gate_from_diag(d, page.url or ""):
                    if await _stop_if_auth_gate(
                        page, allow_login_page=allow_login_page, where="diag"
                    ):
                        return
                if _is_authproxy_timeout(d):
                    last = RuntimeError(f"authproxy timeout snip={d.get('snip')!r}")
                    log(f"[goto] attempt={attempt} authproxy 超时，退避重试")
                    await page.wait_for_timeout(3000 * attempt)
                    break
                # SPA 首屏 body 可能很短，先等 Campaigns/Export 出现再判空
                labels = " ".join(d.get("labels") or []).lower()
                body_len = int(d.get("bodyLen") or 0)
                snip = (d.get("snip") or "").lower()
                ready = (
                    "campaign" in labels
                    or "export" in labels
                    or "campaign" in snip
                    or "ad credits" in snip
                )
                if not ready:
                    for _wait_i in range(8):
                        await page.wait_for_timeout(1500)
                        # 等待渲染期间若跳到登录/OTP，立刻停，禁止外层再 goto
                        if await _stop_if_auth_gate(
                            page,
                            allow_login_page=allow_login_page,
                            where="wait-ready",
                        ):
                            return
                        d = await _page_diag(page)
                        snip = (d.get("snip") or "").lower()
                        labels = " ".join(d.get("labels") or []).lower()
                        body_len = int(d.get("bodyLen") or 0)
                        if _is_authproxy_timeout(d):
                            break
                        if (
                            "campaign" in labels
                            or "export" in labels
                            or "campaign" in snip
                            or "ad credits" in snip
                            or body_len > 800
                        ):
                            ready = True
                            break
                if not ready and (
                    body_len < 200
                    and "campaign" not in snip
                    and "export" not in labels
                ):
                    # 空页重试前再确认：别把 OTP 页当成空页刷掉
                    if await _stop_if_auth_gate(
                        page, allow_login_page=allow_login_page, where="empty-retry"
                    ):
                        return
                    last = RuntimeError(f"空页 bodyLen={body_len}")
                    log(f"[goto] attempt={attempt} 空页，重试")
                    await page.wait_for_timeout(2000 * attempt)
                    break
                return
            except Exception as e:
                last = e
                # 会话过期 / 已在鉴权页：禁止再用 goto 重试（会冲验证码）
                if "会话已过期" in str(e):
                    raise
                try:
                    if await _stop_if_auth_gate(
                        page,
                        allow_login_page=allow_login_page,
                        where="except",
                    ):
                        return
                except RuntimeError:
                    raise
                log(f"[goto] attempt={attempt} wait={wait} 失败: {e}")
                await page.wait_for_timeout(1500)
        else:
            continue
    raise RuntimeError(f"打开 Ad Manager 失败: {last}") from (
        last if isinstance(last, BaseException) else None
    )


def _pw_channel():
    # chrome=本机 Chrome；chromium/空=bundled
    channel = os.environ.get("OUTPOST_ADS_PW_CHANNEL", "chrome").strip() or None
    if channel in ("-", "none", "chromium"):
        return None
    return channel


async def _with_browser(headed: bool, fn, *, persist: bool = False):
    """
    默认始终用同一 user_data_dir 持久 profile（登录态活在 Chrome 配置里）。
    旧逻辑「导出只灌 storage_state」会导致 Akamai 短 Cookie 过期后每次要 OTP。
    仅当 OUTPOST_ADS_PW_USE_STATE_ONLY=1 时退回纯 storage_state 启动。
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise SystemExit(
            "缺少 playwright。请: pip install -r requirements.txt && python -m playwright install chromium"
        ) from e

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    channel = _pw_channel()
    pw_dl = bridge.DOWNLOAD_DIR
    pw_dl.mkdir(parents=True, exist_ok=True)
    init_script = (
        "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
    )
    # 登录：必须 persistent（登录态写进 Chrome 配置目录）
    # 导出：默认用 storage_state 启动（避免 persistent 下载时整窗关掉）；
    #       若无 state 文件则退回 persistent。可用 OUTPOST_ADS_PW_PERSIST_EXPORT=1 强制 persistent。
    force_persist_export = os.environ.get(
        "OUTPOST_ADS_PW_PERSIST_EXPORT", "0"
    ).strip().lower() in ("1", "true", "yes")
    use_persistent = persist or force_persist_export or (not STATE_PATH.is_file())

    async with async_playwright() as p:
        browser = None
        context = None
        try:
            if use_persistent:
                log(
                    f"[browser] persistent profile={PROFILE_DIR} "
                    f"channel={channel or 'chromium'} "
                    f"(登录态复用此目录；storage_state 仅作备份)"
                )
                kwargs = dict(
                    user_data_dir=str(PROFILE_DIR),
                    headless=not headed,
                    accept_downloads=True,
                    downloads_path=str(pw_dl),
                    viewport={"width": 1400, "height": 900},
                    args=["--disable-blink-features=AutomationControlled"],
                    locale="en-US",
                    ignore_default_args=["--enable-automation"],
                )
                if channel:
                    kwargs["channel"] = channel
                try:
                    context = await p.chromium.launch_persistent_context(**kwargs)
                except Exception as e:
                    if channel:
                        log(f"[browser] channel={channel} 失败 ({e})，改 Chromium")
                        kwargs.pop("channel", None)
                        context = await p.chromium.launch_persistent_context(**kwargs)
                    else:
                        raise
            else:
                if not STATE_PATH.is_file():
                    raise RuntimeError(
                        f"无 storage_state，请先 login。期望文件: {STATE_PATH}"
                    )
                log(
                    f"[browser] STATE_ONLY storage_state={STATE_PATH} "
                    f"channel={channel or 'chromium'}（短 Cookie 易过期）"
                )
                launch_kwargs = dict(
                    headless=not headed,
                    args=["--disable-blink-features=AutomationControlled"],
                )
                if channel:
                    launch_kwargs["channel"] = channel
                try:
                    browser = await p.chromium.launch(**launch_kwargs)
                except Exception as e:
                    if channel:
                        log(f"[browser] channel={channel} 失败 ({e})，改 Chromium")
                        launch_kwargs.pop("channel", None)
                        browser = await p.chromium.launch(**launch_kwargs)
                    else:
                        raise
                context = await browser.new_context(
                    storage_state=str(STATE_PATH),
                    accept_downloads=True,
                    viewport={"width": 1400, "height": 900},
                    locale="en-US",
                )

            await context.add_init_script(init_script)
            page = context.pages[0] if context.pages else await context.new_page()
            result = await fn(context, page)
            try:
                await context.storage_state(path=str(STATE_PATH))
                log(f"[browser] 已备份 storage_state → {STATE_PATH}")
            except Exception as e:
                log(f"[browser] 写 storage_state 跳过: {e}")
            return result
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


async def cmd_login():
    log(
        f"[login] 有头打开 Ad Manager；请在弹出的 Chrome 里登录（含邮箱 OTP）。"
        f"脚本只会等待、不会刷新页面。登录成功后自动保存 profile。profile={PROFILE_DIR}"
    )

    async def run(context, page):
        # 登录流程必须允许落在 OTP 页，不能当「会话过期」直接抛死，更不能反复 goto
        await _goto_resilient(
            page,
            ads_url(SHOP_IDS[0] if SHOP_IDS else None),
            allow_login_page=True,
        )
        # 邮箱验证码常要 1～几分钟；给足 15 分钟，期间绝不 page.goto / reload
        deadline = time.time() + 900
        last_url = ""
        log("[login] 请在窗口完成登录；若已点发送验证码，请耐心等待邮件，窗口不会被脚本刷新")
        while time.time() < deadline:
            try:
                d = await _page_diag(page)
            except Exception as e:
                log(f"[login] 读页跳过: {e}")
                await page.wait_for_timeout(3000)
                continue
            url = (d.get("url") or page.url or "").lower()
            labels = " ".join(d.get("labels") or []).lower()
            snip = (d.get("snip") or "").lower()
            if url != last_url:
                log(f"[login] {_short_diag(d)}")
                last_url = url
            # 仍在鉴权页：只等，绝不导航
            if _auth_gate_from_diag(d, url):
                await page.wait_for_timeout(3000)
                continue
            logged_in = (
                not d.get("blocked")
                and (
                    "campaign" in labels
                    or "export" in labels
                    or (
                        "admanager.noon.partners" in url
                        and int(d.get("loginHits") or 0) < 2
                        and "log in to continue" not in snip
                    )
                )
            )
            if logged_in:
                log("[login] 已离开登录页，等待 Campaigns 渲染…")
                for _ in range(20):
                    await page.wait_for_timeout(1500)
                    d = await _page_diag(page)
                    if _auth_gate_from_diag(d, d.get("url") or page.url or ""):
                        log("[login] 又回到登录/OTP，继续等待你完成验证…")
                        break
                    labels = " ".join(d.get("labels") or []).lower()
                    snip = (d.get("snip") or "").strip()
                    if labels or len(snip) > 40:
                        log(f"[login] 页面就绪 {_short_diag(d)}")
                        try:
                            await context.storage_state(path=str(STATE_PATH))
                            log(f"[login] storage_state → {STATE_PATH}")
                        except Exception as e:
                            log(f"[login] storage_state 失败: {e}")
                        return d
                else:
                    log(f"[login] 已进 Ad Manager，但文案仍空 {_short_diag(d)}")
                    try:
                        await context.storage_state(path=str(STATE_PATH))
                    except Exception:
                        pass
                    return d
                continue
            await page.wait_for_timeout(3000)
        d = await _page_diag(page)
        log(f"[login] 超时仍未登录（已等 15 分钟）{_short_diag(d)}")
        return d

    return await _with_browser(headed=True, fn=run, persist=True)


async def cmd_probe():
    log(f"[probe] profile={PROFILE_DIR} shops={SHOP_IDS}")

    async def run(context, page):
        sid = SHOP_IDS[0] if SHOP_IDS else None
        try:
            await _goto_resilient(page, ads_url(sid))
            try:
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception:
                pass
            # SPA：等到 Campaigns / Export / 日期控件之一
            for sel in ("text=Campaigns", "text=Export", "text=Yesterday", "text=Export Data"):
                try:
                    await page.locator(sel).first.wait_for(state="visible", timeout=8_000)
                    log(f"[probe] 等到 {sel}")
                    break
                except Exception:
                    continue
            await page.wait_for_timeout(2000)
            d = await _page_diag(page)
            shot = LOG_DIR / f"ads_export_pw_probe_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            try:
                await page.screenshot(path=str(shot), full_page=False)
                d["screenshot"] = str(shot)
            except Exception as e:
                d["screenshotError"] = str(e)
            err = None
        except Exception as e:
            d = {"error": str(e), "url": ads_url(sid)}
            err = str(e)
            log(f"[probe] goto 失败: {e}")
        log(f"[probe] {_short_diag(d)}")
        out = {
            "ok": err is None
            and not d.get("blocked")
            and int(d.get("loginHits") or 0) < 2,
            "error": err,
            "diag": d,
            "profile": str(PROFILE_DIR),
        }
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        p = LOG_DIR / f"ads_export_pw_probe_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        p.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"[probe] wrote {p}")
        return out

    headed = not HEADLESS
    return await _with_browser(headed=headed, fn=run)


async def cmd_datecheck():
    """只打开日期下拉并点选，不导出。用来验前端变量能否对上 Ad Manager。"""
    from_date, to_date = _ads_file_dates()
    sid = (SHOP_IDS[0] if SHOP_IDS else "").strip().upper()
    if not sid:
        raise RuntimeError("无 shopId")
    if not STATE_PATH.is_file():
        raise RuntimeError("无 Ad Manager cookie，请先 login")
    target, _zh = _preset_click_labels()
    log(f"[datecheck] {sid} click={target} file={from_date}..{to_date}")

    async def run(context, page):
        await _goto_resilient(page, ads_url(sid))
        try:
            await page.wait_for_load_state("networkidle", timeout=20_000)
        except Exception:
            pass
        await page.wait_for_timeout(1500)
        await _assert_not_blocked(page)
        await _goto_campaigns(page)
        await _select_date(page)
        d = await _page_diag(page)
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        shot = LOG_DIR / f"ads_datecheck_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        try:
            await page.screenshot(path=str(shot), full_page=False)
            d["screenshot"] = str(shot)
        except Exception as e:
            d["screenshotError"] = str(e)
        labels = d.get("labels") or []
        blob = f"{labels} {d.get('snip') or ''} {d.get('url') or ''}".lower()
        hit = target.lower() in blob
        out = {
            "ok": hit,
            "target": target,
            "from_date": from_date,
            "to_date": to_date,
            "shop_id": sid,
            "diag": d,
        }
        log(f"[datecheck] labels={labels} hit={out['ok']}")
        p = LOG_DIR / f"ads_datecheck_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        p.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        return out

    return await _with_browser(headed=not HEADLESS, fn=run)


async def cmd_ui():
    shops = bridge.parse_shop_ids()
    from_date, to_date = _ads_file_dates()
    bridge.ensure_dirs(shops)
    log(
        f"[ui] shops={shops} range={ADS_RANGE_MODE} "
        f"{from_date}..{to_date} headless={HEADLESS}"
    )

    async def run(context, page):
        results, errors, skipped = [], [], []
        for i, sid in enumerate(shops):
            try:
                log(f"======== [{i+1}/{len(shops)}] {sid} ========")
                r = await _export_one_shop(context, page, sid, from_date, to_date)
                results.append(r)
            except AdsShopSkipped as e:
                skipped.append(f"{sid}: {e}")
                log(f"[SKIP][{sid}] {e}")
                await _capture_fail_snapshot(page, sid, "skipped", e)
                await _dismiss_org_modal(page)
                # 回到无 project 的广告首页，避免下一店仍卡在权限页
                try:
                    await _goto_resilient(page, ads_url(None))
                except Exception as ge:
                    log(f"[SKIP] 回首页失败: {ge}")
            except Exception as e:
                errors.append(f"{sid}: {e}")
                log(f"[FAIL][{sid}] {e}")
                traceback.print_exc()
                await _capture_fail_snapshot(page, sid, "fail", e)
                await _dismiss_org_modal(page)
                # 418 / 风控后页面废了，下一店前先回干净首页
                if "418" in str(e) or "fault filter" in str(e).lower():
                    try:
                        await _goto_resilient(page, ads_url(None))
                        await page.wait_for_timeout(2000)
                    except Exception as ge:
                        log(f"[FAIL] 418 后回首页失败: {ge}")
        if not results:
            path = write_fail_log(
                {
                    "time": datetime.now().isoformat(),
                    "errors": errors,
                    "skipped": skipped,
                    "shops": shops,
                    "range": ADS_RANGE_MODE,
                }
            )
            raise RuntimeError(
                f"全部店铺导出失败: {' | '.join(errors + skipped)} · log={path}"
            )
        payload = {
            "mode": "pw-ui",
            "from_date": from_date,
            "to_date": to_date,
            "shops": [r.get("shop_id") for r in results],
            "results": results,
            "errors": errors,
            "skipped": skipped,
            "rows": sum(int(r.get("rows") or 0) for r in results),
            "portal": "; ".join(str(r.get("portal")) for r in results),
        }
        write_ok_log(payload)
        if skipped:
            log(f"[ui] 已跳过无权限店: {skipped}")
        return payload

    headed = not HEADLESS
    return await _with_browser(headed=headed, fn=run)


def cmd_demo():
    from_date, to_date = _ads_file_dates()
    bridge.ensure_dirs(SHOP_IDS)
    results = []
    for sid in SHOP_IDS:
        rows = [
            {
                "sku": f"DEMO-{sid[-4:]}-001",
                "campaign_name": "pw-demo",
                "from_date": from_date,
                "to_date": to_date,
                "spend": "1.00",
                "revenue": "2.00",
                "orders": "1",
                "views": "10",
                "clicks": "2",
                "atc": "1",
            }
        ]
        out = bridge.shop_export_ads_dir(sid) / f"ads_sku_{from_date}_{to_date}.csv"
        bridge.write_ads_csv(rows, out)
        portal = bridge.deliver_to_portal(out, shop_id=sid)
        results.append({"shop_id": sid, "export": str(out), "portal": str(portal), "rows": 1})
        log(f"[demo] {sid} → {portal}")
    return {"mode": "demo", "results": results}


def main():
    if CMD in ("help", "-h", "--help"):
        print(__doc__)
        return 0
    if CMD == "demo":
        print(json.dumps(cmd_demo(), ensure_ascii=False, indent=2))
        return 0
    if CMD == "login":
        r = asyncio.run(cmd_login())
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0
    if CMD == "probe":
        r = asyncio.run(cmd_probe())
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0 if r.get("ok") else 2
    if CMD == "datecheck":
        try:
            r = asyncio.run(cmd_datecheck())
            print(json.dumps(r, ensure_ascii=False, indent=2))
            return 0 if r.get("ok") else 2
        except Exception as e:
            log(f"[fatal] {e}")
            return 1
    if CMD == "ui":
        try:
            r = asyncio.run(cmd_ui())
            print(json.dumps(r, ensure_ascii=False, indent=2))
            return 1 if r.get("errors") else 0
        except Exception as e:
            log(f"[fatal] {e}")
            return 1
    log(f"未知命令 {CMD}；用 login | probe | datecheck | ui | demo")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
