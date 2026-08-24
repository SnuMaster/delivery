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
} from './lib.js?v=20260824-auth-mail-4';
import {
  cloudEnabled,
  getSupabaseClient,
  isNewer,
  parcelToRow,
  rowToParcel,
  rowToTombstone,
  tombstoneToRow,
} from './cloud.js?v=20260824-auth-mail-4';
import { findGmailTrackingCandidates } from './gmail.js?v=20260824-auth-mail-4';
import { GMAIL_CONFIG, SUPABASE_CONFIG } from './supabase-config.js?v=20260824-auth-mail-4';

const STORAGE_KEY = 'parcel-hub.items.v3';
const TOMBSTONE_STORAGE_KEY = 'parcel-hub.deleted.v1';
const CACHE_OWNER_KEY = 'parcel-hub.cache-owner.v1';
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
  connectionsOpenButton: $('connectionsOpenButton'),
  importOpenButton: $('importOpenButton'),
  exportButton: $('exportButton'),
  accountOpenButton: $('accountOpenButton'),
  accountButtonLabel: $('accountButtonLabel'),
  parcelList: $('parcelList'),
  emptyState: $('emptyState'),
  filters: $('filters'),
  statAll: $('statAll'),
  statNeedsCarrier: $('statNeedsCarrier'),
  statNeedsCheck: $('statNeedsCheck'),
  statReceived: $('statReceived'),
  storageState: $('storageState'),
  storageBadge: $('storageBadge'),
  cloudBanner: $('cloudBanner'),
  cloudBannerTitle: $('cloudBannerTitle'),
  cloudBannerDescription: $('cloudBannerDescription'),
  syncNowButton: $('syncNowButton'),
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
  accountDialog: $('accountDialog'),
  accountCloseButton: $('accountCloseButton'),
  anonymousAccountPanel: $('anonymousAccountPanel'),
  signedInAccountPanel: $('signedInAccountPanel'),
  passwordRecoveryPanel: $('passwordRecoveryPanel'),
  authModeTabs: $('authModeTabs'),
  authForm: $('authForm'),
  authEmail: $('authEmail'),
  authPassword: $('authPassword'),
  authPasswordConfirmRow: $('authPasswordConfirmRow'),
  authPasswordConfirm: $('authPasswordConfirm'),
  authSubmitButton: $('authSubmitButton'),
  authResetButton: $('authResetButton'),
  authNotice: $('authNotice'),
  accountEmail: $('accountEmail'),
  localImportPrompt: $('localImportPrompt'),
  localImportDescription: $('localImportDescription'),
  localImportMergeButton: $('localImportMergeButton'),
  localImportDiscardButton: $('localImportDiscardButton'),
  accountSyncButton: $('accountSyncButton'),
  accountSignOutButton: $('accountSignOutButton'),
  signedInNotice: $('signedInNotice'),
  passwordRecoveryForm: $('passwordRecoveryForm'),
  newPassword: $('newPassword'),
  newPasswordConfirm: $('newPasswordConfirm'),
  recoveryNotice: $('recoveryNotice'),
  connectionsDialog: $('connectionsDialog'),
  connectionsCloseButton: $('connectionsCloseButton'),
  iphoneShortcutSetupButton: $('iphoneShortcutSetupButton'),
  iphoneImportButton: $('iphoneImportButton'),
  iphoneShortcutDialog: $('iphoneShortcutDialog'),
  iphoneShortcutCloseButton: $('iphoneShortcutCloseButton'),
  iphoneShortcutStatus: $('iphoneShortcutStatus'),
  iphoneShortcutStatusDetail: $('iphoneShortcutStatusDetail'),
  iphoneShortcutSecretPanel: $('iphoneShortcutSecretPanel'),
  iphoneShortcutEndpoint: $('iphoneShortcutEndpoint'),
  iphoneShortcutKey: $('iphoneShortcutKey'),
  iphoneShortcutCopyEndpointButton: $('iphoneShortcutCopyEndpointButton'),
  iphoneShortcutCopyKeyButton: $('iphoneShortcutCopyKeyButton'),
  iphoneShortcutCreateButton: $('iphoneShortcutCreateButton'),
  iphoneShortcutRotateButton: $('iphoneShortcutRotateButton'),
  iphoneShortcutRevokeButton: $('iphoneShortcutRevokeButton'),
  iphoneShortcutNotice: $('iphoneShortcutNotice'),
  gmailSetupButton: $('gmailSetupButton'),
  gmailConnectButton: $('gmailConnectButton'),
  gmailManualButton: $('gmailManualButton'),
  naverSetupButton: $('naverSetupButton'),
  naverManualButton: $('naverManualButton'),
  connectionNotice: $('connectionNotice'),
  toast: $('toast'),
};

