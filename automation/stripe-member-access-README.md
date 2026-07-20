# Stripe決済後の会員コンテンツ自動付与

Stripe決済が完了したら、購入者ごとの会員サイト用ユーザー名・パスワードをSupabaseへ発行し、案内メールを自動送信する仕組みです。

## できること

1. Stripe決済完了を受け取る
2. 購入者メールアドレスを取得する
3. Supabaseへ購入者専用アカウントを作成する
4. 購入者へ会員サイトURL・ユーザー名・パスワードを送る
5. スプレッドシートに顧客とログイン情報を記録する
6. 返金イベントを受け取ったら、専用アカウントを停止する

## 前提

- 決済サービスはStripeを想定
- 会員サイト:
  - `https://ai-life-roadmap.s8138.chatgpt.site/login`
- Apps Scriptはスプレッドシートに紐づけて使う
- 購入者に見せたくない管理資料は、購入者向け会員サイトの外に置く

## 初回設定

### 1. Stripeで決済リンクを作る

StripeのPayment Linksで `AI LIFE ACADEMY` の決済リンクを作ります。

- 商品名: `AI LIFE ACADEMY`
- 価格: `220,000円`
- 説明会参加クーポン: `FS20260701`（55,000円OFF / 適用後165,000円）
- 税込表示
- 決済時にメールアドレスを取得

Payment LinksはStripeの管理画面から作れます。

### 2. スプレッドシートを作る

Google Driveで `AI LIFE ACADEMY_購入者管理` というスプレッドシートを作ります。

### 3. Apps Scriptを貼る

1. スプレッドシートを開く
2. `拡張機能` → `Apps Script`
3. `stripe-member-access.gs` の中身を貼り付ける
4. 保存する

### 4. Stripe秘密鍵を設定する

Apps Scriptの左メニューから `プロジェクトの設定` を開き、スクリプト プロパティに以下を追加します。

```text
STRIPE_SECRET_KEY = sk_live_...
STRIPE_WEBHOOK_TOKEN = 任意の長いランダム文字列
SUPABASE_SERVICE_ROLE_KEY = Supabaseのservice_roleキー
```

テスト中は `sk_test_...` を使います。

`STRIPE_WEBHOOK_TOKEN` を設定した場合、StripeのWebhook URLは以下の形にします。

```text
https://script.google.com/macros/s/xxxxx/exec?token=STRIPE_WEBHOOK_TOKENの値
```

Apps ScriptではStripeの `Stripe-Signature` ヘッダーを安定して取得できないため、イベントIDをStripe APIで再取得する確認に加えて、Webhook URL専用トークンで第三者からの直接POSTを防ぎます。

Supabaseの個別ログイン自動発行をまだ使わない場合は、代わりに以下を設定します。

```text
SHARED_MEMBER_USERNAME = AILIFE
SHARED_MEMBER_PASSWORD = 共通パスワード
```

`SUPABASE_SERVICE_ROLE_KEY` がある場合は購入者ごとに個別ログインを自動発行し、未設定の場合は共通ログインを購入者へ案内します。

### 5. Webアプリとしてデプロイ

Apps Script右上の `デプロイ` → `新しいデプロイ` を押します。

```text
種類: ウェブアプリ
実行ユーザー: 自分
アクセスできるユーザー: 全員
```

デプロイ後に表示される `ウェブアプリURL` をコピーします。

### 6. Stripe Webhookに登録する

Stripe管理画面でWebhookエンドポイントを作ります。

登録するURL:

```text
Apps ScriptのウェブアプリURL
```

`STRIPE_WEBHOOK_TOKEN` を設定した場合は、URL末尾に `?token=設定した値` を付けて登録します。

受け取るイベント:

```text
checkout.session.completed
charge.refunded
refund.created
```

`checkout.session.completed` は決済完了、`charge.refunded` / `refund.created` は返金時の権限削除に使います。

## 運営が手動でやること

初回だけ必要です。

- Stripeアカウント作成
- Payment Link作成
- Apps Script貼り付け
- Stripe秘密鍵の設定
- Webhook登録
- 初回のGoogle許可

運用開始後は、基本的に自動です。

ただし、次の場合は手動確認が必要です。

- 購入者が決済時と別のGoogleアカウントで見ようとしている
- 返金イベントからメールアドレスを特定できなかった
- 分割返金や例外対応をした
- 会員サイトのログイン情報を手動で再送する必要がある

## 購入者に届くメール

件名:

```text
【AI LIFE ACADEMY】会員コンテンツのご案内
```

本文には以下が入ります。

- 会員コンテンツURL
- ユーザー名・パスワード
- 学習順序
- アクセスできない時の返信案内

## 注意

共通ログインを使う場合は、購入者全員が同じユーザー名・パスワードで会員サイトへ入ります。
購入者ごとに停止や変更をしたい場合は、Supabaseの個別ログイン自動発行を設定してください。
