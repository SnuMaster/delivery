import { extractTrackingCandidates } from './lib.js?v=20260824-auth-mail-4';

// Gmail access is requested only after a person presses the connect button.
// This is a restricted scope, so it must remain narrow and never be used for
// background scanning from the public GitHub Pages site.
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MESSAGE_LIMIT = 50;
const SEARCH_DAYS = 180;
const FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 20_000;
const DELIVERY_SEARCH_QUERY = `newer_than:${SEARCH_DAYS}d (운송장 OR 송장 OR 택배 OR 배송 OR 출고 OR 발송 OR tracking OR waybill OR shipment OR delivery)`;

let gisLoader;

function decodeBase64Url(value = '') {
  const text = String(value);
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function htmlToText(html) {
  if (typeof DOMParser === 'undefined') {
    // This only runs in non-browser test environments. Gmail scanning itself is
    // browser-only because Google Identity Services needs a user click.
    return String(html).replace(/<[^>]*>/g, ' ');
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  return document.body?.textContent || '';
}

function collectBodyText(part) {
  if (!part) return '';
  const mimeType = String(part.mimeType || '').toLowerCase();
  // Attachment data is never fetched. We only inspect inline text/html or
  // text/plain message bodies returned by Gmail's full-message response.
  const own = part.body?.data && (mimeType === 'text/plain' || mimeType === 'text/html')
    ? decodeBase64Url(part.body.data)
    : '';
  const normalized = mimeType === 'text/html' ? htmlToText(own) : own;
  return [normalized, ...(part.parts || []).map(collectBodyText)].filter(Boolean).join('\n');
}

function headerValue(message, name) {
  return message?.payload?.headers?.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function readableApiError(status, payload) {
  const reason = String(payload?.error?.errors?.[0]?.reason || payload?.error?.status || '').toLowerCase();
  if (status === 401 || reason === 'autherror' || reason === 'insufficientpermissions') {
    return 'Gmail 권한이 만료되었거나 허용되지 않았어요. Gmail 연결 버튼을 다시 눌러 주세요.';
  }
  if (status === 403 && (reason === 'accessnotconfigured' || reason === 'service_disabled')) {
    return 'Gmail 연결 서비스 설정이 아직 완료되지 않았어요. 잠시 후 다시 시도해 주세요.';
  }
  if (status === 429 || reason.includes('ratelimit') || reason.includes('quota')) {
    return 'Gmail 요청이 많아 잠시 기다린 뒤 다시 시도해 주세요.';
  }
  if (status >= 500) return 'Gmail이 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요.';
  return 'Gmail 메일을 읽지 못했어요. 잠시 후 다시 시도해 주세요.';
}

async function loadGoogleIdentityServices() {
  if (globalThis.google?.accounts?.oauth2) return;
  if (!gisLoader) {
    gisLoader = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) {
        if (globalThis.google?.accounts?.oauth2) {
          resolve();
          return;
        }
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Google 로그인 도구를 불러오지 못했습니다.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Google 로그인 도구를 불러오지 못했습니다.'));
      document.head.append(script);
    });
  }
  try {
    await gisLoader;
  } catch (error) {
    // A transient network failure must not make all later user retries fail.
    gisLoader = null;
    throw error;
  }
  if (!globalThis.google?.accounts?.oauth2) throw new Error('Google 로그인 도구를 시작하지 못했습니다.');
}

async function requestAccessToken(clientId) {
  // Do not await a script load here. TokenClient.requestAccessToken() must run
  // directly inside the click event that started the Gmail import, otherwise a
  // popup blocker can reject a legitimate connection attempt.
  if (!globalThis.google?.accounts?.oauth2) {
    throw new Error('Gmail 연결을 준비하는 중이에요. 잠시 후 다시 눌러 주세요.');
  }
  return new Promise((resolve, reject) => {
    const tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: response => {
        if (response?.error || !response?.access_token) {
          reject(new Error(response?.error_description || 'Gmail 읽기 권한을 받지 못했습니다.'));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: response => reject(new Error(response?.message || 'Google 계정 선택을 완료하지 않았습니다.')),
    });
    // This is called from the user's button press. The token stays only in
    // memory for this scan; no refresh token is issued or saved by the site.
    tokenClient.requestAccessToken();
  });
}

// Call this during app startup, before the user presses the Gmail button. It
// loads no inbox data and opens no popup; it only prepares Google’s SDK so the
// real OAuth request can remain inside a user-initiated click handler.
export async function prepareGmailConnection() {
  await loadGoogleIdentityServices();
}

async function gmailFetch(path, accessToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // A status code alone is enough for a useful Korean error message.
      }
      throw new Error(readableApiError(response.status, payload));
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Gmail 응답이 늦어졌어요. 잠시 후 다시 시도해 주세요.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function combineCandidates(groups) {
  const result = new Map();
  for (const candidates of groups) {
    for (const candidate of candidates) {
      const current = result.get(candidate.tracking);
      if (!current || candidate.confidence === 'high' || (!current.carrier && candidate.carrier)) {
        result.set(candidate.tracking, candidate);
      }
    }
  }
  return [...result.values()];
}

async function mapWithConcurrency(values, callback, concurrency = FETCH_CONCURRENCY) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { ok: true, value: await callback(values[index]) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function readMessageCandidates(summary, accessToken, existingNumbers, fetchGmail) {
  const message = await fetchGmail(`messages/${encodeURIComponent(summary.id)}?format=full`, accessToken);
  const subject = headerValue(message, 'subject');
  // Cap only the text handed to our local parser, not the Gmail request. This
  // avoids accidentally scanning extremely long marketing mail indefinitely.
  const body = collectBodyText(message.payload).slice(0, 80_000);
  return extractTrackingCandidates(`${subject}\n${body}`, existingNumbers).map(candidate => ({
    ...candidate,
    reason: `${candidate.reason} Gmail 메일에서 찾았습니다.`,
  }));
}

/**
 * Runs a user-initiated Gmail scan in the browser. It asks Google for a
 * short-lived access token, searches recent delivery-related mail, and returns
 * only candidate tracking numbers to the dashboard. Raw message data, provider
 * IDs, and OAuth tokens never leave the browser or persistent app storage.
 */
export async function findGmailTrackingCandidates({
  clientId,
  existingNumbers = [],
  requestToken = requestAccessToken,
  fetchGmail = gmailFetch,
}) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) throw new Error('Gmail 연결 설정이 아직 완료되지 않았습니다.');

  const accessToken = await requestToken(normalizedClientId);
  const query = encodeURIComponent(DELIVERY_SEARCH_QUERY);
  const list = await fetchGmail(`messages?q=${query}&maxResults=${MESSAGE_LIMIT}`, accessToken);
  const messages = Array.isArray(list.messages) ? list.messages : [];
  const matchedEstimate = Number.isFinite(list.resultSizeEstimate) ? Math.max(0, list.resultSizeEstimate) : messages.length;
  const outcomes = await mapWithConcurrency(
    messages,
    summary => readMessageCandidates(summary, accessToken, existingNumbers, fetchGmail),
  );
  const succeeded = outcomes.filter(outcome => outcome.ok);
  const failed = outcomes.filter(outcome => !outcome.ok);

  // If Gmail returned summaries but none can be read, showing an empty success
  // result would hide a real permission/API outage from the user.
  if (messages.length && !succeeded.length && failed[0]?.error) throw failed[0].error;

  return {
    candidates: combineCandidates(succeeded.map(outcome => outcome.value)),
    messagesScanned: messages.length,
    messagesSkipped: failed.length,
    messagesMatched: matchedEstimate,
    scanWasLimited: matchedEstimate > messages.length,
    searchDays: SEARCH_DAYS,
    messageLimit: MESSAGE_LIMIT,
  };
}