const state = {
  items: loadItems(),
  deletedItems: loadDeletedItems(),
  filter: 'all',
  bulkCandidates: [],
  pendingImport: [],
};

const cloud = {
  client: null,
  initialization: null,
  user: null,
  authMode: 'signin',
  recoveryMode: false,
  requiresLocalImportDecision: false,
  status: 'local',
  syncInFlight: false,
  syncTimer: null,
};

const iphoneShortcut = {
  connection: null,
  secret: '',
  loading: false,
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

function normalizeTombstone(value) {
  const validation = validateTrackingNumber(value?.tracking);
  const updatedAt = value?.updatedAt || value?.deletedAt;
  if (!validation.valid || Number.isNaN(Date.parse(updatedAt))) return null;
  return {
    tracking: validation.tracking,
    deletedAt: value?.deletedAt || updatedAt,
    updatedAt,
  };
}

function loadDeletedItems() {
  const seen = new Set();
  return (readStoredArray(TOMBSTONE_STORAGE_KEY) || [])
    .map(normalizeTombstone)
    .filter(item => {
      if (!item || seen.has(item.tracking)) return false;
      seen.add(item.tracking);
      return true;
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function clearTombstones(trackings) {
  const restored = new Set(trackings);
  state.deletedItems = state.deletedItems.filter(item => !restored.has(item.tracking));
}

function nextMutationTimestamp(previous = '') {
  const previousTime = Date.parse(previous);
  const now = Date.now();
  return new Date(Number.isNaN(previousTime) ? now : Math.max(now, previousTime + 1)).toISOString();
}

function markDeleted(tracking, previousUpdatedAt = '') {
  const timestamp = nextMutationTimestamp(previousUpdatedAt);
  state.deletedItems = [
    { tracking, deletedAt: timestamp, updatedAt: timestamp },
    ...state.deletedItems.filter(item => item.tracking !== tracking),
  ];
}

function getCacheOwner() {
  try {
    return localStorage.getItem(CACHE_OWNER_KEY) || '';
  } catch {
    return '';
  }
}

function setCacheOwner(userId) {
  try {
    localStorage.setItem(CACHE_OWNER_KEY, userId);
  } catch {
    // Local storage failures are reported by persist() when a parcel changes.
  }
}

function clearLocalAccountCache() {
  state.items = [];
  state.deletedItems = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOMBSTONE_STORAGE_KEY);
    localStorage.removeItem(CACHE_OWNER_KEY);
  } catch {
    // The in-memory copy is still cleared before a different account can use it.
  }
  render();
}

function prepareCacheForUser(user) {
  const cacheOwner = getCacheOwner();
  const hasLocalData = state.items.length > 0 || state.deletedItems.length > 0;
  cloud.requiresLocalImportDecision = false;

  if (cacheOwner && cacheOwner !== user.id) {
    clearLocalAccountCache();
    setCacheOwner(user.id);
    return false;
  }
  if (!cacheOwner && hasLocalData) {
    cloud.requiresLocalImportDecision = true;
    cloud.status = 'awaiting-choice';
    return true;
  }
  setCacheOwner(user.id);
  return false;
}

function persist({ sync = true } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, items: state.items }));
    localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify({ version: 1, items: state.deletedItems }));
    if (cloud.user && sync) scheduleCloudSync();
    else updateCloudPresentation();
    return true;
  } catch {
    elements.storageState.textContent = '저장 공간 오류';
    elements.storageBadge.textContent = '저장 오류';
    showToast('브라우저 저장 공간에 기록하지 못했어요. 먼저 백업을 내려받아 주세요.');
    return false;
  }
}

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function shortAccountLabel(email = '') {
  const [localPart] = String(email).split('@');
  return localPart && localPart.length <= 14 ? localPart : '내 계정';
}

