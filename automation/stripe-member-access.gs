const CONFIG = {
  adminEmail: 'rakuichi644@gmail.com',
  senderName: 'あいらいふ運営事務局',
  productName: 'AI LIFE ACADEMY',
  memberSiteUrl: 'https://ai-life-roadmap.s8138.chatgpt.site/login',
  supabaseUrl: 'https://hahdvhvvasefphriviga.supabase.co',
  spreadsheetName: 'AI LIFE ACADEMY_購入者管理',
  purchaserSpreadsheetId: '1zRcSUefAtjQrFqC_wxJUChL90-2ffqXNhTHM7Y6F7ow',
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
  '簡易サイトURL',
  'ユーザー名',
  'パスワード',
  'Supabase User ID',
  'アカウント状態',
  'メール送信',
  '購入者ステータス',
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

  const credentials = createMemberAccount_({ name, customerEmail: email });

  GmailApp.sendEmail(email, `【${CONFIG.productName}】会員サイトのログイン情報`, buildMemberWelcomeMail_({
    name,
    memberSiteUrl: CONFIG.memberSiteUrl,
    username: credentials.username,
    password: credentials.password,
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
    memberSiteUrl: CONFIG.memberSiteUrl,
    username: credentials.username,
    password: credentials.password,
    supabaseUserId: credentials.userId,
    accountStatus: credentials.mode === 'shared' ? '共通ログイン案内' : '有効',
    mailStatus: '送信済み',
    purchaserStatus: '決済済み',
    memo: credentials.mode === 'shared'
      ? 'Supabase自動発行設定が未完了のため、Script Propertiesの共通ログインを案内しました。'
      : '',
  });

  return json_({ ok: true, granted: true, email });
}

function handleRefund_(event) {
  const refundObject = event.data.object;
  const chargeId = refundObject.object === 'charge' ? refundObject.id : refundObject.charge;
  const paymentIntentId = refundObject.payment_intent || '';
  const sheet = getOrCreateSheet_();

  if (hasProcessedEvent_(sheet, event.id)) {
    return json_({ ok: true, duplicated: true });
  }

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
    GmailApp.sendEmail(CONFIG.adminEmail, '【AI LIFE ACADEMY】返金者のアカウント停止確認が必要です',
      `返金イベントを受信しましたが、メールアドレスを特定できませんでした。\n\nStripeイベントID: ${event.id}\nCharge ID: ${chargeId || '不明'}\nPayment Intent ID: ${paymentIntentId || '不明'}\n\nStripe管理画面で購入者を確認し、Supabaseの会員アカウントを手動で停止してください。`,
      { name: CONFIG.senderName }
    );
    return json_({ ok: true, needsCheck: true });
  }

  if (purchaser.status === 'REFUNDED') {
    logRow_({
      status: 'REFUND_DUPLICATED',
      name: purchaser.name,
      email: purchaser.email,
      eventId: event.id,
      eventType: event.type,
      chargeId,
      paymentIntentId,
      accountStatus: '処理済み',
      mailStatus: '送信なし',
      purchaserStatus: '返金済み',
      memo: 'すでに返金・権限削除済みのため、重複通知を停止しました。',
    });
    return json_({ ok: true, alreadyRefunded: true, email: purchaser.email });
  }

  let accountStatus = '停止済み';
  let accountMemo = '';
  try {
    if (purchaser.supabaseUserId) deleteMemberAccount_(purchaser.supabaseUserId);
  } catch (error) {
    accountStatus = '停止要確認';
    accountMemo = `Supabaseアカウント停止時の注意: ${error.message}`;
  }

  markPurchaserRefunded_(sheet, purchaser, {
    refundEventId: event.id,
    eventType: event.type,
    chargeId,
    paymentIntentId,
    accountStatus,
    memo: accountMemo,
  });

  GmailApp.sendEmail(CONFIG.adminEmail, '【AI LIFE ACADEMY】返金者の会員権限を削除しました',
    `以下の購入者アカウントを停止しました。\n\n${purchaser.email}\nユーザー名: ${purchaser.username || '不明'}\n\nStripeイベントID: ${event.id}\nアカウント状態: ${accountStatus}${accountMemo ? `\n${accountMemo}` : ''}`,
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
    username: purchaser.username,
    supabaseUserId: purchaser.supabaseUserId,
    accountStatus,
    mailStatus: '運営へ通知済み',
    purchaserStatus: '返金済み',
    memo: accountMemo,
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

function createMemberAccount_(data) {
  const serviceRoleKey = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return getSharedMemberCredentials_();

  const username = generateUsername_();
  const password = generatePassword_();
  const authEmail = `${username.toLowerCase()}@ai-life.local`;
  const response = UrlFetchApp.fetch(`${CONFIG.supabaseUrl}/auth/v1/admin/users`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    payload: JSON.stringify({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        customer_email: data.customerEmail,
        customer_name: data.name,
      },
    }),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`会員アカウント作成に失敗しました。status=${status} body=${body}`);
  }
  const user = JSON.parse(body);
  return { username, password, userId: user.id, mode: 'individual' };
}

function getSharedMemberCredentials_() {
  const properties = PropertiesService.getScriptProperties();
  const username = properties.getProperty('SHARED_MEMBER_USERNAME');
  const password = properties.getProperty('SHARED_MEMBER_PASSWORD');

  if (!username || !password) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY未設定です。個別ログインを自動発行できない場合は、Script PropertiesにSHARED_MEMBER_USERNAMEとSHARED_MEMBER_PASSWORDを設定してください。');
  }

  return { username, password, userId: '', mode: 'shared' };
}

