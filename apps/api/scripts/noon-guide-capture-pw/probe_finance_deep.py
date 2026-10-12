# -*- coding: utf-8 -*-
"""深入 finance.noon.partners：扫侧栏文案 + 点 Payments 子项。"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from capture import (  # noqa: E402
    OUT_ROOT,
    SHOP_ID,
    collect_nav_links,
    ensure_project,
    goto_resilient,
    is_missing_page,
    js_click_visible_text,
    log,
    normalize_landing,
    page_meta,
)
from main import with_seller_browser  # noqa: E402

ITEMS = [
    "Statements",
    "Statement Of Account",
    "Invoices & Creditnotes",
    "Transaction View",
    "Exports",
    "Legal Entities",
    "Payments & Fees",
]


async def visible_labels(page) -> list[str]:
    return await page.evaluate(
        """() => {
          function vis(el) {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1 && r.top < innerHeight && r.bottom > 0;
          }
          const out = [];
          const seen = new Set();
          for (const n of document.querySelectorAll('a,button,[role="button"],span,li,div,p')) {
            if (n.children && n.children.length > 6) continue;
            if (!vis(n)) continue;
            const t = (n.innerText || '').replace(/\\s+/g, ' ').trim();
            if (!t || t.length > 60 || t.length < 2) continue;
            if (seen.has(t)) continue;
            seen.add(t);
            out.push(t);
            if (out.length >= 120) break;
          }
          return out;
        }"""
    )


async def run(page):
    out = OUT_ROOT / SHOP_ID / "_finance_deep"
    out.mkdir(parents=True, exist_ok=True)
    shots = out / "shots"
    shots.mkdir(exist_ok=True)

    start = f"https://finance.noon.partners/en/?project={SHOP_ID}"
    await goto_resilient(page, start)
    await ensure_project(page, SHOP_ID)
    await page.wait_for_timeout(3000)

    labels = await visible_labels(page)
    links = await collect_nav_links(page, include_hidden=True)
    (out / "labels_root.json").write_text(
        json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out / "links_root.json").write_text(
        json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    await page.screenshot(path=str(shots / "00_root.png"), full_page=False)
    log("root labels", len(labels), labels[:40])

    # 点左侧可能出现的菜单项
    results = []
    for item in ITEMS:
        await goto_resilient(page, start)
        await page.wait_for_timeout(1500)
        clicked = await js_click_visible_text(page, item, prefer_nav=True)
        if not clicked:
            clicked = await js_click_visible_text(page, item, prefer_nav=False)
        await page.wait_for_timeout(2200)
        meta = await page_meta(page)
        missing = await is_missing_page(page)
        title = meta.get("title") or ""
        url = meta.get("url") or page.url
        ok = clicked and not missing and title.strip() != "404"
        shot = f"{item.replace(' ', '_').replace('&', 'and')[:40]}.png"
        await page.screenshot(path=str(shots / shot), full_page=False)
        # 每次点完再扫链
        more = await collect_nav_links(page, include_hidden=True)
        labs = await visible_labels(page)
        row = {
            "item": item,
            "clicked": clicked,
            "ok": ok,
            "url": url,
            "title": title,
            "landing": normalize_landing(url) if ok else "",
            "labels_sample": labs[:30],
            "new_links": more[:40],
        }
        results.append(row)
        log("item", item, "ok=" + str(ok), url[:110], "title=", title)

    # 额外：从 Legal Entities 页找左侧 nav 的所有 a
    await goto_resilient(page, start)
    await page.wait_for_timeout(2000)
    deep = await page.evaluate(
        """() => {
          const out = [];
          for (const a of document.querySelectorAll('a[href]')) {
            const href = a.href || '';
            if (!href.includes('noon.partners')) continue;
            out.push({
              text: (a.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
              href,
              left: Math.round(a.getBoundingClientRect().left),
            });
          }
          return out;
        }"""
    )
    (out / "all_anchors.json").write_text(
        json.dumps(deep, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out / "click_results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log("DONE finance deep", "ok", [r["item"] for r in results if r["ok"]])
    return {"results": results, "anchors": deep}


async def main():
    return await with_seller_browser(run)


if __name__ == "__main__":
    asyncio.run(main())
