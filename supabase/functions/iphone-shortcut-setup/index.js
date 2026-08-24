import { createClient } from 'npm:@supabase/supabase-js@2.97.0';

const APP_ORIGIN = 'https://snumaster.github.io';

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': APP_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

function emptyResponse(status) {
  return new Response(null, {
    status,
    headers: {
      'Access-Control-Allow-Origin': APP_ORIGIN,
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
    // Existing projects can use the legacy public key until it is retired.
  }
  return Deno.env.get('SUPABASE_ANON_KEY') || '';
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

function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value) {
  const input = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeConnection(row) {
  if (!row) return { connected: false };
  return {
    connected: row.status === 'active',
    status: row.status,
    secretHint: row.secret_hint,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    rotatedAt: row.rotated_at,
  };
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

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (origin !== APP_ORIGIN) return response({ ok: false, error: 'forbidden_origin' }, 403);
  if (request.method === 'OPTIONS') return emptyResponse(204);
  if (request.method !== 'POST') return response({ ok: false, error: 'method_not_allowed' }, 405);

  const user = await requireUser(request);
  if (!user) return response({ ok: false, error: 'unauthorized' }, 401);

  let action;
  try {
    action = String((await request.json())?.action || 'status');
  } catch {
    return response({ ok: false, error: 'invalid_payload' }, 400);
  }
  if (!['status', 'create', 'rotate', 'revoke'].includes(action)) {
    return response({ ok: false, error: 'invalid_action' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const readConnection = () => admin
    .from('iphone_shortcut_connections')
    .select('id, status, secret_hint, last_used_at, created_at, rotated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  try {
    const { data: existing, error: existingError } = await readConnection();
    if (existingError) throw existingError;
    if (action === 'status') return response({ ok: true, connection: safeConnection(existing) });

    if (action === 'revoke') {
      if (existing) {
        const { error } = await admin
          .from('iphone_shortcut_connections')
          .update({ status: 'revoked', rate_request_count: 0, rate_window_started_at: null })
          .eq('id', existing.id)
          .eq('user_id', user.id);
        if (error) throw error;
      }
      return response({ ok: true, connection: { connected: false, status: 'revoked' } });
    }

    if (action === 'create' && existing?.status === 'active') {
      return response({ ok: false, error: 'already_connected', connection: safeConnection(existing) }, 409);
    }

    const secret = randomKey();
    const secretHash = await sha256Hex(secret);
    const now = new Date().toISOString();
    const write = {
      user_id: user.id,
      secret_hash: secretHash,
      secret_hint: secret.slice(-6),
      status: 'active',
      last_used_at: null,
      rate_window_started_at: null,
      rate_request_count: 0,
      rotated_at: existing ? now : null,
    };
    const { data: saved, error: saveError } = await admin
      .from('iphone_shortcut_connections')
      .upsert(write, { onConflict: 'user_id' })
      .select('id, status, secret_hint, last_used_at, created_at, rotated_at')
      .single();
    if (saveError) throw saveError;

    // The random key is returned only in this creation/rotation response. The
    // database keeps its SHA-256 hash, so it cannot be shown again later.
    return response({ ok: true, connection: safeConnection(saved), secret });
  } catch {
    return response({ ok: false, error: 'temporary_failure' }, 503);
  }
});

