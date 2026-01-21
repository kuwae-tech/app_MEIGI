-- 名義SPOT管理 - Supabase schema

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz default now()
);

create table if not exists allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor',
  created_at timestamptz default now()
);

create table if not exists station_data (
  station text primary key,
  records_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists locks (
  station text not null,
  record_id text not null,
  locked_by uuid not null,
  locked_by_name text not null,
  locked_until timestamptz not null,
  updated_at timestamptz default now(),
  primary key (station, record_id)
);

create table if not exists daily_keepalive_log (
  id bigserial primary key,
  ran_at timestamptz default now(),
  note text default 'daily keepalive'
);

alter table profiles enable row level security;
alter table allowed_users enable row level security;
alter table station_data enable row level security;
alter table locks enable row level security;
alter table daily_keepalive_log enable row level security;

-- profiles
create policy "profiles_select_self_or_allowed" on profiles
  for select
  using (
    auth.uid() = user_id
    or exists (select 1 from allowed_users au where au.user_id = auth.uid())
  );

create policy "profiles_insert_self" on profiles
  for insert
  with check (auth.uid() = user_id);

create policy "profiles_update_self" on profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- allowed_users (self-check only)
create policy "allowed_users_select_self" on allowed_users
  for select
  using (auth.uid() = user_id);

-- station_data
create policy "station_data_select_allowed" on station_data
  for select
  using (exists (select 1 from allowed_users au where au.user_id = auth.uid()));

create policy "station_data_insert_editor" on station_data
  for insert
  with check (
    exists (
      select 1 from allowed_users au
      where au.user_id = auth.uid()
        and au.role in ('editor', 'admin')
    )
  );

create policy "station_data_update_editor" on station_data
  for update
  using (
    exists (
      select 1 from allowed_users au
      where au.user_id = auth.uid()
        and au.role in ('editor', 'admin')
    )
  )
  with check (
    exists (
      select 1 from allowed_users au
      where au.user_id = auth.uid()
        and au.role in ('editor', 'admin')
    )
  );

-- locks
create policy "locks_select_allowed" on locks
  for select
  using (exists (select 1 from allowed_users au where au.user_id = auth.uid()));

create policy "locks_insert_allowed" on locks
  for insert
  with check (exists (select 1 from allowed_users au where au.user_id = auth.uid()));

create policy "locks_update_owner_or_expired" on locks
  for update
  using (
    locked_by = auth.uid()
    or locked_until < now()
  )
  with check (locked_by = auth.uid());

-- daily_keepalive_log (no client access)
create policy "keepalive_select_none" on daily_keepalive_log
  for select using (false);
