let isMonitoring = false;
let stopRequested = false;
let targetConfig = null;
let monitorGeneration = 0;
/** 约成后主动清 monitoringActive 时，避免误报「收到停止指令」 */
let stopLogSuppressed = false;

const __noonContentAlreadyLoaded = Boolean(globalThis.__NOON_BOOKING_CONTENT_LOADED__);
globalThis.__NOON_BOOKING_CONTENT_LOADED__ = true;

// L2：运行时站点门禁（与 manifest 宽匹配配合，避免写死单一域名）
const siteVerdict = (typeof NoonSiteConfig !== 'undefined' && NoonSiteConfig.matchUrl)
    ? NoonSiteConfig.matchUrl(location.href)
    : { ok: true, message: 'site-config missing, skip gate' };

//debugger;

//log('content.js 开始加载');
// 安全发送日志（忽略连接错误）
function log(msg) {
    console.log(msg);
    try {
        chrome.runtime.sendMessage({ action: 'log', text: msg }, () => {
            void chrome.runtime.lastError;
        });
    } catch (e) {}
}

function assertSchedulePage() {
    if (siteVerdict && siteVerdict.ok === false) {
        throw new Error(siteVerdict.message || '当前页不在站点白名单内');
    }
}

// 可中断延迟：停止后尽快结束等待，避免点了停止仍继续跑
function sleep(min = 200, max = 500) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
            if (stopRequested) {
                clearInterval(timer);
                reject(new Error('已停止'));
                return;
            }
            if (Date.now() - start >= ms) {
                clearInterval(timer);
                resolve();
            }
        }, 200);
    });
}

function isStopError(err) {
    return stopRequested || !isMonitoring || (err && err.message === '已停止');
}

async function reloadIfStillMonitoring(reason) {
    if (stopRequested || !isMonitoring) {
        return false;
    }
    const active = await new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(false);
        }, 2000);
        try {
            chrome.storage.local.get('monitoringActive', (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                void chrome.runtime.lastError;
                resolve(Boolean(result && result.monitoringActive));
            });
        } catch (e) {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(false);
            }
        }
    });
    if (!active || stopRequested || !isMonitoring) {
        stopRequested = true;
        isMonitoring = false;
        log('检测到已停止，取消页面刷新');
        return false;
    }
    log(reason || '刷新页面后重试...');
    location.reload();
    return true;
}

async function waitForElement(selector, timeout = 10000, visible = true) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (stopRequested || !isMonitoring) {
            throw new Error('已停止');
        }
        const el = document.querySelector(selector);
        if (visible && el) return el;
        if (!visible && !el) return true;
        await sleep(100, 200);
    }
    throw new Error(`元素 ${selector} 未找到`);
}

// slow：打开下拉/点日期前随机等 5~10 秒。now：菜单或时段已经出现，立刻点，避免等太久菜单关掉。
async function clickElement(element, pace = 'slow') {
    if (!element || stopRequested || !isMonitoring) return false;
    if (pace !== 'now') {
        try { element.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) {}
        await sleep(5000, 10000);
    }
    if (stopRequested || !isMonitoring || !element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + Math.min(Math.max(rect.height / 2, 1), rect.height - 1);
    const base = {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 0,
        buttons: 1
    };
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of types) {
        if (stopRequested || !isMonitoring) return false;
        const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        element.dispatchEvent(new Ctor(type, base));
    }
    const top = document.elementFromPoint(clientX, clientY);
    const target = (top && (top === element || element.contains(top))) ? top : element;
    try { target.click(); } catch (e) {}
    return true;
}

function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') {
        return false;
    }
    return true;
}

function normalizeWarehouseCode(text) {
    return String(text || '').trim().toUpperCase();
}

/** 兼容页面展示 "RUH01S - Riyadh" / title 仅代码 / 选项全文 */
function warehouseTextMatches(text, targetWarehouse) {
    const raw = String(text || '').trim();
    const code = normalizeWarehouseCode(targetWarehouse);
    if (!raw || !code) return false;
    const upper = raw.toUpperCase();
    if (upper === code) return true;
    if (upper.startsWith(code + ' ') || upper.startsWith(code + '-') || upper.startsWith(code + ' -')) {
        return true;
    }
    const firstToken = upper.split(/[\s\-–—|/]+/)[0];
    return firstToken === code;
}

function isWarehousePlaceholder(text) {
    const t = String(text || '').trim();
    return /select\s*warehouse/i.test(t) || /选择仓库/.test(t) || /^select\.\.\.$/i.test(t);
}

function getWarehouseDisplayText(el) {
    if (!el) return '';
    if (el.matches && el.matches('input, textarea')) {
        return (el.value || el.getAttribute('placeholder') || '').trim();
    }
    const item = el.querySelector && el.querySelector('.ant-select-selection-item');
    if (item) return (item.getAttribute('title') || item.textContent || '').trim();
    const ph = el.querySelector && el.querySelector('.ant-select-selection-placeholder, [class*="placeholder"]');
    if (ph) return (ph.textContent || '').trim();
    const aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'));
    if (aria) return aria.trim();
    return String(el.innerText || el.textContent || '').trim().split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
}

function closestClickable(el) {
    if (!el) return null;
    return el.closest(
        '[role="combobox"], [role="button"], button, .ant-select, [class*="Select"], [class*="select"], [class*="dropdown"], input'
    ) || el;
}

/**
 * 新 UI 可能已不用 .ant-select。按「Select warehouse... / Ship to」文案定位。
 * 旧 ant-select 仍作为兜底。
 */
