# Supabase セットアップ（最小構成）

以下の SQL を Supabase の SQL Editor で実行してください。すでにテーブルがある場合も壊さないように idempotent にしています。

## ユーザー招待（Authentication → Users）

ログインは「メール」または「ログインID」に対応しています。Supabase Dashboard の Authentication → Users → Add user で作成してください。

- **メールログインの場合**: 実際のメールアドレスで Add user を作成します。
- **ログインIDの場合**: `ログインID@meigi.local` の形式で Add user を作成します。
  - `meigi.local` はアプリ側の疑似メール用ドメインの初期値です（変更する場合はアプリ設定側で調整します）。

ユーザーへ渡す情報は「ログインID（またはメール）」＋「パスワード」です。

> **注意**: ログインID運用の場合、実メールを使わないためパスワードリセットのメール送信は使えません。管理者がパスワード再発行またはユーザー再作成で対応してください。

```sql
-- station_data の最小セットアップ（idempotent）
create table if not exists public.station_data (
  station text,
  records_json jsonb,
  updated_at timestamptz,
  updated_by uuid
);

alter table public.station_data
  add column if not exists station text,
  add column if not exists records_json jsonb,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'station_data_pkey'
  ) then
    alter table public.station_data
      add constraint station_data_pkey primary key (station);
  end if;
end $$;

alter table public.station_data enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'station_data'
      and policyname = 'station_data_authenticated'
  ) then
    create policy station_data_authenticated
      on public.station_data
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;
```
