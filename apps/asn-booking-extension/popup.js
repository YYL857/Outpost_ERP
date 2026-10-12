let monitoring = false;
let selectedDates = [];
let calendarViewDate = new Date();
let highlightedWeekday = null;
let isDraggingDates = false;
let dragMode = null;
let dragVisitedDates = new Set();
let hasSavedWarehouse = false;

document.addEventListener('DOMContentLoaded', () => {
    initializeDatePicker();
    loadSavedConfig();
    detectSiteFromActiveTab();
    updateLogStatus();
    chrome.storage.local.get('monitoringActive', (result) => {
        if (result.monitoringActive) {
            monitoring = true;
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            addLog('监控正在后台运行中...');
        }
    });
});

function detectSiteFromActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs && tabs[0] ? tabs[0].url || '' : '';
        const warehouseInput = document.getElementById('warehouseInput');
        const region = (typeof NoonSiteConfig !== 'undefined' && NoonSiteConfig.detectRegion)
            ? NoonSiteConfig.detectRegion(currentUrl)
            : null;

        if (region === 'ae') {
            highlightedWeekday = 0;
            if (!hasSavedWarehouse && !warehouseInput.value.trim()) {
                warehouseInput.value = 'AUH01S';
            }
        } else if (region === 'sa') {
            highlightedWeekday = 5;
            if (!hasSavedWarehouse && !warehouseInput.value.trim()) {
                warehouseInput.value = 'RUH01S';
            }
        } else {
            highlightedWeekday = null;
        }

        renderCalendar();
    });
}

function getActiveTabSiteVerdict(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0] ? tabs[0] : null;
        const currentUrl = tab && tab.url ? tab.url : '';
        if (typeof NoonSiteConfig === 'undefined' || !NoonSiteConfig.matchUrl) {
            callback(tab, currentUrl, {
                ok: false,
                message: '站点配置未加载（site-config.js），请重新加载扩展。'
            });
            return;
        }
        callback(tab, currentUrl, NoonSiteConfig.matchUrl(currentUrl));
    });
}

function initializeDatePicker() {
    document.getElementById('openDatePickerBtn').addEventListener('click', toggleDatePicker);
    document.getElementById('closeDatePickerBtn').addEventListener('click', closeDatePicker);
    document.getElementById('clearDatesBtn').addEventListener('click', clearSelectedDates);
    document.addEventListener('mouseup', stopDateDrag);
    document.getElementById('prevMonthBtn').addEventListener('click', () => {
        calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() - 1, 1);
        renderCalendar();
    });
    document.getElementById('nextMonthBtn').addEventListener('click', () => {
        calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + 1, 1);
        renderCalendar();
    });
}

function toggleDatePicker() {
    const popover = document.getElementById('calendarPopover');
    if (popover.classList.contains('hidden')) {
        openDatePicker();
        return;
    }
    closeDatePicker();
}

function openDatePicker() {
    const popover = document.getElementById('calendarPopover');
    popover.classList.remove('hidden');

    if (selectedDates.length > 0) {
        calendarViewDate = parseDateString(selectedDates[selectedDates.length - 1]);
    } else {
        calendarViewDate = new Date();
    }
    calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth(), 1);
    renderCalendar();
}

function closeDatePicker() {
    document.getElementById('calendarPopover').classList.add('hidden');
}

function clearSelectedDates() {
    selectedDates = [];
    syncDatesInput();
    renderSelectedDates();
    renderCalendar();
}

function toggleSelectedDate(dateValue) {
    if (selectedDates.includes(dateValue)) {
        selectedDates = selectedDates.filter(date => date !== dateValue);
    } else {
        selectedDates.push(dateValue);
    }

    syncDatesInput();
    renderSelectedDates();
    renderCalendar();
}

function startDateDrag(dateValue, dayBtn, event) {
    event.preventDefault();
    isDraggingDates = true;
    dragMode = selectedDates.includes(dateValue) ? 'remove' : 'add';
    dragVisitedDates = new Set();
    applyDragSelection(dateValue, dayBtn);
}

