import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrackingUrl,
  detectCarrier,
  extractTrackingCandidates,
  mergeUniqueItems,
  normalizeTrackingNumber,
  normalizeSavedItem,
  validateTrackingNumber,
} from '../lib.js';

test('normalizes spacing, dashes, and case', () => {
  assert.equal(normalizeTrackingNumber(' ee-123 456 789 kr '), 'EE123456789KR');
  assert.equal(validateTrackingNumber('EE123456789KR').valid, true);
  assert.equal(validateTrackingNumber('68-0405-450931').tracking, '680405450931');
});

test('does not guess a Korean carrier from a numeric prefix', () => {
  const result = detectCarrier('680405450931');
  assert.equal(result.code, '');
  assert.match(result.reason, /확정/);
});

test('recognizes an explicit carrier label but keeps an S10 format as a soft suggestion', () => {
  assert.equal(detectCarrier('680405450931', 'CJ대한통운 운송장입니다').code, 'cj');
  const international = detectCarrier('EE123456789KR');
  assert.equal(international.code, '');
  assert.deepEqual(international.candidates, ['ems']);
  assert.equal(international.confidence, 'suggestion');
});

test('extracts contextual candidates but excludes a mobile phone number', () => {
  const candidates = extractTrackingCandidates('CJ대한통운 운송장 6804-0545-0931\n문의 010-1234-5678');
  assert.deepEqual(candidates.map(item => item.tracking), ['680405450931']);
  assert.equal(candidates[0].carrier, 'cj');
  assert.equal(candidates[0].selected, true);
});

test('keeps a bare long number opt-in instead of claiming it is a tracking number', () => {
  const candidates = extractTrackingCandidates('참조 번호 123456789012');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].carrier, '');
  assert.equal(candidates[0].selected, false);
});

test('requires an explicit decision for an S10 international-postal candidate', () => {
  const candidates = extractTrackingCandidates('국제 배송 번호 EE123456789KR');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].selected, false);
  assert.equal(candidates[0].carrier, '');
  assert.match(candidates[0].reason, /S10/);
});

test('exports only safe, encoded official tracking links', () => {
  const url = buildTrackingUrl('cj', '680405450931');
  assert.match(url, /^https:\/\/www\.cjlogistics\.com\//);
  assert.match(url, /gnbInvcNo=680405450931/);
  assert.equal(buildTrackingUrl('not-a-carrier', '680405450931'), '');
});

test('merges backups by normalized tracking number', () => {
  const current = [{ id: 'old', tracking: '680405450931', createdAt: '2026-01-01T00:00:00.000Z' }];
  const incoming = [
    { id: 'duplicate', tracking: '6804-0545-0931', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'new', tracking: 'EE123456789KR', carrier: 'ems', createdAt: '2026-01-02T00:00:00.000Z' },
  ];
  const result = mergeUniqueItems(current, incoming);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].tracking, 'EE123456789KR');
  assert.equal(result.skipped.length, 1);
});

test('migrates legacy saved records safely and drops unknown carrier codes', () => {
  const restored = normalizeSavedItem({
    id: 'legacy',
    tracking: '6804-0545-0931',
    carrier: 'made-up-carrier',
    status: 'active',
    memo: '  old memo  ',
    createdAt: 'not-a-date',
  }, 'fallback');
  assert.equal(restored.tracking, '680405450931');
  assert.equal(restored.carrier, '');
  assert.equal(restored.managementStatus, 'needs-check');
  assert.equal(restored.memo, 'old memo');
  assert.equal(normalizeSavedItem({ tracking: 'not a tracking number' }, 'bad'), null);
});

