-- Keep browser roles denied even if a future table grant is added by mistake.
-- Edge Functions use the server-only service role and bypass this policy.
create policy "tracking_refresh_usage_deny_browser_access"
  on public.tracking_refresh_usage
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- The primary key starts with user_id for rate-limit lookups. This separate
-- index keeps parcel deletion/cascade checks inexpensive as the ledger grows.
create index tracking_refresh_usage_parcel_id_idx
  on public.tracking_refresh_usage (parcel_id);

