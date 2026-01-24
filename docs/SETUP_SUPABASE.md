# Supabase セットアップ（最小構成）

以下の SQL を Supabase の SQL Editor で実行してください。すでにテーブルがある場合も壊さないように idempotent にしています。

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
