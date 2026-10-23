import { groupRepeatedCasts } from './feed-groups.js';
import { hasMedia, isGifEmbedUrl, isImageEmbedUrl, isReply, isVideoEmbedUrl, topicsForCast, visibleByFeedOptions } from './feed-curation.js';
import { STATION_NARRATION, STATION_VOICES } from './station-voice.js';
import { createTimeCapsule, parseTimeCapsules, capsuleDateLabel } from './time-capsules.js';
import { isStationAccessAllowed } from './station-access.js';
import { deriveRecoveryAccountCandidates, findRegisteredRecoveryAccount, isSupportedRecoveryPhraseLength, takeRecoveryPhrase } from './recovery-phrase.js';
import { resultOrThrow } from './hub-result.js';
import { BrowserEd25519Signer } from './browser-signer.js';
import { inject, pageview } from '@vercel/analytics';

const ANALYTICS_CONSENT_STORAGE = 'castonaut.analytics-consent.v1';
let analyticsEnabled = false;

function enableAnalytics() {
  if (!import.meta.env.PROD || analyticsEnabled) return;
  inject({
    disableAutoTrack: true,
    beforeSend: (event) => {
      try { if (localStorage.getItem(ANALYTICS_CONSENT_STORAGE) !== 'yes') return null; }
      catch { return null; }
      const url = new URL(event.url);
      url.search = '';
      url.hash = '';
      return { ...event, url: url.toString() };
    },
  });
  analyticsEnabled = true;
}

try { if (localStorage.getItem(ANALYTICS_CONSENT_STORAGE) === 'yes') enableAnalytics(); } catch { /* Analytics stays off when consent cannot be read. */ }

const $ = (selector) => document.querySelector(selector);
const FARCASTER_EPOCH_MS = Date.UTC(2021, 0, 1);
const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const LEGACY_KEY_STORAGE = 'openroom.snapchain.signer.v1';
const SIGNER_DB = 'castonaut-security';
const SIGNER_STORE = 'signers';
const DESK_STORAGE = 'packet-porch.desk-pins.v1';
const DESK_CASTS_STORAGE = 'castonaut.desk-casts.v1';
const DESK_TOPICS_STORAGE = 'castonaut.desk-topics.v1';
const PROFILE_NOTES_STORAGE = 'castonaut.profile-notes.v1';
const FLIGHT_LOG_STORAGE = 'castonaut.flight-log.v1';
const REMOTE_MEDIA_STORAGE = 'castonaut.remote-media.v1';
const REPEAT_GROUPING_STORAGE = 'castonaut.group-repeats.v1';
const THEME_STORAGE = 'castonaut.theme.v1';
const VOICE_STORAGE = 'castonaut.station-voice.v1';
const FRIENDS_STORAGE = 'castonaut.friends.v1';
const CREW_STORAGE = 'castonaut.crew.v1';
const CREW_NAME_STORAGE = 'castonaut.crew-name.v1';
const MUTED_AUTHORS_STORAGE = 'castonaut.muted-authors.v1';
const MUTED_TOPICS_STORAGE = 'castonaut.muted-topics.v1';
const FEED_OPTIONS_STORAGE = 'castonaut.feed-options.v1';
const FEED_SCROLL_STORAGE = 'castonaut.feed-scroll.v1';
const COMPOSE_STORAGE = 'castonaut.compose.v1';
const PROFILE_PINS_STORAGE = 'castonaut.profile-pins.v1';
const PROFILE_COVERS_STORAGE = 'castonaut.profile-covers.v1';
const TIME_CAPSULES_STORAGE = 'castonaut.time-capsules.v1';
const LOCAL_BACKUP_VERSION = 1;
const PORTABLE_STORAGE_KEYS = [DESK_STORAGE, DESK_CASTS_STORAGE, DESK_TOPICS_STORAGE, PROFILE_NOTES_STORAGE, FLIGHT_LOG_STORAGE, REMOTE_MEDIA_STORAGE, REPEAT_GROUPING_STORAGE, THEME_STORAGE, VOICE_STORAGE, FRIENDS_STORAGE, CREW_STORAGE, CREW_NAME_STORAGE, MUTED_AUTHORS_STORAGE, MUTED_TOPICS_STORAGE, FEED_OPTIONS_STORAGE, FEED_SCROLL_STORAGE, PROFILE_PINS_STORAGE, PROFILE_COVERS_STORAGE];
const PASS_WALLET_STORAGE = 'castonaut.pass-wallet.v1';
const PASS_CONTRACT_ADDRESS = String(import.meta.env.VITE_PASS_CONTRACT_ADDRESS || '').trim();
const CONTEST_ACCESS = String(import.meta.env.VITE_CONTEST_ACCESS || '').toLowerCase() === 'true';
const ID_REGISTRY_ADDRESS = '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b';
const ID_REGISTRY_ABI = [{ type: 'function', name: 'idOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: 'fid', type: 'uint256' }] }];
const state = { fid: null, signer: null, publicKey: '', custodyAddress: '', signerReady: false, passWallet: '', passWalletConnected: false, passExpiry: 0, passBusy: false, capsules: [], activeCapsule: '', nodeInfo: null, casts: [], visibleCasts: [], messages: new Map(), people: new Map(), following: new Map(), sourceBySigner: new Map(), conversation: null, parent: null, threadRoot: null, threadItems: [], threadPending: null, pendingCast: null, feedQuery: '', feedBusy: false, feedMoreBusy: false, feedPending: null, feedRequest: 0, feedSources: [], feedSourceOffset: 0, feedFollowTotal: 0, feedMode: 'following', feedTargetFid: null, boardMode: 'signals', profileTab: 'posts', savedCasts: [], deskPins: [], deskCasts: [], deskTopics: [], activeDeskTopic: '', friendFids: [], crewFids: [], crewName: 'Crew', mutedAuthors: [], mutedTopics: [], profilePins: {}, profileCovers: {}, profileNotes: {}, remoteMediaEnabled: false, groupRepeats: true, repliesOnly: false, mediaOnly: false, appsOnly: false, orbitOnly: false, compactMode: false, feedScroll: {} };
let pendingWalletAccount = null;
let pendingRecoveryAccount = null;
let refreshSignerFlow = false;
let feedScrollSaved = false;
const profileRequests = new Map();
const signerSourceRequests = new Map();
const signerSourcesLoaded = new Set();
let optimismToolkitPromise;
let timePassModulePromise;

function optimismToolkit() {
  if (!optimismToolkitPromise) optimismToolkitPromise = import('./optimism-toolkit.js');
  return optimismToolkitPromise;
}

function optimismReadTransport(fallback, http) {
  return fallback([
    http('https://mainnet.optimism.io', { retryCount: 1, timeout: 8000 }),
    http('https://optimism-rpc.publicnode.com', { retryCount: 1, timeout: 8000 }),
  ]);
}
function timePassModule() { if (!timePassModulePromise) timePassModulePromise = import('./time-pass.js'); return timePassModulePromise; }
function isAddress(value) { return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value); }
function isConfiguredPassAddress(value) { return isAddress(value); }
function findConnectedPassWallet(savedWallet, accounts) { return isAddress(savedWallet) && Array.isArray(accounts) ? accounts.find((account) => isAddress(account) && account.toLowerCase() === savedWallet.toLowerCase()) || '' : ''; }
function formatPassCountdown(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, Math.floor(Number(expiresAt) - now / 1000));
  if (!remaining) return 'Pass expired';
  const days = Math.floor(remaining / 86_400), hours = Math.floor((remaining % 86_400) / 3_600), minutes = Math.floor((remaining % 3_600) / 60);
  return days ? `${days}d ${String(hours).padStart(2, '0')}h left` : `${hours}h ${String(minutes).padStart(2, '0')}m left`;
}

try { state.passWallet = localStorage.getItem(PASS_WALLET_STORAGE) || ''; } catch { /* A pass can still be connected for this visit. */ }

function setStationTone() {
  const hour = new Date().getHours();
  document.documentElement.dataset.stationTone = hour < 10 ? 'morning' : hour < 16 ? 'day' : hour < 20 ? 'evening' : 'night';
}
function hasStationAccess() {
  return isStationAccessAllowed({
    contestAccess: CONTEST_ACCESS,
    passContractConfigured: isConfiguredPassAddress(PASS_CONTRACT_ADDRESS),
    passExpiry: state.passExpiry,
  });
}
function openAccessMode() {
  return CONTEST_ACCESS || !isConfiguredPassAddress(PASS_CONTRACT_ADDRESS);
}
function accessReadyMessage() {
  return openAccessMode() ? 'Account verified. Castonaut is ready.' : 'Account verified. Your Time Pass is active.';
}
if (CONTEST_ACCESS) document.documentElement.dataset.contestAccess = 'true';
function setTheme(theme) {
  const validThemes = ['atlas', 'night-radio'];
  const selected = validThemes.includes(theme) ? theme : 'atlas';
  document.documentElement.dataset.theme = selected;
  const picker = document.querySelector('#theme-select');
  if (picker && picker.value !== selected) picker.value = selected;
}
try { setTheme(localStorage.getItem(THEME_STORAGE) || 'atlas'); } catch { setTheme('atlas'); }
setStationTone();

try {
  const pins = JSON.parse(localStorage.getItem(DESK_STORAGE) || '[]');
  if (Array.isArray(pins)) state.deskPins = [...new Set(pins.map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0))].slice(0, 24);
} catch { /* The desk stays usable when local storage is unavailable. */ }
try {
  const casts = JSON.parse(localStorage.getItem(DESK_CASTS_STORAGE) || '[]');
  if (Array.isArray(casts)) state.deskCasts = casts.filter((cast) => cast && Number.isSafeInteger(Number(cast.fid)) && Number(cast.fid) > 0 && /^0x[\da-f]{40,64}$/i.test(String(cast.hash || '')) && typeof cast.text === 'string').slice(0, 8);
  const topics = JSON.parse(localStorage.getItem(DESK_TOPICS_STORAGE) || '[]');
  if (Array.isArray(topics)) state.deskTopics = [...new Set(topics.filter((topic) => typeof topic === 'string' && /^#[\p{L}\p{N}_]{2,40}$|^site:[a-z\d.-]{1,253}$/iu.test(topic)))].slice(0, 12);
} catch { /* The personal desk stays usable if a saved shortcut is malformed. */ }
try {
  const storedNotes = JSON.parse(localStorage.getItem(PROFILE_NOTES_STORAGE) || '{}');
  if (storedNotes && typeof storedNotes === 'object' && !Array.isArray(storedNotes)) state.profileNotes = storedNotes;
} catch { /* Local profile touches are optional. */ }
try { state.remoteMediaEnabled = localStorage.getItem(REMOTE_MEDIA_STORAGE) === 'true'; } catch { /* Remote media stays off when browser storage is unavailable. */ }
try { state.groupRepeats = localStorage.getItem(REPEAT_GROUPING_STORAGE) !== 'false'; } catch { /* Repeated links are grouped by default. */ }
function readLocalFids(key) {
  try {
    const values = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(values) ? [...new Set(values.map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0))].slice(0, 36) : [];
  } catch { return []; }
}
state.friendFids = readLocalFids(FRIENDS_STORAGE);
state.crewFids = readLocalFids(CREW_STORAGE);
state.mutedAuthors = readLocalFids(MUTED_AUTHORS_STORAGE);
try {
  state.crewName = (localStorage.getItem(CREW_NAME_STORAGE) || 'Crew').trim().slice(0, 20) || 'Crew';
  state.mutedTopics = JSON.parse(localStorage.getItem(MUTED_TOPICS_STORAGE) || '[]').filter((topic) => typeof topic === 'string').slice(0, 80);
  state.profilePins = JSON.parse(localStorage.getItem(PROFILE_PINS_STORAGE) || '{}');
  state.profileCovers = JSON.parse(localStorage.getItem(PROFILE_COVERS_STORAGE) || '{}');
  state.feedScroll = JSON.parse(localStorage.getItem(FEED_SCROLL_STORAGE) || '{}');
  const options = JSON.parse(localStorage.getItem(FEED_OPTIONS_STORAGE) || '{}');
  state.repliesOnly = options.repliesOnly === true;
  state.mediaOnly = options.mediaOnly === true;
  state.appsOnly = options.appsOnly === true;
  state.orbitOnly = options.orbitOnly === true;
  state.compactMode = options.compactMode === true;
} catch { /* These optional preferences use their defaults when local storage is unavailable. */ }
let selectedVoice = 'navigator';
try {
  const savedVoice = localStorage.getItem(VOICE_STORAGE);
  if (STATION_VOICES.some((voice) => voice.id === savedVoice)) selectedVoice = savedVoice;
} catch { /* The first voice remains selected for this visit. */ }

function openSignerDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SIGNER_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SIGNER_STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open protected browser key storage.'));
  });
}

async function storeSigner(record) {
  const db = await openSignerDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(SIGNER_STORE, 'readwrite');
      transaction.objectStore(SIGNER_STORE).put({ ...record, id: 'active' });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not save the app key in browser key storage.'));
      transaction.onabort = () => reject(transaction.error || new Error('Saving the app key was cancelled by browser storage.'));
    });
  } finally { db.close(); }
}

async function loadSigner() {
  const db = await openSignerDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(SIGNER_STORE, 'readonly').objectStore(SIGNER_STORE).get('active');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read browser key storage.'));
    });
  } finally { db.close(); }
}

async function removeStoredSigner() {
  try {
    const db = await openSignerDb();
    try { await new Promise((resolve, reject) => {
      const transaction = db.transaction(SIGNER_STORE, 'readwrite');
      transaction.objectStore(SIGNER_STORE).delete('active');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not delete the browser app key.'));
      transaction.onabort = () => reject(transaction.error || new Error('Deleting the browser app key was cancelled.'));
    }); } finally { db.close(); }
    return true;
  } catch { return false; }
}

async function clearPendingRegistration() {
  try {
    const saved = await loadSigner();
    if (saved?.signedKeyAdd) {
      delete saved.signedKeyAdd;
      await storeSigner(saved);
    }
  } catch { /* A confirmed key remains usable if browser storage cleanup fails. */ }
}

async function createBrowserSigner() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) throw new Error('This browser cannot securely store a signing key. Update your browser or use a current desktop browser.');
  try {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return { signer: new BrowserEd25519Signer(pair.privateKey, publicKey), publicKey, privateKey: pair.privateKey };
  } catch (error) {
    throw new Error(`Secure app-key support is unavailable in this browser: ${error.message}`);
  }
}

async function importLegacySigner(saved) {
  const bytes = fromBase64(saved.key);
  if (bytes.length !== 32) throw new Error('Stored app key has an invalid length.');
  // PKCS#8 Ed25519 wrapper around the legacy 32-byte seed. The import is explicitly non-extractable.
  const prefix = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
  const pkcs8 = new Uint8Array(prefix.length + bytes.length); pkcs8.set(prefix); pkcs8.set(bytes, prefix.length);
  let privateKey;
  try { privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']); }
  finally { bytes.fill(0); pkcs8.fill(0); }
  const { NobleEd25519Signer } = await import('./protocol.js');
  const legacyBytes = fromBase64(saved.key);
  let publicKey;
  try {
    const oldSigner = new NobleEd25519Signer(legacyBytes);
    publicKey = new Uint8Array(resultOrThrow(await oldSigner.getSignerKey(), 'Could not verify the saved app key'));
  } finally { legacyBytes.fill(0); }
  if (bytesHex(publicKey).toLowerCase() !== String(saved.publicKey).toLowerCase()) throw new Error('Saved app key does not match its registered public key.');
  return { privateKey, publicKey };
}

function setNotice(message, kind = 'info') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.hidden = false;
  clearTimeout(setNotice.timer);
  setNotice.timer = setTimeout(() => { toast.hidden = true; }, 5600);
}

function setConnectionStatus(message, { canRetry = false, canRefresh = false, busy = false } = {}) {
  const refreshChoice = refreshSignerFlow && !busy && !canRetry && !state.signerReady;
  $('#dialog-status').textContent = message;
  $('#recovery-import').hidden = busy || canRetry || !!pendingWalletAccount || (!!state.signer && !refreshChoice) || state.signerReady;
  const canAuthorizeWallet = !!pendingWalletAccount && !canRetry && !state.signerReady && !busy;
  $('#wallet-connect').hidden = canRetry || state.signerReady || !!pendingWalletAccount || (!!state.signer && !refreshChoice) || busy;
  $('#wallet-review').hidden = !canAuthorizeWallet;
  $('#wallet-authorize').hidden = !canAuthorizeWallet || busy;
  $('#wallet-change').hidden = !canAuthorizeWallet || busy;
  $('#check-signer').hidden = !canRetry;
  $('#refresh-signer').hidden = !canRefresh;
}

function clearWalletReview() {
  pendingWalletAccount = null;
  $('#wallet-review-fid').textContent = '';
  $('#wallet-review-address').textContent = '';
  $('#wallet-review').hidden = true;
  $('#wallet-authorize').hidden = true;
  $('#wallet-change').hidden = true;
}

function openConnectDialog() {
  if (!state.signer && !state.signerReady) clearWalletReview();
  if (state.signer && !state.signerReady) {
    setConnectionStatus('Your app key is saved in this browser. Check whether Snapchain has confirmed it before creating anything else.', { active: 'approve', completed: ['sign'], canRetry: true });
  } else if (state.signerReady) {
    setConnectionStatus('This browser is connected and ready for social actions.', { active: 'done', completed: ['sign', 'approve', 'done'] });
  } else {
    setConnectionStatus('', { active: 'sign', completed: [], canRetry: false });
  }
  $('#connect-dialog').showModal();
  $('#connect-title').focus({ preventScroll: true });
}