function updateCloudPresentation() {
  const signedIn = Boolean(cloud.user);
  const status = cloud.status;
  const textByStatus = {
    local: '이 브라우저에만 저장됨',
    unavailable: '계정 서비스 연결 오류',
    pending: '계정 동기화 대기 중',
    'awaiting-choice': '기존 목록 확인 필요',
    syncing: '계정에 동기화 중…',
    synced: '내 계정에 동기화됨',
    error: '동기화 오류 · 이 브라우저에는 저장됨',
  };

  elements.accountButtonLabel.textContent = signedIn ? shortAccountLabel(cloud.user.email) : '로그인';
  elements.storageState.textContent = textByStatus[status] || textByStatus.local;
  elements.storageBadge.textContent = signedIn
    ? status === 'synced' ? '계정에 저장' : status === 'awaiting-choice' ? '목록 확인 필요' : '계정 동기화 중'
    : '이 브라우저에만 저장';
  elements.storageBadge.classList.toggle('cloud', signedIn);

  elements.cloudBanner.hidden = false;
  elements.syncNowButton.hidden = !signedIn || cloud.requiresLocalImportDecision;
  if (!signedIn) {
    elements.cloudBannerTitle.textContent = cloudEnabled ? '계정 동기화' : '브라우저 저장';
    elements.cloudBannerDescription.textContent = cloudEnabled
      ? '로그인하면 이 브라우저의 택배 목록을 내 계정으로 안전하게 가져올 수 있어요.'
      : '현재는 이 브라우저에만 저장됩니다. 백업 파일도 함께 보관해 주세요.';
    return;
  }

  elements.cloudBannerTitle.textContent = status === 'awaiting-choice'
    ? '기존 브라우저 목록 확인'
    : status === 'error' ? '동기화에 다시 연결할 수 있어요' : '내 계정으로 동기화 중';
  elements.cloudBannerDescription.textContent = status === 'awaiting-choice'
    ? '다른 계정으로 옮기기 전에 기존 목록을 이 계정에 가져올지 선택해 주세요.'
    : status === 'error'
    ? '인터넷 연결을 확인한 뒤 “지금 동기화”를 누르세요. 이 기기의 목록은 그대로 남아 있어요.'
    : `${cloud.user.email} 계정에만 저장됩니다. 다른 기기에서 로그인하면 같은 목록을 볼 수 있어요.`;
}

