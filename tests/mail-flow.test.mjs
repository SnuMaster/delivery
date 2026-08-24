import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findGmailTrackingCandidates } from '../gmail.js';

const appRoot = new URL('../', import.meta.url);

test('mail picker keeps copy and paste as the immediate option', async () => {
  const html = await readFile(new URL('index.html', appRoot), 'utf8');
  const app = await readFile(new URL('app.js', appRoot), 'utf8');

  assert.match(html, /id="quickTextImportButton"/);
  assert.match(html, /Gmail 자동 가져오기는 준비 중이에요/);
  assert.match(html, /id="gmailConnectButton"[^>]*hidden/);
  assert.match(html, /네이버 메일 자동 가져오기는 아직 준비 중이에요/);
  assert.doesNotMatch(html, /gmailSetupButton|naverSetupButton/);
  assert.match(app, /if \(state\.bulkMode !== 'paste'\) return;/);
  assert.match(app, /elements\.bulkPastePanel\.hidden = true;/);
});

test('keeps successful Gmail candidates when one matching message cannot be read', async () => {
  const text = Buffer.from('CJ대한통운 운송장 6804-0545-0931', 'utf8').toString('base64url');
  const fetchGmail = async path => {
    if (path.startsWith('messages?q=')) return { messages: [{ id: 'readable' }, { id: 'unreadable' }] };
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
    clientId: 'test-client-id',
    requestToken: async () => 'short-lived-token',
    fetchGmail,
  });

  assert.equal(result.messagesScanned, 2);
  assert.equal(result.messagesSkipped, 1);
  assert.deepEqual(result.candidates.map(candidate => candidate.tracking), ['680405450931']);
});

