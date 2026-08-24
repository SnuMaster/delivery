/**
 * Parcel Hub's deterministic, dependency-free tracking helpers.
 *
 * A tracking number is not a universal carrier identifier.  These helpers only
 * identify a carrier when an explicit carrier name appears in nearby text.
 * International-postal S10 codes receive only a soft suggestion. Numeric
 * numbers alone intentionally remain unassigned.
 */

export const CARRIERS = Object.freeze({
  cj: {
    label: 'CJ대한통운',
    aliases: ['cj대한통운', 'cj logistics', '대한통운'],
    trackingUrl: number => `https://www.cjlogistics.com/ko/tool/parcel/newTracking?gnbInvcNo=${encodeURIComponent(number)}`,
  },
  hanjin: {
    label: '한진택배',
    aliases: ['한진택배', 'hanjin'],
    trackingUrl: number => `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnum=${encodeURIComponent(number)}`,
  },
  lotte: {
    label: '롯데택배',
    aliases: ['롯데택배', '롯데글로벌로지스', 'lotte global logistics'],
    // The official lookup currently submits a POST form; the former GET link
    // only opens a shell page and does not reliably pass the invoice number.
    trackingMethod: 'post',
    trackingField: 'InvNo',
    trackingUrl: () => 'https://www.lotteglogis.com/home/reservation/tracking/invoiceView',
  },
  logen: {
    label: '로젠택배',
    aliases: ['로젠택배', 'ilogen'],
    trackingUrl: number => `https://www.ilogen.com/web/personal/trace/${encodeURIComponent(number)}`,
  },
  post: {
    label: '우체국택배',
    aliases: ['우체국택배', '우체국'],
    trackingUrl: number => `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${encodeURIComponent(number)}`,
  },
  ems: {
    label: '우체국 EMS·국제우편',
    aliases: ['국제우편', 'ems', 'express mail service'],
    trackingUrl: number => `https://service.epost.go.kr/trace.RetrieveEmsRigiTraceList.comm?POST_CODE=${encodeURIComponent(number)}`,
  },
  kyungdong: {
    label: '경동택배',
    aliases: ['경동택배', '경동'],
    trackingUrl: number => `https://kdexp.com/service/delivery/etc/delivery.do?barcode=${encodeURIComponent(number)}`,
  },
  daesin: {
    label: '대신택배',
    aliases: ['대신택배'],
    // The tracking form is POST-only; a made-up GET query returns an error.
    trackingMethod: 'post',
    trackingField: 'billno',
    trackingUrl: () => 'https://www.ds3211.co.kr/freight/internalFreightSearch.ht',
  },
});

export const CARRIER_CODES = Object.freeze(Object.keys(CARRIERS));

const SEPARATOR_PATTERN = /[\s\-‐‑‒–—―]/g;
const INTERNATIONAL_POSTAL_PATTERN = /^[A-Z]{2}\d{9}[A-Z]{2}$/;
const NUMERIC_TRACKING_PATTERN = /^\d{8,16}$/;
const TRACKING_CONTEXT_PATTERN = /운송장|송장|택배|배송|조회|tracking|waybill|shipment|parcel|delivery/i;
const KOREAN_PHONE_PATTERN = /^01[016789]\d{7,8}$/;

export function normalizeTrackingNumber(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(SEPARATOR_PATTERN, '');
}

export function validateTrackingNumber(value) {
  const tracking = normalizeTrackingNumber(value);

  if (!tracking) {
    return { valid: false, tracking, reason: '운송장번호를 입력해 주세요.' };
  }

  if (INTERNATIONAL_POSTAL_PATTERN.test(tracking)) {
    return { valid: true, tracking, kind: 'international-postal' };
  }

  if (NUMERIC_TRACKING_PATTERN.test(tracking)) {
    return { valid: true, tracking, kind: 'numeric' };
  }

  return {
    valid: false,
    tracking,
    reason: '숫자 8~16자리 또는 국제우편 형식(예: EE123456789KR)인지 확인해 주세요.',
  };
}

export function getCarrierLabel(code) {
  return CARRIERS[code]?.label ?? '택배사 선택 필요';
}

export function buildTrackingUrl(code, trackingNumber) {
  const carrier = CARRIERS[code];
  const { valid, tracking } = validateTrackingNumber(trackingNumber);
  return carrier && valid ? carrier.trackingUrl(tracking) : '';
}

function textForMatching(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR');
}

export function findCarrierMentions(text) {
  const haystack = textForMatching(text);
  return CARRIER_CODES.filter(code => CARRIERS[code].aliases.some(alias => haystack.includes(textForMatching(alias))));
}

/**
 * Returns a conservative carrier recommendation.  It never assigns a Korean
 * carrier based solely on a numeric length or prefix: those patterns overlap.
 */
export function detectCarrier(trackingNumber, context = '') {
  const { valid, tracking, kind } = validateTrackingNumber(trackingNumber);
  if (!valid) {
    return { code: '', candidates: [], confidence: 'none', reason: '유효한 운송장 형식이 아닙니다.' };
  }

  const mentions = findCarrierMentions(context);
  if (mentions.includes('ems')) {
    return { code: 'ems', candidates: ['ems'], confidence: 'high', reason: '주변 문구에서 국제우편/EMS 표기를 찾았습니다.' };
  }
  if (mentions.length === 1) {
    return { code: mentions[0], candidates: mentions, confidence: 'high', reason: `주변 문구에서 ${getCarrierLabel(mentions[0])} 표기를 찾았습니다.` };
  }
  if (mentions.length > 1) {
    return { code: '', candidates: mentions, confidence: 'ambiguous', reason: '주변 문구에 여러 택배사가 있어 직접 선택이 필요합니다.' };
  }
  if (kind === 'international-postal') {
    return { code: '', candidates: ['ems'], confidence: 'suggestion', reason: '국제우편 S10 형식 추정입니다. 우체국 EMS·국제우편인지 확인해 선택해 주세요.' };
  }
  return { code: '', candidates: [], confidence: 'none', reason: '숫자 형식만으로는 택배사를 확정할 수 없습니다.' };
}