function setAuthMode(mode) {
  cloud.authMode = mode === 'signup' ? 'signup' : 'signin';
  const signingUp = cloud.authMode === 'signup';
  elements.authPasswordConfirmRow.hidden = !signingUp;
  elements.authPassword.autocomplete = signingUp ? 'new-password' : 'current-password';
  elements.authPasswordConfirm.required = signingUp;
  elements.authSubmitButton.textContent = signingUp ? '회원가입' : '로그인';
  elements.authResetButton.hidden = signingUp;
  elements.authNotice.textContent = signingUp
    ? '가입 후 이메일 인증 링크를 열면 계정 동기화를 시작할 수 있어요.'
    : '';
  elements.authModeTabs.querySelectorAll('[data-auth-mode]').forEach(button => {
    const active = button.dataset.authMode === cloud.authMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function showAuthNotice(message, target = elements.authNotice) {
  target.textContent = message;
}

function readableAuthError(error, fallback) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('invalid login') || message.includes('invalid credentials')) return '이메일 아이디 또는 비밀번호를 다시 확인해 주세요.';
  if (message.includes('email not confirmed')) return '이메일 인증을 먼저 완료해 주세요.';
  if (message.includes('rate limit') || message.includes('too many')) return '잠시 후 다시 시도해 주세요.';
  if (message.includes('password')) return '비밀번호 조건을 확인해 주세요.';
  if (message.includes('redirect')) return '로그인 설정이 아직 완료되지 않았어요. 잠시 후 다시 시도해 주세요.';
  return fallback;
}

async function initializeCloud() {
  if (cloud.initialization) return cloud.initialization;
  cloud.initialization = (async () => {
    if (!cloudEnabled) {
      cloud.status = 'unavailable';
      updateCloudPresentation();
      return null;
    }
    try {
      cloud.client = await getSupabaseClient();
      const { data, error } = await cloud.client.auth.getSession();
      if (error) throw error;
      cloud.user = data.session?.user ?? null;
      cloud.status = cloud.user ? 'pending' : 'local';
      const needsLocalImportDecision = cloud.user && prepareCacheForUser(cloud.user);
      cloud.client.auth.onAuthStateChange((event, session) => {
        cloud.user = session?.user ?? null;
        if (event === 'PASSWORD_RECOVERY') {
          cloud.recoveryMode = true;
          openDialog(elements.accountDialog);
        }
        if (event === 'SIGNED_OUT') {
          cloud.status = 'local';
          cloud.requiresLocalImportDecision = false;
        }
        if (cloud.user && event === 'SIGNED_IN') {
          const needsDecision = prepareCacheForUser(cloud.user);
          if (needsDecision) {
            openDialog(elements.accountDialog);
          } else {
            cloud.status = 'pending';
            window.setTimeout(() => void syncCloud(), 0);
          }
        }
        updateCloudPresentation();
        updateAccountPanels();
      });
      updateCloudPresentation();
      updateAccountPanels();
      if (needsLocalImportDecision) openDialog(elements.accountDialog);
      else if (cloud.user) window.setTimeout(() => void syncCloud(), 0);
      return cloud.client;
    } catch {
      cloud.client = null;
      cloud.status = 'unavailable';
      cloud.initialization = null;
      updateCloudPresentation();
      return null;
    }
  })();
  return cloud.initialization;
}

function updateAccountPanels() {
  const signedIn = Boolean(cloud.user);
  elements.anonymousAccountPanel.hidden = signedIn || cloud.recoveryMode;
  elements.signedInAccountPanel.hidden = !signedIn || cloud.recoveryMode;
  elements.passwordRecoveryPanel.hidden = !cloud.recoveryMode;
  if (signedIn) {
    elements.accountEmail.textContent = cloud.user.email || '내 계정';
    elements.localImportPrompt.hidden = !cloud.requiresLocalImportDecision;
    elements.localImportDescription.textContent = `${state.items.length}개 운송장${state.deletedItems.length ? `과 ${state.deletedItems.length}개 삭제 기록` : ''}이 이 브라우저에 남아 있어요. 이 계정으로 가져올지 먼저 선택해 주세요.`;
    elements.accountSyncButton.disabled = cloud.requiresLocalImportDecision;
    elements.signedInNotice.textContent = cloud.requiresLocalImportDecision
      ? '기존 목록을 확인한 뒤 동기화를 시작합니다.'
      : cloud.status === 'error'
      ? '동기화하지 못했어요. 이 기기의 목록은 그대로 남아 있어요.'
      : '';
  } else {
    elements.localImportPrompt.hidden = true;
    elements.accountSyncButton.disabled = false;
  }
}

function sortParcels(items) {
  return [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function parcelRecord(item) {
  return { kind: 'parcel', tracking: item.tracking, updatedAt: item.updatedAt, value: item };
}

function tombstoneRecord(item) {
  return { kind: 'tombstone', tracking: item.tracking, updatedAt: item.updatedAt, value: item };
}

function recordFromRow(row, index) {
  if (row.deleted_at) {
    const item = normalizeTombstone(rowToTombstone(row));
    return item ? tombstoneRecord(item) : null;
  }
  const item = normalizeSavedItem(rowToParcel(row), `cloud-${index}`);
  return item ? parcelRecord(item) : null;
}

function newestRecordByTracking(records) {
  const result = new Map();
  for (const record of records) {
    const current = result.get(record.tracking);
    if (!current || isNewer(record, current)) result.set(record.tracking, record);
  }
  return result;
}

async function syncCloud({ announce = false } = {}) {
  const client = await initializeCloud();
  const user = cloud.user;
  if (!client || !user || cloud.syncInFlight || cloud.requiresLocalImportDecision) return false;

  cloud.syncInFlight = true;
  cloud.status = 'syncing';
  updateCloudPresentation();
  try {
    const { data: rows, error: readError } = await client
      .from('parcels')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (readError) throw readError;

    const remoteRecords = (rows || []).map(recordFromRow).filter(Boolean);
    const localRecords = [
      ...state.items.map(parcelRecord),
      ...state.deletedItems.map(tombstoneRecord),
    ];
    const remoteByTracking = newestRecordByTracking(remoteRecords);
    const localByTracking = newestRecordByTracking(localRecords);
    const finalByTracking = new Map();
    const writeRecords = [];

    for (const tracking of new Set([...localByTracking.keys(), ...remoteByTracking.keys()])) {
      const localRecord = localByTracking.get(tracking);
      const remoteRecord = remoteByTracking.get(tracking);
      const localWins = localRecord && (!remoteRecord || isNewer(localRecord, remoteRecord));
      const winner = localWins ? localRecord : remoteRecord;
      if (!winner) continue;
      finalByTracking.set(tracking, winner);
      if (localWins) writeRecords.push(winner);
    }

    if (writeRecords.length) {
      const { data: writtenRows, error: writeError } = await client
        .from('parcels')
        .upsert(writeRecords.map(record => (
          record.kind === 'parcel'
            ? parcelToRow(record.value, user.id)
            : tombstoneToRow(record.value, user.id)
        )), { onConflict: 'user_id,tracking_number' })
        .select('*');
      if (writeError) throw writeError;
      for (const [index, row] of (writtenRows || []).entries()) {
        const record = recordFromRow(row, index);
        if (record) finalByTracking.set(record.tracking, record);
      }
    }

    const finalRecords = [...finalByTracking.values()];
    state.items = sortParcels(finalRecords.filter(record => record.kind === 'parcel').map(record => record.value));
    state.deletedItems = finalRecords
      .filter(record => record.kind === 'tombstone')
      .map(record => record.value)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    persist({ sync: false });
    setCacheOwner(user.id);
    render();
    cloud.status = 'synced';
    updateCloudPresentation();
    updateAccountPanels();
    if (announce) showToast('내 계정에 동기화했어요.');
    return true;
  } catch {
    cloud.status = 'error';
    updateCloudPresentation();
    updateAccountPanels();
    if (announce) showToast('동기화하지 못했어요. 인터넷 연결을 확인해 주세요.');
    return false;
  } finally {
    cloud.syncInFlight = false;
  }
}

function scheduleCloudSync() {
  if (!cloud.user || cloud.syncInFlight || cloud.requiresLocalImportDecision) return;
  cloud.status = 'pending';
  updateCloudPresentation();
  window.clearTimeout(cloud.syncTimer);
  cloud.syncTimer = window.setTimeout(() => void syncCloud(), 700);
}

async function openAccount() {
  await initializeCloud();
  cloud.recoveryMode = false;
  updateAccountPanels();
  setAuthMode(cloud.authMode);
  openDialog(elements.accountDialog);
  if (!cloud.user) elements.authEmail.focus();
}

async function submitAuth(event) {
  event.preventDefault();
  const client = await initializeCloud();
  if (!client) return showAuthNotice('계정 서비스에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  if (!email || !password) return showAuthNotice('이메일 아이디와 비밀번호를 입력해 주세요.');
  if (password.length < 8) return showAuthNotice('비밀번호는 8자 이상으로 만들어 주세요.');
  if (cloud.authMode === 'signup' && password !== elements.authPasswordConfirm.value) {
    return showAuthNotice('비밀번호 확인이 일치하지 않아요.');
  }

  elements.authSubmitButton.disabled = true;
  try {
    if (cloud.authMode === 'signup') {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: getAuthRedirectUrl() },
      });
      if (error) throw error;
      if (data.session) {
        showAuthNotice('계정을 만들고 로그인했어요. 목록을 동기화하는 중이에요.');
      } else {
        showAuthNotice('인증 메일을 보냈어요. 메일의 링크를 열면 로그인할 수 있어요.');
      }
      return;
    }

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showAuthNotice('로그인했어요. 목록을 동기화하는 중이에요.');
  } catch (error) {
    showAuthNotice(readableAuthError(error, '로그인 또는 회원가입을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.'));
  } finally {
    elements.authSubmitButton.disabled = false;
  }
}

async function requestPasswordReset() {
  const client = await initializeCloud();
  const email = elements.authEmail.value.trim();
  if (!client) return showAuthNotice('계정 서비스에 연결하지 못했어요.');
  if (!email) return showAuthNotice('비밀번호를 재설정할 이메일 아이디를 먼저 입력해 주세요.');
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: getAuthRedirectUrl() });
    if (error) throw error;
    showAuthNotice('가입 여부와 관계없이, 가능한 경우 재설정 메일을 보냈어요. 받은편지함을 확인해 주세요.');
  } catch (error) {
    showAuthNotice(readableAuthError(error, '재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.'));
  }
}