function findWarehousePicker() {
    // 1) 占位文案
    const textNodes = Array.from(document.querySelectorAll('div, span, p, label, button, [role="combobox"], [role="button"]'));
    for (const el of textNodes) {
        if (!isElementVisible(el)) continue;
        const own = (el.childElementCount === 0 ? el.textContent : '') || '';
        const direct = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent.trim())
            .join('');
        const candidate = (direct || own || '').trim();
        if (isWarehousePlaceholder(candidate) || isWarehousePlaceholder(el.getAttribute && el.getAttribute('placeholder'))) {
            return closestClickable(el);
        }
    }

    // 2) input placeholder
    const input = Array.from(document.querySelectorAll('input')).find((inp) => {
        if (!isElementVisible(inp)) return false;
        return isWarehousePlaceholder(inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || '');
    });
    if (input) return closestClickable(input);

    // 3) role=combobox 靠近 Ship to
    const comboboxes = Array.from(document.querySelectorAll('[role="combobox"]')).filter(isElementVisible);
    if (comboboxes.length === 1) return comboboxes[0];
    if (comboboxes.length > 1) {
        const ship = Array.from(document.querySelectorAll('div, span, label, h1, h2, h3, h4, p'))
            .find((el) => /^(ship\s*to|发货至|运至)$/i.test((el.textContent || '').trim()));
        if (ship) {
            const shipTop = ship.getBoundingClientRect().top;
            comboboxes.sort((a, b) => Math.abs(a.getBoundingClientRect().top - shipTop) - Math.abs(b.getBoundingClientRect().top - shipTop));
            return comboboxes[0];
        }
        return comboboxes[0];
    }

    // 4) Ship to 区块内第一个像下拉的控件
    const shipToLabel = Array.from(document.querySelectorAll('div, span, label, p, h1, h2, h3, h4'))
        .find((el) => {
            const t = (el.textContent || '').trim();
            return /^ship\s*to$/i.test(t) || t === '发货至' || t === '运至';
        });
    if (shipToLabel) {
        let root = shipToLabel.parentElement;
        for (let i = 0; i < 8 && root; i += 1) {
            const hit = root.querySelector(
                '[role="combobox"], .ant-select.ant-select-single, input[placeholder*="warehouse"], input[placeholder*="Warehouse"], input[placeholder*="仓库"]'
            );
            if (hit && isElementVisible(hit)) return closestClickable(hit);
            root = root.parentElement;
        }
    }

    // 5) 旧版 ant-select 兜底
    const ant = document.querySelector('.ant-select.ant-select-single.ant-select-show-arrow')
        || document.querySelector('.ant-select.ant-select-single');
    if (ant && isElementVisible(ant)) return ant;

    return null;
}

function findOpenOptionPanels() {
    const panels = [];
    const nodes = document.querySelectorAll(
        '[role="listbox"], .ant-select-dropdown, [class*="dropdown"], [class*="Dropdown"], [class*="menu"], [class*="Menu"], [class*="popover"], [class*="Popover"], ul'
    );
    for (const el of nodes) {
        if (el.classList && el.classList.contains('ant-select-dropdown-hidden')) continue;
        if (!isElementVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height < 36 || rect.width < 80) continue;
        panels.push(el);
    }
    return panels;
}

function resolveOptionRow(opt) {
    if (!opt) return null;
    return opt.closest('[role="option"], .ant-select-item-option, li, button, [role="menuitem"]') || opt;
}

function searchWarehouseOption(targetWarehouse, roots, includePlainText) {
    let best = null;
    let bestArea = Infinity;
    const selector = includePlainText
        ? '[role="option"], .ant-select-item-option, li, button, [role="menuitem"], div, span'
        : '[role="option"], .ant-select-item-option, li, button, [role="menuitem"]';
    for (const root of roots) {
        const nodes = root.querySelectorAll(selector);
        for (const opt of nodes) {
            const title = opt.getAttribute('title') || '';
            const text = (opt.textContent || '').trim();
            if (!text || text.length > 80) continue;
            if (!warehouseTextMatches(title, targetWarehouse) && !warehouseTextMatches(text, targetWarehouse)) continue;
            const row = resolveOptionRow(opt);
            if (!row || !isElementVisible(row)) continue;
            const rect = row.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > 0 && area < bestArea) {
                best = row;
                bestArea = area;
            }
        }
    }
    return best;
}

function findWarehouseOption(targetWarehouse) {
    const panels = findOpenOptionPanels();
    if (panels.length) {
        const inPanel = searchWarehouseOption(targetWarehouse, panels, true);
        if (inPanel) return inPanel;
    }
    return searchWarehouseOption(targetWarehouse, [document], false);
}

function pageShowsWarehouse(targetWarehouse) {
    const code = normalizeWarehouseCode(targetWarehouse);
    if (!code) return false;
    const nodes = document.querySelectorAll('div, span, button, [role="combobox"], [role="button"], input');
    for (const el of nodes) {
        if (!isElementVisible(el)) continue;
        const text = getWarehouseDisplayText(el) || (el.childElementCount === 0 ? (el.textContent || '').trim() : '');
        if (!text || text.length > 80 || isWarehousePlaceholder(text)) continue;
        if (warehouseTextMatches(text, targetWarehouse)) return true;
    }
    return false;
}

/** 从展示文案提取仓码，如 "AUH01S - Abudhabi" → AUH01S */
function extractWarehouseCodeFromDisplay(text) {
    const raw = String(text || '').trim();
    if (!raw || isWarehousePlaceholder(raw)) return '';
    const upper = normalizeWarehouseCode(raw);
    const first = upper.split(/[\s\-–—|/]+/)[0];
    // 常见 noon 仓码：AUH01S / RUH01S / DXB01 等
    if (/^[A-Z]{2,6}\d{2}[A-Z]?$/.test(first)) return first;
    const m = upper.match(/\b([A-Z]{2,6}\d{2}[A-Z]?)\b/);
    return m ? m[1] : '';
}

/** 页文案提示：本 ASN 仅开放唯一目的仓（下拉常点不开） */
function pageHintsSoleWarehouseLocked() {
    const body = document.body ? (document.body.innerText || '') : '';
    if (!body) return false;
    return /only\s+destination\s+warehouse(\s+open\s+to\s+this\s+ASN)?/i.test(body)
        || /唯一目的仓|仅有一个目的仓|唯一可用仓库|仅开放.*仓库|唯一.*仓库/.test(body);
}

function isWarehousePickerNonOpenable(picker) {
    if (!picker) return false;
    if (picker.disabled) return true;
    if (picker.getAttribute && (
        picker.getAttribute('aria-disabled') === 'true'
        || picker.getAttribute('disabled') != null
        || picker.getAttribute('data-disabled') === 'true'
    )) {
        return true;
    }
    if (picker.classList && (
        picker.classList.contains('disabled')
        || picker.classList.contains('ant-select-disabled')
        || picker.classList.contains('pointer-events-none')
    )) {
        return true;
    }
    try {
        const style = window.getComputedStyle(picker);
        if (style && style.pointerEvents === 'none') return true;
    } catch (e) {}
    const nested = picker.querySelector && picker.querySelector('input, button, [role="combobox"]');
    if (nested) {
        if (nested.disabled) return true;
        if (nested.getAttribute && nested.getAttribute('aria-disabled') === 'true') return true;
    }
    return false;
}

