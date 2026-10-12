/** 侧栏内约仓监控：原版日历多选 + 开始/停止（抢仓仍走原 content.js） */
(function () {
  const warehouseInput = document.getElementById("warehouseInput");
  const datesInput = document.getElementById("datesInput");
  const timeRangeStart = document.getElementById("timeRangeStart");
  const timeRangeEnd = document.getElementById("timeRangeEnd");
  const preferredStart = document.getElementById("preferredStart");
  const startBtn = document.getElementById("monitorStartBtn");
  const stopBtn = document.getElementById("monitorStopBtn");
  const logEl = document.getElementById("monitorLog");

  let selectedDates = [];
  let calendarViewDate = new Date();
  let highlightedWeekday = null;
  let isDraggingDates = false;
  let dragMode = null;
  let dragVisitedDates = new Set();

  function addLog(msg) {
    if (!logEl) return;
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.textContent = `${logEl.textContent ? `${logEl.textContent}\n` : ""}${line}`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseDateString(dateValue) {
    const [year, month, day] = dateValue.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function isSameDay(left, right) {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  function syncDatesInput() {
    selectedDates.sort((a, b) => a.localeCompare(b));
    datesInput.value = selectedDates.join(",");
  }

  function renderSelectedDates() {
    const container = document.getElementById("selectedDatesList");
    if (!container) return;
    container.innerHTML = "";
    if (!selectedDates.length) {
      const empty = document.createElement("span");
      empty.className = "selected-dates-empty";
      empty.textContent = "尚未选择日期";
      container.appendChild(empty);
      return;
    }
    selectedDates.forEach((dateValue) => {
      const tag = document.createElement("span");
      tag.className = "selected-date-tag";
      tag.textContent = dateValue;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "selected-date-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        selectedDates = selectedDates.filter((d) => d !== dateValue);
        syncDatesInput();
        renderSelectedDates();
        renderCalendar();
      });
      tag.appendChild(removeBtn);
      container.appendChild(tag);
    });
  }

  function updateDateButtonState(dayBtn, date, dateValue, today = new Date()) {
    dayBtn.classList.toggle(
      "is-highlighted-weekday",
      highlightedWeekday !== null && date.getDay() === highlightedWeekday,
    );
    dayBtn.classList.toggle("is-selected", selectedDates.includes(dateValue));
    dayBtn.classList.toggle("is-today", isSameDay(date, today));
  }

  function applyDragSelection(dateValue, dayBtn) {
    if (dragVisitedDates.has(dateValue)) return;
    dragVisitedDates.add(dateValue);
    if (dragMode === "add" && !selectedDates.includes(dateValue)) {
      selectedDates.push(dateValue);
    } else if (dragMode === "remove" && selectedDates.includes(dateValue)) {
      selectedDates = selectedDates.filter((d) => d !== dateValue);
    }
    syncDatesInput();
    renderSelectedDates();
    updateDateButtonState(dayBtn, parseDateString(dateValue), dateValue);
  }

  function renderCalendar() {
    const monthLabel = document.getElementById("calendarMonthLabel");
    const daysContainer = document.getElementById("calendarDays");
    if (!monthLabel || !daysContainer) return;
    monthLabel.textContent = `${calendarViewDate.getFullYear()}年 ${calendarViewDate.getMonth() + 1}月`;
    daysContainer.innerHTML = "";
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    for (let i = 0; i < startWeekday; i += 1) {
      const filler = document.createElement("button");
      filler.type = "button";
      filler.className = "calendar-day is-outside";
      filler.disabled = true;
      daysContainer.appendChild(filler);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const dateValue = formatDate(date);
      const dayBtn = document.createElement("button");
      dayBtn.type = "button";
      dayBtn.className = "calendar-day";
      dayBtn.textContent = String(day);
      updateDateButtonState(dayBtn, date, dateValue, today);
      dayBtn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        isDraggingDates = true;
        dragMode = selectedDates.includes(dateValue) ? "remove" : "add";
        dragVisitedDates = new Set();
        applyDragSelection(dateValue, dayBtn);
      });
      dayBtn.addEventListener("mouseenter", () => {
        if (!isDraggingDates) return;
        applyDragSelection(dateValue, dayBtn);
      });
      daysContainer.appendChild(dayBtn);
    }
  }

  function openDatePicker() {
    document.getElementById("calendarPopover").classList.remove("hidden");
    if (selectedDates.length) {
      calendarViewDate = parseDateString(selectedDates[selectedDates.length - 1]);
    } else {
      calendarViewDate = new Date();
    }
    calendarViewDate = new Date(
      calendarViewDate.getFullYear(),
      calendarViewDate.getMonth(),
      1,
    );
    renderCalendar();
  }

  function closeDatePicker() {
    document.getElementById("calendarPopover").classList.add("hidden");
  }

  function setSelectedDates(dates) {
    selectedDates = (dates || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    syncDatesInput();
    renderSelectedDates();
    renderCalendar();
  }

  globalThis.BookingDatePicker = { setSelectedDates, getSelectedDates: () => [...selectedDates] };

  document.getElementById("openDatePickerBtn")?.addEventListener("click", () => {
    const pop = document.getElementById("calendarPopover");
    if (pop.classList.contains("hidden")) openDatePicker();
    else closeDatePicker();
  });
  document.getElementById("closeDatePickerBtn")?.addEventListener("click", closeDatePicker);
  document.getElementById("clearDatesBtn")?.addEventListener("click", () => {
    selectedDates = [];
    syncDatesInput();
    renderSelectedDates();
    renderCalendar();
  });
  document.getElementById("prevMonthBtn")?.addEventListener("click", () => {
    calendarViewDate = new Date(
      calendarViewDate.getFullYear(),
      calendarViewDate.getMonth() - 1,
      1,
    );
    renderCalendar();
  });
  document.getElementById("nextMonthBtn")?.addEventListener("click", () => {
    calendarViewDate = new Date(
      calendarViewDate.getFullYear(),
      calendarViewDate.getMonth() + 1,
      1,
    );
    renderCalendar();
  });
  document.addEventListener("mouseup", () => {
    if (!isDraggingDates) return;
    isDraggingDates = false;
    dragMode = null;
    dragVisitedDates = new Set();
    renderCalendar();
  });

  function getActiveTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      cb(tabs && tabs[0] ? tabs[0] : null);
    });
  }

  function sendStart(tabId, config, cb) {
    chrome.tabs.sendMessage(tabId, { action: "start", config }, (response) => {
      if (chrome.runtime.lastError) {
        cb(new Error(chrome.runtime.lastError.message));
        return;
      }
      cb(null, response);
    });
  }

  function ensureContent(tabId) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          files: ["site-config.js", "content.js", "capture-hook.js"],
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        },
      );
    });
  }

  chrome.storage.local.get(["targetConfig", "monitoringActive"], (result) => {
    const cfg = result.targetConfig;
    if (cfg) {
      if (cfg.warehouse) warehouseInput.value = cfg.warehouse;
      if (Array.isArray(cfg.dates)) setSelectedDates(cfg.dates);
      if (cfg.timeRangeStart) timeRangeStart.value = cfg.timeRangeStart;
      if (cfg.timeRangeEnd) timeRangeEnd.value = cfg.timeRangeEnd;
      if (cfg.preferredStart != null) preferredStart.value = cfg.preferredStart;
    }
    if (result.monitoringActive) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
      addLog("监控正在运行…");
    }
    getActiveTab((tab) => {
      const region =
        typeof NoonSiteConfig !== "undefined" && NoonSiteConfig.detectRegion
          ? NoonSiteConfig.detectRegion(tab?.url || "")
          : null;
      highlightedWeekday = region === "ae" ? 0 : region === "sa" ? 5 : null;
      if (!warehouseInput.value.trim()) {
        warehouseInput.value = region === "ae" ? "AUH01S" : "RUH01S";
      }
      renderSelectedDates();
    });
  });

  startBtn.addEventListener("click", () => {
    const warehouse = warehouseInput.value.trim();
    const dates = [...selectedDates];
    if (!warehouse) {
      addLog("请输入仓库代码");
      return;
    }
    if (!dates.length) {
      addLog("请用日历至少选择一个日期");
      return;
    }
    const config = {
      warehouse,
      dates,
      timeRangeStart: timeRangeStart.value,
      timeRangeEnd: timeRangeEnd.value,
      preferredStart: preferredStart.value,
    };
    chrome.storage.local.set({ targetConfig: config, monitoringActive: true });
    chrome.runtime.sendMessage({ action: "startLogSession" }, () => {
      void chrome.runtime.lastError;
    });

    getActiveTab((tab) => {
      if (!tab?.id) {
        addLog("未找到当前标签页");
        chrome.storage.local.set({ monitoringActive: false });
        return;
      }
      const verdict =
        typeof NoonSiteConfig !== "undefined" && NoonSiteConfig.matchUrl
          ? NoonSiteConfig.matchUrl(tab.url || "")
          : { ok: true, host: "?", message: "ok" };
      if (!verdict.ok) {
        addLog(verdict.message);
        chrome.storage.local.set({ monitoringActive: false });
        return;
      }

      const onOk = () => {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        addLog(`监控已启动（${verdict.host || "noon"}）`);
      };

      sendStart(tab.id, config, (err) => {
        if (!err) {
          onOk();
          return;
        }
        addLog("页面脚本未就绪，尝试注入…");
        ensureContent(tab.id)
          .then(() => new Promise((r) => setTimeout(r, 200)))
          .then(() => {
            sendStart(tab.id, config, (err2) => {
              if (err2) {
                addLog(`启动失败：${err2.message}`);
                chrome.storage.local.set({ monitoringActive: false });
                return;
              }
              onOk();
            });
          })
          .catch((e) => {
            addLog(`注入失败：${e.message}`);
            chrome.storage.local.set({ monitoringActive: false });
          });
      });
    });
  });

  stopBtn.addEventListener("click", () => {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    chrome.storage.local.set({ monitoringActive: false }, () => {
      getActiveTab((tab) => {
        if (tab?.id != null) {
          chrome.tabs.sendMessage(tab.id, { action: "stop" }, () => {
            void chrome.runtime.lastError;
          });
        }
        addLog("监控已停止");
      });
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "log") addLog(message.text);
    if (message.action === "success") {
      chrome.storage.local.get(["bookingWorkMode"], (result) => {
        addLog(
          result.bookingWorkMode === "offline"
            ? "预约成功（离线，不回填主机）"
            : "预约成功，正在回填…",
        );
      });
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
    if (message.action === "bookingCaptureApplied") {
      const c = message.session?.capture;
      if (c) addLog(`已回填 ${c.scheduledDate} ${c.scheduleSlot}`);
    }
  });
})();
