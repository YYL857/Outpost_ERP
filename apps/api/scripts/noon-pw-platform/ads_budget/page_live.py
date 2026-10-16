# -*- coding: utf-8 -*-
"""Ad Manager Campaigns 页：筛 Live、抓预算、改预算。

大体量店：sync/probe 会「页内滚到稳定 + 翻页」扫全量 Live；
apply 优先用 Search campaigns 按 campaignId 定位（不依赖当前页）。
"""
from __future__ import annotations

import os
import re
from typing import Any

from runtime import ADS_HOME, goto_resilient
from session_sync import is_auth_gate
from shop_switch import ensure_shop


def ads_campaigns_url(shop_id: str) -> str:
    sid = shop_id.strip().upper()
    return f"{ADS_HOME}?project={sid}&mpCode=noon&tab=campaigns"


def log(msg: str) -> None:
    print(f"[ads-budget] {msg}", flush=True)


async def _assert_not_auth_gate(page, where: str) -> None:
    """撞登录墙时抛出含关键字的错误，供上层 OTP 兜底识别。"""
    url = page.url or ""
    snip = ""
    title = ""
    try:
        title = (await page.title()) or ""
    except Exception:
        pass
    try:
        snip = await page.evaluate(
            "() => ((document.body && document.body.innerText) || '').slice(0, 300)"
        )
    except Exception:
        pass
    if is_auth_gate(url, snip or "", title or ""):
        raise RuntimeError(
            f"落在登录/OTP 页（{where}）url={url[:160]} snip={(snip or '')[:80]!r}"
        )


async def open_shop_campaigns(page, shop_id: str) -> None:
    url = ads_campaigns_url(shop_id)
    log(f"goto {url}")
    await goto_resilient(page, url)
    await _assert_not_auth_gate(page, "after-goto")
    try:
        await page.wait_for_load_state("networkidle", timeout=20_000)
    except Exception:
        pass
    try:
        await page.locator("text=Campaigns").first.wait_for(state="visible", timeout=25_000)
    except Exception:
        pass
    await page.wait_for_timeout(1200)
    await _assert_not_auth_gate(page, "before-shop-switch")
    await ensure_shop(page, shop_id, kind="ads")
    # 确保仍在 campaigns
    if "tab=campaigns" not in (page.url or "").lower():
        await goto_resilient(page, ads_campaigns_url(shop_id))
        await page.wait_for_timeout(1000)
    await _assert_not_auth_gate(page, "campaigns-ready")
    await _dismiss_overlays(page)


async def filter_live_only(page) -> None:
    """Status → Live only。失败不致命：后续 scrape 再按 Live 过滤。"""
    await _dismiss_overlays(page)
    try:
        # 点 Status 下拉（文案可能含 Live (n)）
        opened = False
        for sel in (
            "button:has-text('Live')",
            "[role=button]:has-text('Live')",
            "button:has-text('Status')",
            "[role=combobox]:has-text('Status')",
            "text=/Status/i",
        ):
            try:
                loc = page.locator(sel).first
                await loc.wait_for(state="visible", timeout=2500)
                await loc.click(timeout=2500)
                opened = True
                log(f"opened status filter via {sel[:60]}")
                break
            except Exception:
                continue
        if not opened:
            log("status filter: 未找到下拉，跳过（将靠 DOM 筛 Live）")
            return
        await page.wait_for_timeout(500)
        # Only Live
        for sel in (
            "text=/^Only$/i",
            "button:has-text('Only')",
            "[role=menuitem]:has-text('Live')",
            "label:has-text('Live')",
            "text=/^Live$/i",
        ):
            try:
                # Prefer checkbox row with Live + Only
                only = page.locator("text=/Only/i").first
                if await only.count() > 0:
                    await only.click(timeout=2000)
                    log("clicked Only next to Live")
                    break
            except Exception:
                pass
            try:
                loc = page.locator(sel).first
                await loc.click(timeout=2000)
                log(f"clicked {sel[:50]}")
                break
            except Exception:
                continue
        # Apply
        for sel in (
            "button:has-text('Apply')",
            "[role=button]:has-text('Apply')",
            "text=/^Apply$/i",
        ):
            try:
                await page.locator(sel).first.click(timeout=2000)
                log("applied status filter")
                break
            except Exception:
                continue
        await page.wait_for_timeout(1500)
    except Exception as e:
        log(f"filter_live_only soft-fail: {e}")


