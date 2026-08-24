import {
  CARRIERS,
  CARRIER_CODES,
  buildTrackingUrl,
  detectCarrier,
  extractTrackingCandidates,
  getCarrierLabel,
  mergeUniqueItems,
  normalizeSavedItem,
  normalizeTrackingNumber,
  validateTrackingNumber,
} from './lib.js';

const STORAGE_KEY = 'parcel-hub.items.v3';
const LEGACY_STORAGE_KEYS = ['delivery.items.v2'];
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const $ = id => document.getElementById(id);
const elements = {
  trackingForm: $('trackingForm'),
  trackingInput: $('trackingInput'),
  trackingHint: $('trackingHint'),
  carrierInput: $('carrierInput'),
  memoInput: $('memoInput'),
  bulkOpenButton: $('bulkOpenButton'),
  importOpenButton: $('importOpenButton'),
  exportButton: $('exportButton'),
  parcelList: $('parcelList'),
  emptyState: $('emptyState'),
  filters: $('filters'),
  statAll: $('statAll'),
  statNeedsCarrier: $('statNeedsCarrier'),
  statNeedsCheck: $('statNeedsCheck'),
  statReceived: $('statReceived'),
  storageState: $('storageState'),
  bulkDialog: $('bulkDialog'),
  bulkCloseButton: $('bulkCloseButton'),
  bulkCancelButton: $('bulkCancelButton'),
  bulkText: $('bulkText'),
  bulkPreview: $('bulkPreview'),
  bulkSummary: $('bulkSummary'),
  bulkAddButton: $('bulkAddButton'),
  importDialog: $('importDialog'),
  importCloseButton: $('importCloseButton'),
  importCancelButton: $('importCancelButton'),
  importFile: $('importFile'),
  importSummary: $('importSummary'),
  importConfirmButton: $('importConfirmButton'),
  detailDialog: $('detailDialog'),
  detailCloseButton: $('detailCloseButton'),
  detailForm: $('detailForm'),
  detailTracking: $('detailTracking'),
  detailCarrier: $('detailCarrier'),
  detailMemo: $('detailMemo'),
  detailStatus: $('detailStatus'),
  detailOrigin: $('detailOrigin'),
  detailOfficialLink: $('detailOfficialLink'),
  detailLinkHint: $('detailLinkHint'),
  detailCopyButton: $('detailCopyButton'),
  detailDeleteButton: $('detailDeleteButton'),
  toast: $('toast'),
};

