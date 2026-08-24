-- iPhone Shortcuts inbound webhook configuration.
--
-- This table deliberately stores only a one-way hash of a random per-account
-- shortcut key. It never stores raw SMS/iMessage content, a device ID, or the
-- key itself. The Edge Function is the only caller with table privileges.

create table public.iphone_shortcut_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  secret_hash text not null unique,
  secret_hint text not null,
  status text not null default 'active',
  last_used_at timestamptz,
  rate_window_started_at timestamptz,
  rate_request_count integer not null default 0,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iphone_shortcut_connections_secret_hash_valid
    check (secret_hash ~ '^[a-f0-9]{64}$'),
  constraint iphone_shortcut_connections_secret_hint_valid
    check (secret_hint ~ '^[A-Za-z0-9_-]{6}$'),
  constraint iphone_shortcut_connections_status_valid
    check (status in ('active', 'revoked')),
  constraint iphone_shortcut_connections_rate_valid
    check (rate_request_count between 0 and 20)
);

comment on table public.iphone_shortcut_connections is
  'One status record per account for the iPhone Shortcuts webhook. Only a SHA-256 hash and six-character hint of the random key are retained; no SMS/iMessage content or device identifier is stored.';

alter table public.iphone_shortcut_connections enable row level security;

-- Configuration is returned through an authenticated Edge Function as a
-- purpose-built, safe response. Browser table access would unnecessarily
-- expose the hash and rate-limit bookkeeping fields.
revoke all on table public.iphone_shortcut_connections from anon, authenticated;
grant all on table public.iphone_shortcut_connections to service_role;

create trigger iphone_shortcut_connections_set_updated_at
  before update on public.iphone_shortcut_connections
  for each row execute function public.set_updated_at();