_SCRAPE_JS = """() => {
  function vis(el) {
    if (!el || !el.getClientRects) return false;
    if (el.getClientRects().length === 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  function norm(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }
  function parseBudget(t) {
    const m = String(t || '').replace(/,/g, '').match(/(\\d+(?:\\.\\d+)?)/);
    return m ? Number(m[1]) : null;
  }
  const rows = [];
  const trs = document.querySelectorAll('table tbody tr, [role="row"]');
  for (const tr of trs) {
    if (!vis(tr)) continue;
    const text = norm(tr.innerText || '');
    if (!text || text.length < 8) continue;
    // 跳过表头
    if (/^campaign\\b/i.test(text) && /budget/i.test(text) && !/\\bC_[A-Z0-9]+\\b/i.test(text)) continue;
    const cidM = text.match(/\\b(C_[A-Z0-9]+)\\b/i);
    if (!cidM) continue;
    const campaignId = cidM[1].toUpperCase();
    const statusLive = /\\blive\\b/i.test(text) || /budget\\s*over/i.test(text);
    const statusPaused = /\\bpaused\\b/i.test(text);
    const budgetOver = /budget\\s*over/i.test(text);
    // 活动名：通常在 ID 前
    let campaignName = '';
    const before = text.slice(0, text.indexOf(cidM[1])).trim();
    // 去掉 Active 开关等短前缀
    campaignName = before.replace(/^(active|on|off)\\s+/i, '').trim();
    if (!campaignName) {
      const lines = (tr.innerText || '').split(/\\n+/).map(norm).filter(Boolean);
      campaignName = lines[0] || '';
    }
    // Budget：Status 后第一列；降预算后可能变成「Budget over 5」
    // 例：… Live 10 84.68 … → 10；… Live Budget over 5 84.68 … → 5
    let budget = null;
    const afterBudgetOver = text.match(/budget\\s*over\\s+([\\d,]+(?:\\.\\d+)?)/i);
    if (afterBudgetOver) {
      budget = Number(String(afterBudgetOver[1]).replace(/,/g, ''));
    }
    if (budget == null) {
      const afterStatus = text.match(/\\b(?:Live|Paused|Scheduled|Draft|Archived)\\b\\s+([\\d,]+(?:\\.\\d+)?)/i);
      if (afterStatus) {
        budget = Number(String(afterStatus[1]).replace(/,/g, ''));
      }
    }
    if (budget == null) {
      const cells = [...tr.querySelectorAll('td, [role="cell"], [role="gridcell"]')];
      // 若能认出 Status 单元格，取下一格
      for (let i = 0; i < cells.length - 1; i++) {
        const ct = norm(cells[i].innerText || '');
        if (/^(Live|Paused|Scheduled|Draft)$/i.test(ct)) {
          const nt = norm(cells[i + 1].innerText || '').split(/\\s|\\n/)[0];
          const n = Number(String(nt).replace(/,/g, '').replace(/[^\\d.]/g, ''));
          if (!Number.isNaN(n)) { budget = n; break; }
        }
      }
    }
    rows.push({
      campaignId,
      campaignName,
      budget,
      statusLive,
      statusPaused,
      budgetOver,
      rowText: text.slice(0, 200),
    });
  }
  // 去重：同 campaignId 保留第一条
  const seen = new Set();
  const uniq = [];
  for (const r of rows) {
    if (seen.has(r.campaignId)) continue;
    seen.add(r.campaignId);
    uniq.push(r);
  }
  return uniq;
}"""


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)) or default)
    except ValueError:
        return default


def max_scroll_rounds() -> int:
    # 大体量店为滚动累加（非翻页）；默认加大，仍可用环境变量收紧
    return max(1, _env_int("OUTPOST_ADS_BUDGET_SCROLL_ROUNDS", 120))


def max_table_pages() -> int:
    """翻页上限（仅当真有 Next 分页时用）；主力店可调 OUTPOST_ADS_BUDGET_MAX_PAGES。"""
    return max(1, _env_int("OUTPOST_ADS_BUDGET_MAX_PAGES", 50))


_COUNT_CIDS_JS = """() => {
  const text = (document.body && document.body.innerText) || '';
  const ids = text.match(/\\bC_[A-Z0-9]+\\b/gi) || [];
  return new Set(ids.map(s => s.toUpperCase())).size;
}"""


_FIND_SCROLL_ROOT_JS = """() => {
  // 找含 campaign 行的可滚容器（虚拟列表常见）；找不到再退回 overflow 候选
  const row = [...document.querySelectorAll('tr, [role="row"]')].find((el) =>
    /\\bC_[A-Z0-9]+\\b/i.test(el.innerText || '')
  );
  const isScrollable = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    const st = getComputedStyle(el);
    const oy = st.overflowY || st.overflow || '';
    if (!/(auto|scroll|overlay)/i.test(oy)) return false;
    return (el.scrollHeight || 0) > (el.clientHeight || 0) + 20;
  };
  if (row) {
    let p = row.parentElement;
    while (p) {
      if (isScrollable(p)) {
        return {
          via: 'row-ancestor',
          tag: p.tagName,
          className: String(p.className || '').slice(0, 80),
          scrollTop: p.scrollTop,
          clientHeight: p.clientHeight,
          scrollHeight: p.scrollHeight,
        };
      }
      p = p.parentElement;
    }
  }
  const cands = [
    ...document.querySelectorAll(
      '[class*="virtual" i], [class*="Virtual"], .ag-body-viewport,' +
      '[class*="table" i] [class*="scroll" i], [role="grid"], [role="rowgroup"]'
    ),
    document.querySelector('main'),
    document.scrollingElement,
  ].filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const el of cands) {
    if (!isScrollable(el) && el !== document.scrollingElement) continue;
    const score = (el.scrollHeight || 0) - (el.clientHeight || 0);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return null;
  return {
    via: 'overflow-scan',
    tag: best.tagName,
    className: String(best.className || '').slice(0, 80),
    scrollTop: best.scrollTop,
    clientHeight: best.clientHeight,
    scrollHeight: best.scrollHeight,
  };
}"""


