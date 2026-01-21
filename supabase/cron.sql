-- Enable pg_cron (requires Supabase project setting)
create extension if not exists pg_cron;

create or replace function public.insert_daily_keepalive()
returns void
language plpgsql
as $$
begin
  insert into daily_keepalive_log (note) values ('daily keepalive');
end;
$$;

-- Schedule daily at 00:00 UTC
select cron.schedule(
  'daily-keepalive',
  '0 0 * * *',
  $$select public.insert_daily_keepalive();$$
);

-- Verify latest runs
select * from cron.job_run_details order by start_time desc limit 20;