function continueDateDrag(dateValue, dayBtn) {
    if (!isDraggingDates) {
        return;
    }
    applyDragSelection(dateValue, dayBtn);
}

function stopDateDrag() {
    if (!isDraggingDates) {
        return;
    }
    isDraggingDates = false;
    dragMode = null;
    dragVisitedDates = new Set();
    renderCalendar();
}

function applyDragSelection(dateValue, dayBtn) {
    if (dragVisitedDates.has(dateValue)) {
        return;
    }
    dragVisitedDates.add(dateValue);

    if (dragMode === 'add' && !selectedDates.includes(dateValue)) {
        selectedDates.push(dateValue);
    } else if (dragMode === 'remove' && selectedDates.includes(dateValue)) {
        selectedDates = selectedDates.filter(date => date !== dateValue);
    }

    syncDatesInput();
    renderSelectedDates();
    updateDateButtonState(dayBtn, parseDateString(dateValue), dateValue);
}

function parseDateString(dateValue) {
    const [year, month, day] = dateValue.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function renderCalendar() {
    const monthLabel = document.getElementById('calendarMonthLabel');
    const daysContainer = document.getElementById('calendarDays');

    monthLabel.textContent = `${calendarViewDate.getFullYear()}年 ${calendarViewDate.getMonth() + 1}月`;
    daysContainer.innerHTML = '';

    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    for (let i = 0; i < startWeekday; i += 1) {
        const filler = document.createElement('button');
        filler.type = 'button';
        filler.className = 'calendar-day is-outside';
        filler.disabled = true;
        daysContainer.appendChild(filler);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const dateValue = formatDate(date);
        const dayBtn = document.createElement('button');
        dayBtn.type = 'button';
        dayBtn.className = 'calendar-day';
        dayBtn.textContent = String(day);
        updateDateButtonState(dayBtn, date, dateValue, today);
        dayBtn.addEventListener('mousedown', (event) => startDateDrag(dateValue, dayBtn, event));
        dayBtn.addEventListener('mouseenter', () => continueDateDrag(dateValue, dayBtn));
        daysContainer.appendChild(dayBtn);
    }
}

function updateDateButtonState(dayBtn, date, dateValue, today = new Date()) {
    dayBtn.classList.toggle(
        'is-highlighted-weekday',
        highlightedWeekday !== null && date.getDay() === highlightedWeekday
    );
    dayBtn.classList.toggle('is-selected', selectedDates.includes(dateValue));
    dayBtn.classList.toggle('is-today', isSameDay(date, today));
}

function addSelectedDate(dateValue) {
    if (!dateValue || selectedDates.includes(dateValue)) {
        return;
    }

    selectedDates.push(dateValue);
    syncDatesInput();
    renderSelectedDates();
    renderCalendar();
}

function removeSelectedDate(dateValue) {
    selectedDates = selectedDates.filter(date => date !== dateValue);
    syncDatesInput();
    renderSelectedDates();
}

function syncDatesInput() {
    // 始终按日期从小到大排序（最近日期优先检测）
    selectedDates.sort((a, b) => a.localeCompare(b));
    document.getElementById('datesInput').value = selectedDates.join(',');
}

function renderSelectedDates() {
    const container = document.getElementById('selectedDatesList');
    container.innerHTML = '';

    if (selectedDates.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'selected-dates-empty';
        empty.textContent = '尚未选择日期';
        container.appendChild(empty);
        return;
    }

    selectedDates.forEach(dateValue => {
        const tag = document.createElement('span');
        tag.className = 'selected-date-tag';
        tag.textContent = dateValue;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'selected-date-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => removeSelectedDate(dateValue));

        tag.appendChild(removeBtn);
        container.appendChild(tag);
    });
}

function loadSavedConfig() {
    chrome.storage.local.get('targetConfig', (result) => {
        if (result.targetConfig) {
            const savedWarehouse = result.targetConfig.warehouse || '';
            document.getElementById('warehouseInput').value = savedWarehouse;
            hasSavedWarehouse = Boolean(savedWarehouse.trim());
            if (result.targetConfig.dates) {
                selectedDates = result.targetConfig.dates
                    .map(date => String(date).trim())
                    .filter(date => date);
                syncDatesInput();
            }
            const savedRangeStart = result.targetConfig.timeRangeStart || '10am';
            const savedRangeEnd = result.targetConfig.timeRangeEnd || '6pm';
            const savedPreferred = result.targetConfig.preferredStart || '';
            const rsEl = document.getElementById('timeRangeStart');
            const reEl = document.getElementById('timeRangeEnd');
            const pfEl = document.getElementById('preferredStart');
            if (rsEl) rsEl.value = savedRangeStart;
            if (reEl) reEl.value = savedRangeEnd;
            if (pfEl) pfEl.value = savedPreferred;
        } else {
            hasSavedWarehouse = false;
        }
        renderSelectedDates();
        renderCalendar();
    });
}

function updateLogStatus() {
    chrome.runtime.sendMessage({ action: 'getLogStatus' }, (response) => {
        if (chrome.runtime.lastError || !response) {
            return;
        }

        if (response.error) {
            addLog(`日志写入失败: ${response.error}`, { persist: false });
            return;
        }

        const downloadLogBtn = document.getElementById('downloadLogBtn');
        downloadLogBtn.disabled = !response.fileName;

        if (response.fileName) {
            addLog(`当前日志文件: ${response.fileName}`, { persist: false });
        }
    });
}

function downloadLogFile() {
    chrome.runtime.sendMessage({ action: 'downloadLogFile' }, (response) => {
        if (chrome.runtime.lastError) {
            addLog(`日志导出失败: ${chrome.runtime.lastError.message}`, { persist: false });
            return;
        }

        if (response && response.ok && response.fileName) {
            addLog(`日志已下载: Downloads/logs/${response.fileName}`, { persist: false });
        } else if (response && response.error) {
            addLog(`日志导出失败: ${response.error}`, { persist: false });
        }
    });
}

function sendStartToTab(tabId, config, callback) {
    chrome.tabs.sendMessage(tabId, { action: 'start', config }, (response) => {
        if (chrome.runtime.lastError) {
            callback(new Error(chrome.runtime.lastError.message), null);
            return;
        }
        callback(null, response);
    });
}

function ensureContentScript(tabId) {
    return new Promise((resolve, reject) => {
        if (!chrome.scripting || !chrome.scripting.executeScript) {
            reject(new Error('当前扩展缺少 scripting 权限，请重新加载扩展'));
            return;
        }

        chrome.scripting.executeScript(
            {
                target: { tabId },
                files: ['site-config.js', 'content.js']
            },
            () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            }
        );
    });
}