/**
 * 特殊：Ship to 已预选唯一仓（如下拉旁 "only destination warehouse…"），
 * 且展示的是真实仓码（含 *01S）时，无需再点下拉——即使配置仓码与页上不完全一致（如配置 RUH01S、页上 AUH01S）。
 * 不改动「目标仓已精确匹配」与正常点选成功路径。
 */
function shouldSkipLockedSoleWarehouse(picker, currentText) {
    const shown = extractWarehouseCodeFromDisplay(currentText)
        || extractWarehouseCodeFromDisplay(picker ? getWarehouseDisplayText(picker) : '');
    if (!shown) return false;
    if (pageHintsSoleWarehouseLocked()) return true;
    if (isWarehousePickerNonOpenable(picker)) return true;
    return false;
}

async function waitWarehouseSelected(targetWarehouse, picker, timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (stopRequested || !isMonitoring) throw new Error('已停止');
        const current = findWarehousePicker() || picker;
        const text = getWarehouseDisplayText(current);
        if (warehouseTextMatches(text, targetWarehouse) && !isWarehousePlaceholder(text)) {
            return text;
        }
        if (pageShowsWarehouse(targetWarehouse) && !isWarehousePlaceholder(text)) {
            return text || targetWarehouse;
        }
        await sleep(200, 350);
    }
    return '';
}

async function waitForWarehouseOption(targetWarehouse, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const opt = findWarehouseOption(targetWarehouse);
        if (opt) return opt;
        await sleep(150, 250);
    }
    return null;
}

// ================== 仓库选择（文案/角色定位，不依赖 ant-select class）==================
async function selectWarehouse(targetWarehouse) {
    const picker = findWarehousePicker();
    // 页上已是目标仓且找不到下拉（常见：仅一仓已预选，无 Select warehouse 占位）→ 跳过，不改后续点选逻辑
    if (!picker) {
        if (pageShowsWarehouse(targetWarehouse)) {
            log(`仓库已匹配（页上已显示），跳过下拉: ${targetWarehouse}`);
            return;
        }
        const hasPlaceholder = /select\s*warehouse|选择仓库/i.test(document.body.innerText || '');
        const antCount = document.querySelectorAll('.ant-select').length;
        throw new Error(`未找到仓库下拉（页面含Select warehouse文案:${hasPlaceholder} ant-select数:${antCount}）`);
    }

    const currentText = getWarehouseDisplayText(picker);
    if (warehouseTextMatches(currentText, targetWarehouse) && !isWarehousePlaceholder(currentText)) {
        log(`仓库已匹配: ${currentText}`);
        return;
    }

    // 新增特殊：唯一仓已预选且下拉点不开（如 only destination warehouse）→ 直接继续后续约仓
    if (shouldSkipLockedSoleWarehouse(picker, currentText)) {
        const lockedCode = extractWarehouseCodeFromDisplay(currentText) || currentText || '(已预选)';
        log(`仓库已锁定预选，跳过下拉: ${lockedCode}（配置: ${targetWarehouse}）`);
        return;
    }

    const clickTarget = (picker.querySelector && (
        picker.querySelector('.ant-select-selector')
        || picker.querySelector('input')
        || picker.querySelector('[role="combobox"]')
    )) || picker;

    // 列表已经打开时不要再慢点下拉，否则菜单会先关掉
    let option = findWarehouseOption(targetWarehouse);
    if (!option) {
        log(`点击仓库下拉: ${targetWarehouse}（当前: ${currentText || '(空)'}，节点: ${picker.tagName}.${String(picker.className || '').slice(0, 60)}）`);
        await clickElement(clickTarget, 'now');
        option = await waitForWarehouseOption(targetWarehouse, 5000);
    }
    if (!option) {
        log('仓库列表未出现，再次打开');
        await clickElement(clickTarget, 'now');
        option = await waitForWarehouseOption(targetWarehouse, 5000);
    }
    if (!option) {
        // 点不开时再判一次唯一仓锁定（文案晚渲染 / disabled 晚出现）
        const afterPicker = findWarehousePicker() || picker;
        const afterText = getWarehouseDisplayText(afterPicker) || currentText;
        if (shouldSkipLockedSoleWarehouse(afterPicker, afterText)
            || (pageHintsSoleWarehouseLocked() && extractWarehouseCodeFromDisplay(afterText))) {
            const lockedCode = extractWarehouseCodeFromDisplay(afterText) || afterText || '(已预选)';
            log(`仓库已锁定预选（下拉不可开），跳过: ${lockedCode}（配置: ${targetWarehouse}）`);
            return;
        }
        throw new Error(`未找到仓库选项: ${targetWarehouse}`);
    }

    const optionRow = findWarehouseOption(targetWarehouse) || resolveOptionRow(option);
    if (!optionRow || !optionRow.isConnected) {
        throw new Error(`未找到仓库选项: ${targetWarehouse}`);
    }
    log(`点击仓库选项: ${(optionRow.getAttribute('title') || optionRow.textContent || '').trim().slice(0, 80)}`);
    await clickElement(optionRow, 'now');

    const selectedText = await waitWarehouseSelected(targetWarehouse, picker, 4500);
    if (selectedText) {
        log(`仓库选择成功: ${selectedText}`);
        return;
    }

    // 点完后列表可能还开着，再点一次同一选项
    const stillOpen = findWarehouseOption(targetWarehouse);
    if (stillOpen) {
        log('仓库仍未写入，再点一次选项');
        await clickElement(stillOpen, 'now');
        const again = await waitWarehouseSelected(targetWarehouse, picker, 3000);
        if (again) {
            log(`仓库选择成功: ${again}`);
            return;
        }
    }

    const newPicker = findWarehousePicker() || picker;
    const newText = getWarehouseDisplayText(newPicker);
    throw new Error(`验证失败（选择后仍为: ${newText || '(空)'}）`);
}