async function nodeRequest(route, params = {}, options = {}) {
  const url = new URL('/api/snapchain', window.location.origin);
  url.searchParams.set('route', route);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const { timeoutMs = 18_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = fetchOptions.signal
    ? AbortSignal.any([fetchOptions.signal, controller.signal])
    : controller.signal;
  try {
    const response = await fetch(url, { ...fetchOptions, signal, headers: { accept: 'application/json', ...(fetchOptions.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || body.details || `Node request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted && !fetchOptions.signal?.aborted) {
      throw new Error('The node took too long to respond. Your signed key is saved in this browser; choose “Check connection again” before trying to authorize again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function asFid(value) {
  const raw = String(value ?? '').trim();
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw new Error('Enter a valid Farcaster ID (a positive whole number with up to 15 digits).');
  const fid = Number(raw);
  if (!Number.isSafeInteger(fid)) throw new Error('Enter a valid Farcaster ID (a positive whole number with up to 15 digits).');
  return fid;
}

function farcasterDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'time unknown';
  const date = new Date(FARCASTER_EPOCH_MS + n * 1000);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function signerHex(value) {
  if (typeof value === 'string') return value.toLowerCase().startsWith('0x') ? value.toLowerCase() : `0x${value.toLowerCase()}`;
  if (value && typeof value[Symbol.iterator] === 'function') return `0x${Array.from(value, (byte) => Number(byte).toString(16).padStart(2, '0')).join('')}`;
  return '';
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

function makeRemoteImage(url, className = '') {
  const image = document.createElement('img');
  image.className = ['remote-image', className].filter(Boolean).join(' ');
  image.src = url;
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  return image;
}

function unwrapMessages(response) {
  if (Array.isArray(response?.messages)) return response.messages;
  if (Array.isArray(response?.items)) return response.items;
  if (response?.data?.castAddBody || response?.data?.userDataBody || response?.data?.linkBody) return [response];
  return [];
}

function latestUserData(messages) {
  const latest = new Map();
  const numericTypes = { 1: 'pfp', 2: 'display', 3: 'bio', 5: 'url', 6: 'username', 10: 'banner' };
  for (const message of messages) {
    const body = message?.data?.userDataBody;
    if (!body) continue;
    const type = typeof body.type === 'number' ? numericTypes[body.type] : String(body.type || '').replace('USER_DATA_TYPE_', '').toLowerCase();
    if (!type) continue;
    const timestamp = Number(message?.data?.timestamp || 0);
    const previous = latest.get(type);
    if (!previous || timestamp >= previous.timestamp) latest.set(type, { value: body.value, timestamp });
  }
  return Object.fromEntries([...latest].map(([type, entry]) => [type, entry.value]));
}

function decodeRequesterFid(metadataValue) {
  try {
    const bytes = typeof metadataValue === 'string'
      ? (/^0x(?:[0-9a-f]{2})+$/i.test(metadataValue)
        ? Uint8Array.from(metadataValue.slice(2).match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)))
        : fromBase64(metadataValue))
      : Uint8Array.from(metadataValue || []);
    if (bytes.length < 32) return null;
    const fid = Number(BigInt(bytesHex(bytes).slice(0, 66)));
    return Number.isSafeInteger(fid) && fid > 0 ? fid : null;
  } catch { return null; }
}

async function mapLimit(items, limit, callback) {
  const result = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { result[index] = await callback(items[index], index); } catch { result[index] = null; }
    }
  }));
  return result;
}

async function fetchProfile(fid) {
  fid = Number(fid);
  if (state.people.has(fid)) return state.people.get(fid);
  if (profileRequests.has(fid)) return profileRequests.get(fid);
  const request = (async () => {
  const userData = await nodeRequest('userData', { fid, pageSize: 20, reverse: true }).catch(() => ({ messages: [] }));
  const fields = latestUserData(unwrapMessages(userData));
  const profile = { fid, name: fields.display || fields.username || `Farcaster ${fid}`, username: fields.username || `fid-${fid}`, avatar: fields.pfp || '', bio: fields.bio || '' };
  state.people.set(fid, profile);
  return profile;
  })();
  profileRequests.set(fid, request);
  try { return await request; } finally { profileRequests.delete(fid); }
}

async function fetchSignerSources(fid) {
  fid = Number(fid);
  if (signerSourcesLoaded.has(fid)) return;
  if (signerSourceRequests.has(fid)) return signerSourceRequests.get(fid);
  const request = (async () => {
  const signers = await nodeRequest('signers', { fid, pageSize: 100 });
  const signerRows = Array.isArray(signers.signers) ? signers.signers : (signers.messages || []);
  for (const row of signerRows) {
    const keyBody = row?.data?.keyAddBody || row?.data?.signerAddBody || row;
    const signer = signerHex(keyBody.key || keyBody.signer);
    let clientFid = Number(keyBody.requesterFid || keyBody.request_fid || keyBody.sourceFid || row.requesterFid || 0) || null;
    if (!clientFid && keyBody.metadata) clientFid = decodeRequesterFid(keyBody.metadata);
    if (signer && clientFid && clientFid !== fid) state.sourceBySigner.set(signer, clientFid);
  }
  signerSourcesLoaded.add(fid);
  })();
  signerSourceRequests.set(fid, request);
  try { return await request; } finally { signerSourceRequests.delete(fid); }
}

async function loadSignerSources(messages) {
  const fids = [...new Set(messages.map((message) => Number(message?.data?.fid)).filter((fid) => Number.isSafeInteger(fid) && fid > 0))];
  await mapLimit(fids, 6, fetchSignerSources);
}

function setNodeState(kind, title, detail) {
  document.body.dataset.nodeState = kind;
  const browseNote = $('#public-browse-note');
  if (browseNote && document.body.dataset.accountView !== 'member') browseNote.hidden = kind !== 'good';
  const led = $('#node-led');
  if (led) led.className = `node-led ${kind}`;
  $('#node-state').textContent = title;
  $('#node-detail').textContent = detail;
  const largeLed = $('#node-led-large'); if (largeLed) largeLed.className = `node-led large ${kind}`;
  const largeState = $('#node-state-large'); if (largeState) largeState.textContent = title;
  const largeDetail = $('#node-detail-large'); if (largeDetail) largeDetail.textContent = detail;
  $('#status-live').textContent = kind === 'good' ? '● READY' : kind === 'bad' ? '● UNAVAILABLE' : '● CHECKING';
  const journeyLed = $('#node-journey-led'); if (journeyLed) journeyLed.className = `node-led${kind ? ` ${kind}` : ''}`;
  const journeyState = $('#node-journey-state'); if (journeyState) journeyState.textContent = title;
  const journeyDetail = $('#node-journey-detail'); if (journeyDetail) journeyDetail.textContent = detail;
}

function readPortableData() {
  const local = {};
  for (const key of PORTABLE_STORAGE_KEYS) {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) local[key] = value;
    } catch { /* A blocked preference is simply omitted from the portable backup. */ }
  }
  if (state.fid) {
    for (const key of [`${FLIGHT_LOG_STORAGE}:${state.fid}`, `${TIME_CAPSULES_STORAGE}:${state.fid}`]) {
      try { const value = localStorage.getItem(key); if (value !== null) local[key] = value; } catch { /* Other portable data remains available. */ }
    }
  }
  return local;
}

function setBackupStatus(message, isError = false) {
  const status = $('#backup-status');
  if (status) { status.textContent = message; status.dataset.state = isError ? 'error' : 'ok'; }
}

function exportLocalBackup() {
  try {
    const backup = { format: 'castonaut-local-backup', version: LOCAL_BACKUP_VERSION, createdAt: new Date().toISOString(), accountFid: state.fid || null, data: readPortableData() };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `castonaut-backup-${state.fid || 'local'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupStatus(`Backup exported${state.fid ? ` for FID ${state.fid}` : ''}. Keep the file somewhere safe.`);
  } catch { setBackupStatus('Could not create the backup file. Check browser storage and try again.', true); }
}

function validateLocalBackup(value) {
  if (!value || value.format !== 'castonaut-local-backup' || value.version !== LOCAL_BACKUP_VERSION || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('This is not a supported Castonaut backup.');
  if (value.accountFid !== null && value.accountFid !== undefined && (!Number.isSafeInteger(Number(value.accountFid)) || Number(value.accountFid) < 1)) throw new Error('The backup has an invalid account identifier.');
  const isAccountKey = (key, root) => {
    if (!key.startsWith(`${root}:`)) return false;
    const fid = Number(key.slice(root.length + 1));
    return Number.isSafeInteger(fid) && fid > 0;
  };
  const allowed = new Set([...PORTABLE_STORAGE_KEYS, ...Object.keys(value.data).filter((key) => isAccountKey(key, TIME_CAPSULES_STORAGE) || isAccountKey(key, FLIGHT_LOG_STORAGE))]);
  const entries = Object.entries(value.data);
  if (!entries.length || entries.length > 24 || entries.some(([key, raw]) => !allowed.has(key) || typeof raw !== 'string' || raw.length > 2_000_000)) throw new Error('The backup contains unsupported data or exceeds the size limit.');
  for (const [key, raw] of entries) {
    let parsed;
    if ([THEME_STORAGE, VOICE_STORAGE, CREW_NAME_STORAGE].includes(key)) parsed = raw;
    else try { parsed = JSON.parse(raw); } catch { throw new Error(`The backup has invalid data for ${key.replace(/^castonaut\./, '')}.`); }
    if (key === THEME_STORAGE && !['atlas', 'night-radio'].includes(raw)) throw new Error('The backup has an unsupported theme setting.');
    if (key.startsWith(`${TIME_CAPSULES_STORAGE}:`)) {
      if (!Array.isArray(parsed) || parsed.length > 14 || parseTimeCapsules(raw).length !== parsed.length) throw new Error('The backup contains an invalid Time Capsule archive.');
    }
    else if (key.startsWith(`${FLIGHT_LOG_STORAGE}:`)) {
      if (!Array.isArray(parsed) || parsed.length > 100 || parsed.some((cast) => !cast || !Number.isSafeInteger(Number(cast.fid)) || Number(cast.fid) < 1 || !/^0x[\da-f]{40,64}$/i.test(String(cast.hash || '')) || typeof cast.text !== 'string')) throw new Error('The backup contains an invalid Flight Log.');
    } else if ([DESK_STORAGE, FRIENDS_STORAGE, CREW_STORAGE, MUTED_AUTHORS_STORAGE].includes(key)) {
      const max = key === DESK_STORAGE ? 24 : 36;
      if (!Array.isArray(parsed) || parsed.length > max || parsed.some((fid) => !Number.isSafeInteger(Number(fid)) || Number(fid) < 1)) throw new Error('The backup contains an invalid people list.');
    } else if (key === DESK_CASTS_STORAGE && (!Array.isArray(parsed) || parsed.length > 8 || parsed.some((cast) => !cast || !Number.isSafeInteger(Number(cast.fid)) || Number(cast.fid) < 1 || !/^0x[\da-f]{40,64}$/i.test(String(cast.hash || '')) || typeof cast.text !== 'string'))) throw new Error('The backup contains an invalid saved signal list.');
    else if (key === DESK_TOPICS_STORAGE && (!Array.isArray(parsed) || parsed.length > 12 || parsed.some((topic) => typeof topic !== 'string' || !/^#[\p{L}\p{N}_]{2,40}$|^site:[a-z\d.-]{1,253}$/iu.test(topic)))) throw new Error('The backup contains invalid topic shortcuts.');
    else if ([REMOTE_MEDIA_STORAGE, REPEAT_GROUPING_STORAGE].includes(key) && !['true', 'false'].includes(raw)) throw new Error('The backup contains an invalid on/off preference.');
    else if (key === VOICE_STORAGE && !STATION_VOICES.some((voice) => voice.id === raw)) throw new Error('The backup contains an unsupported station voice.');
    else if (key === CREW_NAME_STORAGE && raw.length > 20) throw new Error('The backup contains an invalid crew name.');
    else if (key === PROFILE_COVERS_STORAGE && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.values(parsed).some((cover) => !['atlas', 'dawn', 'orbit', 'dusk'].includes(cover)))) throw new Error('The backup contains an invalid profile appearance.');
    else if (key === PROFILE_PINS_STORAGE && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.entries(parsed).some(([fid, hash]) => !/^\d+$/.test(fid) || Number(fid) < 1 || !/^0x[\da-f]{40,64}$/i.test(String(hash))))) throw new Error('The backup contains invalid pinned posts.');
    else if (key === MUTED_TOPICS_STORAGE && (!Array.isArray(parsed) || parsed.length > 80 || parsed.some((topic) => typeof topic !== 'string' || topic.length > 260))) throw new Error('The backup contains invalid muted topics.');
    else if (key === FEED_OPTIONS_STORAGE && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.values(parsed).some((setting) => typeof setting !== 'boolean'))) throw new Error('The backup contains invalid feed preferences.');
  }
  return entries;
}

async function importLocalBackup(file) {
  try {
    if (!file || file.size > 8_000_000) throw new Error('Choose a backup file smaller than 8 MB.');
    const backup = JSON.parse(await file.text());
    const entries = validateLocalBackup(backup);
    const accountKeys = entries.filter(([key]) => key.startsWith(`${FLIGHT_LOG_STORAGE}:`) || key.startsWith(`${TIME_CAPSULES_STORAGE}:`));
    if (accountKeys.length && state.fid && accountKeys.some(([key]) => Number(key.split(':').at(-1)) !== Number(state.fid))) throw new Error('This backup belongs to a different Farcaster account. Sign into that account to restore its saved posts.');
    const summary = `Restore ${entries.length} saved items/settings${backup.accountFid ? ` for FID ${backup.accountFid}` : ''}? Matching browser data will be replaced. Signing keys and recovery phrases are not part of this file.`;
    if (!confirm(summary)) return;
    const previous = new Map();
    try {
      for (const [key] of entries) previous.set(key, localStorage.getItem(key));
      for (const [key, raw] of entries) localStorage.setItem(key, raw);
    } catch (error) {
      for (const [key, value] of previous) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* Best-effort restore of the pre-import value. */ } }
      throw error;
    }
    if (state.fid) { loadFlightLog(state.fid); loadCapsules(state.fid); }
    state.deskPins = readLocalFids(DESK_STORAGE); state.friendFids = readLocalFids(FRIENDS_STORAGE); state.crewFids = readLocalFids(CREW_STORAGE); state.mutedAuthors = readLocalFids(MUTED_AUTHORS_STORAGE);
    try { state.deskCasts = JSON.parse(localStorage.getItem(DESK_CASTS_STORAGE) || '[]'); state.deskTopics = JSON.parse(localStorage.getItem(DESK_TOPICS_STORAGE) || '[]'); state.profileNotes = JSON.parse(localStorage.getItem(PROFILE_NOTES_STORAGE) || '{}'); state.mutedTopics = JSON.parse(localStorage.getItem(MUTED_TOPICS_STORAGE) || '[]'); state.crewName = localStorage.getItem(CREW_NAME_STORAGE) || 'Crew'; const options = JSON.parse(localStorage.getItem(FEED_OPTIONS_STORAGE) || '{}'); Object.assign(state, { repliesOnly: options.repliesOnly === true, mediaOnly: options.mediaOnly === true, appsOnly: options.appsOnly === true, orbitOnly: options.orbitOnly === true, compactMode: options.compactMode === true }); state.groupRepeats = localStorage.getItem(REPEAT_GROUPING_STORAGE) !== 'false'; setTheme(localStorage.getItem(THEME_STORAGE) || 'atlas'); } catch { /* Values were parsed during validation; recover through the normal render paths if storage has a browser limit. */ }
    renderDesk(); renderDeskShortcuts(); renderFeed(); renderFlightLogCount(); setBackupStatus(`Restored ${entries.length} items/settings${backup.accountFid ? ` for FID ${backup.accountFid}` : ''}.`); setNotice('Your Castonaut backup is restored on this device.', 'success');
  } catch (error) { setBackupStatus(error.message || 'Could not read that backup file.', true); }
  finally { const input = $('#backup-file'); if (input) input.value = ''; }
}

function formatNodeDelay(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds)));
  if (!Number.isFinite(value)) return 'unknown';
  if (value >= 31_557_600) {
    const years = Math.floor(value / 31_557_600);
    const months = Math.floor((value % 31_557_600) / 2_629_746);
    return [years && `${years} year${years === 1 ? '' : 's'}`, months && `${months} month${months === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  }
  if (value >= 86_400) return `${Math.floor(value / 86_400)} days`;
  if (value >= 3_600) return `${Math.floor(value / 3_600)} hours`;
  if (value >= 60) return `${Math.floor(value / 60)} minutes`;
  return `${value} seconds`;
}

async function checkNode() {
  const small = $('#refresh-node'); if (small) small.disabled = true;
  const large = $('#refresh-node-large');
  if (large) large.disabled = true;
  setNodeState('', 'Checking the app connection…', 'Checking the service that powers your feed.');
  try {
    const info = await nodeRequest('info');
    const setupLink = $('#node-setup-link'); if (setupLink) setupLink.hidden = true;
    state.nodeInfo = info;
    const shards = info.shardInfos || [];
    const delays = shards.map((shard) => Number(shard.blockDelay)).filter(Number.isFinite);
    const maxDelay = delays.length ? Math.max(...delays) : null;
    const telemetryDelay = $('#telemetry-delay'); if (telemetryDelay) telemetryDelay.textContent = maxDelay === null ? '—' : formatNodeDelay(maxDelay);
    const meter = $('#delay-meter'); if (meter) meter.value = maxDelay === null ? 0 : Math.max(6, Math.min(100, maxDelay * 3));
    const version = $('#node-version'); if (version) version.textContent = info.version || 'Unknown';
    const shardCount = $('#node-shards'); if (shardCount) shardCount.textContent = `${shards.length || info.numShards || '—'} ACTIVE`;
    const inSync = maxDelay !== null && maxDelay <= 10;
    const title = inSync ? 'Snapchain is ready' : 'The feed is catching up';
    const detail = inSync ? 'Connected. Sign in to open your feed.' : `Connected, but the feed is not current: its latest network data is about ${maxDelay === null ? 'an unknown amount' : formatNodeDelay(maxDelay)} behind.`;
    setNodeState(inSync ? 'good' : '', title, detail);
    const foot = $('#telemetry-foot'); if (foot) foot.textContent = inSync ? 'Connection and network freshness are healthy.' : 'Connection works; feed results may be incomplete until catch-up finishes.';
    const list = $('#shard-list');
    if (list) list.replaceChildren();
    for (const shard of list ? (info.shardInfos || []) : []) {
      const row = document.createElement('div'); row.className = 'shard-row';
      const label = document.createElement('span'); label.textContent = Number(shard.shardId) === 0 ? 'BLOCK SHARD' : `SHARD ${shard.shardId}`;
      const height = document.createElement('strong'); height.textContent = `HEIGHT ${Number(shard.maxHeight || 0).toLocaleString()}`;
      const delay = document.createElement('small'); delay.textContent = `${formatNodeDelay(shard.blockDelay || 0)} behind`;
      row.append(label, height, delay); list.append(row);
    }
  } catch (error) {
    state.nodeInfo = null;
    const telemetryDelay = $('#telemetry-delay'); if (telemetryDelay) telemetryDelay.textContent = '—';
    const meter = $('#delay-meter'); if (meter) meter.value = 0;
    const version = $('#node-version'); if (version) version.textContent = 'Not connected';
    const shardCount = $('#node-shards'); if (shardCount) shardCount.textContent = '—';
    const list = $('#shard-list');
    if (list) { const empty = document.createElement('div'); empty.className = 'empty-shards'; empty.textContent = 'App service is not connected.'; list.replaceChildren(empty); }
    const needsSetup = /SNAPCHAIN_URL|not configured|not been configured/i.test(error.message);
    const setupLink = $('#node-setup-link'); if (setupLink) setupLink.hidden = !needsSetup;
    if (setupLink && needsSetup) setupLink.textContent = 'See feed setup ↗';
    const localPreview = ['localhost', '127.0.0.1'].includes(location.hostname);
    const detail = needsSetup
      ? localPreview ? 'Live posts need a synced node.' : 'Live posts need a Snapchain endpoint.'
      : 'Try again when the node is ready.';
    const message = needsSetup ? (localPreview ? 'Preview mode' : 'Node setup needed') : 'Node unavailable';
    setNodeState('bad', message, detail);
    const largeDetail = $('#node-detail-large'); if (largeDetail) largeDetail.textContent = needsSetup ? detail : error.message;
    const foot = $('#telemetry-foot'); if (foot) foot.textContent = needsSetup ? 'Account sign-in opens after setup.' : 'Try the connection again in a moment.';
  } finally {
    if (small) small.disabled = false;
    if (large) large.disabled = false;
  }
}

function renderEmpty(title, copy, action = null) {
  const box = document.createElement('div'); box.className = 'empty-message';
  const strong = document.createElement('strong'); strong.textContent = title;
  const p = document.createElement('p'); p.textContent = copy;
  box.append(strong, p);
  if (action?.type === 'retry') {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.textContent = action.label;
    button.addEventListener('click', () => loadFeed(state.feedTargetFid || state.fid, state.feedMode));
    box.append(button);
  } else if (action?.type === 'guide') {
    const link = document.createElement('a'); link.className = 'button button-outline'; link.href = '/tutorial.html'; link.textContent = action.label;
    box.append(link);
  } else if (action?.type === 'profile') {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.textContent = action.label;
    button.addEventListener('click', () => loadFeed(state.feedTargetFid || state.fid, 'profile'));
    box.append(button);
  } else if (action?.type === 'clear-source') {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.textContent = action.label;
    button.addEventListener('click', () => { $('#source-fid').value = ''; $('#source-mode').value = 'include'; renderFeed(); });
    box.append(button);
  }
  $('#feed-list').replaceChildren(box);
  $('#feed-end').hidden = true;
}

function postHash(message) {
  const bytes = message?.hash;
  if (typeof bytes === 'string') return bytes.startsWith('0x') ? bytes : `0x${bytes}`;
  if (bytes && typeof bytes[Symbol.iterator] === 'function') return `0x${Array.from(bytes, (byte) => Number(byte).toString(16).padStart(2, '0')).join('')}`;
  return '';
}

function hashText(value) {
  if (typeof value === 'string') return value.startsWith('0x') ? value : `0x${value}`;
  if (value && typeof value[Symbol.iterator] === 'function') return `0x${Array.from(value, (byte) => Number(byte).toString(16).padStart(2, '0')).join('')}`;
  return '';
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

function originalCastUrl(profile, message) {
  const hash = postHash(message);
  if (!/^0x[\da-f]{40,64}$/i.test(hash)) return '';
  const username = String(profile?.username || '');
  if (!/^[a-z\d._-]{1,32}$/i.test(username) || /^fid-\d+$/.test(username)) return '';
  return `https://farcaster.xyz/${encodeURIComponent(username)}/${hash}`;
}

function updateFeedTabs() {
  const modes = ['following', 'friends', 'crew'];
  for (const mode of modes) {
    const button = document.querySelector(`[data-feed-tab="${mode}"]`);
    button.classList.toggle('is-active', state.boardMode === 'signals' && state.feedMode === mode);
    button.setAttribute('aria-pressed', String(state.boardMode === 'signals' && state.feedMode === mode));
  }
  $('#friend-count').textContent = String(state.friendFids.length);
  $('#crew-count').textContent = String(state.crewFids.length);
  $('#show-crew').firstChild.textContent = `${state.crewName} `;
  $('#crew-name').value = state.crewName;
  $('#show-flight-log').classList.toggle('is-active', state.boardMode === 'flight-log');
  $('#show-flight-log').setAttribute('aria-pressed', String(state.boardMode === 'flight-log'));
}

function feedScrollKey() {
  if (!state.fid) return '';
  const feed = state.boardMode === 'flight-log' ? 'flight-log' : state.feedMode;
  const target = feed === 'profile' ? state.feedTargetFid : state.fid;
  return `${Number(state.fid)}:${feed}:${Number(target) || 0}`;
}
function saveFeedScroll() {
  const key = feedScrollKey();
  if (!key) return;
  state.feedScroll[key] = Math.max(0, Math.round(window.scrollY));
  const keys = Object.keys(state.feedScroll);
  for (const oldKey of keys.slice(0, Math.max(0, keys.length - 30))) delete state.feedScroll[oldKey];
  try { localStorage.setItem(FEED_SCROLL_STORAGE, JSON.stringify(state.feedScroll)); } catch { /* Scroll restore is best-effort. */ }
}
function restoreFeedScroll() {
  const key = feedScrollKey();
  if (!key) return;
  requestAnimationFrame(() => window.scrollTo(0, Math.max(0, Number(state.feedScroll[key]) || 0)));
}
let scrollSaveTimer;
window.addEventListener('scroll', () => {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(saveFeedScroll, 180);
}, { passive: true });

function writeFidList(key, values) {
  const normalized = [...new Set(values.map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0))].slice(0, 36);
  try { localStorage.setItem(key, JSON.stringify(normalized)); return normalized; }
  catch { setNotice('This browser could not save that local list.', 'error'); return null; }
}

function renderMutedManager() {
  const manager = $('#muted-manager');
  const container = $('#muted-items');
  if (!manager || !container) return;
  container.replaceChildren();
  const entries = [
    ...state.mutedAuthors.map((fid) => ({ kind: 'author', value: String(fid), label: localProfileName(state.people.get(fid) || { fid, name: `FID ${fid}` }) })),
    ...state.mutedTopics.map((topic) => ({ kind: 'topic', value: topic, label: topic.replace(/^site:/, '') })),
  ];
  manager.hidden = !entries.length;
  for (const entry of entries) {
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'muted-chip';
    chip.dataset.unmuteKind = entry.kind; chip.dataset.unmuteValue = entry.value;
    chip.textContent = `${entry.label} ×`;
    container.append(chip);
  }
}

function saveFeedOptions() {
  try { localStorage.setItem(FEED_OPTIONS_STORAGE, JSON.stringify({ repliesOnly: state.repliesOnly, mediaOnly: state.mediaOnly, appsOnly: state.appsOnly, orbitOnly: state.orbitOnly, compactMode: state.compactMode })); } catch { /* Preferences still apply during this visit. */ }
  document.documentElement.classList.toggle('compact-mode', state.compactMode);
}

function setProfileCover(fid, cover) {
  if (cover === 'atlas') delete state.profileCovers[fid];
  else state.profileCovers[fid] = cover;
  try { localStorage.setItem(PROFILE_COVERS_STORAGE, JSON.stringify(state.profileCovers)); }
  catch { setNotice('This browser could not save the profile cover.', 'error'); return; }
  renderProfileSummary();
}

function menuAction(label, action, fid, extra = {}) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'post-more-action'; button.dataset.action = action;
  button.dataset.fid = String(fid);
  for (const [key, value] of Object.entries(extra)) button.dataset[key] = String(value);
  button.textContent = label;
  return button;
}

function renderCast(message) {
  if (message?.data?.fid && postHash(message)) {
    state.messages.set(`${Number(message.data.fid)}:${postHash(message)}`, message);
    if (state.messages.size > 500) state.messages.delete(state.messages.keys().next().value);
  }
  const data = message?.data || {};
  const body = data.castAddBody || {};
  const fid = Number(data.fid) || 0;
  const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}`, avatar: '' };
  const card = document.createElement('article'); card.className = 'post-card';
  card.dataset.castHash = postHash(message);
  const avatar = document.createElement('div'); avatar.className = 'post-avatar';
  avatar.textContent = (profile.name || '?').trim().slice(0, 1).toUpperCase();
  const avatarUrl = state.remoteMediaEnabled ? safeImageUrl(profile.avatar) : '';
  if (avatarUrl) avatar.replaceChildren(makeRemoteImage(avatarUrl));
  const content = document.createElement('div');
  const head = document.createElement('div'); head.className = 'post-head';
  const shownName = localProfileName(profile);
  const name = document.createElement('button'); name.type = 'button'; name.className = 'post-profile-link'; name.dataset.openProfile = String(fid); name.setAttribute('aria-label', `Open ${shownName}'s recent posts`); name.textContent = shownName;
  const handle = document.createElement('span'); handle.className = 'post-handle'; handle.textContent = `@${profile.username}`;
  const time = document.createElement('span'); time.className = 'post-time'; time.textContent = farcasterDate(data.timestamp);
  const source = document.createElement('span'); source.className = 'post-source';
  const sourceFid = state.sourceBySigner.get(signerHex(message.signer));
  source.textContent = sourceFid ? `APP FID ${sourceFid}` : 'SOURCE UNKNOWN';
  head.append(name, handle, time, source);
  const fullText = body.text || '(empty cast)';
  content.append(head);
  const parent = body.parentCastId;
  if (parent && Number(parent.fid) > 0 && parent.hash) {
    const parentHash = hashText(parent.hash);
    const parentMessage = state.casts.find((candidate) => Number(candidate?.data?.fid) === Number(parent.fid) && postHash(candidate) === parentHash);
    const parentProfile = state.people.get(Number(parent.fid));
    const context = document.createElement('div'); context.className = 'reply-context';
    context.append(document.createTextNode('↳ Reply to '));
    const label = document.createElement('span'); label.textContent = parentProfile ? `@${parentProfile.username}` : `FID ${Number(parent.fid)}`; context.append(label);
    if (parentMessage) {
      const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'reply-context-jump'; jump.dataset.focusCast = parentHash; jump.textContent = 'View above'; context.append(jump);
    } else if (parentProfile?.username && !/^fid-\d+$/.test(parentProfile.username) && /^0x[\da-f]{40,64}$/i.test(parentHash)) {
      const link = document.createElement('a'); link.href = `https://farcaster.xyz/${encodeURIComponent(parentProfile.username)}/${parentHash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open parent ↗'; context.append(link);
    }
    content.append(context);
  }
  if (fullText.length > 240) {
    const excerpt = document.createElement('p'); excerpt.className = 'post-copy post-excerpt'; excerpt.textContent = `${fullText.slice(0, 220).trimEnd()}…`;
    const expansion = document.createElement('details'); expansion.className = 'post-text-expansion';
    const summary = document.createElement('summary'); summary.textContent = 'Read full post';
    const full = document.createElement('p'); full.className = 'post-copy'; full.textContent = fullText;
    expansion.append(summary, full); content.append(excerpt, expansion);
  } else {
    const copy = document.createElement('p'); copy.className = 'post-copy'; copy.textContent = fullText;
    content.append(copy);
  }
  const embeds = [...(body.embeds || []), ...(body.embedsDeprecated || [])].filter((embed) => typeof embed?.url === 'string').slice(0, 4);
  const imageEmbed = embeds.find((embed) => isImageEmbedUrl(embed.url));
  const videoEmbed = embeds.find((embed) => isVideoEmbedUrl(embed.url));
  const mediaEmbed = imageEmbed || videoEmbed;
  if (mediaEmbed) {
    if (state.remoteMediaEnabled) {
      const mediaUrl = safeExternalUrl(mediaEmbed.url);
      if (mediaUrl && videoEmbed === mediaEmbed) {
        const media = document.createElement('details'); media.className = 'post-media post-video-media';
        const summary = document.createElement('summary'); summary.textContent = '▶ Play attached video'; summary.setAttribute('aria-label', 'Load and play attached video');
        const video = document.createElement('video'); video.className = 'post-video'; video.controls = true; video.playsInline = true; video.preload = 'none'; video.setAttribute('aria-label', `Video attached by ${shownName}`); video.dataset.src = mediaUrl.href;
        const videoFallback = document.createElement('span'); videoFallback.className = 'media-fallback'; videoFallback.hidden = true;
        videoFallback.append(document.createTextNode('Video unavailable · '));
        const videoLink = document.createElement('a'); videoLink.href = mediaUrl.href; videoLink.target = '_blank'; videoLink.rel = 'noopener noreferrer nofollow'; videoLink.textContent = 'open original';
        videoFallback.append(videoLink);
        video.addEventListener('error', () => { videoFallback.hidden = false; });
        media.addEventListener('toggle', () => {
          if (media.open && !video.dataset.loaded) { videoFallback.hidden = true; video.src = video.dataset.src; video.dataset.loaded = 'true'; video.load(); }
          if (!media.open) { video.pause(); video.removeAttribute('src'); video.dataset.loaded = ''; video.load(); }
        });
        media.append(summary, video, videoFallback); content.append(media);
      } else if (mediaUrl) {
        const media = document.createElement('figure'); media.className = 'post-media image-media';
        const isGif = isGifEmbedUrl(mediaEmbed.url);
        const imageLink = document.createElement('a'); imageLink.className = 'post-image-link'; imageLink.href = mediaUrl.href; imageLink.target = '_blank'; imageLink.rel = 'noopener noreferrer nofollow'; imageLink.setAttribute('aria-label', `Open ${isGif ? 'GIF' : 'image'} attached by ${shownName} in a new tab`);
        const image = makeRemoteImage(mediaUrl.href, 'post-image'); image.alt = `${isGif ? 'Animated GIF' : 'Image'} attached by ${shownName}`;
        const imageFallback = document.createElement('span'); imageFallback.className = 'media-fallback'; imageFallback.hidden = true;
        imageFallback.append(document.createTextNode(`${isGif ? 'GIF' : 'Image'} unavailable · `));
        const fallbackLink = document.createElement('a'); fallbackLink.href = mediaUrl.href; fallbackLink.target = '_blank'; fallbackLink.rel = 'noopener noreferrer nofollow'; fallbackLink.textContent = 'open original';
        imageFallback.append(fallbackLink);
        image.addEventListener('error', () => { image.hidden = true; imageFallback.hidden = false; });
        imageLink.append(image); media.append(imageLink, imageFallback); content.append(media);
      }
    } else {
      const mediaNote = document.createElement('span'); mediaNote.className = 'media-hidden-note';
      const kind = videoEmbed === mediaEmbed ? 'video' : isGifEmbedUrl(mediaEmbed.url) ? 'GIF' : 'image';
      mediaNote.textContent = `${kind} hidden · Media off`; mediaNote.title = 'Use the Media off control above the feed to load remote media. Hosts can see your IP address.'; content.append(mediaNote);
    }
  }
  const linkEmbed = embeds.find((embed) => embed !== imageEmbed && embed !== videoEmbed);
  const previewUrl = safeExternalUrl(linkEmbed?.url || String(body.text || '').match(/https?:\/\/[^\s<>"'`]+/i)?.[0]);
  if (previewUrl) {
    const preview = document.createElement('a'); preview.className = 'post-link-preview'; preview.href = previewUrl.href; preview.target = '_blank'; preview.rel = 'noopener noreferrer nofollow';
    const domain = document.createElement('strong'); domain.textContent = previewUrl.hostname.replace(/^www\./i, '');
    const path = document.createElement('span'); path.textContent = previewUrl.pathname === '/' ? 'Open linked page' : previewUrl.pathname;
    preview.append(domain, path, document.createTextNode('↗')); content.append(preview);
  }
  const actions = document.createElement('div'); actions.className = 'post-actions';
  const like = document.createElement('button'); like.type = 'button'; like.className = 'post-action'; like.textContent = '♡'; like.setAttribute('aria-label', 'Like cast'); like.title = 'Like'; like.dataset.action = 'like';
  like.setAttribute('aria-pressed', 'false');
  const recast = document.createElement('button'); recast.type = 'button'; recast.className = 'post-action'; recast.textContent = '⟳'; recast.setAttribute('aria-label', 'Recast'); recast.title = 'Recast'; recast.dataset.action = 'recast';
  recast.setAttribute('aria-pressed', 'false');
  const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'post-action'; reply.textContent = '↩'; reply.setAttribute('aria-label', 'Reply'); reply.title = 'Reply'; reply.dataset.action = 'reply';
  const conversation = document.createElement('button'); conversation.type = 'button'; conversation.className = 'post-action conversation-action'; conversation.textContent = '◌'; conversation.setAttribute('aria-label', 'Open conversation'); conversation.title = 'Conversation'; conversation.dataset.openConversation = 'true'; conversation.dataset.fid = String(fid); conversation.dataset.hash = postHash(message);
  const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'post-action'; follow.textContent = state.following.get(fid) ? '✓' : '＋'; follow.setAttribute('aria-label', state.following.get(fid) ? 'Unfollow' : 'Follow'); follow.title = state.following.get(fid) ? 'Unfollow' : 'Follow'; follow.dataset.action = 'follow'; follow.setAttribute('aria-pressed', String(!!state.following.get(fid)));
  const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'post-action pin-action'; pin.textContent = '⌖'; pin.setAttribute('aria-label', state.deskPins.includes(fid) ? 'Unpin person from Desk' : 'Pin person to Desk'); pin.title = pin.getAttribute('aria-label'); pin.dataset.action = 'pin-person';
  pin.setAttribute('aria-pressed', String(state.deskPins.includes(fid)));
  const deskSignal = document.createElement('button'); deskSignal.type = 'button'; deskSignal.className = 'post-action pin-action'; deskSignal.dataset.action = 'toggle-desk-cast'; deskSignal.dataset.fid = String(fid); deskSignal.dataset.hash = postHash(message);
  const signalSaved = state.deskCasts.some((cast) => Number(cast.fid) === fid && cast.hash === postHash(message));
  deskSignal.textContent = signalSaved ? '▣' : '⌑'; deskSignal.setAttribute('aria-label', signalSaved ? 'Remove cast from Desk' : 'Save cast to Desk'); deskSignal.title = deskSignal.getAttribute('aria-label'); deskSignal.setAttribute('aria-pressed', String(signalSaved));
  const flightLog = document.createElement('button'); flightLog.type = 'button'; flightLog.className = 'post-more-action flight-log-action';
  flightLog.dataset.flightLog = 'true'; flightLog.dataset.fid = String(fid); flightLog.dataset.hash = postHash(message);
  const saved = state.savedCasts.some((cast) => Number(cast.fid) === fid && cast.hash === postHash(message));
  flightLog.textContent = saved ? '★ Saved' : '☆ Save'; flightLog.setAttribute('aria-pressed', String(saved));
  for (const button of [like, recast, reply, follow, pin]) { button.dataset.fid = String(fid); button.dataset.hash = postHash(message); button.disabled = button !== pin && (!state.signerReady || (button === follow && fid === state.fid)); }
  const originalUrl = originalCastUrl(profile, message);
  actions.append(conversation, like, recast, reply, deskSignal);
  const more = document.createElement('details'); more.className = 'post-more';
  const moreSummary = document.createElement('summary'); moreSummary.textContent = '•••'; moreSummary.setAttribute('aria-label', 'More post actions');
  const menu = document.createElement('div'); menu.className = 'post-more-menu';
  const share = document.createElement('button'); share.type = 'button'; share.className = 'post-more-action'; share.dataset.shareCast = 'true'; share.dataset.fid = String(fid); share.dataset.hash = postHash(message); share.textContent = 'Copy conversation link'; menu.append(share);
  menu.append(menuAction(state.deskPins.includes(fid) ? 'Unpin person from Desk' : 'Pin person to Desk', state.deskPins.includes(fid) ? 'unpin-person' : 'pin-person', fid));
  menu.append(menuAction(state.following.get(fid) ? 'Unfollow person' : 'Follow person', 'follow', fid, { hash: postHash(message) }));
  menu.append(flightLog);
  menu.append(menuAction(state.friendFids.includes(fid) ? 'Remove friend' : 'Add friend', 'toggle-friend', fid));
  menu.append(menuAction(state.crewFids.includes(fid) ? `Remove from ${state.crewName}` : `Add to ${state.crewName}`, 'toggle-crew', fid));
  menu.append(menuAction(state.mutedAuthors.includes(fid) ? 'Unhide author' : 'Hide author', 'toggle-author-mute', fid));
  const topics = topicsForCast(message);
  const pinnedCast = state.deskCasts.some((cast) => Number(cast.fid) === fid && cast.hash === postHash(message));
  menu.append(menuAction(pinnedCast ? 'Remove signal from Desk' : 'Pin signal to Desk', 'toggle-desk-cast', fid, { hash: postHash(message) }));
  const deskTopic = topics.find((topic) => !state.deskTopics.includes(topic));
  if (deskTopic) menu.append(menuAction(`Pin topic ${deskTopic.replace(/^site:/, '')}`, 'toggle-desk-topic', fid, { topic: deskTopic }));
  if (topics.length) menu.append(menuAction(`Mute ${topics[0].replace(/^site:/, '')}`, 'mute-topic', fid, { topic: topics[0] }));
  if (originalUrl) { const open = document.createElement('a'); open.className = 'post-more-action'; open.href = originalUrl; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = 'Open original cast ↗'; menu.append(open); }
  const pinLabel = state.profilePins[fid] === postHash(message) ? 'Unpin from profile' : 'Pin to profile';
  menu.append(menuAction(pinLabel, 'toggle-profile-pin', fid, { hash: postHash(message) }));
  more.append(moreSummary, menu); actions.append(more);
  content.append(actions); card.append(avatar, content);
  return card;
}

