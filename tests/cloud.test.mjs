import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isNewer,
  parcelToRow,
  rowToParcel,
  rowToTombstone,
  tombstoneToRow,
} from '../cloud.js';

test('maps local parcels to the restricted database contract without a client id', () => {
  const row = parcelToRow({
    id: 'only-local',
    tracking: '680405450931',
    carrier: '',
    carrierOrigin: 'manual',
    memo: '선물',
    managementStatus: 'needs-check',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T01:00:00.000Z',
  }, '77ce3e59-4ea0-4d60-9cc6-7a1008754d4a');

  assert.deepEqual(row, {
    user_id: '77ce3e59-4ea0-4d60-9cc6-7a1008754d4a',
    tracking_number: '680405450931',
    carrier_code: 'unknown',
    carrier_origin: 'manual',
    memo: '선물',
    management_status: 'needs_check',
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T01:00:00.000Z',
    deleted_at: null,
  });
  assert.equal('id' in row, false);
});

test('maps the database contract back to the dashboard contract', () => {
  const item = rowToParcel({
    id: 'c296863e-da22-4f70-8d72-e0e6eb21e0bc',
    tracking_number: 'EE123456789KR',
    carrier_code: 'ems',
    carrier_origin: 'format',
    memo: null,
    management_status: 'received',
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T01:00:00.000Z',
  });

  assert.equal(item.tracking, 'EE123456789KR');
  assert.equal(item.carrier, 'ems');
  assert.equal(item.managementStatus, 'received');
  assert.equal(item.memo, '');
});

test('prefers a strictly newer local record during conflict resolution', () => {
  assert.equal(isNewer({ updatedAt: '2026-08-24T02:00:00Z' }, { updatedAt: '2026-08-24T01:00:00Z' }), true);
  assert.equal(isNewer({ updatedAt: '2026-08-24T01:00:00Z' }, { updatedAt: '2026-08-24T01:00:00Z' }), false);
});

test('maps legacy carrier origins to a database-valid origin', () => {
  const row = parcelToRow({
    tracking: '680405450931',
    carrier: 'cj',
    carrierOrigin: 'legacy',
    memo: '',
    managementStatus: 'needs-check',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T01:00:00.000Z',
  }, '77ce3e59-4ea0-4d60-9cc6-7a1008754d4a');

  assert.equal(row.carrier_origin, 'imported');
  assert.equal(row.deleted_at, null);
});

test('keeps a minimal tombstone row so deletes cannot be resurrected by a stale device', () => {
  const tombstone = tombstoneToRow({
    tracking: '680405450931',
    deletedAt: '2026-08-24T02:00:00.000Z',
    updatedAt: '2026-08-24T02:00:00.000Z',
  }, '77ce3e59-4ea0-4d60-9cc6-7a1008754d4a');

  assert.equal(tombstone.deleted_at, '2026-08-24T02:00:00.000Z');
  assert.equal(tombstone.carrier_code, 'unknown');
  assert.deepEqual(rowToTombstone({
    tracking_number: '680405450931',
    deleted_at: tombstone.deleted_at,
    updated_at: tombstone.updated_at,
  }), {
    tracking: '680405450931',
    deletedAt: '2026-08-24T02:00:00.000Z',
    updatedAt: '2026-08-24T02:00:00.000Z',
  });
});