function markMonitoringStarted(host) {
    monitoring = true;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    addLog(`监控已启动（${host}）`);
}

function startMonitoringOnActiveTab(config, verdict) {
    getActiveTabSiteVerdict((tab, currentUrl, liveVerdict) => {
        const finalVerdict = liveVerdict && liveVerdict.ok ? liveVerdict : verdict;
        if (!finalVerdict.ok) {
            addLog(`错误：${finalVerdict.message}`);
            chrome.storage.local.set({ monitoringActive: false });
            return;
        }

        if (!tab || tab.id == null) {
            addLog('错误：未找到当前标签页');
            chrome.storage.local.set({ monitoringActive: false });
            return;
        }

        sendStartToTab(tab.id, config, (err) => {
            if (!err) {
                markMonitoringStarted(finalVerdict.host);
                return;
            }

            addLog('页面脚本未就绪，尝试主动注入...');
            ensureContentScript(tab.id)
                .then(() => new Promise((resolve) => setTimeout(resolve, 200)))
                .then(() => {
                    sendStartToTab(tab.id, config, (retryErr) => {
                        if (retryErr) {
                            addLog(`错误：主动注入后仍无法连接（${finalVerdict.host}${finalVerdict.path}）。请到 chrome://extensions 重新加载本扩展（需允许访问 *.noon.partners），再硬刷新预约页。详情：${retryErr.message}`);
                            chrome.storage.local.set({ monitoringActive: false });
                            return;
                        }
                        markMonitoringStarted(finalVerdict.host);
                    });
                })
                .catch((injectErr) => {
                    addLog(`错误：注入失败：${injectErr.message}。请重新加载扩展并确认已授权访问 noon.partners。`);
                    chrome.storage.local.set({ monitoringActive: false });
                });
        });
    });
}