async function loadFeed(fidValue = state.fid, mode = state.feedMode) {
  state.conversation = null;
  $('#conversation-view').hidden = true;
  $('#feed-list').hidden = false;
  const publicProfileRequest = mode === 'profile' && Number.isSafeInteger(Number(fidValue)) && Number(fidValue) > 0;
  if ((!state.fid || !state.signerReady) && !publicProfileRequest) {
    renderEmpty('Connect an account for your personal feed.', 'You can explore public profiles without signing in.');
    return;
  }
  if (!hasStationAccess() && !publicProfileRequest) { renderIdentity(); return; }
  if (state.feedBusy) { state.feedPending = [fidValue, mode]; feedScrollSaved = false; return; }
  if (!feedScrollSaved) saveFeedScroll();
  feedScrollSaved = false;
  let fid;
  try {
    fid = asFid(fidValue);
    if (mode !== 'profile' && fid !== Number(state.fid)) throw new Error('Feeds can only be opened for the connected Farcaster account.');
  } catch (error) {
    renderEmpty('Could not load this station.', error.message, { type: 'retry', label: 'Try again' });
    $('#feed-count').textContent = '0 POSTS';
    setNotice(error.message, 'error');
    return;
  }
  state.feedMode = ['profile', 'friends', 'crew'].includes(mode) ? mode : 'following';
  state.feedTargetFid = state.feedMode === 'profile' ? fid : Number(state.fid);
  state.feedSources = [];
  state.feedSourceOffset = 0;
  state.feedQuery = '';
  const loadedSearch = $('#loaded-search');
  if (loadedSearch) loadedSearch.value = '';
  renderFeedMore();
  renderIdentity();
  if (state.feedMode === 'profile' && fid !== Number(state.fid)) refreshFollowState(fid);
  updateFeedTabs();
  $('#page-label').textContent = state.feedMode === 'profile' ? 'PROFILE' : state.feedMode === 'crew' ? state.crewName.toUpperCase() : state.feedMode.toUpperCase();
  $('#composer').hidden = !state.signerReady || state.boardMode === 'flight-log';
  const requestId = ++state.feedRequest;
  state.casts = [];
  $('#feed-pulse').hidden = true;
  renderProfileSummary();
  state.feedBusy = true;
  const list = $('#feed-list'); list.setAttribute('aria-busy', 'true');
  const feedLabel = state.feedMode === 'profile' ? 'Profile' : state.feedMode === 'friends' ? 'Friends' : state.feedMode === 'crew' ? state.crewName : 'Following';
  if (state.boardMode === 'signals') {
    $('#feed-title').textContent = state.feedMode === 'profile' ? 'Posts' : feedLabel;
    $('#feed-caption').textContent = state.feedMode === 'profile' ? 'Recent posts from this profile.' : 'Newest first.';
  }
  renderEmpty('Tuning in…', state.feedMode === 'profile' ? 'Loading recent posts.' : 'Loading your feed.');
  try {
    if (!state.nodeInfo) checkNode();
    const [followResponse, profile] = await Promise.all([
      state.feedMode === 'following' ? nodeRequest('links', { fid, link_type: 'follow', pageSize: 100, reverse: true }) : Promise.resolve({ messages: [] }),
      fetchProfile(state.feedMode === 'profile' ? fid : Number(state.fid)),
    ]);
    const followFids = [...new Set(unwrapMessages(followResponse).map((message) => Number(message?.data?.linkBody?.targetFid)).filter((target) => Number.isSafeInteger(target) && target > 0 && target !== fid))];
    const uniqueFids = state.feedMode === 'profile' ? [fid]
      : state.feedMode === 'friends' ? [...state.friendFids]
        : state.feedMode === 'crew' ? [...state.crewFids]
          : [fid, ...new Set(followFids)].slice(0, 25);
    const limitedFids = [...new Set(uniqueFids)].filter((target) => Number.isSafeInteger(target) && target > 0).slice(0, 25);
    state.feedSources = state.feedMode === 'following' ? limitedFids : [];
    state.feedSourceOffset = state.feedMode === 'following' ? Math.min(6, limitedFids.length) : 0;
    state.feedFollowTotal = state.feedMode === 'following' ? followFids.length : 0;
    if (state.boardMode === 'signals') {
      $('#feed-title').textContent = state.feedMode === 'profile' ? 'Posts' : feedLabel;
      $('#feed-caption').textContent = state.feedMode === 'profile' ? `@${profile.username} · FID ${fid}` : 'Newest first.';
    }
    if (!limitedFids.length && ['friends', 'crew'].includes(state.feedMode)) {
      state.casts = [];
      renderFeed();
      $('#feed-filters').hidden = false;
      restoreFeedScroll();
      return true;
    }
    const firstPageFids = state.feedMode === 'following' ? limitedFids.slice(0, 6) : limitedFids;
    const castGroups = await mapLimit(firstPageFids, 6, async (target) => {
      const [response] = await Promise.all([nodeRequest('casts', { fid: target, pageSize: 12, reverse: true }), fetchProfile(target)]);
      return unwrapMessages(response).filter((message) => message?.data?.castAddBody);
    });
    if (requestId !== state.feedRequest) return false;
    const messages = castGroups.flat().sort((a, b) => Number(b.data.timestamp || 0) - Number(a.data.timestamp || 0)).slice(0, 60);
    state.casts = messages;
    if (Number($('#source-fid').value) > 0) await loadSignerSources(messages);
    const profileFids = [...new Set(messages.map((message) => Number(message?.data?.fid)).filter((value) => value > 0))];
    const missingProfiles = profileFids.filter((target) => !state.people.has(target));
    await mapLimit(missingProfiles, 8, fetchProfile);
    const missingPins = state.deskPins.filter((target) => !state.people.has(target));
    await mapLimit(missingPins, 6, fetchProfile);
    renderDesk();
    renderFeed();
    $('#feed-filters').hidden = state.boardMode === 'flight-log' || !state.casts.length;
    if (state.feedMode === 'profile') renderProfileSummary();
    if (!messages.length) $('#feed-count').textContent = '0 POSTS';
    renderFeedMore();
    updateFollowingCoverage();
    restoreFeedScroll();
    return true;
  } catch (error) {
    if (requestId !== state.feedRequest) return false;
    const needsSetup = /SNAPCHAIN_URL|not configured|not been configured/i.test(error.message);
    const localPreview = ['localhost', '127.0.0.1'].includes(location.hostname);
    const detail = needsSetup
      ? localPreview
        ? 'This local preview has no Snapchain endpoint, so profiles and posts cannot load yet. Use the node guide to connect one.'
        : 'The app’s Snapchain endpoint needs configuration before profiles and posts can load.'
      : error.message;
    const action = needsSetup
      ? (localPreview ? { type: 'guide', label: 'Open feed setup guide' } : null)
      : { type: 'retry', label: 'Try this account again' };
    renderEmpty(needsSetup ? 'Feed service is not connected yet.' : 'Could not build this feed.', detail, action);
    $('#feed-count').textContent = '0 POSTS';
    restoreFeedScroll();
    return false;
  } finally {
    state.feedBusy = false;
    list.setAttribute('aria-busy', 'false');
    if (state.feedPending) {
      const [pendingFid, pendingMode] = state.feedPending;
      state.feedPending = null;
      queueMicrotask(() => loadFeed(pendingFid, pendingMode));
    }
  }
}

function renderFeedMore() {
  const footer = $('#feed-end');
  const button = $('#feed-more');
  const label = $('.feed-end-label');
  if (!footer || !button) return false;
  const hasMore = state.boardMode === 'signals' && state.feedMode === 'following' && state.feedSourceOffset < state.feedSources.length;
  button.hidden = !hasMore;
  button.disabled = state.feedMoreBusy;
  const moreCount = Math.min(6, state.feedSources.length - state.feedSourceOffset);
  button.textContent = state.feedMoreBusy ? 'Loading more people…' : `Load posts from ${moreCount} more ${moreCount === 1 ? 'person' : 'people'}`;
  if (label) {
    label.hidden = hasMore;
    label.textContent = state.feedMode === 'following' && state.feedFollowTotal > Math.max(0, state.feedSources.length - 1)
      ? `FIRST ${Math.max(0, state.feedSources.length - 1)} OF ${state.feedFollowTotal} RETURNED FOLLOWS CHECKED`
      : 'END OF TRANSMISSION';
  }
  footer.hidden = !hasMore && state.casts.length === 0;
  return hasMore;
}

function updateFollowingCoverage() {
  const caption = $('#feed-caption');
  if (!caption || state.feedMode !== 'following' || state.boardMode !== 'signals') return;
  const loaded = Math.max(0, Math.min(state.feedFollowTotal, state.feedSourceOffset - (state.feedSources.length ? 1 : 0)));
  const available = Math.min(state.feedFollowTotal, Math.max(0, state.feedSources.length - 1));
  const capNote = state.feedFollowTotal > available ? ` · first ${available} of ${state.feedFollowTotal} returned` : '';
  caption.textContent = `Newest first · ${loaded} of ${available} follows checked in this lookup${capNote}.`;
}

async function loadMoreFollowed() {
  if (state.feedMoreBusy || state.feedMode !== 'following' || state.boardMode !== 'signals') return;
  const requestId = state.feedRequest;
  const start = state.feedSourceOffset;
  const batch = state.feedSources.slice(start, start + 6);
  if (!batch.length) return;
  state.feedMoreBusy = true;
  renderFeedMore();
  try {
    const groups = await mapLimit(batch, 6, async (target) => {
      const [response] = await Promise.all([
        nodeRequest('casts', { fid: target, pageSize: 12, reverse: true }),
        fetchProfile(target),
      ]);
      return unwrapMessages(response).filter((message) => message?.data?.castAddBody);
    });
    if (requestId !== state.feedRequest) return;
    const existing = new Set(state.casts.map((message) => `${Number(message?.data?.fid)}:${postHash(message)}`));
    for (const message of groups.flat()) {
      const key = `${Number(message?.data?.fid)}:${postHash(message)}`;
      if (!existing.has(key)) { existing.add(key); state.casts.push(message); }
    }
    state.casts.sort((a, b) => Number(b.data.timestamp || 0) - Number(a.data.timestamp || 0));
    state.feedSourceOffset = start + batch.length;
    await mapLimit([...new Set(state.casts.map((message) => Number(message?.data?.fid)).filter((fid) => fid > 0 && !state.people.has(fid)))], 6, fetchProfile);
    if (requestId !== state.feedRequest) return;
    renderFeed();
    updateFollowingCoverage();
    setNotice(`Loaded posts from ${batch.length} more ${batch.length === 1 ? 'person' : 'people'}.`, 'success');
  } catch (error) {
    if (requestId === state.feedRequest) setNotice(`Could not load more of your Following feed. ${error.message}`, 'error');
  } finally {
    state.feedMoreBusy = false;
    renderFeedMore();
  }
}

