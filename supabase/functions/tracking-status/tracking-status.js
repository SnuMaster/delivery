/**
 * Provider-independent helpers for the on-demand delivery-status function.
 *
 * This module deliberately exposes only the tiny, non-personal subset needed
 * by Parcel Hub's UI. Do not add recipient, address, item, driver, phone, or
 * raw provider-response fields here.
 */

export const SWEETTRACKER_CARRIER_CODES = Object.freeze({
  post: '01',
  cj: '04',
  hanjin: '05',
  logen: '06',
  lotte: '08',
  ems: '12',
  daesin: '22',
  kyungdong: '23',
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_BY_LEVEL = Object.freeze({
  0: '배송 정보 없음',
  1: '배송 준비중',
  2: '집화 완료',
  3: '배송중',
  4: '지점 도착',
  5: '배송 출발',
  6: '배송 완료',
});

function safeText(value, maximumLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function toLevel(value) {
  const level = Number(value);
  return Number.isInteger(level) && level >= 0 && level <= 6 ? level : 0;
}

export function isParcelId(value) {
  return UUID_PATTERN.test(String(value ?? ''));
}

export function sweetTrackerCarrierCode(carrierCode) {
  return SWEETTRACKER_CARRIER_CODES[String(carrierCode ?? '')] || '';
}

/**
 * Keeps a delivery event useful without leaking the provider's contact or
 * recipient fields. `remark`, telephone fields, worker details, and photos
 * are intentionally omitted even if the upstream API sends them.
 */
export function sanitizeTrackingEvent(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const event = {
    status: safeText(detail.kind, 80),
    location: safeText(detail.where, 120),
    occurredAt: safeText(detail.timeString, 64),
  };
  return event.status || event.location || event.occurredAt ? event : null;
}

/**
 * Whitelists a SweetTracker response. It must remain safe to cache in the
 * browser for the current tab, so no unlisted upstream field can pass through.
 */
export function sanitizeTrackingInfo(payload, checkedAt = new Date().toISOString()) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const level = toLevel(source.level);
  const complete = source.complete === true || source.completeYN === 'Y' || level === 6;
  const events = Array.isArray(source.trackingDetails)
    ? source.trackingDetails.map(sanitizeTrackingEvent).filter(Boolean).slice(-20)
    : [];
  const lastEvent = sanitizeTrackingEvent(source.lastStateDetail)
    || sanitizeTrackingEvent(source.lastDetail)
    || events.at(-1)
    || null;

  return {
    deliveryStatus: complete ? '배송 완료' : (STATUS_BY_LEVEL[level] || STATUS_BY_LEVEL[0]),
    complete,
    estimate: safeText(source.estimate, 80),
    lastEvent,
    events,
    checkedAt: safeText(checkedAt, 40),
  };
}

/**
 * Translates provider-only failures to stable, non-sensitive application
 * errors. The raw upstream message can contain details we should not return.
 */
export function providerErrorCode(payload, httpStatus = 0) {
  const code = String(payload?.code ?? '');
  if (code === '101' || code === '102') return 'provider_not_ready';
  if (code === '103') return 'usage_exhausted';
  if (code === '104') return 'invalid_tracking';
  if (code === '105') return 'refresh_limited';
  if (code === '106') return 'provider_unavailable';
  if (httpStatus === 429) return 'refresh_limited';
  if (httpStatus === 404) return 'invalid_tracking';
  return 'provider_unavailable';
}

