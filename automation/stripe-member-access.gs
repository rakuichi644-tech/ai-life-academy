const CONFIG = {
  adminEmail: 'rakuichi644@gmail.com',
  senderName: 'あいらいふ運営事務局',
  productName: 'AI LIFE ACADEMY',
  memberFolderId: '1dVWdYweunGZFYTcCIen3xcdrnMBsKh00',
  memberFolderUrl: 'https://drive.google.com/drive/folders/1dVWdYweunGZFYTcCIen3xcdrnMBsKh00',
  spreadsheetName: 'AI LIFE ACADEMY_購入者管理',
  sheetName: '購入者管理',
};

const HEADERS = [
  '処理日時',
  'ステータス',
  '氏名',
  'メールアドレス',
  'StripeイベントID',
  'Stripeイベント種別',
  'Checkout Session ID',
  'Payment Intent ID',
  'Charge ID',
  '金額',
  '通貨',
  'Drive権限',
  'メール送信',
  'メモ',
];

const ROW_COLORS = {
  active: '#ffffff',
  refunded: '#fce8e6',
  needsCheck: '#fff4ce',
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const event = fetchStripeEvent_(payload.id);

    if (event.type === 'checkout.session.completed') {
      return handleCheckoutCompleted_(event);
    }

    if (event.type === 'charge.refunded' || event.type === 'refund.created') {
      return handleRefund_(event);
    }

    return json_({ ok: true, skipped: true, type: event.type });
  } catch (error) {
    logRow_({
      status: 'ERROR',
      eventType: 'unknown',
      memo: error.message,
    });
    return json_({ ok: false, error: error.message });
  }
}

function handleCheckoutCompleted_(event) {
  const session = event.data.object;

  if (session.payment_status && session.payment_status !== 'paid') {
    return json_({ ok: true, skipped: true, reason: 'payment_status is not paid' });
  }

  const email = normalizeEmail_(
    session.customer_details && session.customer_details.email ||
    session.customer_email
  );
  const name = session.customer_details && session.customer_details.name || 'お客様';

  if (!email) {
    throw new Error('購入者メールアドレスがStripeイベント内にありません。');
  }

  const sheet = getOrCreateSheet_();
  if (hasProcessedEvent_(sheet, event.id)) {
    return json_({ ok: true, duplicated: true });
  }

  const folder = DriveApp.getFolderById(CONFIG.memberFolderId);
  folder.addViewer(email);

  GmailApp.sendEmail(email, `【${CONFIG.productName}】会員コンテンツのご案内`, buildMemberWelcomeMail_({
    name,
    memberFolderUrl: CONFIG.memberFolderUrl,
  }), {
    name: CONFIG.senderName,
    replyTo: CONFIG.adminEmail,
  });

  logRow_({
    status: 'ACTIVE',
    name,
    email,
    eventId: event.id,
    eventType: event.type,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent,
    amount: session.amount_total,
    currency: session.currency,
    driveStatus: '付与済み',
    mailStatus: '送信済み',
  });

  return json_({ ok: true, granted: true, email });
}

function handleRefund_(event) {
  const refundObject = event.data.object;
  const chargeId = refundObject.object === 'charge' ? refundObject.id : refundObject.charge;
  const paymentIntentId = refundObject.payment_intent || '';
  const sheet = getOrCreateSheet_();
  const purchaser = findPurchaserForRefund_(sheet, {
    chargeId,
    paymentIntentId,
    email: normalizeEmail_(refundObject.billing_details && refundObject.billing_details.email),
  });

  if (!purchaser.email) {
    logRow_({
      status: 'REFUND_NEEDS_CHECK',
      eventId: event.id,
      eventType: event.type,
      chargeId,
      paymentIntentId,
      memo: '返金イベントから購入者メールを特定できませんでした。Stripe管理画面で確認してください。',
    });
    GmailApp.sendEmail(CONFIG.adminEmail, '【AI LIFE ACADEMY】返金者の権限削除確認が必要です',
      `返金イベントを受信しましたが、メールアドレスを特定できませんでした。\n\nStripeイベントID: ${event.id}\nCharge ID: ${chargeId || '不明'}\nPayment Intent ID: ${paymentIntentId || '不明'}\n\nStripe管理画面で購入者を確認し、Google Driveの共有権限を手動で削除してください。`,
      { name: CONFIG.senderName }
    );
    return json_({ ok: true, needsCheck: true });
  }

  let driveStatus = '削除済み';
  let driveMemo = '';
  try {
    const folder = DriveApp.getFolderById(CONFIG.memberFolderId);
    folder.removeViewer(purchaser.email);
  } catch (error) {
    driveStatus = '削除済み/要確認';
    driveMemo = `Drive権限削除時の注意: ${error.message}`;
  }

  markPurchaserRefunded_(sheet, purchaser, {
    refundEventId: event.id,
    eventType: event.type,
    chargeId,
    paymentIntentId,
    driveStatus,
    memo: driveMemo,
  });

  GmailApp.sendEmail(CONFIG.adminEmail, '【AI LIFE ACADEMY】返金者の会員権限を削除しました',
    `以下のメールアドレスを会員コンテンツから削除しました。\n\n${purchaser.email}\n\nStripeイベントID: ${event.id}\nDrive権限: ${driveStatus}${driveMemo ? `\n${driveMemo}` : ''}`,
    { name: CONFIG.senderName }
  );

  logRow_({
    status: 'REFUNDED',
    name: purchaser.name,
    email: purchaser.email,
    eventId: event.id,
    eventType: event.type,
    chargeId,
    paymentIntentId,
    driveStatus,
    mailStatus: '運営へ通知済み',
    memo: driveMemo,
  });

  return json_({ ok: true, removed: true, email: purchaser.email });
}