_SCROLL_TABLE_STEP_JS = """() => {
  const isScrollable = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    const oy = st.overflowY || st.overflow || '';
    if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
      return (el.scrollHeight || 0) > (el.clientHeight || 0) + 20;
    }
    if (!/(auto|scroll|overlay)/i.test(oy)) return false;
    return (el.scrollHeight || 0) > (el.clientHeight || 0) + 20;
  };
  const row = [...document.querySelectorAll('tr, [role="row"]')].find((el) =>
    /\\bC_[A-Z0-9]+\\b/i.test(el.innerText || '')
  );
  let best = null;
  if (row) {
    let p = row.parentElement;
    while (p) {
      if (isScrollable(p)) { best = p; break; }
      p = p.parentElement;
    }
  }
  if (!best) {
    const cands = [
      ...document.querySelectorAll(
        '[class*="virtual" i], [class*="Virtual"], .ag-body-viewport,' +
        '[class*="table" i] [class*="scroll" i], [role="grid"]'
      ),
      document.querySelector('main'),
      document.scrollingElement,
    ].filter(Boolean);
    let score = 0;
    for (const el of cands) {
      if (!isScrollable(el) && el !== document.scrollingElement) continue;
      const s = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if (s > score) { score = s; best = el; }
    }
  }
  const step = Math.max(420, Math.floor((best && best.clientHeight) || window.innerHeight || 800) * 0.85);
  if (best) {
    const before = best.scrollTop;
    best.scrollTop = Math.min(best.scrollTop + step, best.scrollHeight);
    // 若已贴底仍可能懒加载：再轻推一点
    if (best.scrollTop === before || best.scrollTop + best.clientHeight >= best.scrollHeight - 2) {
      best.scrollTop = best.scrollHeight;
    }
    try {
      best.dispatchEvent(new WheelEvent('wheel', { deltaY: step, bubbles: true, cancelable: true }));
    } catch (_) {}
    return {
      via: 'container',
      delta: best.scrollTop - before,
      scrollTop: best.scrollTop,
      clientHeight: best.clientHeight,
      scrollHeight: best.scrollHeight,
      atBottom: best.scrollTop + best.clientHeight >= best.scrollHeight - 4,
    };
  }
  const beforeY = window.scrollY || 0;
  window.scrollBy(0, step);
  return {
    via: 'window',
    delta: (window.scrollY || 0) - beforeY,
    scrollTop: window.scrollY || 0,
    atBottom: false,
  };
}"""


async def _scroll_table_once(page) -> dict[str, Any]:
    """向下滚一屏（优先表格/虚拟列表容器），触发懒加载。返回滚动信息。"""
    info: dict[str, Any] = {}
    try:
        raw = await page.evaluate(_SCROLL_TABLE_STEP_JS)
        if isinstance(raw, dict):
            info = raw
    except Exception:
        info = {}
    # 再补一次真实鼠标滚轮（部分虚拟列表只听 wheel）
    try:
        await page.mouse.wheel(0, 1600)
        info = {**info, "wheel": True}
    except Exception:
        if not info:
            return {}
    return info


async def read_live_tab_count(page) -> int | None:
    """读 Campaigns 顶栏「Live 384」类计数，作滚动目标参考。"""
    try:
        n = await page.evaluate(
            """() => {
              const nodes = document.querySelectorAll('button, a, [role="tab"], [role="button"], label, span, div');
              for (const el of nodes) {
                const t = ((el.innerText || el.textContent || '')).replace(/\\s+/g, ' ').trim();
                if (t.length > 24) continue;
                const m = t.match(/^Live\\s*(\\d{1,5})$/i);
                if (m) return Number(m[1]);
              }
              const body = ((document.body && document.body.innerText) || '').slice(0, 4000);
              const m2 = body.match(/\\bLive\\s+(\\d{1,5})\\b/);
              return m2 ? Number(m2[1]) : null;
            }"""
        )
        if isinstance(n, (int, float)) and int(n) > 0:
            return int(n)
    except Exception:
        pass
    return None


async def scroll_until_stable(page, *, max_rounds: int | None = None) -> int:
    """
    页内向下滚若干轮（兼容旧调用）。
    注意：虚拟列表下 DOM 内 C_ 数会长期停在窗口大小，不能单靠这个判断「已扫完」。
    全量抓取请用 scrape_live_campaigns 的边滚边累加。
    """
    rounds = max_rounds if max_rounds is not None else min(12, max_scroll_rounds())
    last = -1
    stable = 0
    count = 0
    for i in range(rounds):
        count = int(await page.evaluate(_COUNT_CIDS_JS) or 0)
        if count == last and count > 0:
            stable += 1
            if stable >= 2:
                log(f"scroll stable at round={i + 1} cids={count}")
                return count
        else:
            stable = 0
        last = count
        await _scroll_table_once(page)
        await page.wait_for_timeout(450)
    log(f"scroll stop max_rounds={rounds} cids={count}")
    return count