async function updatePassword(event) {
  event.preventDefault();
  const client = await initializeCloud();
  const password = elements.newPassword.value;
  if (!client) return showAuthNotice('계정 서비스에 연결하지 못했어요.', elements.recoveryNotice);
  if (password.length < 8) return showAuthNotice('비밀번호는 8자 이상으로 만들어 주세요.', elements.recoveryNotice);
  if (password !== elements.newPasswordConfirm.value) return showAuthNotice('비밀번호 확인이 일치하지 않아요.', elements.recoveryNotice);
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    elements.recoveryNotice.textContent = '새 비밀번호를 저장했어요.';
    cloud.recoveryMode = false;
    elements.newPassword.value = '';
    elements.newPasswordConfirm.value = '';
    updateAccountPanels();
  } catch (error) {
    showAuthNotice(readableAuthError(error, '새 비밀번호를 저장하지 못했어요.'), elements.recoveryNotice);
  }
}

async function signOut() {
  const client = await initializeCloud();
  if (!client) return;
  try {
    if (!cloud.requiresLocalImportDecision && cloud.status !== 'synced' && !(await syncCloud())) {
      elements.signedInNotice.textContent = '아직 동기화하지 못했어요. 목록을 잃지 않도록 인터넷 연결을 확인하거나 백업한 뒤 다시 시도해 주세요.';
      return;
    }
    const { error } = await client.auth.signOut();
    if (error) throw error;
    clearLocalAccountCache();
    closeDialog(elements.accountDialog);
    showToast('로그아웃했어요. 이 기기의 목록은 지웠고, 동기화된 목록은 내 계정에 남아 있어요.');
  } catch {
    elements.signedInNotice.textContent = '로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

function importLocalCacheIntoAccount() {
  if (!cloud.user || !cloud.requiresLocalImportDecision) return;
  cloud.requiresLocalImportDecision = false;
  setCacheOwner(cloud.user.id);
  cloud.status = 'pending';
  updateCloudPresentation();
  updateAccountPanels();
  void syncCloud({ announce: true });
}

function discardLocalCacheAndLoadAccount() {
  if (!cloud.user || !cloud.requiresLocalImportDecision) return;
  cloud.requiresLocalImportDecision = false;
  clearLocalAccountCache();
  setCacheOwner(cloud.user.id);
  cloud.status = 'pending';
  updateCloudPresentation();
  updateAccountPanels();
  void syncCloud({ announce: true });
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

  const tombstone = state.deletedItems.find(item => item.tracking === validation.tracking);
  const now = nextMutationTimestamp(tombstone?.updatedAt);
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
  clearTombstones([result.item.tracking]);
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

async function copyTrackingNumber(value, quiet = false, successMessage = '운송장번호를 복사했어요.') {
  try {
    await navigator.clipboard.writeText(value);
    if (!quiet) showToast(successMessage);
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
    showToast(copied ? successMessage : '복사하지 못했어요. 길게 눌러 복사해 주세요.');
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

function openTextImport(sourceLabel = '') {
  closeDialog(elements.connectionsDialog);
  elements.bulkText.value = '';
  state.bulkCandidates = [];
  renderBulkCandidates();
  openDialog(elements.bulkDialog);
  elements.bulkText.focus();
  if (sourceLabel) showToast(`${sourceLabel} 내용을 붙여넣으면 운송장 후보만 찾아드려요.`);
}

function showGmailSetup() {
  elements.connectionNotice.textContent = 'Gmail 자동 연결은 Google 동의 화면과 이 사이트용 OAuth 설정이 필요한 기능이에요. Google Cloud에서 Gmail API와 웹용 Client ID를 만들고, 허용된 JavaScript 원본에 https://snumaster.github.io 를 등록한 뒤 공개 Client ID만 설정하면 됩니다. Gmail 비밀번호·Client secret·장기 토큰은 이 사이트에 넣지 않아요.';
}

async function importFromGmail() {
  if (!cloud.user) {
    closeDialog(elements.connectionsDialog);
    await openAccount();
    showAuthNotice('Gmail에서 후보를 찾으려면 먼저 택배허브 계정에 로그인해 주세요.');
    return;
  }
  if (!GMAIL_CONFIG.clientId) {
    showGmailSetup();
    return;
  }

  const originalLabel = elements.gmailConnectButton.textContent;
  elements.gmailConnectButton.disabled = true;
  elements.gmailConnectButton.textContent = 'Gmail 확인 중…';
  try {
    const result = await findGmailTrackingCandidates({
      clientId: GMAIL_CONFIG.clientId,
      existingNumbers: state.items.map(item => item.tracking),
    });
    state.bulkCandidates = result.candidates;
    renderBulkCandidates();
    closeDialog(elements.connectionsDialog);
    openDialog(elements.bulkDialog);
    elements.bulkText.value = '';
    elements.bulkText.focus();
    showToast(result.candidates.length
      ? `조건과 맞는 Gmail 메일 ${result.messagesScanned}개에서 ${result.candidates.length}개 후보를 찾았어요.`
      : `조건과 맞는 Gmail 메일 ${result.messagesScanned}개를 확인했지만 새 운송장 후보는 없어요.`);
  } catch (error) {
    elements.connectionNotice.textContent = String(error?.message || 'Gmail을 읽지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    elements.gmailConnectButton.disabled = false;
    elements.gmailConnectButton.textContent = originalLabel;
  }
}

function showNaverSetup() {
  elements.connectionNotice.textContent = '네이버 메일은 일반 비밀번호를 절대 입력하면 안 돼요. 외부 메일 연결을 쓰려면 네이버에서 IMAP을 켜고 앱 비밀번호를 따로 만든 뒤, 일회성 보안 연결을 설정해야 해요. 그전에는 메일을 복사해 가져올 수 있어요.';
}

function iphoneShortcutEndpoint() {
  return `${SUPABASE_CONFIG.url}/functions/v1/iphone-shortcut-ingest`;
}

function formatShortcutDate(value) {
  const time = Date.parse(value || '');
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(time));
}

function clearIphoneShortcutSecret() {
  iphoneShortcut.secret = '';
  elements.iphoneShortcutKey.value = '';
  elements.iphoneShortcutSecretPanel.hidden = true;
}

function renderIphoneShortcutSetup() {
  const connection = iphoneShortcut.connection;
  const connected = Boolean(connection?.connected);
  elements.iphoneShortcutEndpoint.value = iphoneShortcutEndpoint();
  elements.iphoneShortcutCreateButton.hidden = connected;
  elements.iphoneShortcutRotateButton.hidden = !connected;
  elements.iphoneShortcutRevokeButton.hidden = !connected;
  elements.iphoneShortcutCreateButton.disabled = iphoneShortcut.loading;
  elements.iphoneShortcutRotateButton.disabled = iphoneShortcut.loading;
  elements.iphoneShortcutRevokeButton.disabled = iphoneShortcut.loading;

  if (iphoneShortcut.loading) {
    elements.iphoneShortcutStatus.textContent = '연결 상태를 확인하는 중…';
    elements.iphoneShortcutStatusDetail.textContent = '';
    return;
  }
  if (!connected) {
    elements.iphoneShortcutStatus.textContent = '아직 연결되지 않음';
    elements.iphoneShortcutStatusDetail.textContent = '연결 키를 만들면 이 계정의 iPhone 단축어 한 대를 연결할 수 있어요.';
    return;
  }
  elements.iphoneShortcutStatus.textContent = `연결됨 · 키 끝 ${connection.secretHint}`;
  const lastUsed = formatShortcutDate(connection.lastUsedAt);
  elements.iphoneShortcutStatusDetail.textContent = lastUsed
    ? `마지막 자동 등록 시도: ${lastUsed}`
    : '아직 자동 등록된 메시지가 없어요. iPhone에서 단축어 설정을 마친 뒤 배송 메시지로 확인해 보세요.';
}

function readableShortcutError(error, fallback) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('unauthorized') || message.includes('401')) return '로그인 상태를 다시 확인해 주세요.';
  if (message.includes('forbidden') || message.includes('403')) return '이 사이트에서만 연결 설정을 할 수 있어요.';
  if (message.includes('already_connected') || message.includes('409')) return '이미 연결된 iPhone 자동 등록이 있어요. 연결 코드를 바꾸거나 해제할 수 있어요.';
  return fallback;
}

async function callIphoneShortcutSetup(action) {
  const client = await initializeCloud();
  if (!client || !cloud.user) throw new Error('unauthorized');
  const { data, error } = await client.functions.invoke('iphone-shortcut-setup', {
    body: { action },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'temporary_failure');
  return data;
}

async function loadIphoneShortcutStatus() {
  iphoneShortcut.loading = true;
  renderIphoneShortcutSetup();
  try {
    const result = await callIphoneShortcutSetup('status');
    iphoneShortcut.connection = result.connection || null;
    elements.iphoneShortcutNotice.textContent = '';
  } catch (error) {
    iphoneShortcut.connection = null;
    elements.iphoneShortcutNotice.textContent = readableShortcutError(error, 'iPhone 자동 등록 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    iphoneShortcut.loading = false;
    renderIphoneShortcutSetup();
  }
}

async function openIphoneShortcutSetup() {
  if (!cloud.user) {
    closeDialog(elements.connectionsDialog);
    await openAccount();
    showAuthNotice('iPhone 자동 등록을 연결하려면 먼저 택배허브 계정에 로그인해 주세요.');
    return;
  }
  clearIphoneShortcutSecret();
  elements.iphoneShortcutNotice.textContent = '';
  closeDialog(elements.connectionsDialog);
  openDialog(elements.iphoneShortcutDialog);
  await loadIphoneShortcutStatus();
}

async function changeIphoneShortcutConnection(action) {
  const rotating = action === 'rotate';
  if (rotating && !window.confirm('기존 iPhone 연결 코드는 바로 작동하지 않게 돼요. 새 코드로 바꿀까요?')) return;
  if (action === 'revoke' && !window.confirm('iPhone 자동 등록을 해제할까요? 이 iPhone의 기존 연결 코드는 바로 사용할 수 없게 돼요.')) return;

  iphoneShortcut.loading = true;
  renderIphoneShortcutSetup();
  try {
    const result = await callIphoneShortcutSetup(action);
    iphoneShortcut.connection = result.connection || null;
    if (result.secret) {
      iphoneShortcut.secret = result.secret;
      elements.iphoneShortcutKey.value = result.secret;
      elements.iphoneShortcutSecretPanel.hidden = false;
      elements.iphoneShortcutNotice.textContent = '연결 키를 한 번만 표시했어요. iPhone 단축어에 붙여넣은 뒤 이 창을 닫아 주세요.';
    } else {
      clearIphoneShortcutSecret();
      elements.iphoneShortcutNotice.textContent = 'iPhone 자동 등록을 해제했어요.';
    }
  } catch (error) {
    elements.iphoneShortcutNotice.textContent = readableShortcutError(error, '연결 설정을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    iphoneShortcut.loading = false;
    renderIphoneShortcutSetup();
  }
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
  item.updatedAt = nextMutationTimestamp(item.updatedAt);
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
  markDeleted(item.tracking, item.updatedAt);
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
  clearTombstones(additions.map(item => item.tracking));
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
  const restoredItems = added.map(item => {
    const tombstone = state.deletedItems.find(candidate => candidate.tracking === item.tracking);
    return {
      ...item,
      id: createId(),
      carrierOrigin: 'imported',
      updatedAt: nextMutationTimestamp(tombstone?.updatedAt),
    };
  });
  state.items.unshift(...restoredItems);
  clearTombstones(restoredItems.map(item => item.tracking));
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

elements.accountOpenButton.addEventListener('click', () => void openAccount());
elements.accountCloseButton.addEventListener('click', () => closeDialog(elements.accountDialog));
elements.authModeTabs.addEventListener('click', event => {
  const button = event.target.closest('[data-auth-mode]');
  if (!button) return;
  setAuthMode(button.dataset.authMode);
});
elements.authForm.addEventListener('submit', event => void submitAuth(event));
elements.authResetButton.addEventListener('click', () => void requestPasswordReset());
elements.passwordRecoveryForm.addEventListener('submit', event => void updatePassword(event));
elements.localImportMergeButton.addEventListener('click', importLocalCacheIntoAccount);
elements.localImportDiscardButton.addEventListener('click', discardLocalCacheAndLoadAccount);
elements.accountSyncButton.addEventListener('click', () => void syncCloud({ announce: true }));
elements.syncNowButton.addEventListener('click', () => void syncCloud({ announce: true }));
elements.accountSignOutButton.addEventListener('click', () => void signOut());

elements.connectionsOpenButton.addEventListener('click', () => {
  elements.connectionNotice.textContent = cloud.user
    ? '연동에서 찾은 번호도 추가 전에 직접 확인하게 됩니다.'
    : '계정에 로그인하면 가져온 목록도 다른 기기와 동기화할 수 있어요.';
  openDialog(elements.connectionsDialog);
});
elements.connectionsCloseButton.addEventListener('click', () => closeDialog(elements.connectionsDialog));
elements.iphoneShortcutSetupButton.addEventListener('click', () => void openIphoneShortcutSetup());
elements.iphoneImportButton.addEventListener('click', () => openTextImport('아이폰에서 복사한 문자'));
elements.iphoneShortcutCloseButton.addEventListener('click', () => {
  clearIphoneShortcutSecret();
  closeDialog(elements.iphoneShortcutDialog);
});
elements.iphoneShortcutDialog.addEventListener('close', clearIphoneShortcutSecret);
elements.iphoneShortcutCreateButton.addEventListener('click', () => void changeIphoneShortcutConnection('create'));
elements.iphoneShortcutRotateButton.addEventListener('click', () => void changeIphoneShortcutConnection('rotate'));
elements.iphoneShortcutRevokeButton.addEventListener('click', () => void changeIphoneShortcutConnection('revoke'));
elements.iphoneShortcutCopyEndpointButton.addEventListener('click', () => void copyTrackingNumber(elements.iphoneShortcutEndpoint.value, false, '보낼 주소를 복사했어요.'));
elements.iphoneShortcutCopyKeyButton.addEventListener('click', () => void copyTrackingNumber(elements.iphoneShortcutKey.value, false, 'iPhone 연결 키를 복사했어요.'));
elements.gmailManualButton.addEventListener('click', () => openTextImport('Gmail 메일'));
elements.naverManualButton.addEventListener('click', () => openTextImport('네이버 메일'));
elements.gmailSetupButton.addEventListener('click', showGmailSetup);
elements.gmailConnectButton.addEventListener('click', () => void importFromGmail());
elements.naverSetupButton.addEventListener('click', showNaverSetup);

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
    item.updatedAt = nextMutationTimestamp(item.updatedAt);
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
updateCloudPresentation();
void initializeCloud();

