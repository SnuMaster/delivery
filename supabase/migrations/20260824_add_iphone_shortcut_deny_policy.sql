-- Keep browser roles denied even if a future table grant is added by mistake.
-- Edge Functions use the server-only service role and bypass this policy.
create policy "iphone_shortcut_connections_deny_browser_access"
  on public.iphone_shortcut_connections
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);