async def pagination_meta(page) -> dict[str, Any]:
    """探测底部分页：页码文案、是否有可点 Next。"""
    try:
        return await page.evaluate(
            """() => {
              function norm(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }
              const body = norm(document.body && document.body.innerText || '');
              // Showing 1-25 of 180 / 1–25 of 180 / Page 1 of 8
              let showing = null;
              let m = body.match(/showing\\s+(\\d+)\\s*[-–]\\s*(\\d+)\\s+of\\s+(\\d+)/i);
              if (m) showing = { from: +m[1], to: +m[2], total: +m[3] };
              let pageOf = null;
              m = body.match(/page\\s+(\\d+)\\s+of\\s+(\\d+)/i);
              if (m) pageOf = { page: +m[1], pages: +m[2] };

              const nextCandidates = [];
              const nodes = document.querySelectorAll(
                'button, a, [role="button"], [aria-label]'
              );
              for (const n of nodes) {
                const t = norm(n.getAttribute('aria-label') || n.innerText || n.textContent || '');
                if (!t || t.length > 40) continue;
                if (!/^(next|>|›|»|下一页)$/i.test(t) && !/^next\\b/i.test(t)) continue;
                const dis = n.disabled || n.getAttribute('aria-disabled') === 'true'
                  || (n.className || '').toLowerCase().includes('disabled');
                const r = n.getBoundingClientRect();
                if (r.width < 4 || r.height < 4) continue;
                nextCandidates.push({
                  text: t.slice(0, 30),
                  disabled: !!dis,
                  y: Math.round(r.top),
                });
              }
              // 偏页面下方的 Next
              nextCandidates.sort((a, b) => b.y - a.y);
              const next = nextCandidates[0] || null;
              return { showing, pageOf, next, nextCount: nextCandidates.length };
            }"""
        )
    except Exception as e:
        return {"error": str(e)}


async def go_next_table_page(page) -> bool:
    """点下一页。成功返回 True；无 Next / 已禁用返回 False。"""
    meta = await pagination_meta(page)
    nxt = (meta or {}).get("next") or {}
    if nxt.get("disabled"):
        log(f"pagination: Next disabled meta={meta}")
        return False

    sels = [
        "button[aria-label='Next' i]",
        "button[aria-label='Next page' i]",
        "a[aria-label='Next' i]",
        "[aria-label='Go to next page' i]",
        "button:has-text('Next')",
        "[role=button]:has-text('Next')",
        "a:has-text('Next')",
        "button:has-text('下一页')",
        "li.ant-pagination-next:not(.ant-pagination-disabled) button",
        ".ant-pagination-next:not(.ant-pagination-disabled)",
        "[class*='pagination'] button:has-text('>')",
        "button:text-is('›')",
        "button:text-is('»')",
    ]
    # 记录翻页前第一行 campaignId，用于确认页面已变
    before = await page.evaluate(
        """() => {
          const m = ((document.body&&document.body.innerText)||'').match(/\\bC_[A-Z0-9]+\\b/i);
          return m ? m[0].toUpperCase() : '';
        }"""
    )
    for sel in sels:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=1500)
            disabled = await loc.get_attribute("disabled")
            aria = await loc.get_attribute("aria-disabled")
            cls = (await loc.get_attribute("class")) or ""
            if disabled is not None or aria == "true" or "disabled" in cls.lower():
                continue
            await loc.click(timeout=2500)
            await page.wait_for_timeout(1200)
            try:
                await page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                pass
            after = await page.evaluate(
                """() => {
                  const m = ((document.body&&document.body.innerText)||'').match(/\\bC_[A-Z0-9]+\\b/i);
                  return m ? m[0].toUpperCase() : '';
                }"""
            )
            log(f"pagination: Next via {sel[:60]} before={before!r} after={after!r}")
            # 即使首行相同（极少），也视为已点击；调用方用新增 id 判断是否继续
            return True
        except Exception:
            continue
    log(f"pagination: no Next control meta={meta}")
    return False


async def go_first_table_page(page) -> None:
    """尽量回到第 1 页（sync 开始前）。无分页控件则静默跳过。"""
    meta = await pagination_meta(page)
    has_pager = bool((meta or {}).get("next")) or bool((meta or {}).get("pageOf")) or bool(
        (meta or {}).get("showing")
    )
    if not has_pager:
        return
    for sel in (
        "button[aria-label='First page' i]",
        "button[aria-label='Go to first page' i]",
        "li.ant-pagination-item-1:not(.ant-pagination-item-active) >> a",
        "li.ant-pagination-item-1 >> a",
        "[aria-label='Page 1' i]",
        ".ant-pagination-item-1:not(.ant-pagination-item-active)",
    ):
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=1200)
            await loc.click(timeout=2000)
            await page.wait_for_timeout(900)
            log(f"pagination: jump first via {sel[:50]}")
            return
        except Exception:
            continue


