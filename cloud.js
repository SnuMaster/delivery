import { SUPABASE_CONFIG } from './supabase-config.js?v=20260824-auth-mail-4';

let clientPromise;

export const cloudEnabled = Boolean(
  SUPABASE_CONFIG.url
  && SUPABASE_CONFIG.publishableKey,
);

/**
 * Loads the official browser client only when an account feature is used. The
 * main local-first tracker stays usable if the CDN is temporarily unavailable.
 */
export async function getSupabaseClient() {
  if (!cloudEnabled) return null;
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2.97.0')
      .then(({ createClient }) => createClient(
        SUPABASE_CONFIG.url,
        SUPABASE_CONFIG.publishableKey,
        {
          auth: {
            autoRefreshToken: true,
            detectSessionInUrl: true,
            persistSession: true,
            storageKey: 'parcel-hub.auth.v1',
          },
        },
      ));
  }
  return clientPromise;
}

export function rowToParcel(row) {
  return {
    id: String(row.id),
    tracking: String(row.tracking_number),
    carrier: row.carrier_code === 'unknown' ? '' : (row.carrier_code || ''),
    carrierOrigin: row.carrier_origin || 'manual',
    memo: row.memo || '',
    managementStatus: row.management_status === 'received' ? 'received' : 'needs-check',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deleted rows remain as tiny tombstones so a removal made on one device does
 * not get recreated from an offline copy on another device. They contain only
 * the tracking number and timestamps, never message or account credentials.
 */
export function rowToTombstone(row) {
  return {
    tracking: String(row.tracking_number),
    deletedAt: row.deleted_at || row.updated_at,
    updatedAt: row.updated_at || row.deleted_at,
  };
}

export function parcelToRow(item, userId) {
  const carrierOrigin = ['manual', 'context', 'format', 'imported'].includes(item.carrierOrigin)
    ? item.carrierOrigin
    : 'imported';
  return {
    user_id: userId,
    tracking_number: item.tracking,
    carrier_code: item.carrier || 'unknown',
    carrier_origin: carrierOrigin,
    memo: item.memo || '',
    management_status: item.managementStatus === 'received' ? 'received' : 'needs_check',
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: null,
  };
}

export function tombstoneToRow(item, userId) {
  return {
    user_id: userId,
    tracking_number: item.tracking,
    carrier_code: 'unknown',
    carrier_origin: 'manual',
    memo: '',
    management_status: 'needs_check',
    created_at: item.deletedAt,
    updated_at: item.updatedAt || item.deletedAt,
    deleted_at: item.deletedAt,
  };
}

export function isNewer(left, right) {
  return Date.parse(left?.updatedAt || left?.updated_at || 0)
    > Date.parse(right?.updatedAt || right?.updated_at || 0);
}