function renderFeed() {
  const requestedSource = state.boardMode === 'signals' ? Number($('#source-fid').value) || null : null;
  const exclude = $('#source-mode').value === 'exclude';
  const sourceMessages = state.boardMode === 'flight-log' ? state.savedCasts.map(savedCastMessage) : state.casts;
  const mutedTopics = new Set(state.mutedTopics);
  const query = state.feedQuery.trim().toLocaleLowerCase();
  const messages = sourceMessages.filter((message) => {
    if (state.boardMode === 'signals' && state.mutedAuthors.includes(Number(message?.data?.fid))) return false;
    if (state.boardMode === 'signals' && state.feedMode !== 'profile' && state.orbitOnly && !state.deskPins.includes(Number(message?.data?.fid))) return false;
    if (state.boardMode === 'signals' && state.feedMode === 'profile' && state.profileTab === 'media' && !hasMedia(message)) return false;
    if (state.boardMode === 'signals' && state.activeDeskTopic && !topicsForCast(message).includes(state.activeDeskTopic)) return false;
    const isProfilePin = state.feedMode === 'profile' && state.profilePins[state.feedTargetFid] === postHash(message);
    if (isProfilePin) return false;
    if (state.boardMode === 'signals' && !visibleByFeedOptions(message, {
      repliesOnly: state.repliesOnly,
      mediaOnly: state.mediaOnly || (state.feedMode === 'profile' && state.profileTab === 'media'),
      appsOnly: state.appsOnly,
      mutedTopics,
    })) return false;
    if (query) {
      const profile = state.people.get(Number(message?.data?.fid));
      const body = message?.data?.castAddBody || {};
      const searchable = [body.text, profile?.username, profile?.name, ...((body.embeds || []).map((embed) => embed?.url || embed?.castId?.hash || ''))].join(' ').toLocaleLowerCase();
      if (!searchable.includes(query)) return false;
    }
    const source = state.sourceBySigner.get(signerHex(message.signer)) || null;
    if (!requestedSource) return true;
    return exclude ? source !== requestedSource : source === requestedSource;
  });
  state.visibleCasts = messages;
  renderCapsuleShelf();
  $('#ai-catch-up').hidden = state.boardMode !== 'signals' || messages.length === 0;
  $('#ai-catch-up-result').hidden = true;
  const groups = state.boardMode === 'signals' && state.groupRepeats
    ? groupRepeatedCasts(messages)
    : messages.map((message) => ({ messages: [message], reason: null }));
  const repeatedGroupCount = groups.filter((group) => group.messages.length > 1).length;
  const list = $('#feed-list');
  $('#group-repeats-control').hidden = state.boardMode !== 'signals';
  $('#orbit-only-control').hidden = state.boardMode !== 'signals' || state.feedMode === 'profile';
  renderFeedPulse(messages);
  renderProfileSummary();
  renderMutedManager();
  if (!messages.length) {
    const sourceFilter = state.boardMode === 'signals' ? Number($('#source-fid').value) || null : null;
    if (state.boardMode === 'flight-log') {
      renderEmpty('Nothing saved yet.', 'Save a post from any feed to keep it here.');
    } else if (state.feedMode === 'following' && !state.casts.length && state.feedSourceOffset < state.feedSources.length) {
      renderEmpty('Your first group is quiet.', 'Load a wider group of people to check more of your follows.');
    } else if (query) {
      renderEmpty('No loaded posts match.', 'Search checks posts currently loaded in this view. Load more people first to widen the results.');
    } else if (state.casts.length && sourceFilter) {
      renderEmpty('No posts match this source.', 'Clear the source filter to see more posts.', { type: 'clear-source', label: 'Clear source' });
    } else if (state.feedMode === 'profile') {
      const profile = state.people.get(state.feedTargetFid);
      const isMediaTab = state.profileTab === 'media';
      renderEmpty(isMediaTab ? 'No media in this profile yet.' : 'No recent posts here.', isMediaTab ? 'Media appears here when this profile shares an image or link.' : profile ? `Recent posts from @${profile.username} will appear here.` : 'Recent posts from this profile will appear here.');
    } else if (state.feedMode === 'friends' && !state.friendFids.length) {
      renderEmpty('Your friends list is open.', 'Use ••• on a post to add someone. This list stays on this device.');
    } else if (state.feedMode === 'crew' && !state.crewFids.length) {
      renderEmpty(`${state.crewName} is ready.`, `Use ••• on a post to add people to ${state.crewName}. This group stays on this device.`);
    } else if (state.orbitOnly && !state.deskPins.length) {
      renderEmpty('No pinned people yet.', 'Pin someone from a post, then turn on this filter to see only their posts.');
    } else if (state.orbitOnly) {
      renderEmpty('No posts from pinned people here.', 'Try another feed or turn off the filter to see everyone you follow.');
    } else if (state.activeDeskTopic) {
      renderEmpty(`No posts match ${state.activeDeskTopic.replace(/^site:/, '')}.`, 'Try another feed or clear this topic shortcut.');
    } else if (state.casts.length) {
      renderEmpty('Nothing matches these filters.', 'Adjust View options to bring posts back.');
    } else {
      renderEmpty('Your feed is quiet.', 'Follow people on Farcaster to see their posts here.', { type: 'profile', label: 'View your posts' });
    }
    $('#feed-count').textContent = state.boardMode === 'flight-log' ? '0 SAVED' : '0 POSTS';
    const morePeople = renderFeedMore();
    if (!morePeople) $('#feed-end').hidden = true;
    return;
  }
  $('#feed-count').textContent = state.boardMode === 'flight-log'
    ? `${messages.length} SAVED`
    : `${requestedSource ? `${messages.length} OF ${state.casts.length}` : messages.length} POSTS${repeatedGroupCount ? ` · ${repeatedGroupCount} GROUPED` : ''}`;
  $('#feed-end').hidden = false;
  const fragment = document.createDocumentFragment();
  groups.forEach((group) => {
    if (group.messages.length === 1) { fragment.append(renderCast(group.messages[0])); return; }
    const cluster = document.createElement('section'); cluster.className = 'repeat-cluster';
    cluster.append(renderCast(group.messages[0]));
    const more = document.createElement('details'); more.className = 'repeat-cluster-more';
    const summary = document.createElement('summary');
    const people = new Set(group.messages.map((message) => Number(message?.data?.fid)).filter((fid) => fid > 0)).size;
    const itemLabel = group.reason === 'link' ? 'posts share this link' : 'matching posts';
    const updateSummary = () => { summary.textContent = `${group.messages.length} ${itemLabel}${people > 1 ? ` · ${people} people` : ''} · ${more.open ? 'Collapse' : 'Expand'} ${group.messages.length - 1} more`; };
    updateSummary();
    more.addEventListener('toggle', updateSummary);
    const others = document.createElement('div'); others.className = 'repeat-cluster-posts';
    group.messages.slice(1).forEach((message) => others.append(renderCast(message)));
    more.append(summary, others); cluster.append(more); fragment.append(cluster);
  });
  list.replaceChildren(fragment);
  renderFeedMore();
}

function localProfileName(profile) {
  const nickname = state.profileNotes[profile.fid]?.nickname;
  return typeof nickname === 'string' && nickname.trim() ? nickname.trim() : profile.name;
}

function renderFeedPulse(messages) {
  const panel = $('#feed-pulse');
  if (!panel) return;
  panel.hidden = !state.casts.length || state.boardMode === 'flight-log';
  if (!state.casts.length || state.boardMode === 'flight-log') return;
  const people = new Map();
  for (const message of messages) {
    const fid = Number(message?.data?.fid) || 0;
    if (fid) people.set(fid, (people.get(fid) || 0) + 1);
  }
  const busiest = [...people.entries()].sort((a, b) => b[1] - a[1])[0];
  const orbitPosts = messages.filter((message) => state.deskPins.includes(Number(message?.data?.fid))).length;
  const topicCounts = new Map();
  for (const message of messages) for (const topic of topicsForCast(message)) topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  const topTopic = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const stats = $('#pulse-stats');
  stats.replaceChildren();
  const addStat = (label, value) => {
    const item = document.createElement('div'); item.className = 'pulse-stat';
    const strong = document.createElement('strong'); strong.textContent = value;
    const small = document.createElement('small'); small.textContent = label;
    item.append(strong, small); stats.append(item);
  };
  addStat('signals in this view', String(messages.length));
  addStat('from your Orbit', `${orbitPosts} / ${messages.length}`);
  if (topTopic) addStat('recurring topic', `${topTopic[0].replace(/^site:/, '')} · ${topTopic[1]}`);
  if (busiest) {
    const profile = state.people.get(busiest[0]) || { fid: busiest[0], name: `FID ${busiest[0]}` };
    addStat('most active', `${localProfileName(profile)} · ${busiest[1]}`);
  }
  const busiestLabel = busiest ? `${localProfileName(state.people.get(busiest[0]) || { fid: busiest[0], name: `FID ${busiest[0]}` })} appears most` : '';
  const orbitHint = state.deskPins.length ? `${orbitPosts} from your pinned people` : 'Pin people to build your Orbit';
  const topicHint = topTopic ? ` · ${topTopic[0].replace(/^site:/, '')} repeats ${topTopic[1]} times` : '';
  $('#pulse-insight').textContent = `${busiestLabel ? `${busiestLabel} · ` : ''}${orbitHint}${topicHint}. Counted on this device from posts already loaded.`;
}

function renderProfileSummary() {
  const card = $('#profile-summary');
  if (!card) return;
  const isProfile = state.boardMode === 'signals' && state.feedMode === 'profile' && state.feedTargetFid;
  card.hidden = !isProfile;
  if (!isProfile) return;
  const profile = state.people.get(state.feedTargetFid) || { fid: state.feedTargetFid, name: `Farcaster ${state.feedTargetFid}`, username: `fid-${state.feedTargetFid}`, avatar: '', bio: '' };
  const local = state.profileNotes[profile.fid] || {};
  const shell = document.createElement('div'); shell.className = 'profile-summary-main';
  const cover = document.createElement('div');
  const coverTone = ['atlas', 'dawn', 'orbit', 'dusk'].includes(state.profileCovers[profile.fid]) ? state.profileCovers[profile.fid] : 'atlas';
  cover.className = 'profile-cover'; cover.dataset.cover = coverTone;
  const bannerUrl = state.remoteMediaEnabled ? safeImageUrl(profile.banner) : '';
  if (bannerUrl) { const banner = makeRemoteImage(bannerUrl, 'profile-cover-image'); banner.alt = `${localProfileName(profile)}’s profile cover`; cover.append(banner); }
  const avatar = document.createElement('span'); avatar.className = 'profile-summary-avatar'; avatar.textContent = localProfileName(profile).slice(0, 1).toUpperCase();
  const avatarUrl = state.remoteMediaEnabled ? safeImageUrl(profile.avatar) : '';
  if (avatarUrl) avatar.replaceChildren(makeRemoteImage(avatarUrl));
  const identity = document.createElement('div'); identity.className = 'profile-summary-identity';
  const name = document.createElement('h3'); name.textContent = localProfileName(profile);
  const handle = document.createElement('p'); handle.textContent = `@${profile.username} · FID ${profile.fid}`;
  identity.append(name, handle);
  if (profile.bio) { const bio = document.createElement('p'); bio.className = 'profile-summary-bio'; bio.textContent = profile.bio; identity.append(bio); }
  if (local.nickname || local.note) { const note = document.createElement('p'); note.className = 'profile-private-note'; note.textContent = local.note ? `Your note: ${local.note}` : 'Your personal nickname is saved on this device.'; identity.append(note); }
  const actions = document.createElement('div'); actions.className = 'profile-summary-actions';
  const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'button button-outline'; pin.dataset.profilePin = String(profile.fid); pin.textContent = state.deskPins.includes(profile.fid) ? 'On your Desk ✓' : 'Pin to Desk';
  const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'button button-outline'; follow.dataset.action = 'follow'; follow.dataset.fid = String(profile.fid); follow.textContent = Number(profile.fid) === Number(state.fid) ? 'This is you' : state.following.get(Number(profile.fid)) ? '✓ Following' : '＋ Follow'; follow.disabled = Number(profile.fid) === Number(state.fid) || !state.signerReady; follow.setAttribute('aria-pressed', String(!!state.following.get(Number(profile.fid))));
  const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button button-outline'; edit.dataset.editProfile = String(profile.fid); edit.textContent = 'Personalize';
  const share = document.createElement('button'); share.type = 'button'; share.className = 'button button-outline'; share.dataset.copyProfile = String(profile.fid); share.textContent = 'Share profile';
  const coverLabel = document.createElement('label'); coverLabel.className = 'cover-tone-control'; coverLabel.textContent = 'Cover';
  const coverSelect = document.createElement('select'); coverSelect.dataset.coverFid = String(profile.fid); coverSelect.setAttribute('aria-label', 'Choose a local profile cover');
  for (const [value, label] of [['atlas', 'Atlas'], ['dawn', 'Dawn'], ['orbit', 'Orbit'], ['dusk', 'Dusk']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = coverTone === value; coverSelect.append(option);
  }
  coverLabel.append(coverSelect); actions.append(pin, follow, share, edit, coverLabel); shell.append(avatar, identity, actions);
  const tabs = document.createElement('div'); tabs.className = 'profile-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Profile posts');
  const postCount = state.casts.length;
  const mediaCount = state.casts.filter(hasMedia).length;
  for (const [mode, label, count] of [['posts', 'Posts', postCount], ['media', 'Media', mediaCount]]) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = `profile-tab${state.profileTab === mode ? ' is-active' : ''}`;
    tab.dataset.profileTab = mode; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.profileTab === mode));
    tab.textContent = `${label} · ${count}`; tabs.append(tab);
  }
  const pinnedSlot = document.createElement('div'); pinnedSlot.className = 'profile-pinned-slot';
  const pinnedHash = state.profilePins[profile.fid];
  const pinned = state.casts.find((message) => postHash(message) === pinnedHash && Number(message?.data?.fid) === Number(profile.fid));
  if (pinned) {
    const label = document.createElement('div'); label.className = 'profile-pinned-label'; label.textContent = 'Pinned here · only you';
    pinnedSlot.append(label, renderCast(pinned));
  }
  cover.append(shell); card.replaceChildren(cover, tabs, pinnedSlot);
}

async function refreshFollowState(fid) {
  if (!state.fid || Number(fid) === Number(state.fid)) return;
  try { await nodeRequest('linkById', { fid: state.fid, target_fid: fid, link_type: 'follow' }); state.following.set(Number(fid), true); }
  catch (error) {
    if (/\(404\)/.test(error.message)) state.following.set(Number(fid), false);
    else return;
  }
  if (state.feedMode === 'profile' && Number(state.feedTargetFid) === Number(fid)) renderProfileSummary();
  document.querySelectorAll(`[data-action="follow"][data-fid="${Number(fid)}"]`).forEach((button) => {
    button.textContent = state.following.get(Number(fid)) ? 'Unfollow person' : 'Follow person';
    button.setAttribute('aria-pressed', String(!!state.following.get(Number(fid))));
  });
}

function setProfileRoute(fid) {
  history.pushState(null, '', `#profile=${Number(fid)}`);
}

async function searchProfile(rawQuery) {
  const status = $('#people-search-status');
  const form = $('#people-search');
  const submit = form.querySelector('button[type="submit"]');
  const query = String(rawQuery || '').trim().replace(/^@/, '');
  status.hidden = false;
  status.dataset.state = 'idle';
  if (!query) {
    status.dataset.state = 'error';
    status.textContent = 'Enter a username or Farcaster ID.';
    $('#people-query').focus();
    return;
  }
  form.setAttribute('aria-busy', 'true');
  submit.disabled = true;
  $('#people-query').disabled = true;
  status.dataset.state = 'loading';
  status.textContent = 'Looking up profile…';
  try {
    let fid;
    if (/^[1-9]\d{0,14}$/.test(query)) fid = asFid(query);
    else {
      const proof = await nodeRequest('username', { name: query });
      fid = asFid(proof.fid);
    }
    await fetchProfile(fid);
    $('#people-query').value = '';
    status.textContent = `Opening @${state.people.get(fid)?.username || `fid-${fid}`} · FID ${fid}.`;
    if (state.boardMode !== 'signals') setBoardMode('signals');
    setProfileRoute(fid);
    const feedLoaded = await loadFeed(fid, 'profile');
    status.dataset.state = feedLoaded ? 'success' : 'error';
    if (!feedLoaded) status.textContent = `Found @${state.people.get(fid)?.username || `fid-${fid}`} · the profile is open, but its posts could not be loaded.`;
    $('#profile-summary').focus({ preventScroll: true });
    window.setTimeout(() => { status.hidden = true; }, 2200);
  } catch (error) {
    status.dataset.state = 'error';
    const message = String(error?.message || '');
    if (/\(404\)/.test(message)) status.textContent = 'No Farcaster profile found. Check the spelling or try its FID.';
    else if (/SNAPCHAIN_URL|not configured|not been configured/i.test(message)) status.textContent = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'This local preview needs a Snapchain endpoint before search can work.'
      : 'The app’s Snapchain endpoint needs configuration before search can work.';
    else if (/failed to fetch|network|timed out|timeout/i.test(message)) status.textContent = 'Could not reach the feed service. Check your connection and try again.';
    else status.textContent = 'Could not find that profile. Please check the username or FID and try again.';
  } finally {
    form.removeAttribute('aria-busy');
    submit.disabled = false;
    $('#people-query').disabled = false;
  }
}

async function openConversation(fidValue, hashValue, { updateRoute = true } = {}) {
  const fid = asFid(fidValue);
  const hash = hashText(hashValue);
  if (!/^0x[\da-f]{40,64}$/i.test(hash)) { setNotice('This post has an invalid cast link.', 'error'); return; }
  state.conversation = { fid, hash };
  if (updateRoute) history.pushState(null, '', `#cast=${fid}/${hash}`);
  const panel = $('#conversation-view');
  const root = $('#conversation-root');
  const replies = $('#conversation-replies');
  const status = $('#conversation-status');
  panel.hidden = false;
  $('#feed-list').hidden = true;
  $('#composer').hidden = true;
  $('#feed-filters').hidden = true;
  $('#feed-pulse').hidden = true;
  $('#ai-catch-up').hidden = true;
  root.replaceChildren(); replies.replaceChildren();
  status.textContent = 'Loading the post and replies…';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#conversation-title').focus({ preventScroll: true });
  try {
    let original = state.casts.find((message) => Number(message?.data?.fid) === fid && postHash(message) === hash)
      || state.savedCasts.find((message) => Number(message.fid) === fid && message.hash === hash);
    if (original && !original.data) original = savedCastMessage(original);
    if (!original) original = await nodeRequest('castById', { fid, hash });
    const parent = original?.data?.castAddBody?.parentCastId;
    if (parent?.fid && parent?.hash) {
      try { original = await nodeRequest('castById', { fid: Number(parent.fid), hash: hashText(parent.hash) }); }
      catch { /* Keep the selected reply as the conversation root when its parent is unavailable. */ }
    }
    const rootFid = Number(original?.data?.fid) || fid;
    const rootHash = postHash(original) || hash;
    const response = await nodeRequest('replies', { fid: rootFid, hash: rootHash, pageSize: 100, reverse: true });
    const messages = unwrapMessages(response).filter((message) => message?.data?.castAddBody).sort((a, b) => Number(a.data.timestamp || 0) - Number(b.data.timestamp || 0));
    const profiles = [...new Set([rootFid, ...messages.map((message) => Number(message?.data?.fid)).filter(Boolean)])];
    await mapLimit(profiles, 6, fetchProfile);
    root.replaceChildren(renderCast(original));
    replies.replaceChildren(...messages.map(renderCast));
    $('#conversation-title').textContent = messages.length ? `${messages.length} ${messages.length === 1 ? 'reply' : 'replies'}` : 'A quiet thread';
    status.textContent = messages.length ? 'Replies are shown in chronological order.' : 'No replies found on this node yet.';
  } catch (error) {
    status.textContent = `Could not load this conversation. ${error.message}`;
  }
}

function closeConversation() {
  state.conversation = null;
  $('#conversation-view').hidden = true;
  $('#feed-list').hidden = false;
  $('#composer').hidden = !state.signerReady || state.boardMode === 'flight-log';
  $('#feed-filters').hidden = state.boardMode === 'flight-log' || !state.casts.length;
  $('#feed-pulse').hidden = !state.casts.length || state.boardMode === 'flight-log';
  history.pushState(null, '', state.feedMode === 'profile' ? `#profile=${Number(state.feedTargetFid)}` : '#desk');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openProfileEditor(fid) {
  const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}` };
  const local = state.profileNotes[fid] || {};
  $('#profile-edit-title').textContent = `Your notes for ${localProfileName(profile)}.`;
  $('#profile-nickname').value = local.nickname || '';
  $('#profile-note').value = local.note || '';
  $('#profile-edit-status').textContent = '';
  $('#profile-edit-dialog').dataset.fid = String(fid);
  $('#profile-edit-dialog').showModal();
}

function saveProfileTouch(fid, values) {
  const previous = state.profileNotes[fid];
  const nickname = values.nickname.trim().slice(0, 40);
  const note = values.note.trim().slice(0, 240);
  if (nickname || note) state.profileNotes[fid] = { nickname, note };
  else delete state.profileNotes[fid];
  try { localStorage.setItem(PROFILE_NOTES_STORAGE, JSON.stringify(state.profileNotes)); }
  catch {
    if (previous) state.profileNotes[fid] = previous;
    else delete state.profileNotes[fid];
    setNotice('Browser storage is unavailable. These profile touches could not be saved.', 'error');
    return false;
  }
  renderDesk(); renderFeed(); renderIdentity();
  setNotice('Your private profile touches are saved on this device.', 'success');
  return true;
}

function renderFirstOrbit() {
  const panel = $('#first-orbit');
  if (!panel) return;
  const progress = {
    person: state.deskPins.length > 0,
    signal: state.deskCasts.length > 0,
    page: state.capsules.length > 0,
  };
  const completed = Object.values(progress).filter(Boolean).length;
  panel.hidden = completed === 3;
  const count = $('#first-orbit-progress');
  if (count) count.textContent = `${completed} / 3`;
  for (const [step, done] of Object.entries(progress)) {
    const button = panel.querySelector(`[data-flight-step="${step}"]`);
    if (!button) continue;
    button.classList.toggle('is-complete', done);
    button.setAttribute('aria-label', `${button.querySelector('strong')?.textContent || 'Step'}${done ? ', complete' : ''}`);
    const mark = button.querySelector('.first-orbit-mark');
    if (mark) mark.textContent = done ? '✓' : '↗';
  }
}

function renderDesk() {
  const container = $('#desk-pins');
  if (!container) return;
  container.replaceChildren();
  if (!state.deskPins.length) {
    const empty = document.createElement('span'); empty.className = 'desk-empty'; empty.textContent = 'Pin a person from any post to keep them here.'; container.append(empty);
  } else {
    for (const fid of state.deskPins) {
      const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}`, avatar: '' };
      const chip = document.createElement('div'); chip.className = 'desk-person';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'desk-person-open'; open.dataset.deskFid = String(fid);
      const shownName = localProfileName(profile);
      const avatar = document.createElement('span'); avatar.className = 'desk-avatar'; avatar.textContent = shownName.slice(0, 1).toUpperCase();
      const avatarUrl = state.remoteMediaEnabled ? safeImageUrl(profile.avatar) : '';
      if (avatarUrl) avatar.replaceChildren(makeRemoteImage(avatarUrl));
      const labels = document.createElement('span'); labels.className = 'desk-person-label';
      const name = document.createElement('strong'); name.textContent = shownName;
      const handle = document.createElement('small'); handle.textContent = `@${profile.username}`;
      labels.append(name, handle); open.append(avatar, labels);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'desk-unpin'; remove.dataset.action = 'unpin-person'; remove.dataset.fid = String(fid); remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${shownName} from your desk`);
      chip.append(open, remove); container.append(chip);
    }
  }
  renderDeskShortcuts();
  renderCapsuleShelf();
  renderFirstOrbit();
}

function loadTimeCapsules(fid) {
  try { state.capsules = parseTimeCapsules(localStorage.getItem(`${TIME_CAPSULES_STORAGE}:${fid}`) || '[]'); }
  catch { state.capsules = []; }
  state.activeCapsule = '';
  renderCapsuleShelf();
}

function renderCapsuleShelf() {
  const shelf = $('#capsule-shelf');
  const seal = $('#capsule-seal');
  if (!shelf || !seal) return;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const savedToday = state.capsules.some((capsule) => capsule.date === today);
  seal.disabled = !state.signerReady || !state.visibleCasts.length || state.boardMode !== 'signals';
  seal.textContent = savedToday ? 'Update today’s page' : 'Save today’s page';
  const saveNote = $('#capsule-save-note');
  if (saveNote) saveNote.textContent = savedToday
    ? 'Today’s page is saved on this device. Update it with the feed currently in view.'
    : state.boardMode === 'flight-log'
      ? 'Open a live feed to save a page from today.'
      : 'Save this feed to revisit the people and signals from today.';
  shelf.replaceChildren();
  if (!state.capsules.length) {
    const empty = document.createElement('span'); empty.className = 'capsule-empty'; empty.textContent = 'Your first capsule will appear here.'; shelf.append(empty);
  } else {
    for (const capsule of state.capsules) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `capsule-chip${state.activeCapsule === capsule.date ? ' is-active' : ''}`;
      button.dataset.openCapsule = capsule.date; button.setAttribute('aria-pressed', String(state.activeCapsule === capsule.date));
      const date = document.createElement('strong'); date.textContent = capsuleDateLabel(capsule.date, { month: 'short', day: 'numeric' });
      const count = document.createElement('small'); count.textContent = `${capsule.casts.length} signals · ${capsule.feed}`;
      button.append(date, count); shelf.append(button);
    }
  }
  renderCapsuleReplay();
  renderFirstOrbit();
}

function renderCapsuleReplay() {
  const replay = $('#capsule-replay');
  const capsule = state.capsules.find((item) => item.date === state.activeCapsule);
  if (!replay) return;
  replay.hidden = !capsule;
  if (!capsule) return;
  $('#capsule-replay-title').textContent = `${capsuleDateLabel(capsule.date)} · ${capsule.feed}`;
  const list = $('#capsule-replay-list');
  list.replaceChildren();
  if (!capsule.casts.length) {
    const note = document.createElement('p'); note.className = 'capsule-empty'; note.textContent = 'This window had no posts to keep.'; list.append(note); return;
  }
  for (const cast of capsule.casts) {
    const card = document.createElement('article'); card.className = 'capsule-replay-post';
    const byline = document.createElement('span'); byline.textContent = `@${cast.username} · ${cast.timestamp ? farcasterDate(cast.timestamp) : 'saved signal'}`;
    const text = document.createElement('p'); text.textContent = cast.text;
    const link = document.createElement('a'); link.href = `https://farcaster.xyz/${encodeURIComponent(cast.username)}/${encodeURIComponent(cast.hash)}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open original ↗';
    card.append(byline, text, link); list.append(card);
  }
}