def _filter_live(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    live = [r for r in rows if r.get("statusLive") and not r.get("statusPaused")]
    if not live and rows:
        log(f"scrape: 无明确 Live 标记，回退全部含 C_ 行 count={len(rows)}")
        return rows
    return live


async def scrape_visible_live(page) -> list[dict[str, Any]]:
    """只抓当前 DOM 可见行（不含滚页）。"""
    raw = await page.evaluate(_SCRAPE_JS)
    return _filter_live(list(raw or []))


async def scrape_live_campaigns(page, *, scroll_rounds: int | None = None) -> list[dict[str, Any]]:
    """
    扫全量 Live：边向下滚动边累加可见行（虚拟列表 / 无限滚）。

    Noon Ad Manager 大体量店是表内滚动加载，没有「Showing / Next」分页。
    旧逻辑「滚稳 → 抓一页 → 点 Next」会在无 Next 时只拿到窗口内约 50 条就停。

    仍保留：若探测到真分页 Next，则翻页后再滚；否则纯滚动直到连续无新增。
    """
    await _dismiss_overlays(page)
    max_pages = max_table_pages()
    rounds = scroll_rounds if scroll_rounds is not None else max_scroll_rounds()
    await go_first_table_page(page)

    # 滚回顶部，避免上次停在半截
    try:
        await page.evaluate(
            """() => {
              const row = [...document.querySelectorAll('tr, [role="row"]')].find((el) =>
                /\\bC_[A-Z0-9]+\\b/i.test(el.innerText || '')
              );
              let p = row && row.parentElement;
              while (p) {
                const st = getComputedStyle(p);
                const oy = st.overflowY || st.overflow || '';
                if (/(auto|scroll|overlay)/i.test(oy) && p.scrollHeight > p.clientHeight + 20) {
                  p.scrollTop = 0;
                  break;
                }
                p = p.parentElement;
              }
              window.scrollTo(0, 0);
            }"""
        )
        await page.wait_for_timeout(400)
    except Exception:
        pass

    live_target = await read_live_tab_count(page)
    try:
        root = await page.evaluate(_FIND_SCROLL_ROOT_JS)
        log(f"scrape scrollRoot={root} liveTab={live_target}")
    except Exception as e:
        log(f"scrape scrollRoot soft-fail: {e} liveTab={live_target}")

    by_id: dict[str, dict[str, Any]] = {}
    page_idx = 0
    stagnant_scroll = 0
    stagnant_pages = 0

    while page_idx < max_pages:
        page_idx += 1
        # 本「页」：持续向下滚并累加，直到本轮滚动不再出新 id
        for step in range(1, rounds + 1):
            chunk = await scrape_visible_live(page)
            new_n = 0
            for r in chunk:
                cid = str(r.get("campaignId") or "").strip().upper()
                if not cid:
                    continue
                if cid not in by_id:
                    new_n += 1
                by_id[cid] = r

            if step == 1 or new_n > 0 or step % 10 == 0:
                log(
                    f"scrape scroll page={page_idx} step={step}/{rounds} "
                    f"visible={len(chunk)} new={new_n} total={len(by_id)}"
                    + (f" target≈{live_target}" if live_target else "")
                )

            if live_target and len(by_id) >= live_target:
                log(f"scrape: 已达 Live 顶栏计数 {live_target}，停止滚动")
                stagnant_scroll = 0
                break

            if new_n == 0:
                stagnant_scroll += 1
            else:
                stagnant_scroll = 0

            # 连续若干轮无新行：认为本滚动容器已到底（或懒加载结束）
            if stagnant_scroll >= 4 and step >= 3:
                log(
                    f"scrape: 连续 {stagnant_scroll} 轮滚动无新增 "
                    f"total={len(by_id)} step={step}"
                )
                break

            scroll_info = await _scroll_table_once(page)
            await page.wait_for_timeout(500)
            # 贴底后再多等一会给懒加载
            if (scroll_info or {}).get("atBottom"):
                await page.wait_for_timeout(700)

        meta = await pagination_meta(page)
        log(
            f"scrape page-done={page_idx}/{max_pages} total={len(by_id)} meta={meta}"
        )

        if live_target and len(by_id) >= live_target:
            break

        showing = (meta or {}).get("showing") or {}
        total = showing.get("total")
        if isinstance(total, int) and total > 0 and len(by_id) >= total:
            log(f"scrape: 已达 showing.total={total}，停止")
            break

        # 无 Next → 纯滚动模式，一页即全量
        moved = await go_next_table_page(page)
        if not moved:
            break

        # 翻页后重新滚
        stagnant_scroll = 0
        before_n = len(by_id)
        # 翻页首屏先采一次
        chunk = await scrape_visible_live(page)
        for r in chunk:
            cid = str(r.get("campaignId") or "").strip().upper()
            if cid:
                by_id[cid] = r
        if len(by_id) == before_n:
            stagnant_pages += 1
            if stagnant_pages >= 2:
                log("scrape: 连续翻页无新增，停止")
                break
        else:
            stagnant_pages = 0

    out = list(by_id.values())
    log(
        f"scrape done: live={len(out)} pages={page_idx}"
        + (f" liveTab={live_target}" if live_target else "")
    )
    if live_target and len(out) < int(live_target * 0.9):
        log(
            f"scrape WARN: 抓取 {len(out)} < Live 顶栏 {live_target} 的 90%，"
            "可能滚动容器未命中或懒加载未触发完"
        )
    return out


async def scroll_campaign_table(page, rounds: int = 8) -> None:
    """兼容旧调用：等价于有限轮滚动。"""
    await scroll_until_stable(page, max_rounds=rounds)


_CLICK_BUDGET_PENCIL_JS = """(cid) => {
  function norm(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }
  const rows = [...document.querySelectorAll('tr, [role="row"]')];
  const tr = rows.find(r => (r.innerText || '').toUpperCase().includes(String(cid).toUpperCase()));
  if (!tr) return { ok: false, reason: 'no-row' };

  const cells = [...tr.querySelectorAll('td, [role="cell"], [role="gridcell"]')];
  let budgetCell = null;
  for (let i = 0; i < cells.length; i++) {
    const t = norm(cells[i].innerText || '');
    if (/^(Live|Paused|Scheduled|Draft|Archived)$/i.test(t) && i + 1 < cells.length) {
      const next = cells[i + 1];
      const nt = norm(next.innerText || '');
      if (/\\d/.test(nt)) { budgetCell = next; break; }
    }
  }
  if (!budgetCell) {
    for (const c of cells) {
      const t = norm(c.innerText || '');
      // Budget 格通常短：如 "10" + 铅笔，不含 Pause/Revenue
      if (!/^\\d{1,6}(\\.\\d+)?/.test(t)) continue;
      if (/pause|revenue|roas|click/i.test(t)) continue;
      if (c.querySelector('svg, button')) { budgetCell = c; break; }
    }
  }
  if (!budgetCell) return { ok: false, reason: 'no-budget-cell', cellCount: cells.length };

  // 优先点格内带 svg 的小按钮（铅笔），绝不点 Pause
  const buttons = [...budgetCell.querySelectorAll('button, [role="button"]')];
  for (const b of buttons) {
    const label = norm(b.getAttribute('aria-label') || b.innerText || '');
    if (/pause|archive|duplicate|menu|more/i.test(label)) continue;
    b.click();
    return { ok: true, via: 'btn', label: label.slice(0, 40), cellText: norm(budgetCell.innerText).slice(0, 40) };
  }
  const svg = budgetCell.querySelector('svg');
  if (svg) {
    const host = svg.closest('button, [role="button"], span, div') || svg.parentElement;
    if (host) {
      host.click();
      return { ok: true, via: 'svg-host', cellText: norm(budgetCell.innerText).slice(0, 40) };
    }
  }
  budgetCell.click();
  return { ok: true, via: 'cell', cellText: norm(budgetCell.innerText).slice(0, 40) };
}"""


# 官方新功能介绍 / coachmark：关叉号或 Not Now；绝不点 Next（会一路弹下去）。
_DISMISS_OVERLAYS_JS = r"""() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();

  const isVisible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  };

  const textOf = (el) => lower(el.innerText || el.textContent || '');

  // 业务层：正在改预算时不要清掉
  const isBusinessLayer = (el) => {
    const t = textOf(el);
    if (/\bedit budget\b/.test(t)) return true;
    if (/\bare you sure\b/.test(t) && /\b(delete|archive|pause)\b/.test(t)) return true;
    return false;
  };

  const isAdvanceCta = (label) =>
    /^(next|continue|try\b|get started|learn more|explore|got it|ok)$/i.test(label) ||
    /^try\s+/i.test(label);

  const isDismissCta = (label) =>
    /^(not now|maybe later|skip|dismiss|close|no thanks|cancel)$/i.test(label) ||
    /稍后再说|以后再说|暂不|关闭/.test(label);

  const closeControlsIn = (root) => {
    const out = [];
    const nodes = root.querySelectorAll(
      'button, [role="button"], a[aria-label], [aria-label]'
    );
    for (const n of nodes) {
      if (!isVisible(n)) continue;
      const aria = lower(n.getAttribute('aria-label') || '');
      const title = lower(n.getAttribute('title') || '');
      const txt = norm(n.innerText || '');
      const label = aria || title || txt;
      if (!label) {
        // 右上角纯图标叉：小按钮 + 含 svg/path，文案空
        const r = n.getBoundingClientRect();
        if (r.width <= 48 && r.height <= 48 && n.querySelector('svg, path')) {
          out.push({ el: n, kind: 'icon-x', score: 80 });
        }
        continue;
      }
      if (isAdvanceCta(label)) continue;
      if (/close|dismiss|关闭/.test(aria) || /close|dismiss|关闭/.test(title)) {
        out.push({ el: n, kind: 'aria-close', score: 100 });
        continue;
      }
      if (isDismissCta(label)) {
        out.push({ el: n, kind: 'soft-dismiss', score: 90 });
        continue;
      }
      // 单字符 × / x
      if (/^[×x✕]$/i.test(txt) || /^[×x✕]$/i.test(aria)) {
        out.push({ el: n, kind: 'char-x', score: 95 });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };

  const looksLikeTour = (t) => /\b\d+\s+of\s+\d+\b/.test(t) && /\bnext\b/.test(t);
  const looksLikePromo = (t) =>
    (/\bnew!\b/.test(t) || /\bproduct max\b/.test(t) || /\btry\s+\w+/i.test(t)) &&
    (/\bnot now\b/.test(t) || /\btry\b/.test(t) || /\blearn more\b/.test(t));

  const candidates = [];
  const seen = new Set();
  const pushRoot = (el, reason) => {
    if (!el || !(el instanceof Element) || seen.has(el)) return;
    if (!isVisible(el)) return;
    if (isBusinessLayer(el)) return;
    seen.add(el);
    candidates.push({ el, reason });
  };

  for (const el of document.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
    pushRoot(el, 'dialog');
  }

  // 无 role 的居中大白层 / 深色 coachmark：用启发式扫可见大块
  for (const el of document.querySelectorAll('div, section, aside')) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 160 || r.height < 80) continue;
    if (r.width > window.innerWidth * 0.98 && r.height > window.innerHeight * 0.98) {
      continue; // 整页壳
    }
    const t = textOf(el);
    if (t.length < 12 || t.length > 2500) continue;
    if (looksLikeTour(t) || looksLikePromo(t)) {
      pushRoot(el, looksLikeTour(t) ? 'tour' : 'promo');
    }
  }

  // Google Translate 条
  for (const el of document.querySelectorAll(
    '.skiptranslate, #goog-gt-tt, .goog-te-banner-frame, iframe.skiptranslate'
  )) {
    pushRoot(el instanceof HTMLIFrameElement ? el.parentElement || el : el, 'translate');
  }

  const clicks = [];
  for (const { el, reason } of candidates) {
    const controls = closeControlsIn(el);
    if (!controls.length) {
      // 翻译条：直接藏掉
      if (reason === 'translate') {
        try {
          el.style.display = 'none';
          clicks.push({ reason, via: 'hide' });
        } catch (_) {}
      }
      continue;
    }
    const pick = controls[0];
    try {
      pick.el.click();
      clicks.push({
        reason,
        via: pick.kind,
        label: norm(pick.el.getAttribute('aria-label') || pick.el.innerText || '').slice(0, 40),
      });
    } catch (_) {}
    // 一轮只关一层，避免点穿
    break;
  }

  // 顶层 Close（翻译浮层等）
  if (!clicks.length) {
    for (const sel of [
      'button[aria-label="Close"]',
      'button[aria-label="关闭"]',
      'button[aria-label="Dismiss"]',
    ]) {
      const n = document.querySelector(sel);
      if (n && isVisible(n)) {
        const hostText = textOf(n.closest('[role="dialog"]') || n.parentElement || n);
        if (isBusinessLayer(n.closest('[role="dialog"]') || n)) continue;
        // 避免点到 Edit budget 附近的 Close
        if (/\bedit budget\b/.test(hostText)) continue;
        try {
          n.click();
          clicks.push({ reason: 'global-close', via: 'aria', label: sel });
          break;
        } catch (_) {}
      }
    }
  }

  return { closed: clicks.length, clicks };
}"""


async def _dismiss_overlays(page, *, rounds: int = 6) -> None:
    """
    清官方新功能模态 / coachmark / 翻译条。
    只点叉号、Not Now、Close；绝不点 Next（tour 会一串弹下去）。
    不碰「Edit budget」业务层。
    """
    total = 0
    for i in range(max(1, rounds)):
        try:
            info = await page.evaluate(_DISMISS_OVERLAYS_JS)
        except Exception as e:
            log(f"dismiss-overlays evaluate soft-fail: {e}")
            break
        closed = int((info or {}).get("closed") or 0)
        if closed <= 0:
            break
        total += closed
        clicks = (info or {}).get("clicks") or []
        log(f"dismiss-overlays round={i + 1} closed={closed} {clicks!r}")
        await page.wait_for_timeout(350)
    if total == 0:
        # 无浮层时轻 Escape 兜底（有 Edit budget 时 JS 已跳过点击；Escape 仍可能关掉无关层）
        try:
            edit_open = await page.locator("text=Edit budget").first.is_visible(timeout=200)
        except Exception:
            edit_open = False
        if not edit_open:
            try:
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(200)
            except Exception:
                pass
    else:
        log(f"dismiss-overlays done totalClosed={total}")


async def _click_edit_budget_done(page) -> str:
    """
    Edit budget 弹层保存键是 Done（不是 Update）。
    优先在含「Edit budget」的容器内点 Done。
    """
    scoped = [
        "text=Edit budget >> xpath=ancestor::*[.//button][1] >> button:has-text('Done')",
        "xpath=//*[contains(normalize-space(.),'Edit budget')]/following::button[normalize-space()='Done'][1]",
        "xpath=//button[normalize-space()='Done']",
        "button:has-text('Done')",
        "[role=button]:has-text('Done')",
    ]
    last = None
    for sel in scoped:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=4000)
            await loc.click(timeout=4000)
            log(f"[budget-done] OK {sel[:80]}")
            return sel
        except Exception as e:
            last = e
    # 兜底：get_by_role
    try:
        await page.get_by_role("button", name=re.compile(r"^Done$", re.I)).click(timeout=4000)
        log("[budget-done] OK get_by_role Done")
        return "get_by_role:Done"
    except Exception as e:
        last = e
    raise RuntimeError(f"Done 未点到: {last}")


