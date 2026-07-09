const settingsForm = document.querySelector("#adminSettings");
const slotForm = document.querySelector("#slotForm");
const slotList = document.querySelector("#adminSlotList");
const adminStatus = document.querySelector("#adminStatus");
const adminBookingConfig = window.AI_LIFE_BOOKING_CONFIG || {};

const adminState = {
  endpoint: localStorage.getItem("aiLifeBookingApi") || adminBookingConfig.apiEndpoint || "",
  key: localStorage.getItem("aiLifeBookingAdminKey") || "",
};

function setAdminStatus(message) {
  if (!adminStatus) return;
  adminStatus.hidden = false;
  adminStatus.textContent = message;
}

function adminJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `aiLifeAdmin_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
      reject(new Error("予約管理システムへ接続できませんでした。"));
    });

    document.head.append(script);
  });
}

function postAdminAction(action, data = {}) {
  const body = new URLSearchParams({ action, adminKey: adminState.key, ...data });
  return fetch(adminState.endpoint, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });
}

function renderAdminSlots(weeks) {
  if (!slotList) return;
  slotList.replaceChildren();

  if (!weeks || weeks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "slot-loading";
    empty.textContent = "登録済みの日程はありません。";
    slotList.append(empty);
    return;
  }

  weeks.forEach((week) => {
    const group = document.createElement("section");
    group.className = "admin-slot-group";
    const heading = document.createElement("h3");
    heading.textContent = week.label || "予約可能日程";
    group.append(heading);

    (week.slots || []).forEach((slot) => {
      const item = document.createElement("article");
      item.className = "admin-slot-item";
      const remaining = Number(slot.remaining ?? slot.capacity ?? 0);
      item.innerHTML = `
        <div>
          <strong>${slot.date || ""} ${slot.time || ""}</strong>
          <span>${slot.note || "オンラインZoom説明会"}</span>
          <small>定員 ${slot.capacity || 0} / 残席 ${remaining} / ${slot.isPublic === false ? "非公開" : "公開"}</small>
        </div>
      `;

      const actions = document.createElement("div");
      actions.className = "admin-slot-actions";
      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "button secondary";
      toggleButton.textContent = remaining <= 0 ? "残席を戻す" : "満員にする";
      toggleButton.addEventListener("click", async () => {
        await postAdminAction("updateSlot", {
          slotId: slot.id,
          remaining: remaining <= 0 ? String(slot.capacity || 1) : "0",
        });
        await loadAdminSlots();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "button secondary danger";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", async () => {
        await postAdminAction("deleteSlot", { slotId: slot.id });
        await loadAdminSlots();
      });

      actions.append(toggleButton, deleteButton);
      item.append(actions);
      group.append(item);
    });

    slotList.append(group);
  });
}

async function loadAdminSlots() {
  if (!adminState.endpoint || !adminState.key) return;
  const data = await adminJsonp(`${adminState.endpoint}?action=slots&adminKey=${encodeURIComponent(adminState.key)}&includePrivate=1`);
  if (data && data.ok) {
    renderAdminSlots(data.weeks || []);
    setAdminStatus("日程を読み込みました。");
  } else {
    setAdminStatus(data?.error || "日程を読み込めませんでした。");
  }
}

if (settingsForm) {
  settingsForm.apiEndpoint.value = adminState.endpoint;
  settingsForm.adminKey.value = adminState.key;

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    adminState.endpoint = settingsForm.apiEndpoint.value.trim();
    adminState.key = settingsForm.adminKey.value.trim();
    localStorage.setItem("aiLifeBookingApi", adminState.endpoint);
    localStorage.setItem("aiLifeBookingAdminKey", adminState.key);
    await loadAdminSlots();
  });
}

if (slotForm) {
  slotForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!adminState.endpoint || !adminState.key) {
      setAdminStatus("先に接続設定を保存してください。");
      return;
    }

    const data = new FormData(slotForm);
    await postAdminAction("addSlot", {
      weekLabel: data.get("weekLabel") || "",
      date: data.get("date") || "",
      time: data.get("time") || "",
      capacity: data.get("capacity") || "5",
      remaining: data.get("capacity") || "5",
      note: data.get("note") || "オンラインZoom説明会",
      isPublic: data.get("isPublic") ? "TRUE" : "FALSE",
    });

    slotForm.reset();
    slotForm.capacity.value = "5";
    slotForm.note.value = "オンラインZoom説明会";
    slotForm.isPublic.checked = true;
    await loadAdminSlots();
    setAdminStatus("日程を追加しました。");
  });
}

loadAdminSlots();
