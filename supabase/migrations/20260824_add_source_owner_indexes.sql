-- Cover the composite ownership foreign keys used by server-side mail imports.
-- These stay useful even when the source tables are initially empty.
create index mail_imports_connection_owner_idx
  on public.mail_imports (connection_id, user_id)
  where connection_id is not null;

create index parcels_import_owner_idx
  on public.parcels (source_import_id, user_id)
  where source_import_id is not null;
