import { extractTrackingCandidates } from './lib.js?v=20260824-auth-mail-4';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MESSAGE_LIMIT = 25;
const SEARCH_DAYS = 90;

let gisLoader;

function decodeBase64Url(value = '') {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value).length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function htmlToText(html) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return document.body?.textContent || '';
}

function collectBodyText(part) {
  if (!part) return '';
  const mimeType = String(part.mimeType || '').toLowerCase();
  const own = part.body?.data && (mimeType === 'text/plain' || mimeType === 'text/html')
    ? decodeBase64Url(part.body.data)
    : '';
  const normalized = mimeType === 'text/html' ? htmlToText(own) : own;
  return [normalized, ...(part.parts || []).map(collectBodyText)].filter(Boolean).join('\n');
}

function headerValue(message, name) {
  return message?.payload?.headers?.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

async function loadGoogleIdentityServices() {
  if (globalThis.google?.accounts?.oauth2) return;
  if (!gisLoader) {
    gisLoader = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
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
  await gisLoader;
  if (!globalThis.google?.accounts?.oauth2) throw new Error('Google 로그인 도구를 시작하지 못했습니다.');
}

async function requestAccessToken(clientId) {
  await loadGoogleIdentityServices();
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
    // This must stay inside a user-initiated click handler.  The token stays in
    // memory for this import only; we never request an offline refresh token.
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

async function gmailFetch(path, accessToken) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Gmail 읽기 권한이 없거나 만료됐습니다. 다시 연결해 주세요.');
    throw new Error('Gmail을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return response.json();
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

/**
 * Runs a user-initiated, browser-only Gmail scan. Raw message contents and the
 * short-lived Google access token never leave the user's browser or local app
 * state; only candidate tracking numbers are returned to the dashboard.
 */
export async function findGmailTrackingCandidates({ clientId, existingNumbers = [] }) {
  if (!clientId) throw new Error('Gmail 연결 설정이 아직 완료되지 않았습니다.');

  const accessToken = await requestAccessToken(clientId);
  const query = encodeURIComponent(`newer_than:${SEARCH_DAYS}d (운송장 OR 송장 OR 배송 OR 택배)`);
  const list = await gmailFetch(`messages?q=${query}&maxResults=${MESSAGE_LIMIT}`, accessToken);
  const messages = list.messages || [];
  const candidateGroups = [];

  for (const summary of messages) {
    const message = await gmailFetch(`messages/${encodeURIComponent(summary.id)}?format=full`, accessToken);
    const subject = headerValue(message, 'subject');
    const body = collectBodyText(message.payload).slice(0, 80_000);
    const candidates = extractTrackingCandidates(`${subject}\n${body}`, existingNumbers).map(candidate => ({
      ...candidate,
      reason: `${candidate.reason} Gmail 메일에서 찾았습니다.`,
    }));
    candidateGroups.push(candidates);
  }

  return {
    candidates: combineCandidates(candidateGroups),
    messagesScanned: messages.length,
  };
}
