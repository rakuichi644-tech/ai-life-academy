const BOOKING_CONFIG = {
  adminEmail: 'rakuichi644@gmail.com',
  senderName: 'あいらいふ運営事務局',
  spreadsheetName: 'AI LIFE ACADEMY_予約管理',
  bookingSpreadsheetId: '1eVvwxmWepytwsGVlOFRJC37qkcIRDGzke7cPKKryGTU',
  slotsSheetName: '予約枠',
  reservationsSheetName: '予約者管理',
  zoomUrl: 'https://us05web.zoom.us/j/87362640884?pwd=K1hsImx0aSZtk5du0V5NtHF1UwCAXs.1',
};

const SLOT_HEADERS = [
  'slotId',
  '週ラベル',
  '日付',
  '時間',
  'メモ',
  '定員',
  '残席',
  '公開',
  '作成日時',
  '更新日時',
];

const RESERVATION_HEADERS = [
  '予約日時',
  '予約ステータス',
  '氏名',
  'メールアドレス',
  '電話番号',
  '希望日程',
  'slotId',
  'AI経験',
  '知りたいこと',
  'Zoom URL',
  'クーポン',
  '説明会ステータス',
  '決済ステータス',
  '返金ステータス',
  '購入者ステータス',
  '流入元',
  'メモ',
];

function doGet(e) {
  try {
    const action = getParam_(e, 'action') || 'slots';

    if (action === 'slots') {
      const includePrivate = getParam_(e, 'includePrivate') === '1';
      const data = {
        ok: true,
        weeks: getPublicSlotGroups_(includePrivate),
      };
      return output_(e, data);
    }

    if (action === 'reserve') {
      return output_(e, reserveSlot_(e));
    }

    return output_(e, { ok: false, error: 'Unknown action' });
  } catch (error) {
    return output_(e, { ok: false, error: error.message });
  }
}

function setupBookingSystem() {
  const properties = PropertiesService.getScriptProperties();
  let adminKey = properties.getProperty('BOOKING_ADMIN_KEY');
  if (!adminKey) {
    adminKey = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    properties.setProperty('BOOKING_ADMIN_KEY', adminKey);
  }

  const spreadsheet = getSpreadsheet_();
  getSheet_(BOOKING_CONFIG.slotsSheetName, SLOT_HEADERS);
  getSheet_(BOOKING_CONFIG.reservationsSheetName, RESERVATION_HEADERS);

  return {
    spreadsheetUrl: spreadsheet.getUrl(),
    spreadsheetId: spreadsheet.getId(),
    adminKey,
  };
}

function doPost(e) {
  try {
    const action = getParam_(e, 'action');

    if (action === 'reserve') {
      return output_(e, reserveSlot_(e));
    }

    assertAdmin_(e);

    if (action === 'addSlot') {
      return output_(e, addSlot_(e));
    }

    if (action === 'deleteSlot') {
      return output_(e, deleteSlot_(e));
    }

    if (action === 'updateSlot') {
      return output_(e, updateSlot_(e));
    }

    if (action === 'updateReservationStatus') {
      return output_(e, updateReservationStatus_(e));
    }

    return output_(e, { ok: false, error: 'Unknown action' });
  } catch (error) {
    return output_(e, { ok: false, error: error.message });
  }
}

