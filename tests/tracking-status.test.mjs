import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isParcelId,
  providerErrorCode,
  sanitizeTrackingEvent,
  sanitizeTrackingInfo,
  sweetTrackerCarrierCode,
} from '../supabase/functions/tracking-status/tracking-status.js';

test('maps only supported Parcel Hub carriers to verified SweetTracker codes', () => {
  assert.equal(sweetTrackerCarrierCode('cj'), '04');
  assert.equal(sweetTrackerCarrierCode('post'), '01');
  assert.equal(sweetTrackerCarrierCode('ems'), '12');
  assert.equal(sweetTrackerCarrierCode('unknown'), '');
  assert.equal(sweetTrackerCarrierCode(''), '');
});

test('requires a canonical parcel UUID before the server can look up a parcel', () => {
  assert.equal(isParcelId('c296863e-da22-4f70-8d72-e0e6eb21e0bc'), true);
  assert.equal(isParcelId('not-a-uuid'), false);
  assert.equal(isParcelId('c296863e-da22-4f70-8d72-e0e6eb21e0bc;drop'), false);
});

test('whitelists delivery status data and omits recipient and contact fields', () => {
  const result = sanitizeTrackingInfo({
    complete: false,
    level: 5,
    estimate: '오늘 18시 전',
    receiverName: '받는 사람',
    receiverAddr: '비공개 주소',
    senderName: '보내는 사람',
    productInfo: '비공개 상품',
    lastStateDetail: {
      kind: '배송 출발',
      where: '강남영업소',
      timeString: '2026-08-25 13:20',
      manName: '기사 이름',
      telno: '02-0000-0000',
      telno2: '010-0000-0000',
      remark: '문 앞에 놓고 감',
    },
    trackingDetails: [{
      kind: '집화완료',
      where: '서울',
      timeString: '2026-08-24 17:00',
      manName: '다른 기사',
      telno: '02-1111-1111',
      remark: '개인 메모',
    }],
  }, '2026-08-25T04:21:00.000Z');

  assert.deepEqual(result, {
    deliveryStatus: '배송 출발',
    complete: false,
    estimate: '오늘 18시 전',
    lastEvent: {
      status: '배송 출발',
      location: '강남영업소',
      occurredAt: '2026-08-25 13:20',
    },
    events: [{
      status: '집화완료',
      location: '서울',
      occurredAt: '2026-08-24 17:00',
    }],
    checkedAt: '2026-08-25T04:21:00.000Z',
  });
  assert.equal(JSON.stringify(result).includes('기사 이름'), false);
  assert.equal(JSON.stringify(result).includes('비공개'), false);
  assert.equal(JSON.stringify(result).includes('문 앞'), false);
});

test('keeps an empty provider result as a safe no-information status', () => {
  assert.deepEqual(sanitizeTrackingInfo({ level: 0, result: 'N', trackingDetails: [] }, '2026-08-25T00:00:00.000Z'), {
    deliveryStatus: '배송 정보 없음',
    complete: false,
    estimate: '',
    lastEvent: null,
    events: [],
    checkedAt: '2026-08-25T00:00:00.000Z',
  });
});

test('maps provider errors without returning upstream messages', () => {
  assert.equal(providerErrorCode({ code: '103', msg: 'secret details' }, 200), 'usage_exhausted');
  assert.equal(providerErrorCode({ code: '105' }, 200), 'refresh_limited');
  assert.equal(providerErrorCode({}, 429), 'refresh_limited');
  assert.equal(providerErrorCode({ code: 'unknown', msg: 'private upstream text' }, 500), 'provider_unavailable');
});

test('drops an event made only of sensitive provider fields', () => {
  assert.equal(sanitizeTrackingEvent({ manName: '기사', telno: '010-0000-0000', remark: '문 앞' }), null);
});

