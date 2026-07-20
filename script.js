const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector(".nav");

document.body.classList.add("is-loaded");

if (menuButton && nav) {
  menuButton.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });

  nav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      nav.classList.remove("is-open");
      menuButton.setAttribute("aria-expanded", "false");
    }
  });
}

const revealTargets = [
  ...document.querySelectorAll(
    ".section-heading, .reason-grid, .split-layout, .guarantee-box, .comparison-table, .bonus-layout, .faq-layout, .company-layout, .briefing-panel, .legal-list, .policy-stack section, .curriculum-summary, .roadmap-panel, .deliverables-panel, .briefing-visual, .briefing-bonus-row, .briefing-program, .booking-calendar"
  ),
];

const staggerTargets = [
  ...document.querySelectorAll(".worry-grid, .level-stack, .chapter-grid, .bonus-list, .flow-diagram, .calendar-grid"),
];

revealTargets.forEach((element) => element.classList.add("reveal"));
staggerTargets.forEach((element) => element.classList.add("reveal-stagger"));

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
  );

  [...revealTargets, ...staggerTargets].forEach((element) => observer.observe(element));
} else {
  [...revealTargets, ...staggerTargets].forEach((element) => element.classList.add("is-visible"));
}

const bookingForm = document.querySelector("#bookingForm");
const bookingSlotsContainer = document.querySelector("#bookingSlots");
const bookingZoomUrl = "https://us05web.zoom.us/j/87362640884?pwd=K1hsImx0aSZtk5du0V5NtHF1UwCAXs.1";
const bookingConfig = window.AI_LIFE_BOOKING_CONFIG || {};
let bookingCalendarMonth = null;

function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `aiLifeBooking_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement("script");
    const separator = url.includes("?") ? "&" : "?";
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}`;
    script.async = true;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.addEventListener("error", () => {
      cleanup();
      reject(new Error("予約枠を読み込めませんでした。"));
    });

    document.head.append(script);
  });
}

function normalizeSlotGroups(weeks) {
  return (weeks || []).map((week) => ({
    label: week.label || "予約可能日程",
    slots: (week.slots || []).map((slot) => ({
      ...slot,
      id: slot.id || `${slot.date || ""}-${slot.time || ""}`,
      label: slot.label || `${slot.date || ""} ${slot.time || ""}`.trim(),
      capacity: Number(slot.capacity || 0),
      remaining: Number(slot.remaining ?? slot.capacity ?? 0),
    })).filter((slot) => !isExpiredSlot(slot)),
  })).filter((week) => week.slots.length > 0);
}

function flattenSlots(weeks) {
  return weeks.flatMap((week) => week.slots || []);
}

function getSlotDate(slot) {
  const idMatch = String(slot.id || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (idMatch) {
    return new Date(Number(idMatch[1]), Number(idMatch[2]) - 1, Number(idMatch[3]));
  }

  const dateMatch = String(slot.date || "").match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
  if (!dateMatch) return null;
  const now = new Date();
  const year = Number(dateMatch[1] || now.getFullYear());
  return new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[3]));
}

function getSlotStartDateTime(slot) {
  const date = getSlotDate(slot);
  if (!date) return null;
  const timeMatch = String(slot.time || "").match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) return date;
  date.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  return date;
}

function isExpiredSlot(slot) {
  const start = getSlotStartDateTime(slot);
  if (!start) return false;
  return start.getTime() <= Date.now();
}

