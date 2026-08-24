import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidShortcutTrackingNumber,
  normalizeShortcutPayload,
  sha256Hex,
} from '../supabase/functions/iphone-shortcut-ingest/iphone-shortcut.js';

const KEY = 'a'.repeat(43);

test('iPhone Shortcut payload accepts only a key and normalized tracking values', () => {
  const result = normalizeShortcutPayload({
    key: KEY,
    trackingNumbers: [' 1234-5678-9012 ', 'EE123456789KR', '123456789012', 'invalid'],
    message: 'this must be ignored rather than collected',
  });

  assert.deepEqual(result, {
    valid: true,
    key: KEY,
    trackingNumbers: ['123456789012', 'EE123456789KR'],
  });
});

test('iPhone Shortcut payload rejects a missing key or tracking number', () => {
  assert.equal(normalizeShortcutPayload({ trackingNumbers: ['123456789012'] }).valid, false);
  assert.equal(normalizeShortcutPayload({ key: KEY, trackingNumbers: ['01012345678'] }).valid, false);
});

test('iPhone Shortcut tracking validation does not accept arbitrary text', () => {
  assert.equal(isValidShortcutTrackingNumber('12345678'), true);
  assert.equal(isValidShortcutTrackingNumber('RR123456789KR'), true);
  assert.equal(isValidShortcutTrackingNumber('1234567'), false);
  assert.equal(isValidShortcutTrackingNumber('택배 123456789012'), false);
});

test('iPhone Shortcut fingerprint helper is deterministic', async () => {
  assert.equal(
    await sha256Hex('parcel-hub'),
    '7cb8afdc4310ea590172a9368d1b07acb8b394a8cb680915f3bd85be5099e2d0',
  );
});

