import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findGmailTrackingCandidates } from '../gmail.js';

const appRoot = new URL('../', import.meta.url);

test('Gmail direct scan is the configured connection path, while paste remains a fallback', async () => {
  const html = await readFile(new URL('index.html', appRoot), 'utf8');
  const app = await readFile(new URL('app.js', appRoot), 'utf8');
  const styles = await readFile(new URL('styles.css', appRoot), 'utf8');

  assert.match(html, /id="gmailSourceCard" hidden/);
  assert.match(html, /Gmail 연결하고 운송장 찾기/);
  assert.match(html, /id="gmailPrivacyNote" hidden/);
  assert.match(html, /id="gmailConnectButton"[^>]*hidden/);
  assert.match(html, /id="gmailManualButton"/);
  assert.doesNotMatch(html, /gmailSetupButton|naverSetupButton/);
  assert.match(app, /prepareGmailConnection/);
  assert.match(app, /void prepareGmailImport\(\);/);
  assert.match(app, /elements\.gmailSourceCard\.hidden = !available;/);
  assert.match(app, /if \(state\.bulkMode !== 'paste'\) return;/);
  assert.match(app, /elements\.bulkPastePanel\.hidden = true;/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none !important;/);
});

test('keeps personal Naver Mail out of password-based inbox access', async () => {
  const html = await readFile(new URL('index.html', appRoot), 'utf8');
  const naverCard = html.match(/<section class="source-card" id="naverSourceCard">([\s\S]*?)<\/section>/)?.[0] || '';

  assert.match(naverCard, /권한 허용만으로 받은편지함을 읽는 기능을 제공하지 않아요/);
  assert.match(naverCard, /비밀번호나 앱 비밀번호는 받지 않아요/);
  assert.match(naverCard, /자동 연결 불가/);
  assert.match(naverCard, /href="https:\/\/mail\.naver\.com\/"/);
  assert.match(naverCard, /target="_blank" rel="noopener noreferrer"/);
  assert.match(naverCard, /id="naverManualButton"/);
  assert.doesNotMatch(naverCard, /<input\b|<form\b|naverConnectButton|naverSetupButton/);
});

test('finds candidates from recent Gmail mail while retaining partial results', async () => {
  const text = Buffer.from('CJ대한통운 운송장 6804-0545-0931', 'utf8').toString('base64url');
  let listPath = '';
  const fetchGmail = async path => {
    if (path.startsWith('messages?q=')) {
      listPath = path;
      return { resultSizeEstimate: 82, messages: [{ id: 'readable' }, { id: 'unreadable' }] };
    }
    if (path.includes('messages/readable?')) {
      return {
        payload: {
          headers: [{ name: 'Subject', value: '배송 안내' }],
          mimeType: 'text/plain',
          body: { data: text },
        },
      };
    }
    throw new Error('temporarily unavailable');
  };

  const result = await findGmailTrackingCandidates({
    clientId: ' test-client-id ',
    requestToken: async clientId => {
      assert.equal(clientId, 'test-client-id');
      return 'short-lived-token';
    },
    fetchGmail,
  });

  assert.match(decodeURIComponent(listPath), /newer_than:180d/);
  assert.match(listPath, /maxResults=50/);
  assert.equal(result.messagesScanned, 2);
  assert.equal(result.messagesSkipped, 1);
  assert.equal(result.messagesMatched, 82);
  assert.equal(result.scanWasLimited, true);
  assert.deepEqual(result.candidates.map(candidate => candidate.tracking), ['680405450931']);
});

test('does not silently report an empty Gmail scan when every message read fails', async () => {
  const fetchGmail = async path => {
    if (path.startsWith('messages?q=')) return { messages: [{ id: 'missing' }] };
    throw new Error('Gmail 권한이 만료되었어요.');
  };

  await assert.rejects(
    findGmailTrackingCandidates({
      clientId: 'test-client-id',
      requestToken: async () => 'short-lived-token',
      fetchGmail,
    }),
    /Gmail 권한이 만료/,
  );
});