function fetchStripeEvent_(eventId) {
  if (!eventId) throw new Error('StripeイベントIDがありません。');

  const secretKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  if (!secretKey) throw new Error('Script PropertiesにSTRIPE_SECRET_KEYが設定されていません。');

  const response = UrlFetchApp.fetch(`https://api.stripe.com/v1/events/${encodeURIComponent(eventId)}`, {
    method: 'get',
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`Stripeイベント確認に失敗しました。status=${status} body=${body}`);
  }

  return JSON.parse(body);
}

function buildMemberWelcomeMail_(data) {
  return `${data.name} 様

この度は、AI LIFE ACADEMYへお申し込みいただきありがとうございます。
決済が確認できましたので、会員コンテンツの閲覧権限を付与しました。

━━━━━━━━━━━━━━━━━━
会員コンテンツ
━━━━━━━━━━━━━━━━━━

以下のURLからアクセスしてください。
${data.memberFolderUrl}

まずは「00_本コンテンツの使い方」から読み進めてください。
その後、以下の順番で学習するとスムーズです。

1. 01_AI初心者
2. 02_AI活用
3. 03_実践・ビジネス
4. 04_上級・事業化
5. 05_プロンプト集
6. 06_テンプレート配布
7. 07_Zoomアーカイブ

閲覧には、決済時に登録したGoogleアカウントでのログインが必要です。
アクセスできない場合は、このメールにそのまま返信してください。

あいらいふ運営事務局`;
}

function getOrCreateSheet_() {
  const spreadsheet = getOrCreateSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(CONFIG.sheetName) || spreadsheet.insertSheet(CONFIG.sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getOrCreateSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('PURCHASER_SPREADSHEET_ID');

  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  const spreadsheet = SpreadsheetApp.create(CONFIG.spreadsheetName);
  properties.setProperty('PURCHASER_SPREADSHEET_ID', spreadsheet.getId());

  GmailApp.sendEmail(CONFIG.adminEmail, '【AI LIFE ACADEMY】購入者管理シートを作成しました',
    `購入者管理シートを作成しました。\n\n${spreadsheet.getUrl()}`,
    { name: CONFIG.senderName }
  );

  return spreadsheet;
}

function logRow_(data) {
  const sheet = getOrCreateSheet_();
  sheet.appendRow([
    new Date(),
    data.status || '',
    data.name || '',
    data.email || '',
    data.eventId || '',
    data.eventType || '',
    data.checkoutSessionId || '',
    data.paymentIntentId || '',
    data.chargeId || '',
    data.amount || '',
    data.currency || '',
    data.driveStatus || '',
    data.mailStatus || '',
    data.memo || '',
  ]);
}

function hasProcessedEvent_(sheet, eventId) {
  if (!eventId || sheet.getLastRow() <= 1) return false;

  const eventIdColumn = HEADERS.indexOf('StripeイベントID') + 1;
  const values = sheet.getRange(2, eventIdColumn, sheet.getLastRow() - 1, 1).getValues().flat();
  return values.includes(eventId);
}

function markPurchaserRefunded_(sheet, purchaser, refundData) {
  const rowNumber = purchaser.rowNumber;
  if (!rowNumber) return;

  const indexes = {
    status: HEADERS.indexOf('ステータス') + 1,
    eventType: HEADERS.indexOf('Stripeイベント種別') + 1,
    chargeId: HEADERS.indexOf('Charge ID') + 1,
    paymentIntentId: HEADERS.indexOf('Payment Intent ID') + 1,
    driveStatus: HEADERS.indexOf('Drive権限') + 1,
    mailStatus: HEADERS.indexOf('メール送信') + 1,
    memo: HEADERS.indexOf('メモ') + 1,
  };

  sheet.getRange(rowNumber, indexes.status).setValue('REFUNDED');
  sheet.getRange(rowNumber, indexes.eventType).setValue(refundData.eventType);
  if (refundData.chargeId) sheet.getRange(rowNumber, indexes.chargeId).setValue(refundData.chargeId);
  if (refundData.paymentIntentId) sheet.getRange(rowNumber, indexes.paymentIntentId).setValue(refundData.paymentIntentId);
  sheet.getRange(rowNumber, indexes.driveStatus).setValue(refundData.driveStatus || '削除済み');
  sheet.getRange(rowNumber, indexes.mailStatus).setValue('運営へ通知済み');
  sheet.getRange(rowNumber, indexes.memo).setValue(
    `返金済み / 返金イベントID: ${refundData.refundEventId}${refundData.memo ? ` / ${refundData.memo}` : ''}`
  );
  sheet.getRange(rowNumber, 1, 1, HEADERS.length).setBackground(ROW_COLORS.refunded);
}

function findPurchaserForRefund_(sheet, data) {
  if (sheet.getLastRow() <= 1) return {};

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
  const indexes = {
    name: HEADERS.indexOf('氏名'),
    email: HEADERS.indexOf('メールアドレス'),
    paymentIntentId: HEADERS.indexOf('Payment Intent ID'),
    chargeId: HEADERS.indexOf('Charge ID'),
  };

  const rowIndex = values.findIndex((item) => {
    return (
      data.paymentIntentId && item[indexes.paymentIntentId] === data.paymentIntentId ||
      data.chargeId && item[indexes.chargeId] === data.chargeId ||
      data.email && normalizeEmail_(item[indexes.email]) === data.email
    );
  });

  if (rowIndex === -1) {
    return data.email ? { email: data.email, name: '' } : {};
  }

  const row = values[rowIndex];
  return {
    name: row[indexes.name],
    email: normalizeEmail_(row[indexes.email]),
    rowNumber: rowIndex + 2,
  };
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