function sealTimeCapsule() {
  if (!state.fid || !state.visibleCasts.length) { setNotice('Load a feed window before saving a capsule.'); return; }
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const capsule = createTimeCapsule(state.visibleCasts, {
    date: localDate,
    feed: state.feedMode === 'crew' ? state.crewName : state.feedMode,
    savedAt: Date.now(),
    hashFor: postHash,
    usernameFor: (fid) => state.people.get(fid)?.username,
  });
  state.capsules = [capsule, ...state.capsules.filter((item) => item.date !== localDate)].slice(0, 14);
  try { localStorage.setItem(`${TIME_CAPSULES_STORAGE}:${state.fid}`, JSON.stringify(state.capsules)); }
  catch { setNotice('This browser could not save the capsule. Free some device storage and try again.', 'error'); return; }
  state.activeCapsule = localDate;
  renderCapsuleShelf();
  setNotice(`Saved ${capsule.casts.length} signals from today on this device.`, 'success');
}

function renderDeskShortcuts() {
  const casts = $('#desk-casts');
  const topics = $('#desk-topics');
  const active = $('#desk-active-topic');
  if (!casts || !topics || !active) return;
  casts.replaceChildren(); topics.replaceChildren();
  for (const saved of state.deskCasts) {
    const item = document.createElement('article'); item.className = 'desk-signal';
    const meta = document.createElement('span'); meta.className = 'desk-signal-meta'; meta.textContent = `SIGNAL · @${saved.username || `fid-${saved.fid}`}`;
    const text = document.createElement('p'); text.textContent = saved.text || 'Saved signal';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'desk-signal-remove'; remove.dataset.action = 'toggle-desk-cast'; remove.dataset.fid = String(saved.fid); remove.dataset.hash = saved.hash; remove.setAttribute('aria-label', 'Remove signal from your Desk'); remove.textContent = '×';
    const profile = state.people.get(Number(saved.fid)) || { username: saved.username || `fid-${saved.fid}` };
    const original = originalCastUrl(profile, { hash: saved.hash });
    item.append(meta, text);
    if (original) { const link = document.createElement('a'); link.href = original; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open cast ↗'; item.append(link); }
    item.append(remove); casts.append(item);
  }
  for (const topic of state.deskTopics) {
    const chip = document.createElement('span'); chip.className = `desk-topic${state.activeDeskTopic === topic ? ' is-active' : ''}`;
    const view = document.createElement('button'); view.type = 'button'; view.dataset.deskTopic = topic; view.textContent = topic.replace(/^site:/, ''); view.setAttribute('aria-pressed', String(state.activeDeskTopic === topic));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'desk-topic-remove'; remove.dataset.action = 'toggle-desk-topic'; remove.dataset.topic = topic; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${topic.replace(/^site:/, '')} from your Desk`);
    chip.append(view, remove); topics.append(chip);
  }
  casts.hidden = state.deskCasts.length === 0;
  topics.hidden = state.deskTopics.length === 0;
  active.hidden = !state.activeDeskTopic || state.boardMode !== 'signals';
  if (state.activeDeskTopic && state.boardMode === 'signals') {
    active.replaceChildren(document.createTextNode(`Showing ${state.activeDeskTopic.replace(/^site:/, '')} in this feed `));
    const clear = document.createElement('button'); clear.type = 'button'; clear.dataset.clearDeskTopic = 'true'; clear.textContent = 'Clear'; active.append(clear);
  }
  renderFirstOrbit();
}

function toggleDeskCast(fidValue, hashValue) {
  const fid = Number(fidValue), hash = String(hashValue || '').toLowerCase();
  const previous = [...state.deskCasts];
  const existing = state.deskCasts.findIndex((cast) => Number(cast.fid) === fid && cast.hash.toLowerCase() === hash);
  if (existing >= 0) state.deskCasts.splice(existing, 1);
  else {
    const message = state.casts.find((cast) => Number(cast?.data?.fid) === fid && postHash(cast).toLowerCase() === hash) || state.messages.get(`${fid}:${hash}`);
    if (!message) { setNotice('Refresh this feed before pinning that signal.', 'error'); return; }
    if (state.deskCasts.length >= 8) { setNotice('Your Desk has room for 8 saved signals. Remove one to make space.'); return; }
    const profile = state.people.get(fid) || { username: `fid-${fid}`, name: `Farcaster ${fid}` };
    state.deskCasts.unshift({ fid, hash, username: String(profile.username || `fid-${fid}`).slice(0, 32), text: String(message.data?.castAddBody?.text || '').slice(0, 500), timestamp: Number(message.data?.timestamp) || 0 });
  }
  try { localStorage.setItem(DESK_CASTS_STORAGE, JSON.stringify(state.deskCasts)); }
  catch { state.deskCasts = previous; setNotice('This browser could not save the Desk signal.', 'error'); return; }
  renderDeskShortcuts(); renderFeed();
  setNotice(existing >= 0 ? 'Signal removed from your Desk.' : 'Signal pinned to your Desk on this device.', 'success');
}

function toggleDeskTopic(topicValue) {
  const topic = String(topicValue || '').slice(0, 260);
  if (!/^#[\p{L}\p{N}_]{2,40}$|^site:[a-z\d.-]{1,253}$/iu.test(topic)) return;
  const previous = [...state.deskTopics], previousActive = state.activeDeskTopic;
  if (state.deskTopics.includes(topic)) {
    state.deskTopics = state.deskTopics.filter((value) => value !== topic);
    if (state.activeDeskTopic === topic) state.activeDeskTopic = '';
  } else {
    if (state.deskTopics.length >= 12) { setNotice('Your Desk has room for 12 topic shortcuts. Remove one to make space.'); return; }
    state.deskTopics.unshift(topic);
  }
  try { localStorage.setItem(DESK_TOPICS_STORAGE, JSON.stringify(state.deskTopics)); }
  catch { state.deskTopics = previous; state.activeDeskTopic = previousActive; setNotice('This browser could not save the Desk topic.', 'error'); return; }
  renderDeskShortcuts(); renderFeed();
}

function savedCastMessage(cast) {
  const fid = Number(cast.fid);
  if (!state.people.has(fid)) state.people.set(fid, { fid, name: cast.name || `Farcaster ${fid}`, username: cast.username || `fid-${fid}`, avatar: '' });
  return {
    hash: cast.hash,
    signer: cast.signer || '',
    data: { fid, timestamp: Number(cast.timestamp) || 0, castAddBody: { text: cast.text, embeds: Array.isArray(cast.embeds) ? cast.embeds : [] } },
  };
}

function renderFlightLogCount() {
  const badge = $('#flight-log-count');
  if (badge) badge.textContent = String(state.savedCasts.length);
}

function flightLogStorageKey(fid = state.fid) { return `${FLIGHT_LOG_STORAGE}:${Number(fid) || 'unverified'}`; }

function loadFlightLog(fid) {
  state.savedCasts = [];
  try {
    const accountKey = flightLogStorageKey(fid);
    let raw = localStorage.getItem(accountKey);
    if (raw === null) {
      const previousLog = JSON.parse(localStorage.getItem(FLIGHT_LOG_STORAGE) || '[]');
      const forThisAccount = Array.isArray(previousLog) ? previousLog.filter((cast) => Number(cast?.fid) === Number(fid)) : [];
      if (forThisAccount.length) {
        raw = JSON.stringify(forThisAccount);
        localStorage.setItem(accountKey, raw);
      }
    }
    const stored = JSON.parse(raw || '[]');
    if (Array.isArray(stored)) state.savedCasts = stored.filter((cast) => Number(cast?.fid) === Number(fid) && /^0x[0-9a-f]{40,64}$/i.test(String(cast?.hash || '')) && typeof cast?.text === 'string').slice(0, 100);
  } catch { /* The flight log remains empty if this browser cannot read its local storage. */ }
  renderFlightLogCount();
}

function setBoardMode(mode) {
  saveFeedScroll();
  state.boardMode = mode === 'flight-log' ? 'flight-log' : 'signals';
  const logMode = state.boardMode === 'flight-log';
  updateFeedTabs();
  renderDeskShortcuts();
  $('#page-label').textContent = logMode ? 'SAVED' : state.feedMode === 'profile' ? 'PROFILE' : 'FEED';
  $('#feed-title').textContent = logMode ? 'Saved' : state.feedMode === 'profile' ? 'Posts' : state.feedMode === 'crew' ? state.crewName : state.feedMode === 'friends' ? 'Friends' : 'Following';
  $('#feed-caption').textContent = logMode
    ? 'Saved on this device.'
    : state.feedMode === 'profile' ? `@${state.people.get(state.feedTargetFid)?.username || 'this profile'}` : 'Newest first.';
  $('#feed-filters').hidden = logMode || !state.casts.length;
  $('#composer').hidden = !state.signerReady || logMode;
  renderFeed();
  restoreFeedScroll();
}

function setFeedTab(mode) {
  saveFeedScroll();
  feedScrollSaved = true;
  state.boardMode = 'signals';
  $('#composer').hidden = !state.signerReady;
  loadFeed(state.fid, mode);
}

function toggleFlightLog(fidValue, hashValue) {
  const fid = Number(fidValue);
  const hash = String(hashValue || '').toLowerCase();
  const match = (cast) => Number(cast.fid) === fid && String(cast.hash).toLowerCase() === hash;
  const prior = [...state.savedCasts];
  const existing = state.savedCasts.findIndex(match);
  if (existing >= 0) state.savedCasts.splice(existing, 1);
  else {
    const message = state.casts.find((cast) => Number(cast?.data?.fid) === fid && postHash(cast) === hash) || state.messages.get(`${fid}:${hash}`);
    if (!message) { setNotice('This post is no longer available. Refresh the feed and try again.', 'error'); return; }
    if (state.savedCasts.length >= 100) { setNotice('Your saved list is full. Remove a post before adding another.'); return; }
    const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}` };
    const body = message.data?.castAddBody || {};
    const embeds = (body.embeds || []).filter((embed) => typeof embed?.url === 'string' && embed.url.length <= 2048).slice(0, 4).map((embed) => ({ url: embed.url }));
    state.savedCasts.unshift({ fid, hash, signer: signerHex(message.signer), text: String(body.text || '').slice(0, 320), timestamp: Number(message.data?.timestamp) || 0, name: String(profile.name || '').slice(0, 80), username: String(profile.username || '').slice(0, 80), embeds, savedAt: Date.now() });
  }
  try { localStorage.setItem(flightLogStorageKey(), JSON.stringify(state.savedCasts)); }
  catch { state.savedCasts = prior; setNotice('Browser storage is unavailable. Your saved list could not be updated.', 'error'); return; }
  renderFlightLogCount();
  renderFeed();
  setNotice(existing >= 0 ? 'Post removed from Saved.' : 'Post saved on this device.', 'success');
}

async function toggleDeskPin(fidValue, button) {
  const fid = asFid(fidValue);
  if (state.deskPins.includes(fid)) state.deskPins = state.deskPins.filter((value) => value !== fid);
  else if (state.deskPins.length < 24) state.deskPins.unshift(fid);
  else { setNotice('Your desk is full. Remove a person before pinning someone else.'); return; }
  try { localStorage.setItem(DESK_STORAGE, JSON.stringify(state.deskPins)); } catch { setNotice('Browser storage is unavailable, so this desk change may not be saved.'); }
  if (!state.people.has(fid)) await fetchProfile(fid);
  renderDesk();
  if (button) {
    const pinned = state.deskPins.includes(fid);
    button.textContent = pinned ? '⌖ Pinned' : '⌖ Pin';
    button.setAttribute('aria-pressed', String(pinned));
  }
  setNotice(state.deskPins.includes(fid) ? 'Pinned to your desk on this device.' : 'Removed from your desk.', 'success');
}

function fromBase64(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function toBase64(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function bytesHex(bytes) { return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`; }

async function createCustodySigner(recoveryAccount = null) {
  const protocol = await import('./protocol.js');
  const { createPublicClient, createWalletClient, custom, fallback, http, optimism } = await optimismToolkit();
  if (recoveryAccount) {
    const custodyAddress = recoveryAccount.address;
    let registeredFid;
    try {
      const publicClient = createPublicClient({ chain: optimism, transport: optimismReadTransport(fallback, http) });
      registeredFid = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [custodyAddress] });
    } catch {
      throw new Error('Could not verify this account on Optimism. Please try again.');
    }
    if (!registeredFid || BigInt(registeredFid) < 1n) throw new Error('No Farcaster account was found for this phrase. Check the words or use a linked wallet.');
    const fid = asFid(registeredFid.toString());
    const eip712Signer = new protocol.ViemLocalEip712Signer(recoveryAccount);
    return { eip712Signer, custodyAddress, fid };
  }
  if (!window.ethereum) throw new Error('No compatible browser wallet was found. Use the Farcaster recovery phrase form above, or open Castonaut in a browser with your linked wallet. Once approved, this browser remembers the limited app key for future visits.');
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (Number.parseInt(chainId, 16) !== optimism.id) {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${optimism.id.toString(16)}` }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: `0x${optimism.id.toString(16)}`,
          chainName: optimism.name,
          nativeCurrency: optimism.nativeCurrency,
          rpcUrls: optimism.rpcUrls.default.http,
          blockExplorerUrls: [optimism.blockExplorers.default.url],
        }],
      });
    }
  }
  const addresses = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const custodyAddress = addresses?.[0];
  if (!custodyAddress || !isAddress(custodyAddress)) throw new Error('The wallet did not return a valid address.');
  let registeredFid;
  try {
    const publicClient = createPublicClient({ chain: optimism, transport: custom(window.ethereum) });
    registeredFid = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [custodyAddress] });
  } catch {
    throw new Error('Could not verify this custody address on Optimism. Please try again.');
  }
  if (!registeredFid || BigInt(registeredFid) < 1n) throw new Error('This wallet is not connected to a Farcaster account yet. Connect the custody wallet for your account and try again.');
  const fid = asFid(registeredFid.toString());
  const eip712Signer = new protocol.ViemWalletEip712Signer(createWalletClient({ account: custodyAddress, chain: optimism, transport: custom(window.ethereum) }));
  return { eip712Signer, custodyAddress, fid };
}

async function beginWalletConnection() {
  const button = $('#wallet-connect');
  button.disabled = true;
  setConnectionStatus('Connect the wallet linked to your Farcaster account.', { active: 'sign', busy: true });
  try {
    const { custodyAddress, fid } = await createCustodySigner();
    pendingWalletAccount = { custodyAddress, fid };
    $('#wallet-review-fid').textContent = `Farcaster ID · ${fid}`;
    $('#wallet-review-address').textContent = `Wallet · ${custodyAddress}`;
    setConnectionStatus(`Farcaster account found · FID ${fid}. Review the limited app-key request in your wallet.`, { active: 'approve', completed: ['sign'], busy: true });
    await authorizeSigner(null, pendingWalletAccount);
  } catch (error) {
    setConnectionStatus(error.message, { active: 'sign' });
  } finally {
    button.disabled = false;
  }
}

async function connectWithRecoveryPhrase() {
  const phraseField = $('#recovery-phrase');
  const connectButton = $('#recovery-connect');
  let phrase = takeRecoveryPhrase(phraseField);
  let candidates = null;
  pendingRecoveryAccount = null;
  if (!phrase) { setConnectionStatus('Enter your Farcaster recovery phrase, or use a linked wallet below.'); return; }
  if (!isSupportedRecoveryPhraseLength(phrase)) { phrase = ''; setConnectionStatus('Use a standard 12, 15, 18, 21, or 24-word phrase. The field has been cleared.'); return; }
  connectButton.disabled = true;
  const originalLabel = connectButton.textContent;
  connectButton.textContent = 'Connecting…';
  connectButton.setAttribute('aria-busy', 'true');
  setConnectionStatus('Checking account…', { active: 'sign', busy: true });
  try {
    const { mnemonicToAccount } = await import('viem/accounts');
    const { createPublicClient, fallback, http, optimism } = await optimismToolkit();
    try { candidates = deriveRecoveryAccountCandidates(phrase, mnemonicToAccount); }
    catch { throw new Error('That phrase could not be imported. Check the words and try again.'); }
    phrase = '';
    const publicClient = createPublicClient({ chain: optimism, transport: optimismReadTransport(fallback, http) });
    const { account, fid } = await findRegisteredRecoveryAccount(candidates, (candidate) => publicClient.readContract({
      address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [candidate.address],
    }));
    candidates = null;
    pendingRecoveryAccount = { account, address: account.address, fid: asFid(fid.toString()) };
    setConnectionStatus(`Farcaster account found · FID ${pendingRecoveryAccount.fid}. Preparing your limited browser key…`, { active: 'approve', completed: ['sign'], busy: true });
    await authorizeSigner(pendingRecoveryAccount);
  } catch (error) {
    const safeMessage = error?.message === 'That phrase could not be imported. Check the words and try again.'
      || error?.message === 'Could not reach the Optimism account registry. Check your connection or try a linked wallet.'
      || error?.message === 'No Farcaster account was found for this phrase. Check the words or use a linked wallet.'
      ? error.message
      : 'Could not verify this account. Please try again or use a linked wallet.';
    setConnectionStatus(`${safeMessage} The phrase field has been cleared.`, { active: 'sign' });
  } finally {
    phrase = '';
    candidates = null;
    connectButton.disabled = false;
    connectButton.textContent = originalLabel;
    connectButton.removeAttribute('aria-busy');
  }
}

async function readCurrentNonce(fid) {
  const result = await nodeRequest('signers', { fid, pageSize: 100 });
  return Number(result.currentUserNonce || 0);
}

async function findSigner(fid, publicKey) {
  const result = await nodeRequest('signers', { fid, pageSize: 100 }, { timeoutMs: 8_000 });
  const rows = Array.isArray(result.signers) ? result.signers : (result.messages || []);
  return rows.some((row) => {
    const body = row?.data?.keyAddBody || row?.data?.signerAddBody || row;
    return signerHex(body.key || body.signer) === publicKey.toLowerCase();
  });
}

async function waitForSigner(fid, publicKey, tries = 6, onProgress = () => {}) {
  for (let i = 0; i < tries; i++) {
    onProgress(i + 1, tries);
    try {
      if (await findSigner(fid, publicKey)) return true;
    } catch (error) {
      if (/Too many requests|\(429\)/i.test(error.message)) throw error;
      // A temporarily unavailable read should not discard the saved signed registration.
    }
    if (i < tries - 1) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

async function authorizeSigner(recoveryAccount = null, walletAccount = null) {
  const connectButton = $('#wallet-connect');
  const actionButtons = [connectButton, $('#wallet-authorize'), $('#wallet-change')].filter(Boolean);
  actionButtons.forEach((button) => { button.disabled = true; });
  let relayAttempted = false;
  try {
    setConnectionStatus('Preparing secure app-key authorization…', {
      active: recoveryAccount || walletAccount ? 'approve' : 'sign',
      completed: recoveryAccount || walletAccount ? ['sign'] : [],
      busy: true,
    });
    const protocol = await import('./protocol.js');
    const { createPublicClient, createWalletClient, custom, optimism } = await optimismToolkit();
    const saved = await loadSigner();
    const legacy = localStorage.getItem(LEGACY_KEY_STORAGE);
    if (legacy || ((!refreshSignerFlow) && (state.signer || saved))) throw new Error('This browser already has an app key saved. Check its status before creating another one.');
    if (refreshSignerFlow && (!saved?.privateKey || !saved?.publicKey)) throw new Error('The saved app key could not be loaded. It has not been deleted; reload this page and check again.');
    setConnectionStatus(recoveryAccount
      ? 'Rechecking the Farcaster account you verified…'
      : walletAccount
        ? 'Rechecking your wallet and Farcaster account…'
        : 'Finding the Farcaster account controlled by your wallet…', {
      active: walletAccount ? 'approve' : 'sign',
      completed: walletAccount ? ['sign'] : [],
      busy: true,
    });
    let eip712Signer;
    let custodyAddress;
    let fid;
    if (walletAccount) {
      if (!window.ethereum) throw new Error('Your wallet disconnected. Connect again to verify your account.');
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (Number.parseInt(chainId, 16) !== optimism.id) throw new Error('Your wallet changed networks. Switch to Optimism, then connect again.');
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accounts?.some((address) => address.toLowerCase() === walletAccount.custodyAddress.toLowerCase())) {
        clearWalletReview();
        throw new Error('The selected wallet changed. Connect again to verify the new account.');
      }
      const publicClient = createPublicClient({ chain: optimism, transport: custom(window.ethereum) });
      const currentFid = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [walletAccount.custodyAddress] });
      if (!currentFid || BigInt(currentFid) !== BigInt(walletAccount.fid)) {
        clearWalletReview();
        throw new Error('This wallet’s Farcaster account changed. Connect again to verify the account.');
      }
      custodyAddress = walletAccount.custodyAddress;
      fid = walletAccount.fid;
      eip712Signer = new protocol.ViemWalletEip712Signer(createWalletClient({ account: custodyAddress, chain: optimism, transport: custom(window.ethereum) }));
    } else {
      ({ eip712Signer, custodyAddress, fid } = await createCustodySigner(recoveryAccount?.account || null));
    }
    if (recoveryAccount && (fid !== recoveryAccount.fid || custodyAddress.toLowerCase() !== recoveryAccount.address.toLowerCase())) throw new Error('The checked account changed. Close this panel and verify the test account again.');
    let signer;
    let publicKeyBytes;
    let privateKey;
    let publicKey;
    if (refreshSignerFlow) {
      if (Number(saved.fid) !== Number(fid)) throw new Error('The saved app key belongs to a different Farcaster account. No new key was created.');
      const publicKeyHex = String(saved.publicKey).replace(/^0x/i, '');
      if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !saved.privateKey.usages?.includes('sign')) throw new Error('The saved app key is not available for signing. It remains stored in this browser.');
      publicKeyBytes = Uint8Array.from(publicKeyHex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
      publicKey = bytesHex(publicKeyBytes);
      privateKey = saved.privateKey;
      signer = new BrowserEd25519Signer(privateKey, publicKeyBytes);
    } else {
      ({ signer, publicKey: publicKeyBytes, privateKey } = await createBrowserSigner());
      publicKey = bytesHex(publicKeyBytes);
    }
    const nonce = await readCurrentNonce(fid);
    const deadline = Number(resultOrThrow(protocol.getFarcasterTime(), 'Could not read Farcaster time')) + 60 * 60;
    setConnectionStatus(recoveryAccount
      ? 'Your Farcaster account will sign a scoped app key in this tab. This gasless request cannot move funds.'
      : 'Review the wallet request. It authorizes the social actions listed here; it does not move funds.', {
      active: 'approve',
      completed: ['sign'],
      busy: true,
    });
    const scopes = [protocol.MessageType.CAST_ADD, protocol.MessageType.CAST_REMOVE, protocol.MessageType.REACTION_ADD, protocol.MessageType.REACTION_REMOVE, protocol.MessageType.LINK_ADD, protocol.MessageType.LINK_REMOVE];
    const appKeyBytes = resultOrThrow(protocol.hexStringToBytes(publicKey), 'Could not prepare the browser app key');
    const keyBody = resultOrThrow(await protocol.makeKeyAddBody({ fid: BigInt(fid), key: appKeyBytes, scopes, ttl: KEY_TTL_SECONDS, nonce: nonce + 1, deadline }, eip712Signer), 'Could not authorize the app key');
    const message = resultOrThrow(await protocol.makeKeyAdd(keyBody, { fid, network: protocol.FarcasterNetwork.MAINNET }, signer), 'Could not sign key registration');
    const signedRequest = protocol.Message.encode(message).finish();
    await storeSigner({ ...(saved || {}), fid, publicKey, custodyAddress, privateKey, signedKeyAdd: toBase64(signedRequest) });
    setConnectionStatus(`${recoveryAccount ? 'Farcaster account authorization' : 'Wallet authorization'} signed. Sending the app-key request to Snapchain…`, { active: 'approve', completed: ['sign'], busy: true });
    state.fid = fid;
    loadFlightLog(fid);
    loadTimeCapsules(fid);
    restoreComposerDraft(fid);
    state.signer = signer;
    state.publicKey = publicKey;
    state.custodyAddress = custodyAddress;
    state.signerReady = false;
    renderIdentity();
    setConnectionStatus('Signed key saved in this browser. Sending it to your Snapchain node…', { active: 'approve', completed: ['sign'], busy: true });
    relayAttempted = true;
    const relayed = await submitMessage(message);
    if (!relayed.hash) throw new Error('The node accepted no message hash. Check node health and try again.');
    const confirmed = await waitForSigner(fid, publicKey, 6, (attempt, total) => {
      setConnectionStatus(`Node accepted the request. Waiting for confirmation · ${attempt}/${total}`, { active: 'approve', completed: ['sign'], busy: true });
    });
    state.signerReady = confirmed;
    if (confirmed) loadFlightLog(state.fid);
    if (confirmed) await clearPendingRegistration();
    if (confirmed) await fetchProfile(fid).catch(() => null);
    if (confirmed) await refreshSavedPass();
    renderIdentity();
    if (confirmed) {
      refreshSignerFlow = false;
      if (hasStationAccess()) {
        setConnectionStatus(accessReadyMessage(), { active: 'done', completed: ['sign', 'approve', 'done'] });
        setNotice(openAccessMode() ? 'Your account is ready. Loading your feed…' : 'Farcaster account and Time Pass verified.', 'success');
        await loadFeed(fid);
      } else {
        setConnectionStatus('Account verified. Connect the wallet holding your Time Pass to enter.', { active: 'done', completed: ['sign', 'approve', 'done'] });
        setNotice('Your Farcaster account is ready. Connect the wallet holding your Time Pass to enter.', 'pending');
      }
      setTimeout(() => { if ($('#connect-dialog').open) $('#connect-dialog').close(); }, 2200);
    } else {
      setConnectionStatus('The request reached Snapchain, but confirmation is taking longer. Your key is saved here. Check again in a moment; posting stays paused until confirmed.', { active: 'approve', completed: ['sign'], canRetry: true });
      setNotice('Key relayed; merge is still pending. Writes stay locked until the node confirms it.', 'pending');
    }
  } catch (error) {
    if (relayAttempted) {
      state.signerReady = false;
      renderIdentity();
      setConnectionStatus(`The request may have reached the node, but confirmation failed. Your key is saved here. Check again before trying anything else. ${error.message}`, { active: 'approve', completed: ['sign'], canRetry: true });
    } else setConnectionStatus(error?.message || 'Authorization could not start. Reload and try again.', {
      active: pendingWalletAccount || recoveryAccount || walletAccount ? 'approve' : 'sign',
      completed: pendingWalletAccount || recoveryAccount || walletAccount ? ['sign'] : [],
    });
    setNotice(error?.message || 'Authorization could not start. Reload and try again.', 'error');
  } finally {
    actionButtons.forEach((button) => { button.disabled = false; });
    if (recoveryAccount) clearRecoveryImport();
  }
}