const state = {
  items: loadItems(),
  filter: 'all',
  bulkCandidates: [],
  pendingImport: [],
};

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `parcel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStoredArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
  } catch {
    // A corrupt old backup should not stop the dashboard from opening.
  }
  return null;
}

function loadItems() {
  let source = readStoredArray(STORAGE_KEY);
  if (!source) {
    source = LEGACY_STORAGE_KEYS.map(readStoredArray).find(Array.isArray) ?? [];
  }

  const seen = new Set();
  return source
    .map((item, index) => normalizeSavedItem(item, `restored-${index}`))
    .filter(item => {
      if (!item || seen.has(item.tracking)) return false;
      seen.add(item.tracking);
      return true;
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, items: state.items }));
    elements.storageState.textContent = '이 브라우저에만 저장됨';
    return true;
  } catch {
    elements.storageState.textContent = '저장 공간 오류';
    showToast('브라우저 저장 공간에 기록하지 못했어요. 먼저 백업을 내려받아 주세요.');
    return false;
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '날짜 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function carrierOptions(selected = '', includeEmpty = true) {
  const options = CARRIER_CODES.map(code => `<option value="${code}"${code === selected ? ' selected' : ''}>${escapeHtml(getCarrierLabel(code))}</option>`);
  if (includeEmpty) options.unshift(`<option value=""${selected ? '' : ' selected'}>택배사 직접 선택</option>`);
  return options.join('');
}

function managementLabel(status) {
  return status === 'received' ? '받음 (내 표시)' : '공식 조회 필요';
}

function originLabel(origin, carrier) {
  if (!carrier) return '택배사 미지정';
  if (origin === 'context') return '문자/메일 문맥에서 감지';
  if (origin === 'format') return '국제우편 형식에서 감지';
  if (origin === 'imported') return '백업에서 가져옴';
  if (origin === 'legacy') return '기존 저장 목록';
  return '직접 선택';
}

function filteredItems() {
  return state.items.filter(item => {
    if (state.filter === 'all') return true;
    if (state.filter === 'needs-carrier') return !item.carrier;
    return item.managementStatus === state.filter;
  });
}

function linkMarkup(item, className = 'official-link') {
  if (!item.carrier) return '<span class="muted-note">택배사를 선택하면 공식 조회를 열 수 있어요.</span>';
  const carrier = CARRIERS[item.carrier];
  const url = buildTrackingUrl(item.carrier, item.tracking);
  if (!url) return '<span class="muted-note">운송장 형식을 확인해 주세요.</span>';
  if (carrier.trackingMethod === 'post') {
    return `<button class="${className}" type="button" data-official-track>공식 조회 ↗</button>`;
  }
  const label = '공식 조회 ↗';
  return `<a class="${className}" data-official-track href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function cardMarkup(item) {
  const statusClass = item.managementStatus === 'received' ? 'received' : 'needs-check';
  const carrierMeta = item.carrier
    ? `<span class="carrier-name">${escapeHtml(getCarrierLabel(item.carrier))}</span><span class="source-label">${escapeHtml(originLabel(item.carrierOrigin, item.carrier))}</span>`
    : '<span class="carrier-name carrier-missing">택배사 선택 필요</span><span class="source-label">숫자만으로 자동 확정하지 않음</span>';

  return `<article class="parcel-card" data-id="${escapeHtml(item.id)}" role="listitem">
    <div class="parcel-primary">
      <div class="carrier-row">${carrierMeta}</div>
      <strong class="tracking-number">${escapeHtml(item.tracking)}</strong>
      ${item.memo ? `<p class="parcel-memo">${escapeHtml(item.memo)}</p>` : ''}
    </div>
    <div class="parcel-status">
      <span class="status-pill ${statusClass}"><span></span>${managementLabel(item.managementStatus)}</span>
      <span class="date-label">수정 ${formatDate(item.updatedAt)}</span>
    </div>
    <div class="parcel-links">
      ${linkMarkup(item)}
      <button class="text-button" type="button" data-action="copy" aria-label="${escapeHtml(item.tracking)} 복사">번호 복사</button>
    </div>
    <div class="parcel-actions" aria-label="택배 관리">
      <button class="icon-button" type="button" data-action="edit" aria-label="${escapeHtml(item.tracking)} 관리" title="관리">✎</button>
      <button class="icon-button" type="button" data-action="toggle" aria-label="${escapeHtml(item.tracking)} ${item.managementStatus === 'received' ? '공식 조회 필요로' : '받음으로'} 표시" title="받음/공식 조회 필요 전환">✓</button>
      <button class="icon-button danger" type="button" data-action="delete" aria-label="${escapeHtml(item.tracking)} 삭제" title="삭제">×</button>
    </div>
  </article>`;
}