function deleteMemberAccount_(userId) {
  const serviceRoleKey = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) throw new Error('Script PropertiesにSUPABASE_SERVICE_ROLE_KEYが設定されていません。');
  const response = UrlFetchApp.fetch(`${CONFIG.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'delete',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(`会員アカウント停止に失敗しました。status=${status}`);
}

function generateUsername_() {
  return `AIL${Utilities.getUuid().replace(/-/g, '').slice(0, 9).toUpperCase()}`;
}

function generatePassword_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let value = '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${Utilities.getUuid()}${Date.now()}`);
  for (let i = 0; i < 14; i += 1) value += chars.charAt((bytes[i] + 256) % chars.length);
  return value;
}

function buildMemberWelcomeMail_(data) {
  return `${data.name} 様

この度は、AI LIFE ACADEMYへお申し込みいただきありがとうございます。
決済が確認できましたので、専用のログイン情報を発行しました。

━━━━━━━━━━━━━━━━━━
会員サイト
━━━━━━━━━━━━━━━━━━

以下のURLからアクセスしてください。
URL: ${data.memberSiteUrl}
ユーザー名: ${data.username}
パスワード: ${data.password}

まずは「00_本コンテンツの使い方」から読み進めてください。
その後、以下の順番で学習するとスムーズです。

1. 第1章 AI活用ロードマップ
2. 第2章 自分専用プロンプト集
3. 第3章 仕事テンプレ・AIワークフロー
4. 第4章 AI秘書・AI社員設計
5. 第5章 Codex実践マニュアル
6. 第7章 Instagram投稿10本作成
7. 第8章 AIショート動画制作
8. 第9章 AI商品完成スタジオ
9. 第10章 専用アプリ設計ツール
10. 第12章 AI COMPANY OS

ユーザー名とパスワードはお客様専用です。第三者へ共有しないでください。
ログインできない場合は、このメールにそのまま返信してください。

あいらいふ運営事務局`;
}

function getOrCreateSheet_() {
  const spreadsheet = getOrCreateSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(CONFIG.sheetName) || spreadsheet.insertSheet(CONFIG.sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    ensureHeaders_(sheet);
  }

  return sheet;
}

function getOrCreateSpreadsheet_() {
  if (CONFIG.purchaserSpreadsheetId) {
    return SpreadsheetApp.openById(CONFIG.purchaserSpreadsheetId);
  }
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
    data.memberSiteUrl || '',
    data.username || '',
    data.password || '',
    data.supabaseUserId || '',
    data.accountStatus || '',
	    data.mailStatus || '',
	    data.purchaserStatus || '',
	    data.memo || '',
	  ]);
}

function ensureHeaders_(sheet) {
  const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (existingHeaders.includes('Drive権限') && !existingHeaders.includes('簡易サイトURL')) {
    sheet.insertColumnsAfter(11, 5);
    sheet.getRange(1, 12, 1, 5).setValues([HEADERS.slice(11, 16)]);
    sheet.deleteColumn(17);
  }
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues()[0];
  HEADERS.forEach((header) => {
    if (!current.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
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
    accountStatus: HEADERS.indexOf('アカウント状態') + 1,
    mailStatus: HEADERS.indexOf('メール送信') + 1,
    purchaserStatus: HEADERS.indexOf('購入者ステータス') + 1,
    memo: HEADERS.indexOf('メモ') + 1,
  };

  sheet.getRange(rowNumber, indexes.status).setValue('REFUNDED');
  sheet.getRange(rowNumber, indexes.eventType).setValue(refundData.eventType);
  if (refundData.chargeId) sheet.getRange(rowNumber, indexes.chargeId).setValue(refundData.chargeId);
  if (refundData.paymentIntentId) sheet.getRange(rowNumber, indexes.paymentIntentId).setValue(refundData.paymentIntentId);
  sheet.getRange(rowNumber, indexes.accountStatus).setValue(refundData.accountStatus || '停止済み');
  sheet.getRange(rowNumber, indexes.mailStatus).setValue('運営へ通知済み');
  sheet.getRange(rowNumber, indexes.purchaserStatus).setValue('返金済み');
  sheet.getRange(rowNumber, indexes.memo).setValue(
    `返金済み / 返金イベントID: ${refundData.refundEventId}${refundData.memo ? ` / ${refundData.memo}` : ''}`
  );
  sheet.getRange(rowNumber, 1, 1, HEADERS.length).setBackground(ROW_COLORS.refunded);
}

function findPurchaserForRefund_(sheet, data) {
  if (sheet.getLastRow() <= 1) return {};

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
  const indexes = {
    status: HEADERS.indexOf('ステータス'),
    name: HEADERS.indexOf('氏名'),
    email: HEADERS.indexOf('メールアドレス'),
    paymentIntentId: HEADERS.indexOf('Payment Intent ID'),
    chargeId: HEADERS.indexOf('Charge ID'),
    username: HEADERS.indexOf('ユーザー名'),
    supabaseUserId: HEADERS.indexOf('Supabase User ID'),
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
    status: row[indexes.status],
    name: row[indexes.name],
    email: normalizeEmail_(row[indexes.email]),
    username: row[indexes.username],
    supabaseUserId: row[indexes.supabaseUserId],
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