async function checkSavedSigner() {
  const button = $('#check-signer');
  button.disabled = true;
  setConnectionStatus('Checking this browser’s saved app key with Snapchain…', { active: 'approve', completed: ['sign'], canRetry: true });
  try {
    if (!state.fid || !state.publicKey || !state.signer) await restoreSession();
    if (!state.fid || !state.publicKey || !state.signer) throw new Error('No saved app key was found in this browser. Start again with your wallet.');
    const saved = await loadSigner();
    let confirmed = await findSigner(state.fid, state.publicKey);
    let replayError = null;
    if (!confirmed && saved?.signedKeyAdd) {
      setConnectionStatus('The key is not visible yet. Retrying its signed registration request, then checking for confirmation…', { active: 'approve', completed: ['sign'], canRetry: true });
      const encoded = fromBase64(saved.signedKeyAdd);
      try { await submitEncodedMessage(encoded); } catch (error) {
        // The first relay may already have accepted it, so always check the signer list
        // before reporting the replay result. Keep the HTTP status for a useful diagnosis.
        replayError = error;
      }
      confirmed = await waitForSigner(state.fid, state.publicKey, 6, (attempt, total) => {
        setConnectionStatus(`Checking the saved key with Snapchain · ${attempt}/${total}`, { active: 'approve', completed: ['sign'], canRetry: true });
      });
    }
    state.signerReady = confirmed;
    if (confirmed) await clearPendingRegistration();
    if (confirmed) await fetchProfile(state.fid).catch(() => null);
    if (confirmed) await refreshSavedPass();
    renderIdentity();
    if (confirmed) {
      if (hasStationAccess()) {
        setConnectionStatus(accessReadyMessage(), { active: 'done', completed: ['sign', 'approve', 'done'] });
        setNotice(openAccessMode() ? 'Your account is ready. Loading your feed…' : 'Farcaster account and Time Pass verified.', 'success');
        await loadFeed(state.fid);
      } else {
        setConnectionStatus('Account verified. Connect the wallet holding your Time Pass to enter.', { active: 'done', completed: ['sign', 'approve', 'done'] });
        setNotice('Your Farcaster account is ready. Connect the wallet holding your Time Pass to enter.', 'pending');
      }
    } else {
      if (replayError?.status >= 400 && replayError.status < 500) {
        setConnectionStatus(`Snapchain rejected the saved authorization (HTTP ${replayError.status}). Your app key is still saved here. You can approve a fresh registration using the same key.`, { active: 'approve', completed: ['sign'], canRetry: true, canRefresh: true });
      } else if (replayError) {
        setConnectionStatus(`Snapchain could not accept the saved authorization (${replayError.message}). Your app key is still saved in this browser. Check the node and try again; don’t create another key.`, { active: 'approve', completed: ['sign'], canRetry: true });
      } else {
        setConnectionStatus('The saved key is not in Snapchain’s signer list yet. It remains in this browser; don’t create another key. Check again after the node has had time to process it.', { active: 'approve', completed: ['sign'], canRetry: true, canRefresh: !saved?.signedKeyAdd });
      }
    }
  } catch (error) {
    setConnectionStatus(`Could not check the saved key. It remains in this browser. ${error.message}`, { active: 'approve', completed: ['sign'], canRetry: true });
  } finally { button.disabled = false; }
}

function beginSignerRefresh() {
  refreshSignerFlow = true;
  setConnectionStatus('Approve a fresh registration for this saved browser key. You can use its linked wallet or enter the recovery phrase again; Castonaut will reuse the key already in this browser.', { active: 'approve', completed: ['sign'] });
}

async function submitMessage(message) {
  const { Message } = await import('./protocol.js');
  const encoded = Message.encode(message).finish();
  return submitEncodedMessage(encoded);
}

async function submitEncodedMessage(encoded) {
  return nodeRequest('submit', {}, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: encoded });
}

async function waitForMerge(route, params, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try { await nodeRequest(route, params); return true; } catch { await new Promise((resolve) => setTimeout(resolve, 1800)); }
  }
  return false;
}

async function waitForRemoval(route, params, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try { await nodeRequest(route, params); }
    catch (error) { if (/\(404\)/.test(error.message)) return true; }
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  return false;
}

async function getActiveSigner() {
  if (!state.fid || !state.signer) throw new Error('Connect a Farcaster signer before writing.');
  if (!hasStationAccess()) throw new Error('Your Time Pass has expired. Connect its wallet and add 30 days to continue.');
  return state.signer;
}

async function signAndRelay(messageResult, successRoute, successParams, successText) {
  const message = resultOrThrow(messageResult, 'Could not create message');
  // Check the signed message's final state before relaying it. If an earlier
  // request reached Snapchain but the browser lost its response, retrying the
  // same signed message must not make the user guess whether it was published.
  try {
    await nodeRequest(successRoute, successParams);
    setNotice(successText, 'success');
    return { alreadyMerged: true };
  } catch (error) {
    if (!/\(404\)/.test(error.message)) throw error;
  }
  let accepted;
  try {
    accepted = await submitMessage(message);
  } catch (error) {
    if (await waitForMerge(successRoute, successParams, 3)) {
      setNotice(successText, 'success');
      return { alreadyMerged: true };
    }
    throw error;
  }
  setNotice('The app service accepted your message for relay. Waiting for network confirmation…', 'pending');
  const confirmed = await waitForMerge(successRoute, successParams);
  if (!confirmed) throw new Error('The node accepted the message for relay, but merge is not confirmed yet. Try refresh in a moment.');
  setNotice(successText, 'success');
  return accepted;
}

async function signAndRelayRemoval(messageResult, route, params, successText) {
  const message = resultOrThrow(messageResult, 'Could not create removal message');
  try {
    await nodeRequest(route, params);
  } catch (error) {
    if (/\(404\)/.test(error.message)) {
      setNotice(successText, 'success');
      return { alreadyRemoved: true };
    }
    throw error;
  }
  try {
    await submitMessage(message);
  } catch (error) {
    if (await waitForRemoval(route, params, 3)) {
      setNotice(successText, 'success');
      return { alreadyRemoved: true };
    }
    throw error;
  }
  setNotice('Removal relayed. Waiting for Snapchain confirmation…', 'pending');
  if (!await waitForRemoval(route, params)) throw new Error('Removal was relayed but the node has not confirmed it yet. Check again before retrying.');
  setNotice(successText, 'success');
}

function renderIdentity() {
  const empty = $('#identity-empty'); const connected = $('#identity-connected');
  const accountReady = !!state.fid && !!state.signerReady;
  const ready = accountReady && hasStationAccess();
  const publicProfilePreview = !state.fid && state.feedMode === 'profile' && !!state.feedTargetFid;
  document.body.dataset.accountView = ready ? 'member' : publicProfilePreview ? 'visitor-profile' : accountReady ? 'pending' : 'visitor';
  $('#portal-gate').hidden = accountReady;
  $('#pass-gate').hidden = !accountReady || ready;
  $('#member-workspace').hidden = !ready && !publicProfilePreview;
  $('#public-browse-note').hidden = ready || accountReady;
  $('#pass-status-strip').hidden = !ready || CONTEST_ACCESS || !isConfiguredPassAddress(PASS_CONTRACT_ADDRESS);
  const passPreview = $('.portal-pass-preview');
  if (passPreview) {
    passPreview.hidden = CONTEST_ACCESS;
    const offerNote = passPreview.querySelector('small');
    if (offerNote) offerNote.textContent = isConfiguredPassAddress(PASS_CONTRACT_ADDRESS)
      ? 'One-time on Base · no auto-renewal'
      : 'Planned price · free preview · checkout not live';
  }
  empty.hidden = !!state.fid; connected.hidden = !state.fid;
  $('#portal-enter').textContent = state.fid && !ready ? 'Check key status ↻' : 'Sign in ↗';
  const portalStatus = $('#portal-status');
  if (portalStatus) portalStatus.textContent = state.fid && !ready
    ? 'Your account is identified. The app key is still awaiting confirmation, so the desk stays locked.'
    : 'Sign in to follow, post, and save. A linked wallet avoids typing your recovery phrase into the page.';
  if (!state.fid) { $('#avatar-initial').textContent = '?'; $('#composer').hidden = true; return; }
  const profile = state.people.get(state.fid) || { fid: state.fid, name: `Farcaster ${state.fid}`, username: `fid-${state.fid}` };
  const shownName = localProfileName(profile);
  $('#avatar-initial').textContent = shownName.slice(0, 1).toUpperCase();
  $('#profile-name').textContent = shownName;
  $('#profile-handle').textContent = `@${profile.username} · FID ${state.fid}`;
  $('#profile-avatar').textContent = profile.name.slice(0, 1).toUpperCase();
  const avatarUrl = state.remoteMediaEnabled ? safeImageUrl(profile.avatar) : '';
  if (avatarUrl) $('#profile-avatar').replaceChildren(makeRemoteImage(avatarUrl));
  $('#composer').hidden = !ready || state.boardMode === 'flight-log';
  $('#composer-context').textContent = state.signerReady ? 'Scoped key · stored in this browser' : 'App key is awaiting merge confirmation';
  $('#composer-text').disabled = !ready;
  $('#composer button[type="submit"]').disabled = !ready;
  document.querySelectorAll('.post-action:not(.pin-action)').forEach((button) => { button.disabled = !state.signerReady; });
  renderPassStatus();
}

function renderPassStatus() {
  const configured = isConfiguredPassAddress(PASS_CONTRACT_ADDRESS);
  const active = state.passExpiry > Date.now() / 1000;
  const status = $('#pass-status');
  if (status) {
    if (!configured) status.textContent = 'Pass checkout is being prepared. It will open after the Base contract is deployed and verified.';
    else if (state.passBusy) status.textContent = 'Checking the Base wallet…';
    else if (!state.passWallet) status.textContent = 'Connect a wallet to check your pass or get started.';
    else if (!state.passWalletConnected) status.textContent = 'Reconnect the wallet holding your pass to check access on Base.';
    else if (active) status.textContent = `Your pass is active through ${new Date(state.passExpiry * 1000).toLocaleDateString()}.`;
    else status.textContent = 'No active pass on this wallet. A single purchase opens the station for 30 days.';
  }
  const setup = $('#pass-setup');
  if (setup) setup.hidden = configured;
  const buy = $('#pass-buy');
  if (buy) { buy.disabled = !configured || state.passBusy; buy.textContent = state.passBusy ? 'Working with wallet…' : active ? 'Add 30 days · $3.70' : 'Get a 30-day pass'; }
  const check = $('#pass-check');
  if (check) { check.disabled = state.passBusy; check.textContent = state.passBusy ? 'Checking…' : state.passWallet && state.passWalletConnected ? 'Check this wallet' : 'Connect wallet / check pass'; }
  const countdown = $('#pass-countdown');
  if (countdown) countdown.textContent = active ? formatPassCountdown(state.passExpiry) : 'Pass needed';
  const walletLabel = $('#pass-wallet-label');
  if (walletLabel) walletLabel.textContent = state.passWallet ? `${state.passWallet.slice(0, 6)}…${state.passWallet.slice(-4)}` : '';
}

async function refreshPass(wallet = state.passWallet) {
  if (!isConfiguredPassAddress(PASS_CONTRACT_ADDRESS) || !wallet) { state.passExpiry = 0; renderIdentity(); return false; }
  state.passBusy = true; renderPassStatus();
  try {
    const { readPassExpiry } = await timePassModule();
    state.passExpiry = await readPassExpiry(wallet, PASS_CONTRACT_ADDRESS);
    return state.passExpiry > Date.now() / 1000;
  } catch (error) {
    state.passExpiry = 0;
    setNotice(`Could not check the pass on Base. ${error.message}`, 'error');
    return false;
  } finally { state.passBusy = false; renderIdentity(); }
}

async function refreshSavedPass() {
  const wallet = state.passWallet;
  if (!wallet || !window.ethereum?.request) { state.passWalletConnected = false; state.passExpiry = 0; renderIdentity(); return false; }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    const connected = findConnectedPassWallet(wallet, accounts);
    state.passWalletConnected = !!connected;
    if (!connected) { state.passExpiry = 0; renderIdentity(); return false; }
    return await refreshPass(connected);
  } catch {
    state.passWalletConnected = false;
    state.passExpiry = 0;
    renderIdentity();
    return false;
  }
}

async function connectAndCheckPass() {
  if (!isConfiguredPassAddress(PASS_CONTRACT_ADDRESS)) { renderPassStatus(); return; }
  try {
    state.passBusy = true; renderPassStatus();
    const { connectPassWallet } = await timePassModule();
    const wallet = await connectPassWallet(window.ethereum);
    state.passWallet = wallet;
    state.passWalletConnected = true;
    try { localStorage.setItem(PASS_WALLET_STORAGE, wallet); } catch { /* Wallet address is remembered only when storage allows. */ }
    const active = await refreshPass(wallet);
    if (active && state.signerReady) { await loadFeed(state.fid); setNotice('Your Time Pass is active. Welcome back to the station.', 'success'); }
    else if (!active) setNotice('No active pass was found for this wallet. Get a 30-day pass to enter.', 'pending');
  } catch (error) { state.passBusy = false; renderPassStatus(); $('#pass-status').textContent = error.message; setNotice(error.message, 'error'); }
}

async function buyTimePass() {
  if (!isConfiguredPassAddress(PASS_CONTRACT_ADDRESS)) { renderPassStatus(); return; }
  try {
    state.passBusy = true; renderPassStatus();
    const { purchasePass } = await timePassModule();
    const purchased = await purchasePass(window.ethereum, PASS_CONTRACT_ADDRESS, (stage) => {
      const status = $('#pass-status');
      if (status) status.textContent = stage === 'approve' ? 'Review the exact 3.70 USDC allowance in your wallet.' : 'Review the 30-day pass purchase in your wallet.';
    });
    state.passWallet = purchased.wallet;
    state.passWalletConnected = true;
    state.passExpiry = purchased.expiresAt;
    try { localStorage.setItem(PASS_WALLET_STORAGE, purchased.wallet); } catch { /* The contract remains the source of membership status. */ }
    setNotice(`Time Pass active until ${new Date(state.passExpiry * 1000).toLocaleDateString()}.`, 'success');
    if (state.signerReady) await loadFeed(state.fid);
  } catch (error) { $('#pass-status').textContent = error.message; setNotice(error.message, 'error'); }
  finally { state.passBusy = false; renderIdentity(); }
}

async function restoreSession() {
  let saved;
  try {
    saved = await loadSigner();
    if (!saved) {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY_STORAGE) || 'null');
      if (legacy?.key && legacy?.publicKey && Number.isSafeInteger(Number(legacy.fid))) {
        const imported = await importLegacySigner(legacy);
        saved = { fid: Number(legacy.fid), publicKey: legacy.publicKey, custodyAddress: legacy.custodyAddress || '', ...imported };
        await storeSigner(saved);
      }
      localStorage.removeItem(LEGACY_KEY_STORAGE);
    }
  } catch (error) {
    setNotice(`Could not restore the browser app key. Reconnect your account to create a new one. ${error.message}`, 'error');
    return;
  }
  if (!saved || !Number.isSafeInteger(Number(saved.fid)) || !saved.privateKey || !saved.publicKey) return;
  try {
    const publicKeyHex = String(saved.publicKey).replace(/^0x/i, '');
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !saved.privateKey.usages?.includes('sign')) throw new Error('Stored app key has an invalid format.');
    const publicKey = Uint8Array.from(publicKeyHex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
    state.fid = Number(saved.fid);
    loadFlightLog(state.fid);
    loadTimeCapsules(state.fid);
    restoreComposerDraft(state.fid);
    state.publicKey = String(saved.publicKey);
    state.signer = new BrowserEd25519Signer(saved.privateKey, publicKey);
    state.custodyAddress = saved.custodyAddress || '';
  } catch {
    await removeStoredSigner();
    return;
  }
  renderIdentity();
  try {
    state.signerReady = await findSigner(state.fid, saved.publicKey);
    if (state.signerReady) await clearPendingRegistration();
    if (state.signerReady) await fetchProfile(state.fid);
    if (state.signerReady) await refreshSavedPass();
    renderIdentity();
    if (!state.signerReady) setNotice('This app key is not confirmed on the current node. Your station stays locked.');
    else if (hasStationAccess()) {
      if (openAccessMode()) setNotice('Your account is ready. Loading your feed…', 'success');
      await loadFeed(state.fid);
    } else setNotice('Your Farcaster account is ready. Connect the wallet holding your Time Pass to enter.', 'pending');
  } catch (error) {
    state.signerReady = false;
    renderIdentity();
    setNotice(`Could not confirm the saved app key with the app service. It remains stored in this browser. ${error.message}`);
  }
}

async function clearLocalSigner() {
  refreshSignerFlow = false;
  try { localStorage.removeItem(LEGACY_KEY_STORAGE); } catch { /* Continue clearing the current session. */ }
  const cleared = await removeStoredSigner();
  state.fid = null; state.signer = null; state.publicKey = ''; state.signerReady = false; state.custodyAddress = ''; state.boardMode = 'signals';
  state.feedRequest += 1; state.feedPending = null; state.casts = []; state.feedTargetFid = null; state.feedMode = 'following';
  state.savedCasts = []; renderFlightLogCount();
  updateFeedTabs(); $('#page-label').textContent = 'FEED';
  $('#feed-title').textContent = 'Following'; $('#feed-caption').textContent = 'Sign in to open your feed.';
  $('#feed-filters').hidden = true; $('#feed-pulse').hidden = true; $('#profile-summary').hidden = true; $('#feed-count').textContent = '0 POSTS';
  renderEmpty('Your account is disconnected.', 'Sign in to open your feed.');
  renderIdentity();
  if (!cleared) { setNotice('This session is signed out, but browser storage could not delete the app key. Revoke it in Farcaster account settings and clear this site’s browser data.', 'error'); return; }
  setNotice('This browser forgot its signing key. The Farcaster signer remains active until you revoke it from account settings or it expires.', 'pending');
}

function navigate(view, { preserveHash = false } = {}) {
  const target = view === 'node' ? 'node' : 'desk';
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== target; });
  document.querySelectorAll('[data-view]').forEach((link) => {
    const active = link.dataset.view === target;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-scroll-to]').forEach((link) => {
    const active = target === 'desk' && link.hash === location.hash;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  });
  $('#page-label').textContent = target === 'node' ? 'ABOUT' : state.boardMode === 'flight-log' ? 'SAVED' : state.feedMode === 'profile' ? 'PROFILE' : 'FEED';
  const expectedHash = target === 'node' ? '#about' : '#desk';
  if (!preserveHash && location.hash !== expectedHash) history.replaceState(null, '', expectedHash);
  if (analyticsEnabled) pageview({ route: target, path: location.pathname });
  if (target === 'node') $('#node-view').scrollIntoView({ block: 'start' });
}

