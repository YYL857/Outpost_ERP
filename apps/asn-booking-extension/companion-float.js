/**
 * Noon 页悬浮条：可拖动；侧栏打开时隐藏；默认收起避免挡按钮
 */
(function () {
  if (globalThis.__OUTPOST_BOOKING_FLOAT__) return;
  globalThis.__OUTPOST_BOOKING_FLOAT__ = true;

  const ROOT_ID = "outpost-booking-float";
  const POS_KEY = "bookingFloatPos";

  function stepLabel(step) {
    const map = {
      ticket: "输入票号",
      align: "对齐清单",
      asn: "填 ASN",
      schedule: "待约仓",
      notify: "可发群",
      done: "完成",
    };
    return map[step] || step || "—";
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function applyPos(el, pos) {
    if (!pos || typeof pos.left !== "number" || typeof pos.top !== "number") {
      el.style.left = "";
      el.style.top = "";
      el.style.right = "16px";
      el.style.bottom = "16px";
      return;
    }
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  }

  function enableDrag(el, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let moved = false;

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.left = `${origLeft}px`;
      el.style.top = `${origTop}px`;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const rect = el.getBoundingClientRect();
      const left = clamp(origLeft + dx, 8, window.innerWidth - rect.width - 8);
      const top = clamp(origTop + dy, 8, window.innerHeight - rect.height - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      const rect = el.getBoundingClientRect();
      const pos = { left: rect.left, top: rect.top };
      chrome.storage.local.set({ [POS_KEY]: pos });
      handle.dataset.justDragged = moved ? "1" : "0";
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  function ensureRoot() {
    let el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.className = "collapsed";
    el.innerHTML = `
      <style>
        #${ROOT_ID} {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483646;
          font: 12px/1.4 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          color: #1c1916;
          user-select: none;
        }
        #${ROOT_ID}.hidden-by-sidepanel { display: none !important; }
        #${ROOT_ID} .obf-panel {
          min-width: 160px;
          max-width: 260px;
          background: #fffdf9;
          border: 1px solid #e4ddd4;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(28,25,22,0.12);
          overflow: hidden;
        }
        #${ROOT_ID}.collapsed .obf-body { display: none; }
        #${ROOT_ID} .obf-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: #0f6e56;
          color: #fff;
          cursor: grab;
          touch-action: none;
        }
        #${ROOT_ID} .obf-bar:active { cursor: grabbing; }
        #${ROOT_ID} .obf-bar.ok { background: #166534; }
        #${ROOT_ID} .obf-title { font-weight: 600; flex: 1; }
        #${ROOT_ID} .obf-toggle {
          opacity: 0.9;
          cursor: pointer;
          padding: 0 4px;
        }
        #${ROOT_ID} .obf-body { padding: 10px; background: #fffdf9; }
        #${ROOT_ID} .obf-line { margin: 0 0 4px; color: #3f3a36; }
        #${ROOT_ID} .obf-muted { color: #6b6560; }
        #${ROOT_ID} .obf-tip {
          margin: 8px 0 0;
          color: #6b6560;
          font-size: 11px;
        }
      </style>
      <div class="obf-panel">
        <div class="obf-bar" id="obfBar">
          <span class="obf-title" id="obfTitle">约仓陪伴</span>
          <span class="obf-toggle" id="obfToggle" title="展开/收起">▸</span>
        </div>
        <div class="obf-body">
          <p class="obf-line" id="obfLine1">未开始：侧栏输入票号</p>
          <p class="obf-line obf-muted" id="obfLine2"></p>
          <p class="obf-tip">可拖动条带走开按钮；侧栏打开时自动隐藏</p>
        </div>
      </div>
    `;
    document.documentElement.appendChild(el);

    const bar = el.querySelector("#obfBar");
    const toggle = el.querySelector("#obfToggle");
    enableDrag(el, bar);

    const toggleCollapse = () => {
      el.classList.toggle("collapsed");
      toggle.textContent = el.classList.contains("collapsed") ? "▸" : "▾";
    };

    // 点击收起/展开；拖动后不触发
    bar.addEventListener("click", (e) => {
      if (bar.dataset.justDragged === "1") {
        bar.dataset.justDragged = "0";
        return;
      }
      if (e.target === toggle || e.target.closest("#obfToggle")) {
        toggleCollapse();
        return;
      }
      toggleCollapse();
    });

    chrome.storage.local.get([POS_KEY], (result) => {
      applyPos(el, result[POS_KEY]);
    });
    return el;
  }

  function setHiddenBySidepanel(hidden) {
    const root = ensureRoot();
    root.classList.toggle("hidden-by-sidepanel", Boolean(hidden));
  }

  function render(session, pageShop) {
    const root = ensureRoot();
    const title = root.querySelector("#obfTitle");
    const line1 = root.querySelector("#obfLine1");
    const line2 = root.querySelector("#obfLine2");
    const bar = root.querySelector("#obfBar");

    const pageLabel = pageShop
      ? `${pageShop.label || pageShop.prefix} ${pageShop.name || ""}`.trim()
      : "";

    if (!session) {
      title.textContent = pageLabel || "约仓陪伴";
      line1.textContent = pageShop
        ? `当前页：${pageShop.name}（${pageShop.projectCode}）`
        : "未开始：侧栏输入票号";
      line2.textContent = "拖动可挪开；点条展开";
      bar.classList.remove("ok");
      return;
    }

    const shop =
      session.shops.find((s) => s.shopPrefix === session.activeShopPrefix) ||
      session.shops[0];
    const boxCount = shop ? shop.boxes.length : 0;
    const asn = shop?.asnId || session.capture?.asnId || "—";
    const shopTitle = shop
      ? `${shop.shopLabel || shop.shopPrefix}${shop.shopName ? " " + shop.shopName : ""}`
      : "—";
    title.textContent = `${shop?.shopPrefix || "—"} · ${boxCount}箱 · ${stepLabel(session.step)}`;

    if (session.capture) {
      bar.classList.add("ok");
      line1.textContent = `已约 ${session.capture.scheduledDate} ${session.capture.scheduleSlot}`;
      line2.textContent = `ASN ${session.capture.asnId}`;
    } else {
      bar.classList.remove("ok");
      line1.textContent = `${shopTitle} · ASN ${asn}`;
      line2.textContent = [
        `票号 ${session.ticketPrefix}`,
        shop
          ? `${shop.items.length} SKU`
          : "",
        pageShop && pageShop.prefix !== shop?.shopPrefix
          ? `页=${pageShop.prefix}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }

  function detectAndStorePageShop() {
    if (typeof NoonSiteConfig === "undefined" || !NoonSiteConfig.detectPageShop) {
      return null;
    }
    const shop = NoonSiteConfig.detectPageShop(location.href, document);
    if (shop) {
      chrome.storage.local.set({ pageShop: shop });
    }
    return shop;
  }

  function pull() {
    chrome.storage.local.get(
      ["bookingSessionSnapshot", "sidePanelOpen", "pageShop", "bookingWorkMode"],
      (result) => {
        setHiddenBySidepanel(Boolean(result.sidePanelOpen));
        const pageShop = result.pageShop || detectAndStorePageShop();
        if (result.bookingWorkMode === "offline") {
          const root = ensureRoot();
          const title = root.querySelector("#obfTitle");
          const line1 = root.querySelector("#obfLine1");
          const line2 = root.querySelector("#obfLine2");
          const bar = root.querySelector("#obfBar");
          title.textContent = "约仓（离线）";
          line1.textContent = "不连主机 · 侧栏可直接开始监控";
          line2.textContent = pageShop
            ? `当前页：${pageShop.name || pageShop.label || ""}`
            : "拖动可挪开；点条展开";
          bar.classList.remove("ok");
          return;
        }
        render(result.bookingSessionSnapshot || null, pageShop);
      },
    );
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.sidePanelOpen) {
      setHiddenBySidepanel(Boolean(changes.sidePanelOpen.newValue));
    }
    if (
      changes.bookingSessionSnapshot ||
      changes.pageShop ||
      changes.sidePanelOpen ||
      changes.bookingWorkMode
    ) {
      pull();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (
      message.action === "bookingSessionUpdated" ||
      message.action === "bookingCaptureApplied"
    ) {
      pull();
    }
  });

  // SPA 路由变化时重新识别店铺
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      detectAndStorePageShop();
      pull();
    }
  }, 1500);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      detectAndStorePageShop();
      pull();
    });
  } else {
    detectAndStorePageShop();
    pull();
  }
})();