export function isProbablyKoreanPhoneNumber(value) {
  return KOREAN_PHONE_PATTERN.test(normalizeTrackingNumber(value));
}

function hasTrackingContext(text) {
  return TRACKING_CONTEXT_PATTERN.test(text);
}

function nearbyContext(source, start, end) {
  // Notifications commonly contain multiple carriers. Stay within the current
  // line so a carrier label from the previous message is not assigned to the
  // next number by accident.
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = source.indexOf('\n', end);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  return source.slice(Math.max(lineStart, start - 90), Math.min(lineEnd, end + 90));
}

function candidateFor(source, rawValue, start, end, existing, seen, confidenceOverride = '') {
  const validation = validateTrackingNumber(rawValue);
  if (!validation.valid || existing.has(validation.tracking) || seen.has(validation.tracking)) return null;
  if (isProbablyKoreanPhoneNumber(validation.tracking)) return null;

  const context = nearbyContext(source, start, end);
  const detection = detectCarrier(validation.tracking, context);
  const contextual = hasTrackingContext(context);
  const confidence = confidenceOverride || (detection.confidence === 'high' ? 'high' : detection.confidence === 'suggestion' || contextual ? 'medium' : 'possible');

  seen.add(validation.tracking);
  return {
    tracking: validation.tracking,
    carrier: detection.code,
    candidateCarriers: detection.candidates,
    detectionConfidence: detection.confidence,
    confidence,
    selected: confidence !== 'possible' && detection.confidence !== 'suggestion',
    reason: detection.code || detection.confidence === 'suggestion'
      ? detection.reason
      : contextual
        ? '운송장 관련 문구 근처에서 찾았습니다. 택배사는 직접 확인해 주세요.'
        : '숫자 형식 후보입니다. 주문번호·전화번호가 아닌지 확인한 뒤 선택해 주세요.',
  };
}

/**
 * Extract likely tracking numbers from pasted notifications without pretending
 * every long number is a parcel.  Context-confirmed candidates are selected by
 * default; bare numeric candidates remain opt-in.
 */
export function extractTrackingCandidates(text, existingNumbers = []) {
  const source = String(text ?? '').normalize('NFKC');
  const existing = new Set([...existingNumbers].map(normalizeTrackingNumber));
  const seen = new Set();
  const candidates = [];
  const occupiedRanges = [];

  const internationalPattern = /[A-Za-z]{2}(?:[\s-]*\d){9}[\s-]*[A-Za-z]{2}/g;
  for (const match of source.matchAll(internationalPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const candidate = candidateFor(source, match[0], start, end, existing, seen);
    if (candidate) candidates.push(candidate);
    occupiedRanges.push([start, end]);
  }

  // Ungrouped numbers and commonly spaced/hyphenated waybills.  The captured
  // group keeps delimiters out of the stored number.
  const numericPattern = /(?:^|[^\d])(\d{8,16}|(?:\d{1,4}[\s-]){1,3}\d{2,5})(?=$|[^\d])/g;
  for (const match of source.matchAll(numericPattern)) {
    const raw = match[1];
    const start = (match.index ?? 0) + match[0].indexOf(raw);
    const end = start + raw.length;
    if (occupiedRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd)) continue;
    const candidate = candidateFor(source, raw, start, end, existing, seen);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

export function normalizeSavedItem(item, fallbackId) {
  const validation = validateTrackingNumber(item?.tracking ?? item?.number);
  if (!validation.valid) return null;

  const carrier = CARRIERS[item?.carrier] ? item.carrier : '';
  const legacyDone = item?.status === 'done';
  const managementStatus = item?.managementStatus === 'received' || legacyDone ? 'received' : 'needs-check';
  const createdAt = Number.isNaN(Date.parse(item?.createdAt)) ? new Date().toISOString() : item.createdAt;
  const updatedAt = Number.isNaN(Date.parse(item?.updatedAt)) ? createdAt : item.updatedAt;

  return {
    id: String(item?.id || fallbackId),
    tracking: validation.tracking,
    carrier,
    carrierOrigin: ['manual', 'context', 'format', 'imported', 'legacy'].includes(item?.carrierOrigin) ? item.carrierOrigin : 'legacy',
    memo: String(item?.memo ?? '').trim().slice(0, 240),
    managementStatus,
    createdAt,
    updatedAt,
  };
}

export function mergeUniqueItems(currentItems, incomingItems) {
  const existing = new Set(currentItems.map(item => normalizeTrackingNumber(item.tracking)));
  const added = [];
  const skipped = [];

  for (const item of incomingItems) {
    const normalized = normalizeSavedItem(item, `import-${item?.tracking ?? Math.random()}`);
    if (!normalized || existing.has(normalized.tracking)) {
      skipped.push(item);
      continue;
    }
    existing.add(normalized.tracking);
    added.push(normalized);
  }

  return { added, skipped };
}