function reserveSlot_(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let reservation;

  try {
    const slotId = getParam_(e, 'slotId');
    const slotLabel = getParam_(e, 'slot');
    const name = getParam_(e, 'name') || 'お客様';
    const email = normalizeEmail_(getParam_(e, 'email'));
    const phone = getParam_(e, 'phone');
    const experience = getParam_(e, 'experience');
    const interest = getParam_(e, 'interest');
    const source = getParam_(e, 'source');

    if (!slotId && !slotLabel) throw new Error('希望日程が選択されていません。');
    if (!email) throw new Error('メールアドレスがありません。');

    const slotsSheet = getSheet_(BOOKING_CONFIG.slotsSheetName, SLOT_HEADERS);
    closeExpiredSlots_(slotsSheet);
    const slot = findSlot_(slotsSheet, slotId, slotLabel);

    if (slot.rowNumber) {
      if (isExpiredSlotRow_(slot.row)) throw new Error('この日程は受付終了です。');
      const remaining = Number(slot.row[SLOT_HEADERS.indexOf('残席')] || 0);
      if (remaining <= 0) throw new Error('この日程は満員です。');
      slotsSheet.getRange(slot.rowNumber, SLOT_HEADERS.indexOf('残席') + 1).setValue(remaining - 1);
      slotsSheet.getRange(slot.rowNumber, SLOT_HEADERS.indexOf('更新日時') + 1).setValue(new Date());
    }

    const finalSlotLabel = slot.label || slotLabel;
    const reservationsSheet = getSheet_(BOOKING_CONFIG.reservationsSheetName, RESERVATION_HEADERS);
    reservationsSheet.appendRow([
      new Date(),
      '予約済み',
      name,
      email,
      phone,
      finalSlotLabel,
      slotId,
      experience,
      interest,
      BOOKING_CONFIG.zoomUrl,
      '',
      '未参加',
      '未申込',
      '',
      '未申込',
      source,
      '',
    ]);

    reservation = { name, email, phone, finalSlotLabel, experience, interest };
  } finally {
    lock.releaseLock();
  }

  GmailApp.sendEmail(reservation.email, '【AI LIFE ACADEMY】無料説明会の予約を受け付けました', buildReservationMail_({
    name: reservation.name,
    slot: reservation.finalSlotLabel,
    zoomUrl: BOOKING_CONFIG.zoomUrl,
  }), {
    name: BOOKING_CONFIG.senderName,
    replyTo: BOOKING_CONFIG.adminEmail,
  });

  GmailApp.sendEmail(BOOKING_CONFIG.adminEmail, '【AI LIFE ACADEMY】無料説明会の予約が入りました',
    `無料説明会の予約が入りました。\n\n氏名: ${reservation.name}\nメール: ${reservation.email}\n電話番号: ${reservation.phone}\n希望日程: ${reservation.finalSlotLabel}\nAI経験: ${reservation.experience}\n知りたいこと: ${reservation.interest}`,
    { name: BOOKING_CONFIG.senderName }
  );

  return { ok: true, reserved: true, slot: reservation.finalSlotLabel };
}

function addSlot_(e) {
  const sheet = getSheet_(BOOKING_CONFIG.slotsSheetName, SLOT_HEADERS);
  const now = new Date();
  const id = `slot_${Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss')}_${Math.floor(Math.random() * 10000)}`;
  const capacity = Number(getParam_(e, 'capacity') || 1);
  const remaining = Number(getParam_(e, 'remaining') || capacity);
  const date = getParam_(e, 'date');
  const time = getParam_(e, 'time');
  const weekLabel = getParam_(e, 'weekLabel') || buildMonthLabel_(date);

  sheet.appendRow([
    id,
    weekLabel,
    date,
    time,
    getParam_(e, 'note') || 'オンラインZoom説明会',
    capacity,
    remaining,
    getParam_(e, 'isPublic') === 'FALSE' ? 'FALSE' : 'TRUE',
    now,
    now,
  ]);

  return { ok: true, slotId: id };
}

function buildMonthLabel_(dateText) {
  const text = String(dateText || '');
  const yearMatch = text.match(/(\d{4})年/);
  const monthMatch = text.match(/(\d{1,2})月/);
  if (!monthMatch) return '予約可能日程';
  return `${yearMatch ? `${yearMatch[1]}年` : ''}${monthMatch[1]}月`;
}

function deleteSlot_(e) {
  const sheet = getSheet_(BOOKING_CONFIG.slotsSheetName, SLOT_HEADERS);
  const rowNumber = findRowBySlotId_(sheet, getParam_(e, 'slotId'));
  if (!rowNumber) throw new Error('日程が見つかりません。');
  sheet.deleteRow(rowNumber);
  return { ok: true, deleted: true };
}

function updateSlot_(e) {
  const sheet = getSheet_(BOOKING_CONFIG.slotsSheetName, SLOT_HEADERS);
  const rowNumber = findRowBySlotId_(sheet, getParam_(e, 'slotId'));
  if (!rowNumber) throw new Error('日程が見つかりません。');

  const updates = {
    '週ラベル': getParam_(e, 'weekLabel'),
    '日付': getParam_(e, 'date'),
    '時間': getParam_(e, 'time'),
    'メモ': getParam_(e, 'note'),
    '定員': getParam_(e, 'capacity'),
    '残席': getParam_(e, 'remaining'),
    '公開': getParam_(e, 'isPublic'),
  };

  Object.keys(updates).forEach((header) => {
    if (updates[header] !== '') {
      sheet.getRange(rowNumber, SLOT_HEADERS.indexOf(header) + 1).setValue(updates[header]);
    }
  });
  sheet.getRange(rowNumber, SLOT_HEADERS.indexOf('更新日時') + 1).setValue(new Date());

  return { ok: true, updated: true };
}