document.getElementById('startBtn').addEventListener('click', () => {
    const warehouse = document.getElementById('warehouseInput').value.trim();
    if (!warehouse) {
        alert('请输入仓库代码');
        return;
    }
    
    if (selectedDates.length === 0) {
        alert('请至少选择一个日期');
        return;
    }
    
    const dates = [...selectedDates];
    
    const timeRangeStart = document.getElementById('timeRangeStart').value;
    const timeRangeEnd = document.getElementById('timeRangeEnd').value;
    const preferredStart = document.getElementById('preferredStart').value;

    if (!timeRangeStart || !timeRangeEnd) {
        alert('请设置时间范围');
        return;
    }

    const config = { warehouse, dates, timeRangeStart, timeRangeEnd, preferredStart };
    chrome.storage.local.set({ targetConfig: config, monitoringActive: true });

    chrome.runtime.sendMessage({ action: 'startLogSession' }, (logResponse) => {
        if (chrome.runtime.lastError) {
            addLog(`日志初始化失败: ${chrome.runtime.lastError.message}`, { persist: false });
        } else if (logResponse && logResponse.ok && logResponse.fileName) {
            document.getElementById('downloadLogBtn').disabled = false;
            addLog(`当前日志文件: ${logResponse.fileName}`, { persist: false });
        } else if (logResponse && logResponse.error) {
            addLog(`日志初始化失败: ${logResponse.error}`, { persist: false });
        }

        getActiveTabSiteVerdict((tab, currentUrl, verdict) => {
            if (!verdict.ok) {
                addLog(`错误：${verdict.message}`);
                chrome.storage.local.set({ monitoringActive: false });
                return;
            }
            startMonitoringOnActiveTab(config, verdict);
        });
    });
});

document.getElementById('downloadLogBtn').addEventListener('click', () => {
    downloadLogFile();
});

document.getElementById('stopBtn').addEventListener('click', () => {
    monitoring = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    addLog('正在停止监控...');

    // 先写 storage，保证刷新后也不会自动恢复；再通知页面中断当前循环
    chrome.storage.local.set({ monitoringActive: false }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab || tab.id == null) {
                addLog('监控已停止');
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: 'stop' }, () => {
                void chrome.runtime.lastError;
                addLog('监控已停止');
            });
        });
    });
});

function addLog(message, options = {}) {
    const { persist = true } = options;
    const logDiv = document.getElementById('log');
    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;

    if (persist) {
        chrome.runtime.sendMessage({ action: 'persistLog', text: message }, () => {});
    }
}

document.getElementById('openCompanionBtn')?.addEventListener('click', () => {
    // 必须在本点击回调里直接 open，经 background 转发会丢掉 user gesture
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const windowId = tabs && tabs[0] && tabs[0].windowId;
        if (windowId == null || !chrome.sidePanel?.open) {
            addLog('打开侧栏失败: 当前环境不支持 sidePanel', { persist: false });
            return;
        }
        chrome.sidePanel.open({ windowId }).then(() => {
            addLog('已打开侧栏陪伴助手', { persist: false });
            window.close();
        }).catch((err) => {
            addLog(`打开侧栏失败: ${err?.message || err}`, { persist: false });
        });
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'log') {
        addLog(message.text, { persist: false });
    } else if (message.action === 'success') {
        addLog('✅ 预约成功！正在回填 Outpost…');
        chrome.storage.local.set({ monitoringActive: false });
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        monitoring = false;
    } else if (message.action === 'bookingCaptureApplied') {
        const c = message.session && message.session.capture;
        if (c) addLog(`已回填: ${c.scheduledDate} ${c.scheduleSlot}`, { persist: false });
    }
});
