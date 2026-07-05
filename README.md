# あいらいふ（AI LIFE）

GitHub Pagesでそのまま公開できる静的ホームページです。

## 公開方法

1. このフォルダの中身をGitHubリポジトリへ入れる
2. GitHubの `Settings > Pages` を開く
3. `Deploy from a branch` を選ぶ
4. `main` ブランチの `/root` を選ぶ
5. 表示されたURLを開く

## 予約導線

- `index.html` の「無料説明会に参加する」は `booking.html` に接続済みです。
- `booking.html` は予約フォームとして使えます。
- 現在はGoogleフォーム経由で、予約内容をGoogleスプレッドシートに自動保存します。
- Googleフォーム側で「新しい回答についてのメール通知」をオンにしているため、新規予約の通知も届きます。

## 差し替える場所

- `booking-slots.js` の空き日程
- `booking.html` のGoogleフォーム送信先URL
- `script.js` のZoom URL
- 決済リンクを作ったら、説明会後の案内文や申込ボタン
- サービス名は `あいらいふ（AI LIFE）` に設定しています。

## 予約日程の追加方法

予約ページの日程は `booking-slots.js` だけを編集します。

1週間分を追加したいときは、下のようなブロックをコピーして、日付と時間を変えて追加します。

```js
{
  label: "8月1日（土）〜8月7日（金）",
  slots: [
    { date: "8月1日（土）", time: "20:00〜21:00", note: "オンラインZoom説明会" },
    { date: "8月3日（月）", time: "21:00〜22:00", note: "オンラインZoom説明会" },
    { date: "8月5日（水）", time: "20:00〜21:00", note: "オンラインZoom説明会" },
  ],
},
```

保存後にGitHubへ反映すると、同じ公開URLの予約ページが更新されます。

## 費用

GitHub Pagesの無料URLを使う場合、維持費は0円です。
独自ドメインを使う場合だけ、ドメイン費用が別途かかります。

## 会員コンテンツの自動付与

決済後に購入者へ会員コンテンツを自動案内する仕組みは、`automation/stripe-member-access.gs` に用意しています。

想定フロー:

1. Stripe Payment Linksで決済
2. Stripe WebhookがApps Scriptへ決済完了を通知
3. Apps ScriptがGoogle Driveの会員コンテンツフォルダへ閲覧権限を付与
4. 購入者へ会員コンテンツURL入りの案内メールを送信
5. 返金イベントを受け取った場合は閲覧権限を削除

設定手順は `automation/stripe-member-access-README.md` を確認してください。
