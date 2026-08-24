const MAX_TRACKING_NUMBERS = 12;
const KEY_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const DOMESTIC_TRACKING_PATTERN = /^\d{8,16}$/;
const INTERNATIONAL_TRACKING_PATTERN = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

function isKoreanMobileNumber(value) {
  return /^01[016789]\d{7,8}$/.test(value);
}

function normalizeCandidate(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

function flattenCandidateValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenCandidateValues);
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  return String(value).split(/[\n,;]+/);
}

export function isValidShortcutTrackingNumber(value) {
  return (DOMESTIC_TRACKING_PATTERN.test(value) && !isKoreanMobileNumber(value))
    || INTERNATIONAL_TRACKING_PATTERN.test(value);
}

/**
 * Accept only a Shortcuts-produced list of tracking numbers. In particular,
 * there is intentionally no `message` field: the webhook never needs to
 * receive or retain the text of a user's SMS/iMessage.
 */
export function normalizeShortcutPayload(payload) {
  const key = String(payload?.key ?? '').trim();
  if (!KEY_PATTERN.test(key)) return { valid: false, reason: 'invalid_key' };

  const seen = new Set();
  const trackingNumbers = flattenCandidateValues(payload?.trackingNumbers)
    .map(normalizeCandidate)
    .filter(candidate => {
      if (!isValidShortcutTrackingNumber(candidate) || seen.has(candidate)) return false;
      seen.add(candidate);
      return true;
    })
    .slice(0, MAX_TRACKING_NUMBERS);

  if (!trackingNumbers.length) return { valid: false, reason: 'no_tracking_numbers' };
  return { valid: true, key, trackingNumbers };
}

export async function sha256Hex(value) {
  const input = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