function formatMonthTitle(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function buildCalendarSlots(slots) {
  const grouped = new Map();
  slots.forEach((slot) => {
    const date = getSlotDate(slot);
    if (!date || Number.isNaN(date.getTime())) return;
    const key = formatDateKey(date);
    if (!grouped.has(key)) grouped.set(key, { date, slots: [] });
    grouped.get(key).slots.push(slot);
  });
  return grouped;
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function getInitialCalendarMonth(slotMap) {
  const today = getMonthStart(new Date());
  const dates = [...slotMap.values()].map((item) => item.date).sort((a, b) => a - b);
  const upcoming = dates.find((date) => getMonthStart(date) >= today);
  return getMonthStart(upcoming || dates[0] || new Date());
}

function renderBookingSlots(weeksSource = window.AI_LIFE_BOOKING_WEEKS) {
  if (!bookingSlotsContainer) return;

  const weeks = Array.isArray(weeksSource) ? normalizeSlotGroups(weeksSource) : [];
  const slots = flattenSlots(weeks);
  bookingSlotsContainer.replaceChildren();

  if (slots.length === 0) {
    const empty = document.createElement("p");
    empty.className = "slot-loading";
    empty.textContent = "現在、予約可能な日程は準備中です。";
    bookingSlotsContainer.append(empty);
    return;
  }

  const calendar = document.createElement("div");
  calendar.className = "booking-calendar";

  const selected = document.createElement("p");
  selected.className = "calendar-selected";
  selected.textContent = "空き日程をタップしてください。";

  const slotMap = buildCalendarSlots(slots);
  if (!bookingCalendarMonth) bookingCalendarMonth = getInitialCalendarMonth(slotMap);
  const calendarStart = getMonthStart(bookingCalendarMonth);
  const daysInMonth = new Date(calendarStart.getFullYear(), calendarStart.getMonth() + 1, 0).getDate();
  const offset = calendarStart.getDay();

  const header = document.createElement("div");
  header.className = "calendar-header";
  const title = document.createElement("h3");
  title.textContent = formatMonthTitle(calendarStart);
  const legend = document.createElement("span");
  legend.textContent = "空き日程を選択";
  const controls = document.createElement("div");
  controls.className = "calendar-month-controls";
  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.textContent = "前の月";
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.textContent = "次の月";
  const currentMonth = getMonthStart(new Date());
  previousButton.disabled = calendarStart <= currentMonth;
  previousButton.addEventListener("click", () => {
    bookingCalendarMonth = addMonths(calendarStart, -1);
    renderBookingSlots(weeksSource);
  });
  nextButton.addEventListener("click", () => {
    bookingCalendarMonth = addMonths(calendarStart, 1);
    renderBookingSlots(weeksSource);
  });
  controls.append(previousButton, nextButton);
  header.append(title, legend, controls);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  ["日", "月", "火", "水", "木", "金", "土"].forEach((day) => {
    const cell = document.createElement("span");
    cell.className = "calendar-weekday";
    cell.textContent = day;
    grid.append(cell);
  });

  for (let i = 0; i < offset; i += 1) {
    const blank = document.createElement("span");
    blank.className = "calendar-day is-blank";
    grid.append(blank);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(calendarStart.getFullYear(), calendarStart.getMonth(), day);
    const key = formatDateKey(date);
    const entry = slotMap.get(key);
    const daySlots = entry?.slots || [];
    const available = daySlots.find((slot) => Number(slot.remaining ?? slot.capacity ?? 0) > 0);
    const representative = available || daySlots[0];
    const isFull = daySlots.length > 0 && !available;
    const isAvailable = Boolean(available);
    const cell = representative ? document.createElement("label") : document.createElement("span");
    cell.className = "calendar-day";
    if (representative) cell.classList.add("has-slot");
    if (isFull) cell.classList.add("is-full");

    const dateText = document.createElement("strong");
    dateText.textContent = String(day);
    cell.append(dateText);

    if (representative) {
      const time = document.createElement("small");
      time.textContent = representative.time || "時間未定";
      const seat = document.createElement("em");
      const remaining = Number(representative.remaining ?? representative.capacity ?? 0);
      seat.textContent = isFull ? "満員御礼" : "受付中";
      cell.append(time, seat);

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "slot";
      input.value = representative.label || `${representative.date || ""} ${representative.time || ""}`.trim();
      input.dataset.slotId = representative.id || "";
      input.required = isAvailable;
      input.disabled = !isAvailable;
      input.className = "calendar-radio";
      cell.append(input);

      if (isAvailable) {
        cell.addEventListener("click", () => {
          bookingSlotsContainer.querySelectorAll(".calendar-day.is-selected").forEach((element) => {
            element.classList.remove("is-selected");
          });
          input.checked = true;
          cell.classList.add("is-selected");
          selected.textContent = `選択中: ${input.value}`;
        });
      }
    }

    grid.append(cell);
  }

  const hasMonthSlots = [...slotMap.values()].some((entry) => {
    const month = getMonthStart(entry.date);
    return month.getTime() === calendarStart.getTime();
  });
  if (!hasMonthSlots) {
    selected.textContent = "この月の公開枠はまだありません。次の月も確認できます。";
  }

  calendar.append(header, grid, selected);
  bookingSlotsContainer.append(calendar);
}

renderBookingSlots();

async function loadManagedBookingSlots() {
  const endpoint = bookingConfig.apiEndpoint || bookingForm?.dataset.bookingApi || "";
  if (!bookingSlotsContainer || !endpoint) return;

  try {
    const data = await fetchJsonp(`${endpoint}?action=slots`);
    if (data && data.ok && Array.isArray(data.weeks)) {
      bookingCalendarMonth = null;
      renderBookingSlots(data.weeks);
    }
  } catch (error) {
    const warning = document.createElement("p");
    warning.className = "slot-loading";
    warning.textContent = "管理システムの日程を読み込めないため、仮の日程を表示しています。";
    bookingSlotsContainer.prepend(warning);
  }
}

loadManagedBookingSlots();

if (bookingForm) {
  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    let status = bookingForm.querySelector(".form-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "form-status";
      bookingForm.append(status);
    }

    const endpoint = bookingForm.dataset.endpoint || bookingForm.action;
    const googleFormEntries = {
      slot: bookingForm.dataset.entrySlot,
      name: bookingForm.dataset.entryName,
      email: bookingForm.dataset.entryEmail,
      phone: bookingForm.dataset.entryPhone,
      experience: bookingForm.dataset.entryExperience,
      interest: bookingForm.dataset.entryInterest,
      zoom: bookingForm.dataset.entryZoom,
      source: bookingForm.dataset.entrySource,
    };
    const hasAllEntries = Object.values(googleFormEntries).every(Boolean);
    if (!endpoint || !hasAllEntries || endpoint.includes("YOUR_")) {
      status.textContent =
        "予約フォームの保存先がまだ設定されていません。設定後、このフォームからスプレッドシート保存が動きます。";
      return;
    }

    const submitButton = bookingForm.querySelector('button[type="submit"]');
    status.textContent = "送信中です...";
    if (submitButton) submitButton.disabled = true;

    try {
      const data = new FormData(bookingForm);
      const selectedSlot = bookingForm.querySelector('input[name="slot"]:checked');
      const bookingApi = bookingForm.dataset.bookingApi || bookingConfig.apiEndpoint || "";

      if (bookingApi) {
        const managedData = new URLSearchParams();
        managedData.append("action", "reserve");
        managedData.append("slotId", selectedSlot?.dataset.slotId || "");
        managedData.append("slot", data.get("slot") || "");
        managedData.append("name", data.get("name") || "");
        managedData.append("email", data.get("email") || "");
        managedData.append("phone", data.get("phone") || "");
        managedData.append("experience", data.get("experience") || "");
        managedData.append("interest", data.get("interest") || "");
        managedData.append("zoom", bookingZoomUrl);
        managedData.append("source", location.href);

        await fetch(bookingApi, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: managedData.toString(),
        });

        bookingForm.reset();
        await loadManagedBookingSlots();
        status.textContent = "予約内容を送信しました。Zoomリンクをメールでお送りします。";
        return;
      }

      const googleFormData = new FormData();
      googleFormData.append(googleFormEntries.slot, data.get("slot") || "");
      googleFormData.append(googleFormEntries.name, data.get("name") || "");
      googleFormData.append(googleFormEntries.email, data.get("email") || "");
      googleFormData.append(googleFormEntries.phone, data.get("phone") || "");
      googleFormData.append(googleFormEntries.experience, data.get("experience") || "");
      googleFormData.append(googleFormEntries.interest, data.get("interest") || "");
      googleFormData.append(googleFormEntries.zoom, bookingZoomUrl);
      googleFormData.append(googleFormEntries.source, location.href);

      await fetch(endpoint, {
        method: "POST",
        mode: "no-cors",
        body: googleFormData,
      });

      bookingForm.reset();
      status.textContent =
        `予約内容を送信しました。Zoomはこちらです: ${bookingZoomUrl}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (location.protocol === "file:") {
        status.textContent =
          "file://で直接開いたページからは送信できない場合があります。公開URLまたは http://127.0.0.1:4173/booking.html から開いて送信してください。";
      } else {
        status.textContent = `送信できませんでした。${message || "時間をおいて再度お試しください。"}`;
      }
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