function render() {
  const all = state.items.length;
  const needsCarrier = state.items.filter(item => !item.carrier).length;
  const needsCheck = state.items.filter(item => item.managementStatus === 'needs-check').length;
  const received = all - needsCheck;
  elements.statAll.textContent = all;
  elements.statNeedsCarrier.textContent = needsCarrier;
  elements.statNeedsCheck.textContent = needsCheck;
  elements.statReceived.textContent = received;

  const items = filteredItems();
  elements.parcelList.innerHTML = items.map(cardMarkup).join('');
  elements.emptyState.hidden = items.length > 0;
  elements.parcelList.hidden = items.length === 0;
  elements.emptyState.querySelector('p').textContent = all
    ? '이 필터에 해당하는 택배가 없어요.'
    : '운송장번호를 등록하면 여기에서 한꺼번에 관리할 수 있어요.';

  elements.filters.querySelectorAll('[data-filter]').forEach(button => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3200);
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function createItem({ tracking, carrier = '', memo = '', managementStatus = 'needs-check', carrierOrigin = 'manual' }) {
  const validation = validateTrackingNumber(tracking);
  if (!validation.valid) return { error: validation.reason };
  if (state.items.some(item => item.tracking === validation.tracking)) return { error: '이미 목록에 있는 운송장번호예요.' };

  const now = new Date().toISOString();
  return {
    item: {
      id: createId(),
      tracking: validation.tracking,
      carrier: CARRIERS[carrier] ? carrier : '',
      carrierOrigin: CARRIERS[carrier] ? carrierOrigin : 'manual',
      memo: String(memo).trim().slice(0, 240),
      managementStatus: managementStatus === 'received' ? 'received' : 'needs-check',
      createdAt: now,
      updatedAt: now,
    },
  };
}

function addSingleTracking() {
  const validation = validateTrackingNumber(elements.trackingInput.value);
  if (!validation.valid) {
    elements.trackingInput.setCustomValidity(validation.reason);
    elements.trackingInput.reportValidity();
    return;
  }

  const suggestion = detectCarrier(validation.tracking);
  const selectedCarrier = elements.carrierInput.value || suggestion.code;
  const result = createItem({
    tracking: validation.tracking,
    carrier: selectedCarrier,
    memo: elements.memoInput.value,
    carrierOrigin: elements.carrierInput.value ? 'manual' : suggestion.code ? 'format' : 'manual',
  });
  if (result.error) return showToast(result.error);

  state.items.unshift(result.item);
  persist();
  render();
  elements.trackingForm.reset();
  updateTrackingHint();
  elements.trackingInput.focus();
  showToast(result.item.carrier ? '택배를 저장했어요.' : '택배를 저장했어요. 택배사를 선택하면 공식 조회도 열 수 있어요.');
}

function updateTrackingHint() {
  const raw = elements.trackingInput.value;
  if (!raw.trim()) {
    elements.trackingInput.setCustomValidity('');
    elements.trackingHint.textContent = '숫자 8~16자리 또는 국제우편 형식을 입력하세요. 숫자만으로는 택배사를 확정하지 않아요.';
    return;
  }
  const validation = validateTrackingNumber(raw);
  if (!validation.valid) {
    elements.trackingInput.setCustomValidity(validation.reason);
    elements.trackingHint.textContent = validation.reason;
    return;
  }
  elements.trackingInput.setCustomValidity('');
  const detected = detectCarrier(validation.tracking);
  elements.trackingHint.textContent = detected.code
    ? `${detected.reason} 필요하면 택배사를 바꿀 수 있어요.`
    : `${detected.reason} 국내 숫자 운송장은 택배사 번호 체계가 겹쳐 직접 선택이 가장 정확해요.`;
}

async function copyTrackingNumber(value, quiet = false) {
  try {
    await navigator.clipboard.writeText(value);
    if (!quiet) showToast('운송장번호를 복사했어요.');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    showToast(copied ? '운송장번호를 복사했어요.' : '복사하지 못했어요. 번호를 길게 눌러 복사해 주세요.');
  }
}

function usesPostTracking(code) {
  return CARRIERS[code]?.trackingMethod === 'post';
}

function openPostTracking(item) {
  const carrier = CARRIERS[item.carrier];
  if (!carrier || carrier.trackingMethod !== 'post') return;
  const form = document.createElement('form');
  form.method = 'post';
  form.action = carrier.trackingUrl(item.tracking);
  form.target = '_blank';
  form.hidden = true;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = carrier.trackingField;
  input.value = item.tracking;
  form.append(input);
  document.body.append(form);
  form.submit();
  form.remove();
}

function openDetail(item) {
  elements.detailDialog.dataset.id = item.id;
  elements.detailTracking.value = item.tracking;
  elements.detailCarrier.innerHTML = carrierOptions(item.carrier);
  elements.detailMemo.value = item.memo;
  elements.detailStatus.value = item.managementStatus;
  elements.detailOrigin.textContent = originLabel(item.carrierOrigin, item.carrier);
  updateDetailLink();
  openDialog(elements.detailDialog);
}

function updateDetailLink() {
  const tracking = elements.detailTracking.value;
  const carrier = elements.detailCarrier.value;
  const url = buildTrackingUrl(carrier, tracking);
  const hasCarrier = Boolean(carrier && url);
  elements.detailOfficialLink.hidden = !hasCarrier;
  if (!hasCarrier) {
    elements.detailOfficialLink.removeAttribute('href');
    elements.detailLinkHint.textContent = '택배사를 선택하면 해당 택배사의 공식 조회 페이지를 열 수 있어요.';
    return;
  }
  elements.detailOfficialLink.href = url;
  elements.detailOfficialLink.textContent = '공식 배송조회 열기 ↗';
  elements.detailLinkHint.textContent = usesPostTracking(carrier)
    ? '이 택배사는 공식 조회 양식으로 번호를 안전하게 전달합니다. 공식 사이트에서 결과를 확인해 주세요.'
    : '공식 사이트에서 배송 상태와 이력을 확인합니다. 이 앱은 배송 데이터를 자체 수집하지 않습니다.';
}

function saveDetail(event) {
  event.preventDefault();
  const item = state.items.find(candidate => candidate.id === elements.detailDialog.dataset.id);
  if (!item) return closeDialog(elements.detailDialog);

  const newCarrier = elements.detailCarrier.value;
  item.carrier = CARRIERS[newCarrier] ? newCarrier : '';
  item.carrierOrigin = item.carrier === newCarrier ? 'manual' : 'manual';
  item.memo = elements.detailMemo.value.trim().slice(0, 240);
  item.managementStatus = elements.detailStatus.value === 'received' ? 'received' : 'needs-check';
  item.updatedAt = new Date().toISOString();
  persist();
  render();
  closeDialog(elements.detailDialog);
  showToast('변경사항을 저장했어요.');
}

function removeItem(id) {
  const item = state.items.find(candidate => candidate.id === id);
  if (!item) return;
  if (!window.confirm(`${item.tracking}을(를) 목록에서 삭제할까요?`)) return;
  state.items = state.items.filter(candidate => candidate.id !== id);
  persist();
  render();
  closeDialog(elements.detailDialog);
  showToast('목록에서 삭제했어요.');
}

function candidateMarkup(candidate, index) {
  const confidenceLabel = candidate.detectionConfidence === 'suggestion' ? '국제우편 추정' : candidate.confidence === 'high' ? '높은 신뢰' : candidate.confidence === 'medium' ? '문맥 후보' : '확인 필요';
  return `<li class="candidate-row ${candidate.selected ? '' : 'unselected'}" data-candidate-index="${index}">
    <label class="candidate-check"><input type="checkbox" data-bulk-select="${index}"${candidate.selected ? ' checked' : ''}><span class="sr-only">${escapeHtml(candidate.tracking)} 추가</span></label>
    <div class="candidate-main"><strong>${escapeHtml(candidate.tracking)}</strong><span class="confidence ${candidate.confidence}">${confidenceLabel}</span><p>${escapeHtml(candidate.reason)}</p></div>
    <label class="candidate-carrier"><span class="sr-only">${escapeHtml(candidate.tracking)} 택배사</span><select data-bulk-carrier="${index}">${carrierOptions(candidate.carrier)}</select></label>
  </li>`;
}

function renderBulkCandidates() {
  const candidates = state.bulkCandidates;
  if (!candidates.length) {
    elements.bulkPreview.innerHTML = '<p class="preview-empty">운송장 후보를 찾지 못했어요. 번호와 주변의 “운송장”, “택배”, 택배사 이름을 함께 확인해 주세요.</p>';
    elements.bulkSummary.textContent = '';
    elements.bulkAddButton.disabled = true;
    return;
  }
  elements.bulkPreview.innerHTML = `<ul class="candidate-list">${candidates.map(candidateMarkup).join('')}</ul>`;
  const selected = candidates.filter(candidate => candidate.selected).length;
  const unknown = candidates.filter(candidate => !candidate.carrier).length;
  elements.bulkSummary.textContent = `${candidates.length}개 후보 중 ${selected}개 선택됨${unknown ? ` · ${unknown}개는 택배사 확인 필요` : ''}`;
  elements.bulkAddButton.disabled = selected === 0;
}

function updateBulkCandidates() {
  state.bulkCandidates = extractTrackingCandidates(elements.bulkText.value, state.items.map(item => item.tracking));
  renderBulkCandidates();
}

function addBulkCandidates() {
  const selected = state.bulkCandidates.filter(candidate => candidate.selected);
  if (!selected.length) return showToast('추가할 후보를 하나 이상 선택해 주세요.');

  const additions = [];
  const known = new Set(state.items.map(item => item.tracking));
  for (const candidate of selected) {
    if (known.has(candidate.tracking)) continue;
    const result = createItem({
      tracking: candidate.tracking,
      carrier: candidate.carrier,
      carrierOrigin: candidate.carrier ? (candidate.confidence === 'high' ? 'context' : 'manual') : 'manual',
    });
    if (result.item) {
      additions.push(result.item);
      known.add(result.item.tracking);
    }
  }
  if (!additions.length) return showToast('새로 추가할 운송장번호가 없어요.');
  state.items.unshift(...additions);
  persist();
  render();
  closeDialog(elements.bulkDialog);
  showToast(`${additions.length}개 운송장을 저장했어요.`);
}

function exportBackup() {
  const payload = {
    app: 'Parcel Hub',
    version: 3,
    exportedAt: new Date().toISOString(),
    items: state.items,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `parcel-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('백업 파일을 내려받았어요.');
}

async function readImportFile() {
  const file = elements.importFile.files?.[0];
  state.pendingImport = [];
  elements.importConfirmButton.disabled = true;
  if (!file) {
    elements.importSummary.textContent = 'JSON 백업 파일을 선택해 주세요.';
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    elements.importSummary.textContent = '2MB 이하의 JSON 백업 파일만 가져올 수 있어요.';
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    const records = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(records)) throw new Error('items not found');
    const prepared = records
      .map((record, index) => normalizeSavedItem({ ...record, carrierOrigin: 'imported' }, `import-preview-${index}`))
      .filter(Boolean)
      .map(record => ({ ...record, id: createId(), carrierOrigin: 'imported' }));
    const current = new Set(state.items.map(item => item.tracking));
    const unique = [];
    for (const record of prepared) {
      if (!current.has(record.tracking) && !unique.some(item => item.tracking === record.tracking)) unique.push(record);
    }
    state.pendingImport = unique;
    elements.importSummary.textContent = `${records.length}개 항목을 읽었고, 새로 추가할 수 있는 운송장은 ${unique.length}개예요.`;
    elements.importConfirmButton.disabled = unique.length === 0;
  } catch {
    elements.importSummary.textContent = '읽을 수 없는 백업 파일이에요. 택배허브에서 내보낸 JSON인지 확인해 주세요.';
  }
}

function commitImport() {
  const { added } = mergeUniqueItems(state.items, state.pendingImport);
  if (!added.length) return showToast('새로 추가할 운송장번호가 없어요.');
  state.items.unshift(...added.map(item => ({ ...item, id: createId(), carrierOrigin: 'imported' })));
  persist();
  render();
  closeDialog(elements.importDialog);
  showToast(`${added.length}개 운송장을 백업에서 가져왔어요.`);
}

elements.trackingForm.addEventListener('submit', event => {
  event.preventDefault();
  addSingleTracking();
});
elements.trackingInput.addEventListener('input', updateTrackingHint);

elements.filters.addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  render();
});

elements.parcelList.addEventListener('click', event => {
  const card = event.target.closest('[data-id]');
  if (!card) return;
  const item = state.items.find(candidate => candidate.id === card.dataset.id);
  if (!item) return;
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'copy') return void copyTrackingNumber(item.tracking);
  if (action === 'edit') return openDetail(item);
  if (action === 'delete') return removeItem(item.id);
  if (action === 'toggle') {
    item.managementStatus = item.managementStatus === 'received' ? 'needs-check' : 'received';
    item.updatedAt = new Date().toISOString();
    persist();
    render();
    return showToast(item.managementStatus === 'received' ? '받음으로 표시했어요.' : '공식 조회 필요로 표시했어요.');
  }
  const trackingLink = event.target.closest('[data-official-track]');
  if (trackingLink && usesPostTracking(item.carrier)) {
    event.preventDefault();
    openPostTracking(item);
  }
});

elements.bulkOpenButton.addEventListener('click', () => {
  elements.bulkText.value = '';
  state.bulkCandidates = [];
  renderBulkCandidates();
  openDialog(elements.bulkDialog);
  elements.bulkText.focus();
});
elements.bulkCloseButton.addEventListener('click', () => closeDialog(elements.bulkDialog));
elements.bulkCancelButton.addEventListener('click', () => closeDialog(elements.bulkDialog));
elements.bulkText.addEventListener('input', updateBulkCandidates);
elements.bulkPreview.addEventListener('change', event => {
  const selectIndex = event.target.dataset.bulkSelect;
  const carrierIndex = event.target.dataset.bulkCarrier;
  if (selectIndex !== undefined) state.bulkCandidates[Number(selectIndex)].selected = event.target.checked;
  if (carrierIndex !== undefined) state.bulkCandidates[Number(carrierIndex)].carrier = event.target.value;
  renderBulkCandidates();
});
elements.bulkAddButton.addEventListener('click', addBulkCandidates);

elements.importOpenButton.addEventListener('click', () => {
  state.pendingImport = [];
  elements.importFile.value = '';
  elements.importSummary.textContent = '이 브라우저에서 내보낸 JSON 백업을 선택해 주세요. 기존 항목은 덮어쓰지 않고 새 번호만 추가합니다.';
  elements.importConfirmButton.disabled = true;
  openDialog(elements.importDialog);
});
elements.importCloseButton.addEventListener('click', () => closeDialog(elements.importDialog));
elements.importCancelButton.addEventListener('click', () => closeDialog(elements.importDialog));
elements.importFile.addEventListener('change', readImportFile);
elements.importConfirmButton.addEventListener('click', commitImport);
elements.exportButton.addEventListener('click', exportBackup);

elements.detailCloseButton.addEventListener('click', () => closeDialog(elements.detailDialog));
elements.detailForm.addEventListener('submit', saveDetail);
elements.detailCarrier.addEventListener('change', updateDetailLink);
elements.detailCopyButton.addEventListener('click', () => copyTrackingNumber(elements.detailTracking.value));
elements.detailDeleteButton.addEventListener('click', () => removeItem(elements.detailDialog.dataset.id));
elements.detailOfficialLink.addEventListener('click', event => {
  if (usesPostTracking(elements.detailCarrier.value)) {
    event.preventDefault();
    openPostTracking({ carrier: elements.detailCarrier.value, tracking: elements.detailTracking.value });
  }
});

render();
updateTrackingHint();