async function selectWarehouseWithRetry(targetWarehouse, times = 3) {
    let lastError = null;
    for (let i = 0; i < times; i += 1) {
        if (stopRequested || !isMonitoring) {
            throw new Error('已停止');
        }
        try {
            await selectWarehouse(targetWarehouse);
            return;
        } catch (err) {
            if (isStopError(err)) throw err;
            lastError = err;
            log(`仓库选择失败(${i + 1}/${times}): ${err.message}`);
            if (i < times - 1) {
                try { document.body.click(); } catch (e) {}
                await sleep(1200, 2000);
            }
        }
    }
    throw lastError || new Error('仓库选择失败');
}

// ================== 获取当前月份（终极增强版）==================
async function getCurrentMonthInfo() {
    log('尝试获取当前月份信息...');

    // 等待页面稳定
    await sleep(500);

    // 方法1: 日期摘要元素
    let summaryEl = document.querySelector('.sc-1f15nqd-16.cSYJfy');
    if (summaryEl) {
        const text = summaryEl.textContent;
        log(`日期摘要(方法1): ${text}`);
        const match = text.match(/(\w+), (\d+) (\w+) (\d+)/);
        if (match) {
            return { month: match[3], year: match[4] };
        }
    }

    // 方法2: 月份选择器显示的文本
    const monthPicker = document.querySelector('.ant-select.ant-select-borderless .ant-select-selection-item');
    if (monthPicker) {
        const text = monthPicker.getAttribute('title') || monthPicker.textContent;
        log(`月份选择器显示: ${text}`);
        const match = text.match(/(\w+) (\d+)/);
        if (match) {
            return { month: match[1], year: match[2] };
        }
    }

    // 方法3: 查找任何包含月份名称和年份的元素
    const monthPattern = /(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/i;
    const allElements = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6');
    for (const el of allElements) {
        const text = el.textContent.trim();
        const match = text.match(monthPattern);
        if (match) {
            log(`通过遍历找到月份: ${text}`);
            return { month: match[1], year: match[2] };
        }
    }

    // 方法4: 检查body文本
    const bodyText = document.body.innerText;
    const bodyMatch = bodyText.match(monthPattern);
    if (bodyMatch) {
        log(`通过body文本找到月份: ${bodyMatch[0]}`);
        return { month: bodyMatch[1], year: bodyMatch[2] };
    }

    throw new Error('无法获取当前月份信息');
}

// ================== 查找日期元素 ==================
async function findDateElement(targetDay) {
    log(`查找日期 ${targetDay} 的元素...`);

    // 策略1：已知class
    const knownSelectors = [
        '.ox7mdn-2',
        '[class*="ox7mdn"]',
        '.ant-col .ant-typography',
        'div[class*="date"]',
        'span[class*="day"]'
    ];
    for (const sel of knownSelectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
            const text = el.textContent.trim();
            if (text === String(targetDay) || parseInt(text, 10) === targetDay) {
                log(`通过选择器 ${sel} 找到: 文本="${text}"`);
                return el;
            }
        }
    }

    // 策略2：遍历div/span找纯数字
    log('尝试查找所有包含数字的元素...');
    const candidateElements = document.querySelectorAll('div, span');
    for (const el of candidateElements) {
        const text = el.textContent.trim();
        if (/^\d+$/.test(text) && parseInt(text, 10) === targetDay) {
            if (el.children.length === 0 || el.innerText === text) {
                log(`通过遍历找到元素: 文本="${text}", class="${el.className}"`);
                return el;
            }
        }
    }

    // 策略3：XPath
    try {
        const xpathResult = document.evaluate(
            `//*[text()="${targetDay}"]`,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        );
        if (xpathResult.singleNodeValue) {
            log(`通过 XPath 找到元素: class="${xpathResult.singleNodeValue.className}"`);
            return xpathResult.singleNodeValue;
        }
    } catch (e) {}

    log('未找到日期元素');
    return null;
}

async function switchToNextTargetDate(reason) {
    if (!targetConfig || !Array.isArray(targetConfig.dates) || targetConfig.dates.length === 0) {
        throw new Error(reason || '没有可切换的目标日期');
    }

    targetConfig.currentDateIndex++;

    if (targetConfig.currentDateIndex < targetConfig.dates.length) {
        chrome.storage.local.set({ targetConfig });
        log(`${reason}，切换到下一个日期: ${targetConfig.dates[targetConfig.currentDateIndex]}`);
    } else {
        log(`${reason}，没有更多日期可尝试`);
    }

    location.reload();
    await sleep(3000);
    return;
}

