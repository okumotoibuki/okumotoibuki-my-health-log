# My Health Log（自分専用 PWA）

オーナー本人だけが使う健康・トレーニング記録アプリ。睡眠・体重・食事（写真/kcal/PFC）・筋トレ・ゴルフスコアを日付ごとに記録し、AI チャットで入力とアドバイスを行う。

## 構成
```
public/            静的ファイル（ビルドなし。Vercel の outputDirectory）
  index.html       画面の骨組み（ログイン / ホーム / チャット / 編集シート）
  styles.css       デザイン（下の「デザインルール」を崩さない）
  js/app.js        画面ロジック（描画・イベント・編集シート・チャット）
  js/api.js        セッション保持とトークン更新つきの API 呼び出し
  js/util.js       日付・書式・SVG チャート（DOM に触らない純粋関数）
  sw.js            Service Worker（アプリ本体はキャッシュ、記録はネット優先で閲覧のみオフライン可）
  manifest.webmanifest, icons/
api/               Vercel Functions（Node 20+, ESM）
  auth.js          メールのワンタイムコードでログイン（send / verify / refresh / logout）
  chat.js          GET 履歴 / POST 送信（AI → 検証 → DB 保存）/ DELETE 履歴削除
  logs.js          GET 期間の記録（+ ゴルフ全履歴）
  records.js       PATCH / DELETE 記録の編集・削除
  health.js        設定が揃っているか
  _lib/            共通処理（_ で始まるのでルートにならない）
    validate.js    入力の検証・正規化（AI 出力もユーザー編集も必ずここを通す）
    data.js        DB・Storage の読み書き、AI 用 context の組み立て
    supabase.js    本人トークンでの接続とオーナー判定
    ai.js          SYSTEM プロンプトと Gateway 呼び出し
supabase/migrations/  スキーマ（RLS・Storage ポリシー込み）
tests/             node:test の単体テスト（npm test）
scripts/mock-server.js  Supabase / AI なしで画面を確認するモック
```

## 設計の要点（変えるときは理由を持って）
- **service role キーは使わない**。API はユーザー本人のアクセストークンで Supabase に接続し、RLS（`auth.uid() = user_id`）で守る。キーが漏れても被害が本人のデータに閉じる。
- **オーナー以外は通さない**: `OWNER_EMAIL` 以外にはコードを送らず、トークン検証後もメールを突き合わせる（`requireUser`）。
- **ログインはメールの 6 桁コード**。iOS のホーム画面 PWA は Safari とストレージが別なので、マジックリンク方式だと PWA 側にログインが残らない。
- **AI は tool calling ではなく `response_format: json_object`**（Chat Completions では関数呼び出しが reasoning_effort=none でしか使えないため）。AI の出力は信用せず、`normalizeRecords` で範囲・部位・日付（未来日禁止・JST 基準）を検証してから保存する。
- **「今日」はサーバーが `APP_TIMEZONE`（既定 Asia/Tokyo）で決める**。Vercel は UTC で動くので `new Date()` の日付をそのまま使わない（`todayIn()`）。
- **AI に渡す context はサーバーが DB から組み立てる**（クライアントの申告は使わない）。
- **写真**: 非公開バケット `photos`、パス `<user_id>/<date>/<uuid>.<ext>`、表示は署名付き URL（6 時間）。行を消すとき、他の行が参照していなければファイルも消す（`removeIfOrphan`）。
- **描画は innerHTML**。ユーザー・AI 由来の文字列は必ず `esc()` を通す。CSP で `script-src 'self'` にしてあるのでインラインスクリプトは書かない。
- **オフライン時は閲覧のみ**。送信に失敗したメッセージは「再送」ボタンを出す（端末内で勝手に記録しない）。

## スキーマを変えるとき
Record の形を変える場合は **SYSTEM プロンプト（api/_lib/ai.js）・`normalizeRecords`・`saveRecords`・`loadDays`・画面の描画** をまとめて更新し、`supabase/migrations/` に新しいファイルを足す（既存ファイルは書き換えない）。

## デザインルール（崩さないこと）
- iOS（ヘルスケア/メッセージ）の作法に準拠：システムフォント、背景 #F2F2F7 にグループ化された白カード（radius 12）、ラージタイトル＋スクロールで出るコンパクトナビ、すりガラスのタブバー、セグメントコントロール、ボトムシート
- 色は `:root` の CSS 変数のみ使用（--sleep, --weight, --food, --train, --golf, --p/--f/--c）。ダークモードは prefers-color-scheme で自動
- 数値は `--rounded`（ui-rounded）と tabular-nums
- 最大幅 430px、safe-area（env(safe-area-inset-*)）対応

## リリース時
- `public/sw.js` の `VERSION` を上げる（上げないと端末に古いアプリ本体が残る）
- `public/js/app.js` の `APP_VERSION` を合わせる
- `npm run check`（構文チェック + テスト）が通ること

## 開発
```bash
npm install
npm run check                 # 構文チェック + 単体テスト
node scripts/mock-server.js   # http://localhost:4173 （ログインコード 000000）
vercel dev                    # 本物の Supabase / AI につないで動かす（.env.local が必要）
```