function updateReservationStatus_(e) {
  const sheet = getSheet_(BOOKING_CONFIG.reservationsSheetName, RESERVATION_HEADERS);
  const email = normalizeEmail_(getParam_(e, 'email'));
  if (!email) throw new Error('メールアドレスがありません。');

  const rowNumber = findLatestReservationRowByEmail_(sheet, email);
  if (!rowNumber) throw new Error('予約者が見つかりません。');

  const statusUpdates = {
    '予約ステータス': getParam_(e, 'reservationStatus'),
    '説明会ステータス': getParam_(e, 'briefingStatus'),
    '決済ステータス': getParam_(e, 'paymentStatus'),
    '返金ステータス': getParam_(e, 'refundStatus'),
    '購入者ステータス': getParam_(e, 'purchaserStatus'),
    'メモ': getParam_(e, 'memo'),
  };

  Object.keys(statusUpdates).forEach((header) => {
    if (statusUpdates[header] !== '') {
      sheet.getRange(rowNumber, RESERVATION_HEADERS.indexOf(header) + 1).setValue(statusUpdates[header]);
    }
  });

  return { ok: true, updated: true };
}

function getPublicSlotGroups_(includePrivate) {
  const sheet = getSheet_(BOOKING_CONFIG.slotsSheetName, SLOT_HEADERS);
  if (sheet.getLastRow() <= 1) seedSlots_(sheet);
  closeExpiredSlots_(sheet);

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SLOT_HEADERS.length).getValues();
  const groups = {};

  values.forEach((row) => {
    const isPublic = row[SLOT_HEADERS.indexOf('公開')] !== 'FALSE';
    if (!includePrivate && !isPublic) return;
    if (!includePrivate && isExpiredSlotRow_(row)) return;

    const weekLabel = row[SLOT_HEADERS.indexOf('週ラベル')] || '予約可能日程';
    if (!groups[weekLabel]) groups[weekLabel] = { label: weekLabel, slots: [] };

    const date = row[SLOT_HEADERS.indexOf('日付')];
    const time = row[SLOT_HEADERS.indexOf('時間')];
    groups[weekLabel].slots.push({
      id: row[SLOT_HEADERS.indexOf('slotId')],
      date,
      time,
      label: `${date} ${time}`,
      note: row[SLOT_HEADERS.indexOf('メモ')],
      capacity: Number(row[SLOT_HEADERS.indexOf('定員')] || 0),
      remaining: Number(row[SLOT_HEADERS.indexOf('残席')] || 0),
      isPublic,
    });
  });

  return Object.keys(groups).map((key) => groups[key]);
}

function closeExpiredSlots_(sheet) {
  if (sheet.getLastRow() <= 1) return;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SLOT_HEADERS.length).getValues();
  const remainingColumn = SLOT_HEADERS.indexOf('残席') + 1;
  const publicColumn = SLOT_HEADERS.indexOf('公開') + 1;
  const memoColumn = SLOT_HEADERS.indexOf('メモ') + 1;
  const updatedColumn = SLOT_HEADERS.indexOf('更新日時') + 1;
  const now = new Date();

  values.forEach((row, index) => {
    if (!isExpiredSlotRow_(row)) return;

    const rowNumber = index + 2;
    const isPublic = row[SLOT_HEADERS.indexOf('公開')] !== 'FALSE';
    const remaining = Number(row[SLOT_HEADERS.indexOf('残席')] || 0);
    if (!isPublic && remaining <= 0) return;

    const memo = String(row[SLOT_HEADERS.indexOf('メモ')] || 'オンラインZoom説明会');
    sheet.getRange(rowNumber, remainingColumn).setValue(0);
    sheet.getRange(rowNumber, publicColumn).setValue('FALSE');
    if (!memo.includes('自動受付終了')) {
      sheet.getRange(rowNumber, memoColumn).setValue(`${memo} / 自動受付終了`);
    }
    sheet.getRange(rowNumber, updatedColumn).setValue(now);
  });
}

function isExpiredSlotRow_(row) {
  const dateText = row[SLOT_HEADERS.indexOf('日付')];
  const timeText = row[SLOT_HEADERS.indexOf('時間')];
  const start = parseSlotStart_(dateText, timeText);
  return start ? start.getTime() <= Date.now() : false;
}

