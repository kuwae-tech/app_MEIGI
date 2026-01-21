# 名義SPOT管理 セットアップ

## 1. Supabase の準備
1. Supabase プロジェクトを作成し、SQL Editor で `supabase/schema.sql` を実行します。
2. `Project URL` と `anon key` を控えます（`service_role` は使用しません）。

### 招待制 (allowed_users)
招待するユーザーの UUID は Supabase Auth で作成したユーザーから取得します。

```sql
insert into allowed_users (user_id, role)
values ('<user_uuid>', 'editor');
```

`profiles` に `display_name` が未登録の場合、アプリ初回ログイン時に入力します。

## 2. pg_cron (keepalive)
Supabase の設定で `pg_cron` を有効化し、SQL Editor で `supabase/cron.sql` を実行します。

- Free プランで Pause されると cron も停止します。
- 手動復帰後に再開されるため、`cron.job_run_details` を確認してください。

## 3. アプリ設定
`⚙設定` → `共有` タブから以下を設定します。

- Project URL
- anon key
- 共有を有効化
- ログイン（メール + パスワード）

未招待ユーザーは `allowed_users` に存在しないため、ログイン後すぐにログアウトされます。

## 4. 開発用スクリプト
```bash
npm run gen:icons      # assets/icon.png から build/icon.icns / icon.ico 生成
npm run build          # vendor 生成（xlsx + Supabase）
npm run start          # Electron 起動
```

## 5. CI ビルド
GitHub Actions で `npm run build` → `npm run dist` を実行し、macOS/Windows のアーティファクトを生成します。
