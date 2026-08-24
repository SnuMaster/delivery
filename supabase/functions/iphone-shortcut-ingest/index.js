import { createClient } from 'npm:@supabase/supabase-js@2.97.0';
import { normalizeShortcutPayload, sha256Hex } from './iphone-shortcut.js';

const APP_ORIGIN = 'https://snumaster.github.io';
const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 20;

function response(payload, status = 200, origin = '') {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (origin === APP_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = APP_ORIGIN;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'content-type';
    headers.Vary = 'Origin';
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function emptyResponse(status, origin = '') {
  const headers = {};
  if (origin === APP_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = APP_ORIGIN;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'content-type';
    headers.Vary = 'Origin';
  }
  return new Response(null, { status, headers });
}

function adminKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    if (keys.default) return keys.default;
  } catch {
    // Managed projects still provide the legacy server-only key as a fallback.
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

function getAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL') || '', adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function consumeRateLimit(client, connection, now) {
  const previousStart = Date.parse(connection.rate_window_started_at || '');
  const withinWindow = Number.isFinite(previousStart) && now.getTime() - previousStart < RATE_WINDOW_MS;
  const nextCount = withinWindow ? Number(connection.rate_request_count || 0) + 1 : 1;
  if (nextCount > RATE_LIMIT) return false;

  const { error } = await client
    .from('iphone_shortcut_connections')
    .update({
      last_used_at: now.toISOString(),
      rate_window_started_at: withinWindow ? connection.rate_window_started_at : now.toISOString(),
      rate_request_count: nextCount,
    })
    .eq('id', connection.id)
    .eq('status', 'active');
  if (error) throw error;
  return true;
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return emptyResponse(204, origin);
  if (request.method !== 'POST') return response({ ok: false, error: 'method_not_allowed' }, 405, origin);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response({ ok: false, error: 'payload_too_large' }, 413, origin);
  }

  let rawPayload;
  try {
    rawPayload = await request.text();
  } catch {
    return response({ ok: false, error: 'invalid_payload' }, 400, origin);
  }
  if (new TextEncoder().encode(rawPayload).byteLength > MAX_BODY_BYTES) {
    return response({ ok: false, error: 'payload_too_large' }, 413, origin);
  }
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return response({ ok: false, error: 'invalid_payload' }, 400, origin);
  }

  const parsed = normalizeShortcutPayload(payload);
  if (!parsed.valid) return response({ ok: false, error: parsed.reason }, 400, origin);

  const client = getAdminClient();
  const keyHash = await sha256Hex(parsed.key);
  const { data: connection, error: connectionError } = await client
    .from('iphone_shortcut_connections')
    .select('id, user_id, status, rate_window_started_at, rate_request_count')
    .eq('secret_hash', keyHash)
    .eq('status', 'active')
    .maybeSingle();

  if (connectionError) return response({ ok: false, error: 'temporary_failure' }, 503, origin);
  if (!connection) return response({ ok: false, error: 'unauthorized' }, 401, origin);

  let activeImportId = '';
  try {
    const now = new Date();
    if (!(await consumeRateLimit(client, connection, now))) {
      return response({ ok: false, error: 'rate_limited' }, 429, origin);
    }

    // The deterministic, secret-salted fingerprint prevents a repeated
    // automation run from creating another import record. It contains no raw
    // message text, sender, or device identifier.
    const fingerprint = await sha256Hex(`${parsed.key}\n${[...parsed.trackingNumbers].sort().join('\n')}`);
    let importRecord;
    const { data: createdImport, error: importError } = await client
      .from('mail_imports')
      .insert({
        user_id: connection.user_id,
        source_kind: 'iphone_shortcut',
        source_fingerprint: fingerprint,
        status: 'queued',
        source_received_at: now.toISOString(),
        parcel_count: 0,
      })
      .select('id')
      .single();

    if (importError?.code === '23505') {
      const { data: existingImport, error: existingImportError } = await client
        .from('mail_imports')
        .select('id, status')
        .eq('user_id', connection.user_id)
        .eq('source_kind', 'iphone_shortcut')
        .eq('source_fingerprint', fingerprint)
        .maybeSingle();
      if (existingImportError || !existingImport) throw existingImportError || new Error('existing_import_missing');
      if (existingImport.status === 'processed') {
        return response({ ok: true, duplicate: true, added: 0 }, 200, origin);
      }
      importRecord = existingImport;
    } else if (importError || !createdImport) {
      throw importError || new Error('import_record_missing');
    } else {
      importRecord = createdImport;
    }
    activeImportId = importRecord.id;

    const rows = parsed.trackingNumbers.map(trackingNumber => ({
      user_id: connection.user_id,
      tracking_number: trackingNumber,
      carrier_code: 'unknown',
      carrier_origin: 'imported',
      management_status: 'needs_check',
      source_import_id: importRecord.id,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    }));
    const { data: inserted, error: parcelError } = await client
      .from('parcels')
      .upsert(rows, { onConflict: 'user_id,tracking_number', ignoreDuplicates: true })
      .select('id');
    if (parcelError) throw parcelError;

    const { error: completeError } = await client
      .from('mail_imports')
      .update({ status: 'processed', parcel_count: inserted?.length || 0 })
      .eq('id', importRecord.id)
      .eq('user_id', connection.user_id);
    if (completeError) throw completeError;

    return response({ ok: true, duplicate: false, added: inserted?.length || 0 }, 200, origin);
  } catch {
    if (activeImportId) {
      // Keep a failed import retryable instead of permanently treating the
      // next Shortcuts delivery as a duplicate after a transient database
      // failure. Do not replace a record another invocation already finished.
      await client
        .from('mail_imports')
        .update({ status: 'failed' })
        .eq('id', activeImportId)
        .eq('status', 'queued');
    }
    // Never include the request body or key in a response or log entry.
    return response({ ok: false, error: 'temporary_failure' }, 503, origin);
  }
});

