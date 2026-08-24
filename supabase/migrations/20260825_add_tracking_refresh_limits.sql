-- Service-role-only usage ledger for the personal SmartTracker connection.
-- It deliberately stores parcel IDs rather than provider responses, recipient
-- information, delivery events, or raw request payloads.
create table public.tracking_refresh_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  parcel_id uuid not null references public.parcels (id) on delete cascade,
  usage_day date not null,
  request_count integer not null default 0,
  last_requested_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, parcel_id, usage_day),
  constraint tracking_refresh_usage_request_count_valid
    check (request_count between 0 and 10)
);

comment on table public.tracking_refresh_usage is
  'Private ledger used only by the tracking-status Edge Function to enforce manual SmartTracker refresh limits. No provider response or delivery PII is stored.';

alter table public.tracking_refresh_usage enable row level security;

revoke all on table public.tracking_refresh_usage from anon, authenticated;
grant all on table public.tracking_refresh_usage to service_role;

-- Atomically reserves one upstream call. A single monthly lock makes the
-- 100-distinct-invoice free-plan cap safe across multiple tabs, while the row
-- lock enforces 10 calls per parcel per UTC day and a short anti-burst delay.
create function public.consume_tracking_refresh_slot(p_user_id uuid, p_parcel_id uuid)
returns table (allowed boolean, error_code text)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_today date;
  v_month_start date;
  v_seen_this_month boolean;
  v_distinct_invoice_count bigint;
  v_request_count integer;
  v_last_requested_at timestamptz;
begin
  if p_user_id is null or p_parcel_id is null then
    return query select false, 'temporary_failure'::text;
    return;
  end if;

  v_now := pg_catalog.now();
  v_today := (v_now at time zone 'UTC')::date;
  v_month_start := pg_catalog.date_trunc('month', v_now at time zone 'UTC')::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || v_month_start::text, 0)
  );

  select exists(
    select 1
    from public.tracking_refresh_usage
    where user_id = p_user_id
      and parcel_id = p_parcel_id
      and usage_day >= v_month_start
  ) into v_seen_this_month;

  if not v_seen_this_month then
    select count(distinct parcel_id)
    into v_distinct_invoice_count
    from public.tracking_refresh_usage
    where user_id = p_user_id
      and usage_day >= v_month_start;

    if v_distinct_invoice_count >= 100 then
      return query select false, 'usage_exhausted'::text;
      return;
    end if;
  end if;

  insert into public.tracking_refresh_usage (user_id, parcel_id, usage_day)
  values (p_user_id, p_parcel_id, v_today)
  on conflict (user_id, parcel_id, usage_day) do nothing;

  select request_count, last_requested_at
  into v_request_count, v_last_requested_at
  from public.tracking_refresh_usage
  where user_id = p_user_id
    and parcel_id = p_parcel_id
    and usage_day = v_today
  for update;

  if v_last_requested_at is not null and v_last_requested_at > v_now - interval '45 seconds' then
    return query select false, 'refresh_limited'::text;
    return;
  end if;

  if v_request_count >= 10 then
    return query select false, 'refresh_limited'::text;
    return;
  end if;

  update public.tracking_refresh_usage
  set request_count = v_request_count + 1,
      last_requested_at = v_now
  where user_id = p_user_id
    and parcel_id = p_parcel_id
    and usage_day = v_today;

  return query select true, null::text;
end;
$$;

revoke all on function public.consume_tracking_refresh_slot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_tracking_refresh_slot(uuid, uuid) to service_role;