function applyLocationRoute() {
  if (location.hash === '#node' || location.hash === '#about') { navigate('node', { preserveHash: true }); return; }
  navigate('desk', { preserveHash: true });
  if (location.hash === '#my-desk' || location.hash === '#people-search') {
    requestAnimationFrame(() => {
      const target = document.getElementById(location.hash.slice(1));
      if (target?.getClientRects().length) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else { navigate('node'); setNotice('Connect a synced node to use this section.', 'pending'); }
    });
    if (location.hash === '#people-search') requestAnimationFrame(() => $('#people-query')?.focus({ preventScroll: true }));
    return;
  }
  const profile = location.hash.match(/^#profile=(\d{1,15})$/);
  if (profile) { if (state.boardMode !== 'signals') setBoardMode('signals'); loadFeed(Number(profile[1]), 'profile'); return; }
  const cast = location.hash.match(/^#cast=(\d{1,15})\/(0x[\da-f]{40,64})$/i);
  if (cast && state.signerReady) openConversation(Number(cast[1]), cast[2], { updateRoute: false });
  else if ((!location.hash || location.hash === '#desk') && state.signerReady && (state.feedMode !== 'following' || state.boardMode !== 'signals')) {
    if (state.boardMode !== 'signals') setBoardMode('signals');
    loadFeed(state.fid, 'following');
  }
}

function castBody(text, parent, protocol, embeds = []) {
  const body = { text, type: protocol.CastType.CAST, embeds: embeds.slice(0, 4).map((url) => ({ url })), embedsDeprecated: [], mentions: [], mentionsPositions: [] };
  if (parent) body.parentCastId = { fid: Number(parent.fid), hash: resultOrThrow(protocol.hexStringToBytes(parent.hash), 'Could not read the reply cast hash') };
  return body;
}

function renderThreadDraft() {
  const section = $('#thread-draft');
  if (!section) return;
  section.hidden = state.threadItems.length === 0;
  $('#thread-draft-count').textContent = `${state.threadItems.length} post${state.threadItems.length === 1 ? '' : 's'}${state.threadPending ? ' · one awaiting confirmation' : ''}`;
  const list = $('#thread-draft-items');
  list.replaceChildren(...state.threadItems.map((text, index) => {
    const item = document.createElement('li');
    const content = document.createElement('span'); content.textContent = text; item.append(content);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-outline';
    remove.textContent = state.threadPending && index === 0 ? 'Awaiting confirmation' : 'Remove';
    remove.disabled = !!state.threadPending && index === 0;
    remove.setAttribute('aria-label', `Remove thread post ${index + 1}`);
    remove.addEventListener('click', () => {
      if (state.threadPending && index === 0) return;
      state.threadItems.splice(index, 1);
      if (!state.threadItems.length) state.threadRoot = null;
      saveComposerDraft(); renderThreadDraft();
    });
    item.append(remove); return item;
  }));
  const publish = $('#thread-publish');
  publish.disabled = !state.signerReady || !state.threadItems.length || state.threadBusy;
  publish.textContent = state.threadBusy ? 'Publishing…' : state.threadPending ? `Resume thread · ${state.threadItems.length} left` : 'Publish thread';
}

function saveComposerDraft() {
  const status = $('#draft-status');
  if (!state.fid || !$('#composer-text')) return;
  const draft = {
    text: $('#composer-text').value.slice(0, 320),
    mediaUrl: $('#composer-media-url').value.trim().slice(0, 2048),
    parent: state.parent && { fid: Number(state.parent.fid), hash: String(state.parent.hash).slice(0, 66) },
    root: state.threadRoot && { fid: Number(state.threadRoot.fid), hash: String(state.threadRoot.hash).slice(0, 66) },
    items: state.threadItems.slice(0, 10).map((text) => String(text).slice(0, 320)),
    pending: state.threadPending && state.threadPending.encoded.length <= 100_000 ? state.threadPending : null,
    pendingCast: state.pendingCast && state.pendingCast.encoded.length <= 100_000 ? state.pendingCast : null,
  };
  try {
    localStorage.setItem(`${COMPOSE_STORAGE}:${state.fid}`, JSON.stringify(draft));
    $('#draft-discard').hidden = !(draft.text.trim() || draft.mediaUrl || draft.pendingCast);
    if (status) status.textContent = draft.pendingCast ? 'Signed post saved on this device; resume it to confirm.' : 'Draft saved on this device.';
  } catch { if (status) status.textContent = 'Draft could not be saved in this browser.'; }
}

function restoreComposerDraft(fid) {
  state.parent = null; state.threadRoot = null; state.threadItems = []; state.threadPending = null; state.pendingCast = null;
  setPendingCastControls(false);
  $('#composer-submit').textContent = 'Post';
  try {
    const saved = JSON.parse(localStorage.getItem(`${COMPOSE_STORAGE}:${fid}`) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.text === 'string') $('#composer-text').value = saved.text.slice(0, 320);
      if (typeof saved.mediaUrl === 'string') { $('#composer-media-url').value = safeExternalUrl(saved.mediaUrl)?.href || ''; $('#composer-media').hidden = !$('#composer-media-url').value; }
      const validParent = (value) => value && Number.isSafeInteger(Number(value.fid)) && Number(value.fid) > 0 && /^0x[\da-f]{40,64}$/i.test(value.hash);
      if (validParent(saved.parent)) state.parent = { fid: Number(saved.parent.fid), hash: saved.parent.hash };
      if (validParent(saved.root)) state.threadRoot = { fid: Number(saved.root.fid), hash: saved.root.hash };
      if (Array.isArray(saved.items)) state.threadItems = saved.items.filter((text) => typeof text === 'string' && text.trim()).slice(0, 10).map((text) => text.slice(0, 320));
      if (saved.pending && typeof saved.pending === 'object' && /^0x[\da-f]{40,64}$/i.test(saved.pending.hash) && typeof saved.pending.encoded === 'string' && saved.pending.encoded.length <= 100_000 && typeof saved.pending.text === 'string') {
        state.threadPending = { hash: saved.pending.hash, encoded: saved.pending.encoded, text: saved.pending.text.slice(0, 320) };
        if (!state.threadItems.length) { state.threadItems = [state.threadPending.text]; state.threadRoot = state.parent; }
      }
      if (saved.pendingCast && typeof saved.pendingCast === 'object' && /^0x[\da-f]{40,64}$/i.test(saved.pendingCast.hash) && typeof saved.pendingCast.encoded === 'string' && /^[A-Za-z0-9+/]+=*$/.test(saved.pendingCast.encoded) && saved.pendingCast.encoded.length > 0 && saved.pendingCast.encoded.length <= 100_000 && typeof saved.pendingCast.text === 'string' && saved.pendingCast.text.length <= 320 && typeof saved.pendingCast.mediaUrl === 'string' && saved.pendingCast.mediaUrl.length <= 2048) {
        try {
          if (toBase64(fromBase64(saved.pendingCast.encoded)) === saved.pendingCast.encoded) state.pendingCast = { hash: saved.pendingCast.hash, encoded: saved.pendingCast.encoded, text: saved.pendingCast.text, mediaUrl: safeExternalUrl(saved.pendingCast.mediaUrl)?.href || '' };
        } catch { /* Corrupt pending data is ignored; keep the editable draft text. */ }
      }
    }
  } catch { /* An invalid or unavailable local draft never blocks sign-in. */ }
  $('#char-count').textContent = `${[...$('#composer-text').value].length} / 320`;
  $('#composer-text').placeholder = state.parent ? `Replying to FID ${state.parent.fid}…` : 'What’s on your mind?';
  $('#draft-discard').hidden = !($('#composer-text').value.trim() || $('#composer-media-url').value || state.pendingCast);
  if (state.pendingCast) {
    $('#composer-text').value = state.pendingCast.text;
    $('#composer-media-url').value = state.pendingCast.mediaUrl;
    $('#composer-media').hidden = !state.pendingCast.mediaUrl;
    setPendingCastControls(true);
    $('#composer-submit').textContent = 'Resume saved post';
    $('#draft-status').textContent = 'A signed post is waiting for confirmation. Resume it to avoid creating a duplicate.';
  }
  renderThreadDraft();
}

function clearCurrentDraft() {
  $('#composer-text').value = '';
  $('#composer-media-url').value = '';
  $('#composer-media').hidden = true;
  setPendingCastControls(false);
  $('#gif-results')?.replaceChildren();
  $('#gif-search-query').value = '';
  $('#char-count').textContent = '0 / 320';
  state.parent = null;
  state.pendingCast = null;
  $('#composer-text').placeholder = 'What’s on your mind?';
  $('#draft-discard').hidden = true;
  saveComposerDraft();
}

function setPendingCastControls(pending) {
  $('#composer-text').readOnly = pending;
  $('#composer-media-url').disabled = pending;
  $('#composer')?.querySelectorAll('button').forEach((button) => {
    if (button.type === 'submit' || button.id === 'draft-discard') return;
    button.disabled = pending;
  });
  const submit = $('#composer-submit');
  if (submit && !pending) submit.disabled = !state.signerReady;
}

async function publishPendingCast(pending) {
  const params = { fid: state.fid, hash: pending.hash };
  try {
    await nodeRequest('castById', params);
  } catch (error) {
    if (!/\(404\)/.test(error.message)) throw error;
    const { Message } = await import('./protocol.js');
    const encoded = fromBase64(pending.encoded);
    const decoded = Message.decode(encoded);
    if (postHash(decoded).toLowerCase() !== pending.hash.toLowerCase() || Number(decoded?.data?.fid) !== Number(state.fid) || !decoded?.data?.castAddBody) {
      throw new Error('The saved post could not be verified against this account. It was not sent. Discard it and review your draft.');
    }
    await submitEncodedMessage(encoded);
    setNotice('Post relayed. Waiting for confirmation. This exact signed post is saved on this device if you need to resume it.', 'pending');
    if (!await waitForMerge('castById', params)) throw new Error('The post is still unconfirmed. Resume this saved post to check or relay the same signed message safely.');
  }
  setNotice('Post confirmed on Snapchain.', 'success');
}

async function publishThread() {
  if (!state.signerReady || state.threadBusy || !state.threadItems.length) return;
  state.threadBusy = true; renderThreadDraft();
  const button = $('#thread-publish');
  let confirmed = 0;
  try {
    const protocol = await import('./protocol.js');
    const signer = await getActiveSigner();
    while (state.threadItems.length) {
      let pending = state.threadPending;
      if (!pending) {
        const text = state.threadItems[0];
        const parent = state.threadRoot;
        const result = await protocol.makeCastAdd(castBody(text, parent, protocol), { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, signer);
        const signed = resultOrThrow(result, 'Could not sign thread post');
        const hash = postHash(signed);
        if (!/^0x[\da-f]{40,64}$/i.test(hash)) throw new Error('Could not verify the signed post hash. The draft remains saved.');
        pending = { hash, encoded: toBase64(protocol.Message.encode(signed).finish()), text };
        state.threadPending = pending; saveComposerDraft();
      }
      const params = { fid: state.fid, hash: pending.hash };
      try {
        await nodeRequest('castById', params);
      } catch (error) {
        if (!/\(404\)/.test(error.message)) throw error;
        await submitEncodedMessage(fromBase64(pending.encoded));
        setNotice('Thread post relayed. Waiting for Snapchain confirmation…', 'pending');
        if (!await waitForMerge('castById', params)) throw new Error('This post was relayed but is not confirmed yet. Resume the thread to check it safely.');
      }
      state.threadRoot = { fid: state.fid, hash: pending.hash };
      state.threadItems.shift(); state.threadPending = null; confirmed += 1;
      saveComposerDraft(); renderThreadDraft();
      $('#thread-draft-status').textContent = `${confirmed} post${confirmed === 1 ? '' : 's'} confirmed. Remaining posts are saved on this device.`;
    }
    state.threadRoot = null;
    saveComposerDraft(); renderThreadDraft();
    $('#thread-draft-status').textContent = 'Thread confirmed on Snapchain.';
    setNotice('Thread confirmed on Snapchain.', 'success');
    await loadFeed(state.fid, 'following');
  } catch (error) {
    $('#thread-draft-status').textContent = `${confirmed ? `${confirmed} post${confirmed === 1 ? '' : 's'} confirmed. ` : ''}${error.message} Your remaining thread is saved; resume to check the last post and continue.`;
    setNotice(error.message, 'error');
  } finally {
    state.threadBusy = false; renderThreadDraft(); button.disabled = !state.signerReady || !state.threadItems.length;
  }
}

$('#feed-refresh').addEventListener('click', () => {
  const button = $('#feed-refresh');
  button.disabled = true;
  const task = state.conversation
    ? openConversation(state.conversation.fid, state.conversation.hash, { updateRoute: false })
    : state.boardMode === 'flight-log' ? Promise.resolve(renderFeed()) : loadFeed(state.feedTargetFid || state.fid);
  Promise.resolve(task).finally(() => { button.disabled = false; });
});
$('#feed-more')?.addEventListener('click', loadMoreFollowed);
$('#backup-export').addEventListener('click', exportLocalBackup);
$('#backup-import-trigger').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', (event) => importLocalBackup(event.currentTarget.files?.[0]));
$('#desk-backup-open')?.addEventListener('click', () => {
  const drawer = $('.local-backup-drawer');
  if (!drawer) return;
  drawer.open = true;
  drawer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#backup-export')?.focus({ preventScroll: true });
});
$('#people-search').addEventListener('submit', (event) => { event.preventDefault(); searchProfile($('#people-query').value); });
$('#conversation-close').addEventListener('click', closeConversation);
$('#theme-select').addEventListener('change', (event) => {
  setTheme(event.currentTarget.value);
  try { localStorage.setItem(THEME_STORAGE, event.currentTarget.value); } catch { /* Theme still applies for this visit. */ }
});
const analyticsChoice = $('#analytics-consent');
if (analyticsChoice) {
  try { analyticsChoice.checked = localStorage.getItem(ANALYTICS_CONSENT_STORAGE) === 'yes'; } catch { analyticsChoice.checked = false; }
  analyticsChoice.addEventListener('change', (event) => {
    try { localStorage.setItem(ANALYTICS_CONSENT_STORAGE, event.currentTarget.checked ? 'yes' : 'no'); }
    catch { event.currentTarget.checked = false; setNotice('Browser storage is unavailable, so analytics remains off.', 'error'); return; }
    if (event.currentTarget.checked) { enableAnalytics(); pageview({ route: 'about', path: location.pathname }); }
    else analyticsEnabled = false;
    setNotice(event.currentTarget.checked ? 'Optional visit analytics enabled on this device.' : 'Optional visit analytics disabled on this device.', 'success');
  });
}
const voiceSelect = $('#voice-profile');
const voiceButton = $('#voice-play');
const stationAudio = $('#station-audio');
voiceSelect.value = selectedVoice;
let speechFallbackActive = false;
function stopStationVoice() {
  stationAudio.pause(); stationAudio.currentTime = 0;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  speechFallbackActive = false;
  voiceButton.textContent = '▶';
  voiceButton.setAttribute('aria-label', 'Listen to the station introduction');
}
function speakStationIntro(voice) {
  if (speechFallbackActive) return;
  if (!('speechSynthesis' in window)) {
    setNotice('Audio playback is unavailable in this browser.');
    stopStationVoice();
    return;
  }
  speechFallbackActive = true;
  voiceButton.textContent = 'Ⅱ';
  voiceButton.setAttribute('aria-label', 'Pause the station introduction');
  const utterance = new SpeechSynthesisUtterance(STATION_NARRATION);
  utterance.rate = voice.rate;
  utterance.pitch = voice.pitch;
  utterance.onend = stopStationVoice;
  utterance.onerror = stopStationVoice;
  window.speechSynthesis.speak(utterance);
}
voiceSelect.addEventListener('change', (event) => {
  selectedVoice = event.currentTarget.value;
  try { localStorage.setItem(VOICE_STORAGE, selectedVoice); } catch { /* This selection still applies until the page closes. */ }
  if (!stationAudio.paused || speechFallbackActive) stopStationVoice();
});
voiceButton.addEventListener('click', async () => {
  const voice = STATION_VOICES.find((item) => item.id === selectedVoice) || STATION_VOICES[0];
  if (!stationAudio.paused || speechFallbackActive) { stopStationVoice(); return; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  speechFallbackActive = false;
  voiceButton.textContent = 'Ⅱ';
  voiceButton.setAttribute('aria-label', 'Pause the station introduction');
  try {
    const available = await fetch(voice.audio, { method: 'HEAD', cache: 'force-cache' });
    if (!available.ok) { speakStationIntro(voice); return; }
  } catch { speakStationIntro(voice); return; }
  stationAudio.src = voice.audio;
  stationAudio.onended = stopStationVoice;
  stationAudio.onerror = () => speakStationIntro(voice);
  try { await stationAudio.play(); }
  catch { speakStationIntro(voice); }
});
stationAudio.addEventListener('pause', () => {
  if (!stationAudio.ended && !speechFallbackActive) {
    voiceButton.textContent = '▶';
    voiceButton.setAttribute('aria-label', 'Listen to the station introduction');
  }
});
document.querySelectorAll('[data-feed-tab]').forEach((button) => button.addEventListener('click', () => setFeedTab(button.dataset.feedTab)));
$('#show-flight-log').addEventListener('click', () => setBoardMode('flight-log'));
$('#refresh-node').addEventListener('click', checkNode);
$('#refresh-node-large')?.addEventListener('click', checkNode);
$('#node-journey-check')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Checking…';
  try { await checkNode(); }
  finally { button.disabled = false; button.textContent = 'Check configured node'; }
});
document.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  navigate(link.dataset.view);
  if (link.dataset.view === 'desk' && state.signerReady && (state.feedMode !== 'following' || state.boardMode !== 'signals')) {
    if (state.boardMode !== 'signals') setBoardMode('signals');
    loadFeed(state.fid, 'following');
  }
}));
document.querySelectorAll('[data-scroll-to]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  navigate('desk', { preserveHash: true });
  const target = document.getElementById(link.dataset.scrollTo);
  if (!target?.getClientRects().length) {
    navigate('node');
    setNotice('Connect a synced node to use this section.', 'pending');
    return;
  }
  history.replaceState(null, '', link.hash);
  document.querySelectorAll('[data-scroll-to]').forEach((item) => {
    const active = item === link;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'location'); else item.removeAttribute('aria-current');
  });
  target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  if (link.dataset.scrollTo === 'people-search') $('#people-query').focus({ preventScroll: true });
}));
window.addEventListener('hashchange', applyLocationRoute);
if (window.ethereum?.on) window.ethereum.on('accountsChanged', (accounts) => {
  const next = Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0] : '';
  state.passWallet = next;
  state.passWalletConnected = !!next;
  state.passExpiry = 0;
  try { next ? localStorage.setItem(PASS_WALLET_STORAGE, next) : localStorage.removeItem(PASS_WALLET_STORAGE); } catch { /* This browser can still check a connected wallet in memory. */ }
  renderIdentity();
  if (next && state.signerReady) refreshPass(next).then((active) => active && loadFeed(state.fid));
});
document.addEventListener('click', async (event) => {
  const deskButton = event.target.closest('[data-desk-fid]');
  if (!deskButton) return;
  const fid = Number(deskButton.dataset.deskFid);
  navigate('desk');
  if (state.boardMode !== 'signals') setBoardMode('signals');
  await loadFeed(fid, 'profile');
});
async function refreshSourceFilter() {
  if (Number($('#source-fid').value) > 0) await loadSignerSources(state.casts);
  renderFeed();
}
$('#source-fid').addEventListener('input', refreshSourceFilter);
$('#source-mode').addEventListener('change', refreshSourceFilter);
$('#loaded-search')?.addEventListener('input', (event) => {
  state.feedQuery = event.currentTarget.value.slice(0, 100);
  renderFeed();
});
$('#group-repeats').checked = state.groupRepeats;
$('#group-repeats').addEventListener('change', (event) => {
  state.groupRepeats = event.currentTarget.checked;
  try { localStorage.setItem(REPEAT_GROUPING_STORAGE, String(state.groupRepeats)); } catch { /* The preference still applies for this visit. */ }
  renderFeed();
});
$('#filter-replies').checked = state.repliesOnly;
$('#filter-media').checked = state.mediaOnly;
$('#filter-apps').checked = state.appsOnly;
$('#orbit-only').checked = state.orbitOnly;
$('#compact-mode').checked = state.compactMode;
document.documentElement.classList.toggle('compact-mode', state.compactMode);
for (const [selector, key] of [['#filter-replies', 'repliesOnly'], ['#filter-media', 'mediaOnly'], ['#filter-apps', 'appsOnly'], ['#orbit-only', 'orbitOnly'], ['#compact-mode', 'compactMode']]) {
  $(selector).addEventListener('change', (event) => {
    state[key] = event.currentTarget.checked;
    saveFeedOptions();
    renderFeed();
  });
}
$('#crew-name').value = state.crewName;
$('#crew-name').addEventListener('change', (event) => {
  state.crewName = event.currentTarget.value.trim().slice(0, 20) || 'Crew';
  try { localStorage.setItem(CREW_NAME_STORAGE, state.crewName); } catch { setNotice('This browser could not save the group name.', 'error'); }
  updateFeedTabs();
  if (state.feedMode === 'crew') { $('#feed-title').textContent = state.crewName; renderFeed(); }
});
document.addEventListener('change', (event) => {
  const coverSelect = event.target.closest('[data-cover-fid]');
  if (!coverSelect) return;
  setProfileCover(Number(coverSelect.dataset.coverFid), coverSelect.value);
});
$('#external-images').checked = state.remoteMediaEnabled;
function syncRemoteMediaToggle() {
  const button = $('#media-toggle');
  if (!button) return;
  button.setAttribute('aria-pressed', String(state.remoteMediaEnabled));
  button.setAttribute('aria-label', state.remoteMediaEnabled ? 'Remote media on. Media hosts can see your IP. Click to turn off.' : 'Remote media off. Click to load images and GIFs; media hosts can see your IP.');
  button.title = state.remoteMediaEnabled ? 'Remote media on · hosts can see your IP' : 'Load images and GIFs · hosts can see your IP';
  button.querySelector('span').textContent = state.remoteMediaEnabled ? 'Media on' : 'Media off';
  button.classList.toggle('is-on', state.remoteMediaEnabled);
}
syncRemoteMediaToggle();
$('#media-toggle').addEventListener('click', () => {
  const control = $('#external-images');
  control.checked = !control.checked;
  control.dispatchEvent(new Event('change', { bubbles: true }));
});
$('#external-images').addEventListener('change', (event) => {
  state.remoteMediaEnabled = event.currentTarget.checked;
  try { localStorage.setItem(REMOTE_MEDIA_STORAGE, String(state.remoteMediaEnabled)); } catch { /* Apply for this page even if preferences cannot be saved. */ }
  syncRemoteMediaToggle();
  if (!state.remoteMediaEnabled) {
    document.querySelectorAll('video').forEach((video) => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    document.querySelectorAll('img.remote-image').forEach((image) => image.removeAttribute('src'));
  }
  renderFeed(); renderDesk(); renderProfileSummary(); renderIdentity();
  setNotice(state.remoteMediaEnabled ? 'Remote media is on. Image and video hosts can see your IP address.' : 'Remote media is off. Active video playback stopped; profile and cast media are hidden.', state.remoteMediaEnabled ? 'pending' : 'success');
});
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if (editing || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  if (key === '?') {
    event.preventDefault();
    const options = $('#feed-filters');
    if (!options.hidden) { options.open = true; options.querySelector('summary').focus(); }
    return;
  }
  if (['1', '2', '3'].includes(key) && state.signerReady) {
    event.preventDefault();
    setFeedTab(({ '1': 'following', '2': 'friends', '3': 'crew' })[key]);
    return;
  }
  if (key === 'c' && state.signerReady && state.boardMode !== 'flight-log') {
    event.preventDefault();
    $('#composer-text').focus();
    $('#composer-text').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!['j', 'k'].includes(key)) return;
  const cards = [...document.querySelectorAll('#feed-list .post-card')];
  if (!cards.length) return;
  event.preventDefault();
  const current = cards.findIndex((card) => card.contains(document.activeElement));
  const next = Math.max(0, Math.min(cards.length - 1, current + (key === 'j' ? 1 : -1)));
  const focusTarget = cards[next].querySelector('.post-profile-link, .post-action, .post-more summary');
  focusTarget?.focus();
  cards[next].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('#open-account').addEventListener('click', openConnectDialog);
$('#portal-enter').addEventListener('click', () => {
  openConnectDialog();
  if (state.signer && !state.signerReady) $('#check-signer').hidden = false;
});
$('#pass-check').addEventListener('click', connectAndCheckPass);
$('#pass-buy').addEventListener('click', buyTimePass);
$('#pass-extend').addEventListener('click', buyTimePass);
$('#capsule-seal').addEventListener('click', sealTimeCapsule);
$('#first-orbit')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-flight-step]');
  if (!button) return;
  const step = button.dataset.flightStep;
  if (step === 'page') {
    const capsule = $('.time-capsule');
    if (capsule) { capsule.open = true; capsule.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    setNotice($('#capsule-seal')?.disabled ? 'Load a feed to save today’s page.' : 'Save today’s feed page to revisit it later.');
    return;
  }
  $('#feed-window')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setNotice(step === 'person'
    ? 'Choose a cast, open its ••• menu, then select Pin person to Desk.'
    : 'Choose a cast, open its ••• menu, then select Pin signal to Desk.');
});
$('#capsule-shelf').addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-capsule]');
  if (!button) return;
  state.activeCapsule = button.dataset.openCapsule;
  renderCapsuleShelf();
  $('#capsule-replay').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('#capsule-replay-close').addEventListener('click', () => { state.activeCapsule = ''; renderCapsuleShelf(); });
