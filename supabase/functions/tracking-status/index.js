import { createClient } from 'npm:@supabase/supabase-js@2.97.0';
import {
  isParcelId,
  providerErrorCode,
  sanitizeTrackingInfo,
  sweetTrackerCarrierCode,
} from './tracking-status.js';

const DEFAULT_APP_ORIGIN = 'https://snumaster.github.io';
const MAX_BODY_BYTES = 1024;
const PROVIDER_TIMEOUT_MS = 8000;
const PROVIDER_URL = 'https://info.sweettracker.co.kr/api/v1/trackingInfo';
const RATE_LIMIT_ERRORS = new Set(['usage_exhausted', 'refresh_limited']);

function configuredOrigins() {
  const values = String(Deno.env.get('PARCEL_HUB_ALLOWED_ORIGINS') || DEFAULT_APP_ORIGIN)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === value;
      } catch {
        return false;
      }
    });
  return new Set(values.length ? values : [DEFAULT_APP_ORIGIN]);
}

const ALLOWED_ORIGINS = configuredOrigins();

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin);
}

function response(payload, status = 200, origin = DEFAULT_APP_ORIGIN) {
  const allowedOrigin = isAllowedOrigin(origin) ? origin : DEFAULT_APP_ORIGIN;
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

function emptyResponse(status, origin = DEFAULT_APP_ORIGIN) {
  const allowedOrigin = isAllowedOrigin(origin) ? origin : DEFAULT_APP_ORIGIN;
  return new Response(null, {
    status,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    },
  });
}

function publishableKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
    if (keys.default) return keys.default;
  } catch {
    // Existing projects can use their legacy public key until it is retired.
  }
  return Deno.env.get('SUPABASE_ANON_KEY') || '';
}

function adminKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    if (keys.default) return keys.default;
  } catch {
    // Existing projects can use their legacy server-only key until it is retired.
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') || '', adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireUser(request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const auth = createClient(Deno.env.get('SUPABASE_URL') || '', publishableKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await auth.auth.getUser(authorization.slice('Bearer '.length));
  return error ? null : data.user;
}

async function readPayload(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  let raw;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchProviderTracking(apiKey, providerCarrierCode, trackingNumber) {
  const url = new URL(PROVIDER_URL);
  url.searchParams.set('t_key', apiKey);
  url.searchParams.set('t_code', providerCarrierCode);
  url.searchParams.set('t_invoice', trackingNumber);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    return { ok: false, error: 'provider_unavailable' };
  } finally {
    clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return { ok: false, error: 'provider_unavailable' };
  }
  if (!upstream.ok || payload?.status === false || payload?.code) {
    return { ok: false, error: providerErrorCode(payload, upstream.status) };
  }
  return { ok: true, tracking: sanitizeTrackingInfo(payload) };
}

async function consumeRefreshSlot(database, userId, parcelId) {
  try {
    const { data, error } = await database.rpc('consume_tracking_refresh_slot', {
      p_user_id: userId,
      p_parcel_id: parcelId,
    });
    if (error || !Array.isArray(data) || !data[0]) return { ok: false, error: 'temporary_failure' };
    if (data[0].allowed === true) return { ok: true };
    const errorCode = String(data[0].error_code || '');
    return { ok: false, error: RATE_LIMIT_ERRORS.has(errorCode) ? errorCode : 'temporary_failure' };
  } catch {
    return { ok: false, error: 'temporary_failure' };
  }
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (!isAllowedOrigin(origin)) return response({ ok: false, error: 'forbidden_origin' }, 403, origin);
  const respond = (payload, status = 200) => response(payload, status, origin);
  if (request.method === 'OPTIONS') return emptyResponse(204, origin);
  if (request.method !== 'POST') return respond({ ok: false, error: 'method_not_allowed' }, 405);

  const user = await requireUser(request);
  if (!user) return respond({ ok: false, error: 'unauthorized' }, 401);

  const payload = await readPayload(request);
  const parcelId = String(payload?.parcelId || '');
  if (!payload || !isParcelId(parcelId)) return respond({ ok: false, error: 'invalid_payload' }, 400);

  // A personal SweetTracker key must not be turned into a public tracking API.
  // The owner ID lives only in the function's server-side secrets along with
  // the key, never in the browser bundle or this repository.
  const ownerId = String(Deno.env.get('PARCEL_HUB_TRACKING_OWNER_ID') || '');
  const apiKey = String(Deno.env.get('SWEETTRACKER_API_KEY') || '').trim();
  if (!ownerId || !apiKey) return respond({ ok: false, error: 'provider_not_ready' }, 503);
  if (user.id !== ownerId) return respond({ ok: false, error: 'tracking_unavailable' }, 403);

  const database = adminClient();
  let parcel;
  try {
    const { data, error } = await database
      .from('parcels')
      .select('id, tracking_number, carrier_code, deleted_at')
      .eq('id', parcelId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    parcel = data;
  } catch {
    return respond({ ok: false, error: 'temporary_failure' }, 503);
  }
  if (!parcel) return respond({ ok: false, error: 'parcel_not_synced' }, 404);

  const providerCarrierCode = sweetTrackerCarrierCode(parcel.carrier_code);
  if (!providerCarrierCode) return respond({ ok: false, error: 'carrier_required' }, 400);

  const slot = await consumeRefreshSlot(database, user.id, parcel.id);
  if (!slot.ok) return respond({ ok: false, error: slot.error }, slot.error === 'temporary_failure' ? 503 : 429);

  const result = await fetchProviderTracking(apiKey, providerCarrierCode, parcel.tracking_number);
  if (!result.ok) return respond({ ok: false, error: result.error }, 502);
  return respond({ ok: true, tracking: result.tracking });
});