async def _campaign_search(page, query: str) -> None:
    """Search campaigns 框：大体量店 apply 靠搜索定位，不依赖当前翻页。"""
    search = page.locator(
        "input[placeholder*='Search' i], input[placeholder*='campaign' i]"
    ).first
    await search.wait_for(state="visible", timeout=8_000)
    await search.click(timeout=2000)
    await search.fill("")
    if query:
        await search.fill(query)
    await page.wait_for_timeout(900)


async def _clear_campaign_search(page) -> None:
    try:
        await _campaign_search(page, "")
    except Exception:
        pass


async def set_campaign_budget(
    page,
    campaign_id: str,
    new_budget: float,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    单条改预算：Search(campaignId) → Budget 铅笔 → Edit budget → Done。
    不依赖列表当前页（主力店多页时仍可改）。
    """
    cid = campaign_id.strip().upper()
    budget_str = str(int(new_budget) if new_budget == int(new_budget) else new_budget)
    result: dict[str, Any] = {
        "campaignId": cid,
        "target": new_budget,
        "ok": False,
        "dryRun": dry_run,
        "error": None,
    }
    if dry_run:
        result["ok"] = True
        result["error"] = "dry-run"
        return result

    await _dismiss_overlays(page)

    try:
        await _campaign_search(page, cid)
    except Exception as e:
        log(f"search soft-fail {cid}: {e}")

    try:
        row = page.locator(f"tr:has-text('{cid}'), [role=row]:has-text('{cid}')").first
        await row.wait_for(state="visible", timeout=15_000)
    except Exception as e:
        # 搜索未命中：清搜索后翻页找（主力店兜底）
        found = await _find_row_across_pages(page, cid)
        if not found:
            result["error"] = f"row not found: {e}"
            await _clear_campaign_search(page)
            return result
        row = found

    # Playwright：行内第一个「带 svg、文案不是 Pause」的按钮 = 预算铅笔（首次实测可开弹层）
    clicked = False
    try:
        btns = row.locator("button:has(svg)")
        n = await btns.count()
        for i in range(min(n, 8)):
            btn = btns.nth(i)
            txt = ((await btn.inner_text()) or "").strip()
            if re.search(r"pause|archive|duplicate", txt, re.I):
                continue
            box = await btn.bounding_box()
            if not box or box["width"] < 4:
                continue
            await btn.click(timeout=2500)
            clicked = True
            log(f"pencil pw button:has(svg) i={i} text={txt!r} for {cid}")
            break
    except Exception as e:
        log(f"pencil pw miss: {e}")

    if not clicked:
        click_info = await page.evaluate(_CLICK_BUDGET_PENCIL_JS, cid)
        log(f"pencil js {cid}: {click_info}")
        if not (click_info or {}).get("ok"):
            result["error"] = f"could not click budget edit: {click_info}"
            return result

    await page.wait_for_timeout(800)

    # 等 Edit budget 标题出现
    try:
        await page.locator("text=Edit budget").first.wait_for(state="visible", timeout=8_000)
    except Exception as e:
        result["error"] = f"Edit budget dialog not open: {e}"
        await _dismiss_overlays(page)
        return result

    inp = None
    inp_sels = [
        "xpath=//*[contains(normalize-space(.),'Edit budget')]/following::input[1]",
        "text=Edit budget >> xpath=ancestor::*[.//input][1] >> input",
        "[role='dialog'] input",
        "input[type='number']:visible",
        "input[inputmode='decimal']:visible",
        "input[inputmode='numeric']:visible",
    ]
    last_inp_err = None
    for sel in inp_sels:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=3000)
            ph = ((await loc.get_attribute("placeholder")) or "").lower()
            if "search" in ph:
                continue
            inp = loc
            log(f"budget input via {sel[:80]}")
            break
        except Exception as e:
            last_inp_err = e

    if inp is None:
        result["error"] = f"input: {last_inp_err}"
        await _dismiss_overlays(page)
        return result

    try:
        await inp.click(timeout=2000)
        await inp.fill("")
        await inp.fill(budget_str)
        await page.wait_for_timeout(250)
    except Exception as e:
        result["error"] = f"fill: {e}"
        await _dismiss_overlays(page)
        return result

    try:
        await _click_edit_budget_done(page)
    except Exception as e:
        result["error"] = f"confirm Done: {e}"
        await _dismiss_overlays(page)
        await _clear_campaign_search(page)
        return result

    await page.wait_for_timeout(1200)
    # 成功后清掉可能残留的弹层；勿连按 Escape 误关未保存层（已点 Done）
    try:
        still = await page.locator("text=Edit budget").first.is_visible(timeout=500)
        if still:
            await _dismiss_overlays(page)
    except Exception:
        pass

    await _clear_campaign_search(page)
    result["ok"] = True
    return result


async def _find_row_across_pages(page, campaign_id: str):
    """搜索失败时：清搜索 → 从第 1 页翻找含 campaignId 的行。"""
    cid = campaign_id.strip().upper()
    await _clear_campaign_search(page)
    await go_first_table_page(page)
    max_pages = max_table_pages()
    for page_idx in range(1, max_pages + 1):
        await scroll_until_stable(page, max_rounds=min(8, max_scroll_rounds()))
        loc = page.locator(f"tr:has-text('{cid}'), [role=row]:has-text('{cid}')").first
        try:
            await loc.wait_for(state="visible", timeout=2500)
            log(f"found {cid} on table page={page_idx} (fallback scan)")
            return loc
        except Exception:
            pass
        if not await go_next_table_page(page):
            break
    return None


async def probe_page(page) -> dict[str, Any]:
    """轻量探针：URL、是否见 Campaigns、Live 行数、样例预算。"""
    url = page.url or ""
    body_snip = ""
    try:
        body_snip = await page.evaluate(
            "() => ((document.body && document.body.innerText) || '').slice(0, 400)"
        )
    except Exception:
        pass
    # probe 也走同一滚动累加路径，但步数上限略低（仍可读 Live 顶栏提前停）
    live = await scrape_live_campaigns(page, scroll_rounds=min(40, max_scroll_rounds()))
    sample = live[:5]
    return {
        "url": url,
        "hasCampaigns": bool(re.search(r"campaign", body_snip, re.I)),
        "liveCount": len(live),
        "sample": sample,
        "bodySnip": body_snip[:200],
    }