// ================== tryDate: 尝试单个日期 ==================
// 返回 true=找到可用时间段并已点击，false=本轮跳过
async function tryDate(targetDate) {
    const [targetYear, targetMonth, targetDay] = targetDate.split('-').map(Number);
    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const targetMonthName = monthNames[targetMonth-1];
    const targetMonthYear = `${targetMonthName} ${targetYear}`;  // e.g. "April 2026"

    // ---- 步骤1: 读取当前月份 ----
    const monthPattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i;

    function monthFromText(text) {
        const t = String(text || '').trim();
        if (!t || t.length > 40) return null;
        const m = t.match(monthPattern);
        if (!m) return null;
        return { month: m[1], year: m[2] };
    }

    function findCalendarRoot() {
        const pool = document.querySelectorAll('[role="grid"], .ant-picker-content, table, [class*="calendar"], [class*="Calendar"]');
        let best = null;
        let bestScore = 0;
        for (const el of pool) {
            if (!isElementVisible(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 160 || rect.height < 80) continue;
            const seen = new Set();
            let days = 0;
            for (const leaf of el.querySelectorAll('button, [role="gridcell"], td, div, span')) {
                const text = (leaf.textContent || '').trim();
                if (!/^\d{1,2}$/.test(text)) continue;
                const n = parseInt(text, 10);
                if (n < 1 || n > 31 || leaf.children.length > 1) continue;
                const r = leaf.getBoundingClientRect();
                const key = `${text}:${Math.round(r.top)}:${Math.round(r.left)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                days += 1;
            }
            if (days > bestScore) {
                bestScore = days;
                best = el;
            }
        }
        return bestScore >= 7 ? best : null;
    }

    async function readCurrentMonth() {
        await sleep(300, 500);
        const sel = document.querySelector('.ant-select-borderless .ant-select-selection-item');
        if (sel) {
            const hit = monthFromText(sel.getAttribute('title') || sel.textContent);
            if (hit) return hit;
        }

        const calendar = findCalendarRoot();
        const scopes = [];
        if (calendar) {
            scopes.push(calendar);
            if (calendar.parentElement) scopes.push(calendar.parentElement);
            if (calendar.parentElement && calendar.parentElement.parentElement) scopes.push(calendar.parentElement.parentElement);
        }
        for (const scope of scopes) {
            for (const el of scope.querySelectorAll('div, span, h1, h2, h3, h4, p, button, strong')) {
                const own = el.childElementCount === 0 ? el.textContent : '';
                const hit = monthFromText(own || el.getAttribute('aria-label') || '');
                if (hit) return hit;
            }
        }
        throw new Error('无法读取当前月份');
    }

    function findDayInLegacyCarousel(day) {
        const dayItems = document.querySelectorAll('.ox7mdn-2, [class*="ox7mdn"]');
        for (const el of dayItems) {
            if (parseInt(el.textContent.trim(), 10) === day) return el;
        }
        return null;
    }

    function dayClickTarget(el) {
        return (el && el.closest('button, [role="gridcell"], td, [role="button"]')) || el;
    }

    function isDaySelected(el) {
        const row = dayClickTarget(el);
        const nodes = [el, row, row && row.parentElement].filter(Boolean);
        return nodes.some((node) => {
            const cls = String(node.className || '');
            return node.classList.contains('gslvou')
                || node.getAttribute('aria-selected') === 'true'
                || node.getAttribute('aria-pressed') === 'true'
                || node.getAttribute('aria-current') === 'date'
                || /(?:^|[^a-z])selected|is-active|checked/i.test(cls);
        });
    }

    function findDayInMonthGrid(day) {
        const calendar = findCalendarRoot();
        const roots = calendar ? [calendar] : [document];
        const selectors = [
            'td.ant-picker-cell:not(.ant-picker-cell-disabled) .ant-picker-cell-inner',
            '[role="gridcell"]:not([aria-disabled="true"])',
            'button',
            '[role="button"]',
            'div',
            'span'
        ];
        const seen = new Set();
        for (const root of roots) {
            for (const sel of selectors) {
                const nodes = root.querySelectorAll(sel);
                for (const el of nodes) {
                    if (seen.has(el)) continue;
                    seen.add(el);
                    const text = (el.textContent || '').trim();
                    if (text !== String(day)) continue;
                    if (el.children.length > 2) continue;
                    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
                    const cls = String(el.className || '');
                    if (/disabled|unavailable|outside|muted|inert/i.test(cls)) continue;
                    if (el.closest && el.closest('.calendar-popover, .container')) continue;
                    return dayClickTarget(el);
                }
            }
        }
        return null;
    }

    function parseSlotLabel(text) {
        const compact = String(text || '').replace(/\s+/g, ' ').trim();
        if (!compact || compact.length > 160) return null;
        const re = /(\d{1,2})(?::\d{2})?\s*(am|pm)\s*(?:[-–—]|to)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)/ig;
        const found = [];
        let match;
        while ((match = re.exec(compact))) {
            found.push(match);
            if (found.length > 1) return null;
        }
        if (found.length !== 1) return null;
        const hit = found[0];
        return {
            start: `${parseInt(hit[1], 10)}${hit[2].toLowerCase()}`,
            end: `${parseInt(hit[3], 10)}${hit[4].toLowerCase()}`
        };
    }

    function rememberSlot(available, start, end, element) {
        const row = element.closest('button, [role="button"], label, .ant-col') || element;
        if (row.disabled || row.getAttribute('aria-disabled') === 'true') return;
        if (!isElementVisible(row)) return;
        const rect = row.getBoundingClientRect();
        const area = rect.width * rect.height;
        const prev = available.find((slot) => slot.start === start && slot.end === end);
        if (!prev || area < prev.area) {
            if (prev) {
                prev.element = row;
                prev.area = area;
            } else {
                available.push({ start, end, element: row, area });
            }
        }
    }

    function collectTimeSlots() {
        const available = [];
        const legacyCards = document.querySelectorAll('.ant-col.sc-19dpo2e-0.dOXVoU, .ant-col[class*="sc-"]');
        for (const card of legacyCards) {
            const spans = card.querySelectorAll('span.jTRJQD, span');
            const times = Array.from(spans)
                .map((s) => s.textContent.trim().toLowerCase().replace(/\s+/g, '').replace(/:\d{2}/, ''))
                .filter((t) => /^\d{1,2}(am|pm)$/i.test(t));
            if (times.length >= 2) rememberSlot(available, times[0], times[1], card);
        }

        const candidates = document.querySelectorAll('button, [role="button"], .ant-col, label, div, span');
        for (const el of candidates) {
            const parsed = parseSlotLabel(el.textContent || '');
            if (!parsed) continue;
            rememberSlot(available, parsed.start, parsed.end, el);
        }
        return available;
    }

    function timeToMinutes(t) {
        t = String(t || '').trim().toLowerCase();
        const ampm = t.slice(-2);
        let h = parseInt(t, 10);
        if (ampm === 'pm' && h !== 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        return h * 60;
    }

    function slotsInRange(available) {
        const rangeStartMin = timeToMinutes(targetConfig.timeRangeStart || '10am');
        const rangeEndMin = timeToMinutes(targetConfig.timeRangeEnd || '10pm');
        return available.filter((slot) => {
            const m = timeToMinutes(slot.start);
            return m >= rangeStartMin && m < rangeEndMin;
        });
    }

    // ---- 步骤2: 月份不一致时才切换；切不动也继续在当前日历里找日期 ----
    let curInfo = null;
    for (let r = 3; r-- > 0;) {
        try { curInfo = await readCurrentMonth(); break; }
        catch (e) { await sleep(600, 900); }
    }
    const monthMatches = curInfo
        && curInfo.month.toLowerCase() === targetMonthName.toLowerCase()
        && curInfo.year === String(targetYear);
    if (!curInfo) {
        log(`无法读取月份，直接在当前日历查找 ${targetDate}`);
    } else if (!monthMatches) {
        log(`切换月份: ${curInfo.month} ${curInfo.year} → ${targetMonthYear}`);
        let switched = false;
        const monthPicker = document.querySelector('.ant-select-borderless');
        if (!monthPicker) {
            log('没有旧版月份下拉，继续在当前日历查找');
        } else {
            const monthSelector = monthPicker.querySelector('.ant-select-selector');
            const openMonth = async () => {
                if (monthSelector) await clickElement(monthSelector, 'now');
                else await clickElement(monthPicker, 'now');
            };
            await openMonth();
            await sleep(400, 700);

            let dropdown = null;
            for (let t = 0; t < 20; t++) {
                dropdown = Array.from(document.querySelectorAll('.ant-select-dropdown'))
                    .find((d) => !d.classList.contains('ant-select-dropdown-hidden') && isElementVisible(d));
                if (dropdown) break;
                if (t === 8) await openMonth();
                await sleep(200, 300);
            }
            const monthOption = dropdown && Array.from(dropdown.querySelectorAll('.ant-select-item-option, [role="option"]'))
                .find((opt) => {
                    const t = (opt.getAttribute('title') || opt.textContent || '').trim();
                    return t.toLowerCase() === targetMonthYear.toLowerCase();
                });
            if (!monthOption) {
                log(`未点到月份「${targetMonthYear}」，继续在当前日历查找`);
                try { document.body.click(); } catch (e) {}
            } else {
                await clickElement(resolveOptionRow(monthOption), 'now');
                await sleep(500, 800);
                switched = true;
                log(`已点击月份: ${targetMonthYear}`);
            }
        }
        if (!switched) log('月份未切换，不因此跳过已出现的日期和时间');
    }

    // ---- 步骤3: 找目标日期。已经选中且时段已出现时，不再重点日期 ----
    let targetDayElement = findDayInLegacyCarousel(targetDay);

    if (!targetDayElement && document.querySelector('.slick-arrow, .ox7mdn-2, [class*="ox7mdn"]')) {
        for (let r = 0; r < 20; r++) {
            const prevArrow = document.querySelector('.slick-arrow.slick-prev:not(.slick-disabled)');
            if (!prevArrow) break;
            await clickElement(prevArrow, 'now');
            await sleep(200, 300);
        }
        await sleep(200, 400);

        for (let page = 0; page < 15; page++) {
            targetDayElement = findDayInLegacyCarousel(targetDay);
            if (targetDayElement) break;

            const nextArrow = document.querySelector('.slick-arrow.slick-next:not(.slick-disabled)');
            if (!nextArrow) { log('已到最后一页，未找到日期'); break; }
            log(`翻页第 ${page + 1} 次找 ${targetDay}`);
            await clickElement(nextArrow, 'now');
            await sleep(200, 400);
        }
    }

    if (!targetDayElement) {
        targetDayElement = findDayInMonthGrid(targetDay);
        if (targetDayElement) log(`通过整月日历找到日期 ${targetDay}`);
    }

    const alreadySelected = targetDayElement && isDaySelected(targetDayElement);
    let inRange = alreadySelected ? slotsInRange(collectTimeSlots()) : [];
    if (alreadySelected && inRange.length > 0) {
        log(`日期 ${targetDay} 已选中，范围内时间段已出现，直接选择`);
    } else if (!targetDayElement) {
        // 找不到目标日期格子时，不抢页面上可能属于其他日期的时段
        log(`未找到日期 ${targetDay}，跳过 ${targetDate}`);
        return false;
    } else {
        if (!alreadySelected) {
            log(`点击日期: ${targetDay}`);
            await clickElement(targetDayElement, 'now');
        } else {
            log(`日期 ${targetDay} 已选中，等待时间段`);
        }
        let available = [];
        for (let t = 0; t < 20; t++) {
            available = collectTimeSlots();
            if (available.length > 0) break;
            await sleep(250, 400);
        }
        if (available.length === 0) { log(`${targetDate} 无时间段，跳过`); return false; }
        log(`${targetDate} 可用时间段: ${available.map((s) => s.start + '-' + s.end).join(', ')}`);
        inRange = slotsInRange(available);
    }

    if (inRange.length === 0) {
        log(`${targetDate} 无范围内时间段（${targetConfig.timeRangeStart}~${targetConfig.timeRangeEnd}），跳过`);
        return false;
    }
    log(`${targetDate} 范围内时间段: ${inRange.map((s) => s.start + '-' + s.end).join(', ')}`);

    const preferred = (targetConfig.preferredStart || '').trim().toLowerCase();
    let chosen = inRange[0];
    if (preferred) {
        const hit = inRange.find((slot) => slot.start === preferred);
        if (hit) {
            chosen = hit;
            log(`优先命中: ${hit.start}-${hit.end}`);
        } else {
            log(`优先时间 ${preferred} 未出现，退回第一个`);
        }
    } else {
        log(`抢时间段: ${chosen.start}-${chosen.end}`);
    }

    let clicked = false;
    for (let attempt = 0; attempt < 3 && !clicked; attempt += 1) {
        const fresh = collectTimeSlots().find((slot) => slot.start === chosen.start && slot.end === chosen.end);
        if (!fresh || !fresh.element || !fresh.element.isConnected) {
            await sleep(200, 350);
            continue;
        }
        clicked = await clickElement(fresh.element, 'now');
        if (!clicked) await sleep(200, 350);
    }
    if (!clicked) {
        log(`${targetDate} 时间段点击失败，跳过`);
        return null;
    }

    // 点完时段后等 React 启用 Confirm；没有可用 Confirm 不算选中成功
    const confirmStart = Date.now();
    while (Date.now() - confirmStart < 4000) {
        if (findConfirmButton()) {
            log(`已选时间段: ${chosen.start}-${chosen.end}`);
            return { date: targetDate, start: chosen.start, end: chosen.end };
        }
        await sleep(150, 250);
    }
    log(`${targetDate} 点了时段但 Confirm 未就绪，跳过`);
    return null;
}


function findConfirmButton() {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    const usable = (btn) => btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && isElementVisible(btn);
    const slotBtn = buttons.find((btn) => usable(btn) && /confirm\s*slot/i.test((btn.textContent || '').replace(/\s+/g, ' ').trim()));
    if (slotBtn) return slotBtn;
    const confirmBtn = buttons.find((btn) => usable(btn) && /^confirm$/i.test((btn.textContent || '').replace(/\s+/g, ' ').trim()));
    if (confirmBtn) return confirmBtn;
    const primary = document.querySelector('button.ant-btn-primary:not([disabled])');
    return usable(primary) ? primary : null;
}

/** 仍停在 Book a slot /schedule 页 */
function isOnSchedulePath() {
    const path = location.pathname || '';
    return /\/asn\/[^/]+\/schedule(?:\/|$)/i.test(path) || /\/asn\/schedule(?:\/|$)/i.test(path);
}

/**
 * 约成后的 ASN 详情页：必须出现 Scheduled + Drop-off/Reschedule
 * （禁止仅凭 /asn/XXX URL 误判——否则 Drop-off 未渲染就会用已点时段收尾）
 */
function isBookingResultPage() {
    const text = (document.body && document.body.innerText) || '';
    const hasScheduledUi =
        /\bScheduled\b/i.test(text) &&
        (/Drop-?\s*off/i.test(text) || /\bReschedule\b/i.test(text) || /View\s*location/i.test(text));
    if (!hasScheduledUi) return false;
    if (isOnSchedulePath()) {
        return !/Book\s*a\s*slot/i.test(text);
    }
    return true;
}

async function waitForBookingResultPage(timeoutMs, myGeneration) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (myGeneration !== monitorGeneration) return false;
        if (isBookingResultPage()) return true;
        // 不因 stopRequested 提前退出：约成等待期间不能被自己清 storage 打断
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
}

async function clickConfirmSlot(myGeneration) {
    let confirmBtn = null;
    const confirmStart = Date.now();
    while (Date.now() - confirmStart < 10000) {
        if (stopRequested || !isMonitoring || myGeneration !== monitorGeneration) return false;
        confirmBtn = findConfirmButton();
        if (confirmBtn) break;
        await sleep(200, 350);
    }
    if (!confirmBtn) {
        log('未找到可点击的 Confirm slot');
        return false;
    }
    log('点击 Confirm slot...');
    let confirmed = await clickElement(confirmBtn, 'now');
    if (!confirmed) {
        const again = findConfirmButton();
        if (again) confirmed = await clickElement(again, 'now');
    }
    return confirmed;
}

async function findSlotElementByRange(start, end) {
    const s = String(start || '').toLowerCase();
    const e = String(end || '').toLowerCase();
    if (!s || !e) return null;
    const nodes = document.querySelectorAll('button, [role="button"], .ant-col, label, div');
    let best = null;
    let bestArea = Infinity;
    for (const el of nodes) {
        const raw = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!raw || raw.length > 80) continue;
        const compact = raw.replace(/[–—]/g, '-');
        if (!(compact.includes(s) && compact.includes(e) && /am|pm/.test(compact))) continue;
        if (!isElementVisible(el)) continue;
        const row = el.closest('button, [role="button"], label, .ant-col') || el;
        if (row.disabled || row.getAttribute('aria-disabled') === 'true') continue;
        const rect = row.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area < bestArea && area > 0) {
            bestArea = area;
            best = row;
        }
    }
    return best;
}

/**
 * 点 Confirm 后必须等到离开预约页（图二），才算约成。
 * 仍停在图一时重试点时段 + Confirm，绝不提前报成功。
 * 若 Noon 整页跳转导致脚本被卸：靠 awaitingBookingConfirm + 结果页注入收尾。
 */
async function confirmAndWaitForResult(booked, myGeneration) {
    try {
        chrome.storage.local.set({
            awaitingBookingConfirm: {
                date: booked.date,
                start: booked.start,
                end: booked.end,
                warehouse: (targetConfig && targetConfig.warehouse) || '',
                at: Date.now(),
            },
        });
    } catch (e) {}

    for (let attempt = 1; attempt <= 4; attempt += 1) {
        if (stopRequested || !isMonitoring || myGeneration !== monitorGeneration) return false;
        if (isBookingResultPage()) return true;

        if (attempt > 1) {
            const slotEl = await findSlotElementByRange(booked.start, booked.end);
            if (slotEl) {
                log(`重选时间段: ${booked.start}-${booked.end}`);
                await clickElement(slotEl, 'now');
                await sleep(350, 550);
            }
        }

        const clicked = await clickConfirmSlot(myGeneration);
        if (!clicked) {
            log(`Confirm slot 点击失败（第 ${attempt}/4 次）`);
            await sleep(400, 600);
            continue;
        }

        log('已点 Confirm slot，等待跳转到 Scheduled 结果页...');
        const ok = await waitForBookingResultPage(12000, myGeneration);
        if (ok) {
            log(`已进入结果页（${booked.date} ${booked.start}-${booked.end}）`);
            return true;
        }
        if (isOnSchedulePath()) {
            log(`仍停在预约页，重试（${attempt}/4）— 未跳转不算约成`);
        }
    }
    return isBookingResultPage();
}

function finishMonitoringAfterSuccess(booked) {
    stopLogSuppressed = true;
    const pending = {
        asnId: '',
        warehouse: (targetConfig && targetConfig.warehouse) || '',
        scheduledDate: booked.date,
        scheduleSlot: `${booked.start}-${booked.end}`,
        at: Date.now(),
    };
    try {
        const m = (location.pathname || '').match(/\/asn\/([A-Z0-9]+)/i);
        if (m) pending.asnId = m[1];
    } catch (e) {}

    try {
        chrome.runtime.sendMessage(
            {
                action: 'success',
                booked: {
                    date: booked.date,
                    start: booked.start,
                    end: booked.end,
                    warehouse: pending.warehouse,
                    asnId: pending.asnId,
                },
            },
            () => {
                void chrome.runtime.lastError;
            },
        );
    } catch (e) {}

    chrome.storage.local.set({
        monitoringActive: false,
        pendingBookingCapture: pending,
        bookingSuccessAt: Date.now(),
        awaitingBookingConfirm: null,
    });
}

async function monitor() {
    assertSchedulePage();
    const myGeneration = ++monitorGeneration;
    stopRequested = false;
    log('监控启动');
    isMonitoring = true;
    while (isMonitoring && !stopRequested && myGeneration === monitorGeneration) {
        try {
            // 等仓库下拉出现，或页上已显示目标仓（已预选则可跳过找下拉）
            const startWait = Date.now();
            const targetWh = targetConfig.warehouse;
            while (Date.now() - startWait < 15000) {
                if (stopRequested || !isMonitoring || myGeneration !== monitorGeneration) break;
                if (findWarehousePicker() || pageShowsWarehouse(targetWh)) break;
                await sleep(200, 400);
            }
            if (stopRequested || !isMonitoring || myGeneration !== monitorGeneration) break;
            if (!findWarehousePicker() && !pageShowsWarehouse(targetWh)) {
                throw new Error('未找到仓库下拉（Select warehouse / Ship to）');
            }
            await sleep(500, 1000);

            await selectWarehouseWithRetry(targetWh, 3);
            if (stopRequested || !isMonitoring || myGeneration !== monitorGeneration) break;

            const dates = Array.isArray(targetConfig.dates) ? targetConfig.dates : [];
            if (dates.length === 0) throw new Error('未配置目标日期');
            log(`本轮检测 ${dates.length} 个日期: ${dates.join(', ')}`);
            let succeeded = false;

            for (const date of dates) {
                if (stopRequested || !isMonitoring || myGeneration !== monitorGeneration) break;
                log(`尝试日期: ${date}`);
                const booked = await tryDate(date);
                if (!booked) continue;

                if (stopRequested || !isMonitoring || myGeneration !== monitorGeneration) break;

                // 点时段后稍等，再点 Confirm，避免 React 尚未启用按钮
                await sleep(400, 700);
                const confirmed = await confirmAndWaitForResult(booked, myGeneration);
                if (!confirmed) {
                    log(`${date} Confirm 后未进入结果页，继续试下一日期`);
                    continue;
                }

                log('✅ 预约成功！正在结果页提取…');
                finishMonitoringAfterSuccess(booked);
                succeeded = true;
                break;
            }

            if (succeeded || stopRequested || !isMonitoring || myGeneration !== monitorGeneration) break;

            await reloadIfStillMonitoring('本轮所有日期均无可用时间段，刷新后重试...');
            break;
        } catch (err) {
            if (myGeneration !== monitorGeneration) break;
            if (isStopError(err)) {
                log('监控已停止');
                break;
            }
            log(`错误: ${err.message}`);
            // 仓库类错误先页内多等一轮，减少无意义狂刷
            if (/仓库|选择器|下拉|验证失败/.test(err.message || '')) {
                log('仓库步骤异常，5 秒后本页重试（不刷新）...');
                try {
                    await sleep(5000);
                } catch (stopErr) {
                    if (isStopError(stopErr)) {
                        log('监控已停止');
                        break;
                    }
                }
                if (myGeneration !== monitorGeneration) break;
                continue;
            }
            await reloadIfStillMonitoring('刷新页面后重试...');
            break;
        }
    }
    if (myGeneration === monitorGeneration) {
        isMonitoring = false;
        stopRequested = true;
    }
}

// ================== 自动恢复 / 消息监听（仅首次注入注册）==================
if (!__noonContentAlreadyLoaded) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.monitoringActive) return;
        if (changes.monitoringActive.newValue === false) {
            monitorGeneration += 1;
            stopRequested = true;
            isMonitoring = false;
            if (stopLogSuppressed) {
                stopLogSuppressed = false;
                log('约仓完成，监控已结束');
            } else {
                log('收到停止指令');
            }
        }
    });

    chrome.storage.local.get(
        ['targetConfig', 'monitoringActive', 'awaitingBookingConfirm'],
        (result) => {
            const awaiting = result.awaitingBookingConfirm;
            const awaitingFresh =
                awaiting &&
                awaiting.date &&
                Number(awaiting.at || 0) > 0 &&
                Date.now() - Number(awaiting.at) < 120000;

            // 整页跳转后落到 Scheduled 结果页：收尾约成，不要在详情页瞎恢复监控
            if (awaitingFresh && isBookingResultPage()) {
                targetConfig = result.targetConfig || {
                    warehouse: awaiting.warehouse,
                    dates: [awaiting.date],
                };
                log('检测到约仓跳转成功，在结果页收尾…');
                log('✅ 预约成功！正在结果页提取…');
                finishMonitoringAfterSuccess({
                    date: awaiting.date,
                    start: awaiting.start,
                    end: awaiting.end,
                });
                return;
            }

            if (result.monitoringActive && result.targetConfig) {
                // 结果页没有预约控件，禁止自动恢复抢仓
                if (isBookingResultPage() || !isOnSchedulePath()) {
                    log('当前非预约页，跳过自动恢复监控');
                    return;
                }
                targetConfig = result.targetConfig;
                log('自动恢复监控');
                monitor();
            }
        },
    );

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'start') {
            try {
                assertSchedulePage();
            } catch (err) {
                log(`错误: ${err.message}`);
                sendResponse({ status: 'rejected', error: err.message });
                return;
            }
            // 若已有一轮在跑，先抬高代次，让旧循环退出，避免双开抢点
            if (isMonitoring) {
                monitorGeneration += 1;
                stopRequested = true;
                isMonitoring = false;
                log('检测到已有监控，切换到新一轮');
            }
            stopRequested = false;
            targetConfig = message.config;
            chrome.storage.local.set({ monitoringActive: true });
            monitor();
            sendResponse({ status: 'ok' });
        } else if (message.action === 'stop') {
            monitorGeneration += 1;
            stopRequested = true;
            isMonitoring = false;
            chrome.storage.local.set({ monitoringActive: false }, () => {
                sendResponse({ status: 'ok' });
            });
            log('监控已停止');
            return true;
        }
    });

    if (siteVerdict && siteVerdict.ok === false) {
        console.warn('[Noon预约] 站点门禁未通过:', siteVerdict.message);
    } else {
        log(`content.js 已加载 v1.2.10（${location.hostname}）`);
    }
} else {
    console.log('[Noon预约] content.js 已存在，跳过重复注册');
}
