-- Keep a minimal deletion marker instead of hard-deleting a synced parcel.
-- This prevents an older offline device from recreating a parcel after a user
-- removes it elsewhere. Tombstones contain only a tracking number and times.
alter table public.parcels
  add column if not exists deleted_at timestamptz;

comment on column public.parcels.deleted_at is
  'A user-owned sync tombstone. A non-null value hides the parcel in the dashboard so stale devices cannot resurrect it.';

create index if not exists parcels_user_id_updated_at_idx
  on public.parcels (user_id, updated_at desc);

create index if not exists parcels_user_id_deleted_at_idx
  on public.parcels (user_id, deleted_at)
  where deleted_at is not null;