function parseSlotStart_(dateText, timeText) {
  const dateMatch = String(dateText || '').match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
  if (!dateMatch) return null;

  const now = new Date();
  const year = Number(dateMatch[1] || now.getFullYear());
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const timeMatch = String(timeText || '').match(/(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function seedSlots_(sheet) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const rows = [];

  for (let i = 0; i < 32; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const day = date.getDay();
    if (![0, 2, 5].includes(day)) continue;

    const time = day === 0 ? '21:00〜22:00' : '20:00〜21:00';
    const timeId = time.slice(0, 5).replace(':', '');
    const id = `seed_${Utilities.formatDate(date, 'Asia/Tokyo', 'yyyyMMdd')}_${timeId}`;
    rows.push([
      id,
      formatWeekLabel_(date),
      formatJapaneseDate_(date),
      time,
      'オンラインZoom説明会',
      5,
      5,
      'TRUE',
      new Date(),
      new Date(),
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SLOT_HEADERS.length).setValues(rows);
  }
}

function formatJapaneseDate_(date) {
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekdays[date.getDay()]}）`;
}

function formatWeekLabel_(date) {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${formatJapaneseDate_(start)}〜${formatJapaneseDate_(end)}`;
}

function findSlot_(sheet, slotId, slotLabel) {
  if (sheet.getLastRow() <= 1) return {};
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SLOT_HEADERS.length).getValues();
  const rowIndex = values.findIndex((row) => {
    const label = `${row[SLOT_HEADERS.indexOf('日付')]} ${row[SLOT_HEADERS.indexOf('時間')]}`;
    return (slotId && row[SLOT_HEADERS.indexOf('slotId')] === slotId) || (slotLabel && label === slotLabel);
  });
  if (rowIndex === -1) return {};
  const row = values[rowIndex];
  return {
    row,
    rowNumber: rowIndex + 2,
    label: `${row[SLOT_HEADERS.indexOf('日付')]} ${row[SLOT_HEADERS.indexOf('時間')]}`,
  };
}

function findRowBySlotId_(sheet, slotId) {
  if (!slotId || sheet.getLastRow() <= 1) return 0;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const index = values.indexOf(slotId);
  return index === -1 ? 0 : index + 2;
}

function findLatestReservationRowByEmail_(sheet, email) {
  if (sheet.getLastRow() <= 1) return 0;
  const emailColumn = RESERVATION_HEADERS.indexOf('メールアドレス') + 1;
  const values = sheet.getRange(2, emailColumn, sheet.getLastRow() - 1, 1).getValues().flat();
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (normalizeEmail_(values[i]) === email) return i + 2;
  }
  return 0;
}

function getSheet_(sheetName, headers) {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  ensureHeaders_(sheet, headers);
  return sheet;
}

function getSpreadsheet_() {
  if (BOOKING_CONFIG.bookingSpreadsheetId) return SpreadsheetApp.openById(BOOKING_CONFIG.bookingSpreadsheetId);

  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('BOOKING_SPREADSHEET_ID');
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

  const spreadsheet = SpreadsheetApp.create(BOOKING_CONFIG.spreadsheetName);
  properties.setProperty('BOOKING_SPREADSHEET_ID', spreadsheet.getId());
  return spreadsheet;
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  headers.forEach((header) => {
    if (!current.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
}

function buildReservationMail_(data) {
  return `${data.name} 様

AI LIFE ACADEMY 無料説明会のご予約ありがとうございます。

━━━━━━━━━━━━━━━━━━
予約内容
━━━━━━━━━━━━━━━━━━

日程: ${data.slot}
Zoom: ${data.zoomUrl}

当日はお時間になりましたらZoomへご参加ください。

あいらいふ運営事務局`;
}

function assertAdmin_(e) {
  const savedKey = PropertiesService.getScriptProperties().getProperty('BOOKING_ADMIN_KEY');
  if (!savedKey) throw new Error('BOOKING_ADMIN_KEYが未設定です。');
  if (getParam_(e, 'adminKey') !== savedKey) throw new Error('管理キーが違います。');
}

function output_(e, data) {
  const callback = getParam_(e, 'callback');
  const body = callback ? `${callback}(${JSON.stringify(data)});` : JSON.stringify(data);
  const mimeType = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(body).setMimeType(mimeType);
}

function getParam_(e, key) {
  return String(e && e.parameter && e.parameter[key] || '').trim();
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}