$('#manage-key').addEventListener('click', () => { if (confirm('Delete Castonaut’s signing key from this browser? This pauses posting here, but does not revoke the Farcaster signer. Revoke it separately in Farcaster account settings.')) clearLocalSigner(); });
$('#wallet-connect').addEventListener('click', () => beginWalletConnection());
$('#refresh-signer').addEventListener('click', beginSignerRefresh);
$('#wallet-authorize').addEventListener('click', () => {
  if (!pendingWalletAccount) { setConnectionStatus('Connect your wallet again so Castonaut can verify the account first.'); return; }
  authorizeSigner(null, pendingWalletAccount);
});
$('#wallet-change').addEventListener('click', () => {
  clearWalletReview();
  beginWalletConnection();
});
$('#check-signer').addEventListener('click', () => checkSavedSigner());
$('#recovery-connect').addEventListener('click', () => connectWithRecoveryPhrase());
$('#recovery-phrase').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    connectWithRecoveryPhrase();
  }
});
$('#recovery-reveal').addEventListener('click', (event) => {
  const field = $('#recovery-phrase');
  const button = event.currentTarget;
  const reveal = field.type === 'password';
  field.type = reveal ? 'text' : 'password';
  button.textContent = reveal ? 'Hide' : 'Show';
  button.setAttribute('aria-pressed', String(reveal));
  field.focus({ preventScroll: true });
});
function clearRecoveryImport() {
  pendingRecoveryAccount = null;
  clearRecoveryPhraseField();
}
function clearRecoveryPhraseField() {
  const phraseField = $('#recovery-phrase');
  if (phraseField) phraseField.value = '';
  phraseField.type = 'password';
  const revealButton = $('#recovery-reveal');
  if (revealButton) { revealButton.textContent = 'Show'; revealButton.setAttribute('aria-pressed', 'false'); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clearRecoveryImport(); });
window.addEventListener('pagehide', clearRecoveryImport);
window.addEventListener('beforeunload', clearRecoveryImport);
$('#connect-dialog').addEventListener('close', () => { clearRecoveryImport(); clearWalletReview(); });
$('#connect-dialog').addEventListener('click', (event) => { if (event.target === $('#connect-dialog')) $('#connect-dialog').close(); });
$('#composer-text').addEventListener('input', () => {
  $('#char-count').textContent = `${[...$('#composer-text').value].length} / 320`;
  $('#draft-discard').hidden = !$('#composer-text').value;
  saveComposerDraft();
});
$('#composer-media-toggle').addEventListener('click', () => {
  const panel = $('#composer-media');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) $('#composer-media-url').focus();
});
$('#composer-media-url').addEventListener('input', () => {
  $('#gif-results').querySelectorAll('.gif-result').forEach((item) => { item.classList.remove('selected'); item.setAttribute('aria-pressed', 'false'); });
  const candidate = safeExternalUrl($('#composer-media-url').value.trim());
  $('#composer-media-note').textContent = candidate
    ? `${candidate.hostname} will be attached. Remote image previews remain off unless you enable them.`
    : 'Use a direct HTTPS .gif or image URL. Castonaut does not upload it; previews stay off until you enable remote images.';
  $('#draft-discard').hidden = !($('#composer-text').value.trim() || $('#composer-media-url').value.trim());
  saveComposerDraft();
});
$('#composer-media-clear').addEventListener('click', () => {
  $('#composer-media-url').value = ''; $('#composer-media').hidden = true;
  $('#composer-media-note').textContent = 'Use a direct HTTPS .gif or image URL. Castonaut does not upload it; previews stay off until you enable remote images.';
  $('#gif-results').replaceChildren();
  $('#draft-discard').hidden = !$('#composer-text').value.trim();
  saveComposerDraft();
});
async function searchGifs(event) {
  event.preventDefault();
  const query = $('#gif-search-query').value.trim().slice(0, 50);
  const note = $('#gif-search-note');
  const submit = $('#gif-search-submit');
  if (!query) { note.textContent = 'Enter a word or phrase to search GIFs.'; $('#gif-search-query').focus(); return; }
  submit.disabled = true;
  note.textContent = 'Searching GIPHY…';
  $('#gif-results').replaceChildren();
  try {
    const apiKey = import.meta.env.VITE_GIPHY_API_KEY;
    if (!apiKey) throw new Error('GIF search is not configured on this build yet. Direct GIF URLs still work.');
    const searchUrl = new URL('https://api.giphy.com/v1/gifs/search');
    searchUrl.searchParams.set('api_key', apiKey);
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('limit', '9');
    searchUrl.searchParams.set('rating', 'g');
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(10_000), referrerPolicy: 'no-referrer' });
    const result = await response.json();
    if (!response.ok) throw new Error('GIPHY could not complete that search. Check the app’s GIPHY API key or try again shortly.');
    const gifs = (Array.isArray(result.data) ? result.data : []).slice(0, 9).map((item) => ({
      title: item?.title || 'GIPHY result',
      url: item?.images?.original?.url,
      preview: item?.images?.fixed_width?.webp || item?.images?.fixed_width?.url || item?.images?.original?.url,
    }));
    if (!gifs.length) { note.textContent = `No GIFs found for “${query.slice(0, 80)}”. Try another search.`; return; }
    const fragment = document.createDocumentFragment();
    for (const gif of gifs) {
      const target = safeExternalUrl(gif?.url);
      const preview = safeExternalUrl(gif?.preview);
      if (!target || !preview || !target.hostname.endsWith('giphy.com') || !preview.hostname.endsWith('giphy.com')) continue;
      const choice = document.createElement('button');
      choice.type = 'button'; choice.className = 'gif-result'; choice.dataset.gifUrl = target.href;
      choice.setAttribute('aria-label', `Attach GIF: ${String(gif.title || 'GIPHY result').slice(0, 120)}`);
      choice.setAttribute('aria-pressed', 'false');
      const image = document.createElement('img'); image.src = preview.href; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      const caption = document.createElement('span'); caption.textContent = String(gif.title || 'Select GIF').slice(0, 80);
      choice.append(image, caption); fragment.append(choice);
    }
    $('#gif-results').replaceChildren(fragment);
    note.textContent = 'Choose a thumbnail to attach it. GIPHY thumbnails load from GIPHY; cast previews still follow your remote-media setting.';
  } catch (error) {
    note.textContent = error.message || 'GIF search is temporarily unavailable. Paste a direct GIF URL instead.';
  } finally { submit.disabled = false; }
}
$('#gif-search-submit').addEventListener('click', searchGifs);
$('#gif-search-query').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); $('#gif-search-submit').click(); }
});
$('#gif-results').addEventListener('click', (event) => {
  const choice = event.target.closest('button[data-gif-url]');
  if (!choice) return;
  const field = $('#composer-media-url');
  field.value = choice.dataset.gifUrl;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  $('#composer-media-note').textContent = 'GIPHY link attached. Castonaut does not upload media; cast previews stay off until you enable remote media.';
  $('#gif-search-note').textContent = 'GIF attached to this draft. Remove it or choose another before posting.';
  $('#gif-results').querySelectorAll('.gif-result').forEach((item) => { const selected = item === choice; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected)); });
});
$('.emoji-picker').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-emoji]');
  if (!button) return;
  const field = $('#composer-text');
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const inserted = button.dataset.emoji;
  const room = Math.max(0, 320 - (field.value.length - (end - start)));
  const emoji = inserted.slice(0, room);
  field.setRangeText(emoji, start, end, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.focus();
});
$('#composer-text').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.parent) {
    state.parent = null;
    $('#composer-text').placeholder = 'What’s on your mind?';
    saveComposerDraft();
    setNotice('Reply cancelled.');
  }
});

$('#draft-discard').addEventListener('click', () => {
  if (state.pendingCast && !window.confirm('This signed post may already have reached Farcaster. Discarding it can make it easier to accidentally publish a duplicate. Discard it anyway?')) return;
  clearCurrentDraft(); setNotice('Current draft discarded.');
});
$('#thread-add').addEventListener('click', () => {
  if ($('#composer-media-url').value.trim()) { setNotice('Remove the GIF or image before adding this post to a text thread.'); return; }
  const text = $('#composer-text').value.trim();
  if (!text) { $('#composer-text').focus(); setNotice('Write the next post before adding it to a thread.'); return; }
  if (state.threadItems.length >= 10) { setNotice('A thread can contain up to 10 posts in this composer.'); return; }
  if (!state.threadItems.length) state.threadRoot = state.parent ? { ...state.parent } : null;
  state.threadItems.push(text);
  clearCurrentDraft();
  renderThreadDraft();
  $('#thread-draft-status').textContent = 'Saved on this device. Posts publish in order; later posts reply to the previous one.';
});
$('#thread-publish').addEventListener('click', publishThread);

$('#composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.threadItems.length || state.threadPending) { setNotice('Publish or discard the saved thread before sending a separate post.', 'pending'); return; }
  const text = $('#composer-text').value.trim();
  const mediaValue = $('#composer-media-url').value.trim();
  const mediaUrl = mediaValue ? safeExternalUrl(mediaValue) : null;
  if (mediaValue && (!mediaUrl || mediaUrl.href.length > 2048)) { setNotice('Use a valid HTTPS GIF or image URL up to 2,048 characters.', 'error'); return; }
  if (!text && !mediaUrl) return;
  const submit = $('#composer button[type="submit"]'); submit.disabled = true;
  try {
    let pending = state.pendingCast;
    if (!pending) {
      submit.textContent = 'Preparing…';
      const protocol = await import('./protocol.js');
      const signer = await getActiveSigner();
      const message = await protocol.makeCastAdd(castBody(text, state.parent, protocol, mediaUrl ? [mediaUrl.href] : []), { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, signer);
      const signedMessage = resultOrThrow(message, 'Could not sign cast');
      const hash = postHash(signedMessage);
      if (!/^0x[\da-f]{40,64}$/i.test(hash)) throw new Error('Could not verify the signed post hash. Your draft remains saved.');
      pending = { hash, encoded: toBase64((await import('./protocol.js')).Message.encode(signedMessage).finish()), text, mediaUrl: mediaUrl?.href || '' };
      state.pendingCast = pending;
      setPendingCastControls(true);
      $('#draft-discard').hidden = false;
      $('#draft-status').textContent = 'Signed post saved on this device. Checking network status…';
      saveComposerDraft();
    }
    submit.textContent = 'Checking post…';
    await publishPendingCast(pending);
    state.pendingCast = null;
    clearCurrentDraft();
    await loadFeed(state.fid, 'following');
  } catch (error) {
    if (state.pendingCast) {
      saveComposerDraft();
      $('#draft-status').textContent = 'Post status is not confirmed. Submit again to safely check or resume the same signed post.';
    }
    setNotice(error.message, 'error');
  }
  finally { submit.textContent = state.pendingCast ? 'Resume saved post' : 'Post'; submit.disabled = !state.signerReady; }
});

$('#generate-digest').addEventListener('click', async () => {
  const button = $('#generate-digest'); const output = $('#ai-catch-up-result');
  const visibleHashes = [...document.querySelectorAll('#feed-list .post-card')]
    .filter((card) => !card.closest('.repeat-cluster-more:not([open])'))
    .map((card) => card.dataset.castHash);
  const visibleMessages = visibleHashes.map((hash) => state.visibleCasts.find((message) => postHash(message) === hash)).filter(Boolean);
  const posts = visibleMessages.slice(0, 20).map((message) => ({ text: String(message?.data?.castAddBody?.text || '').slice(0, 320) })).filter((post) => post.text.trim());
  output.hidden = false; output.textContent = '';
  if (!posts.length) { output.textContent = 'There are no post texts to summarize in this view.'; return; }
  button.disabled = true; button.textContent = 'Summarizing…';
  output.textContent = 'Sending up to 20 visible post texts to Gemini for this request…';
  try {
    const response = await fetch('/api/digest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ posts }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Digest could not be created. Try again shortly.');
    output.textContent = result.text;
  } catch (error) { output.textContent = error.message || 'Digest could not be created. Try again shortly.'; }
  finally { button.disabled = false; button.textContent = 'Summarize posts'; }
});

document.addEventListener('click', async (event) => {
  const conversationButton = event.target.closest('[data-open-conversation]');
  if (conversationButton) { await openConversation(conversationButton.dataset.fid, conversationButton.dataset.hash); return; }
  const shareCast = event.target.closest('[data-share-cast]');
  if (shareCast) {
    const url = new URL(`${location.pathname}${location.search}`, location.origin);
    url.hash = `cast=${Number(shareCast.dataset.fid)}/${String(shareCast.dataset.hash).toLowerCase()}`;
    try { await navigator.clipboard.writeText(url.href); setNotice('Conversation link copied.', 'success'); }
    catch { setNotice(url.href, 'pending'); }
    return;
  }
  const shareProfile = event.target.closest('[data-copy-profile]');
  if (shareProfile) {
    const url = new URL(`${location.pathname}${location.search}`, location.origin); url.hash = `profile=${Number(shareProfile.dataset.copyProfile)}`;
    try { await navigator.clipboard.writeText(url.href); setNotice('Profile link copied.', 'success'); }
    catch { setNotice(url.href, 'pending'); }
    return;
  }
  const deskTopic = event.target.closest('[data-desk-topic]');
  if (deskTopic) {
    state.activeDeskTopic = state.activeDeskTopic === deskTopic.dataset.deskTopic ? '' : deskTopic.dataset.deskTopic;
    if (state.boardMode !== 'signals') { setBoardMode('signals'); return; }
    updateFeedTabs(); renderDeskShortcuts(); renderFeed();
    return;
  }
  if (event.target.closest('[data-clear-desk-topic]')) { state.activeDeskTopic = ''; renderDeskShortcuts(); renderFeed(); return; }
  const parentJump = event.target.closest('[data-focus-cast]');
  if (parentJump) {
    const card = [...document.querySelectorAll('#feed-list [data-cast-hash]')].find((item) => item.dataset.castHash === parentJump.dataset.focusCast);
    if (card) { const collapsed = card.closest('details:not([open])'); if (collapsed) collapsed.open = true; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('cast-focus'); setTimeout(() => card.classList.remove('cast-focus'), 1500); }
    return;
  }
  const flightButton = event.target.closest('[data-flight-log]');
  if (flightButton) { toggleFlightLog(flightButton.dataset.fid, flightButton.dataset.hash); return; }
  const unmute = event.target.closest('[data-unmute-kind]');
  if (unmute) {
    if (unmute.dataset.unmuteKind === 'author') {
      const saved = writeFidList(MUTED_AUTHORS_STORAGE, state.mutedAuthors.filter((fid) => String(fid) !== unmute.dataset.unmuteValue));
      if (saved) state.mutedAuthors = saved;
    } else {
      state.mutedTopics = state.mutedTopics.filter((topic) => topic !== unmute.dataset.unmuteValue);
      try { localStorage.setItem(MUTED_TOPICS_STORAGE, JSON.stringify(state.mutedTopics)); } catch { /* This unmute still applies for this visit. */ }
    }
    renderFeed(); return;
  }
  const profileTab = event.target.closest('[data-profile-tab]');
  if (profileTab) { state.profileTab = profileTab.dataset.profileTab === 'media' ? 'media' : 'posts'; renderProfileSummary(); renderFeed(); return; }
  const profilePin = event.target.closest('[data-profile-pin]');
  if (profilePin) {
    await toggleDeskPin(profilePin.dataset.profilePin, null);
    renderProfileSummary();
    return;
  }
  const profileEdit = event.target.closest('[data-edit-profile]');
  if (profileEdit) { openProfileEditor(Number(profileEdit.dataset.editProfile)); return; }
  const profileButton = event.target.closest('[data-open-profile]');
  if (profileButton) {
    const fid = Number(profileButton.dataset.openProfile);
    if (state.boardMode !== 'signals') setBoardMode('signals');
    setProfileRoute(fid);
    await loadFeed(fid, 'profile');
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  try {
    const targetFid = Number(button.dataset.fid);
    if (button.dataset.action === 'toggle-desk-cast') { toggleDeskCast(targetFid, button.dataset.hash); return; }
    if (button.dataset.action === 'toggle-desk-topic') { toggleDeskTopic(button.dataset.topic); return; }
    if (button.dataset.action === 'toggle-friend') {
      const next = state.friendFids.includes(targetFid) ? state.friendFids.filter((fid) => fid !== targetFid) : [...state.friendFids, targetFid];
      const saved = writeFidList(FRIENDS_STORAGE, next); if (saved) state.friendFids = saved;
      updateFeedTabs(); renderFeed(); setNotice(state.friendFids.includes(targetFid) ? 'Added to Friends on this device.' : 'Removed from Friends.', 'success'); return;
    }
    if (button.dataset.action === 'toggle-crew') {
      const next = state.crewFids.includes(targetFid) ? state.crewFids.filter((fid) => fid !== targetFid) : [...state.crewFids, targetFid];
      const saved = writeFidList(CREW_STORAGE, next); if (saved) state.crewFids = saved;
      updateFeedTabs(); renderFeed(); setNotice(state.crewFids.includes(targetFid) ? `Added to ${state.crewName} on this device.` : `Removed from ${state.crewName}.`, 'success'); return;
    }
    if (button.dataset.action === 'toggle-author-mute') {
      const next = state.mutedAuthors.includes(targetFid) ? state.mutedAuthors.filter((fid) => fid !== targetFid) : [...state.mutedAuthors, targetFid];
      const saved = writeFidList(MUTED_AUTHORS_STORAGE, next); if (saved) state.mutedAuthors = saved;
      renderFeed(); renderMutedManager(); setNotice(state.mutedAuthors.includes(targetFid) ? 'Author hidden from your feeds on this device.' : 'Author shown in your feeds again.', 'success'); return;
    }
    if (button.dataset.action === 'mute-topic') {
      const topic = String(button.dataset.topic || '').slice(0, 120);
      if (topic && !state.mutedTopics.includes(topic)) state.mutedTopics = [...state.mutedTopics, topic].slice(-80);
      try { localStorage.setItem(MUTED_TOPICS_STORAGE, JSON.stringify(state.mutedTopics)); } catch { /* The topic is muted for this visit. */ }
      renderFeed(); renderMutedManager(); setNotice(`Muted ${topic.replace(/^site:/, '')} in your feeds.`, 'success'); return;
    }
    if (button.dataset.action === 'toggle-profile-pin') {
      if (state.profilePins[targetFid] === button.dataset.hash) delete state.profilePins[targetFid];
      else state.profilePins[targetFid] = button.dataset.hash;
      try { localStorage.setItem(PROFILE_PINS_STORAGE, JSON.stringify(state.profilePins)); } catch { setNotice('This browser could not save the pinned post.', 'error'); return; }
      renderProfileSummary(); renderFeed(); setNotice('Profile pin updated on this device.', 'success'); return;
    }
    if (button.dataset.action === 'pin-person' || button.dataset.action === 'unpin-person') { await toggleDeskPin(button.dataset.fid, button.dataset.action === 'pin-person' ? button : null); if (button.dataset.action === 'unpin-person') renderFeed(); return; }
    if (!state.signerReady) { $('#connect-dialog').showModal(); return; }
    const hash = button.dataset.hash;
    if (button.dataset.action === 'reply') {
      state.parent = { fid: targetFid, hash };
      $('#composer-text').placeholder = `Replying to FID ${targetFid}…`;
      $('#composer-text').focus(); $('#composer').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    button.disabled = true;
    const protocol = await import('./protocol.js');
    if (button.dataset.action === 'follow') {
      const params = { fid: state.fid, target_fid: targetFid, link_type: 'follow' };
      let following = false;
      try { await nodeRequest('linkById', params); following = true; }
      catch (error) { if (!/\(404\)/.test(error.message)) throw error; }
      const message = following
        ? await protocol.makeLinkRemove({ type: 'follow', targetFid }, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner())
        : await protocol.makeLinkAdd({ type: 'follow', targetFid }, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner());
      if (following) await signAndRelayRemoval(message, 'linkById', params, `Unfollow of FID ${targetFid} confirmed.`);
      else await signAndRelay(message, 'linkById', params, `Follow of FID ${targetFid} confirmed.`);
      state.following.set(targetFid, !following);
      document.querySelectorAll(`[data-action="follow"][data-fid="${targetFid}"]`).forEach((item) => {
        item.textContent = following ? 'Follow person' : 'Unfollow person';
        item.setAttribute('aria-pressed', String(!following));
        item.disabled = false;
      });
    } else {
      const reactionType = button.dataset.action === 'like' ? protocol.ReactionType.LIKE : protocol.ReactionType.RECAST;
      const routeType = button.dataset.action === 'like' ? 'Like' : 'Recast';
      const params = { fid: state.fid, target_fid: targetFid, target_hash: hash, reaction_type: routeType };
      let active = false;
      try { await nodeRequest('reactionById', params); active = true; }
      catch (error) { if (!/\(404\)/.test(error.message)) throw error; }
      const body = { type: reactionType, targetCastId: { fid: targetFid, hash: resultOrThrow(protocol.hexStringToBytes(hash), 'Could not read the reaction cast hash') } };
      const message = active
        ? await protocol.makeReactionRemove(body, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner())
        : await protocol.makeReactionAdd(body, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner());
      const label = routeType === 'Like' ? (active ? 'Like removed from Snapchain.' : 'Like confirmed in Snapchain.') : (active ? 'Recast removed from Snapchain.' : 'Recast confirmed in Snapchain.');
      if (active) await signAndRelayRemoval(message, 'reactionById', params, label);
      else await signAndRelay(message, 'reactionById', params, label);
      button.textContent = routeType === 'Like' ? (active ? '♡' : '♥') : (active ? '⟳' : '✓');
      button.setAttribute('aria-label', active ? (routeType === 'Like' ? 'Like cast' : 'Recast') : (routeType === 'Like' ? 'Remove like' : 'Remove recast'));
      button.title = button.getAttribute('aria-label');
      button.setAttribute('aria-pressed', String(!active));
    }
    button.disabled = false;
  } catch (error) { setNotice(error.message, 'error'); button.disabled = !state.signerReady; }
});
$('#profile-edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const dialog = $('#profile-edit-dialog');
  const saved = saveProfileTouch(Number(dialog.dataset.fid), { nickname: $('#profile-nickname').value, note: $('#profile-note').value });
  if (saved) dialog.close();
});
$('#clear-profile-custom').addEventListener('click', () => {
  const dialog = $('#profile-edit-dialog');
  if (saveProfileTouch(Number(dialog.dataset.fid), { nickname: '', note: '' })) dialog.close();
});
$('#profile-edit-dialog').addEventListener('click', (event) => { if (event.target === $('#profile-edit-dialog')) $('#profile-edit-dialog').close(); });

if (location.hash === '#node' || location.hash === '#about') navigate('node', { preserveHash: true });
renderDesk();
renderFlightLogCount();
setBoardMode('signals');
renderIdentity();
checkNode().then(() => renderDesk());
restoreSession().then(applyLocationRoute);
setInterval(() => { if (!document.hidden) { setStationTone(); checkNode(); } }, 60_000);
setInterval(() => {
  if (document.hidden) return;
  const active = state.passExpiry > Date.now() / 1000;
  renderPassStatus();
  if (state.passClockActive !== active) {
    state.passClockActive = active;
    renderIdentity();
    if (!active && state.fid && state.signerReady) setNotice('Your Time Pass expired. Add 30 days to return to the station.', 'pending');
  }
}, 60_000);
