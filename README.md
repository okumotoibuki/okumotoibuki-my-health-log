# My Health Log

睡眠・体重・食事・筋トレ・ゴルフを記録する、自分専用の PWA。AI チャットに話しかけるか写真を送るだけで記録され、カレンダーとトレンドで振り返れます。

- ホスティング: Vercel（静的ファイル + Functions）
- DB / 認証 / 写真: Supabase（Postgres + Auth + Storage）
- AI: Vercel AI Gateway

## 初回セットアップ

### 1. Supabase
1. プロジェクトを作成（リージョン: Seoul / ap-northeast-2（Vercel の関数も icn1 に合わせてある））
2. SQL Editor で `supabase/migrations/20260928000000_init.sql` を実行
3. **Authentication → Users** で `OWNER_EMAIL` のユーザーを作り、パスワードを設定する（Auto Confirm User を ON）
   - 作り直さずにパスワードだけ変えるときは SQL Editor で
     `update auth.users set encrypted_password = extensions.crypt('<新しいパスワード>', extensions.gen_salt('bf')) where email = '<OWNER_EMAIL>';`
4. **Project Settings → API** から URL と anon（publishable）キーを控える

### 2. Vercel
1. このリポジトリを Import（Framework Preset: Other。ビルド設定は `vercel.json` で指定済み）
2. 環境変数（Production / Preview）
   | 変数 | 必須 | 内容 |
   |---|---|---|
   | `SUPABASE_URL` | ✓ | Supabase の URL |
   | `SUPABASE_ANON_KEY` | ✓ | anon / publishable キー（公開前提のキー。service role キーは不要） |
   | `OWNER_EMAIL` | ✓ | ログインを許可する自分のメールアドレス |
   | `AI_GATEWAY_API_KEY` | | Vercel 上では未設定でも OIDC で Gateway に認証される |
   | `AI_MODEL` | | 既定 `openai/gpt-6-luna` |
   | `APP_TIMEZONE` | | 既定 `Asia/Tokyo` |
3. デプロイ後、`https://<ドメイン>/api/health` が `{"ok":true}` を返すことを確認。`supabase.status` が `invalid_key` なら `SUPABASE_ANON_KEY` の値が違う（`key` にキーの種類と文字数を出すので Supabase の画面と見比べる。publishable キーなら 46 文字）

### 3. 初回ログイン
1. アプリを開き、`OWNER_EMAIL` のアドレスと設定したパスワードでログイン
   - メールアドレスは端末に記憶されます。パスワードは iOS のパスワード管理に保存できます
2. （任意）**Authentication → Sign In / Providers** で「Allow new users to sign up」を OFF にする。
   API は `OWNER_EMAIL` 以外のログインを Supabase に問い合わせずに断り、データ API も本人以外を 403 で弾くので、OFF にしなくても他人は使えません

### 4. iPhone のホーム画面に追加
Safari でアプリを開き、共有 → 「ホーム画面に追加」。ホーム画面から開いた状態で改めてログインしてください（Safari とはログイン状態が別です）。

## API
すべて `Authorization: Bearer <access_token>`（`/api/auth` と `/api/health` を除く）。

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/api/auth` | `{action:'login', email, password}` / `{action:'refresh', refresh_token}` / `{action:'logout'}` |
| GET | `/api/logs?from&to[&golf=1]` | 期間（最大 120 日）の記録。`golf=1` で全ゴルフ履歴も |
| GET | `/api/chat` | 会話履歴（直近 60 件） |
| POST | `/api/chat` | `{message}`（文字列 or `[{type:'text'},{type:'image_url'}]`）→ `{reply, saved, suggestions, dates}` |
| DELETE | `/api/chat` | 会話履歴を消す（記録は残る） |
| PATCH / DELETE | `/api/records` | 記録の編集・削除（`api/records.js` 冒頭参照） |
| GET | `/api/health` | 設定が揃っているか |

## コードレビュー（Codex）
PR を開く・「Ready for review」にすると、Codex の GitHub アプリがレビューしてコメントします（設定は chatgpt.com/codex）。
観点は `AGENTS.md` の「Review guidelines」。PR に `@codex review` とコメントすると再レビューされます。
同じ PR で `CI`（構文チェック + 単体テスト）も走ります。

## 開発
```bash
npm install
npm run check                 # 構文チェック + 単体テスト
node scripts/mock-server.js   # Supabase/AI なしで画面確認（http://localhost:4173・パスワード mock）
vercel dev                    # 本物につないで動かす（.env.example を .env.local にコピーして設定）
```
