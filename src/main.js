import './runtime-polyfills.js';
import { upload as uploadPublicBlob, uploadPresigned as uploadPublicBlobPresigned } from '@vercel/blob/client';
import { groupRepeatedCasts } from './feed-groups.js';
import { hasMedia, isGifEmbedUrl, isImageEmbedUrl, isReply, isVideoEmbedUrl, topicsForCast, visibleByFeedOptions, visibleInProfileView } from './feed-curation.js';
import { mixAuthorTimeline, rankActiveFeedSources, rankFollowRecommendations } from './feed-ranking.js';
import { loadFollowGraph } from './follow-graph.js';
import { STATION_NARRATION, STATION_VOICES } from './station-voice.js';
import { createTimeCapsule, parseTimeCapsules, capsuleDateLabel } from './time-capsules.js';
import { deriveRecoveryAccountCandidates, findRegisteredRecoveryAccount, isSupportedRecoveryPhraseLength, takeRecoveryPhrase } from './recovery-phrase.js';
import { resultOrThrow } from './hub-result.js';
import { BrowserEd25519Signer } from './browser-signer.js';
import { CAST_EMBED_LIMIT, CAST_EMBED_URL_LIMIT, CAST_LIMIT, CAST_USER_LIMIT, castTypeForText, truncateUtf8, utf8ByteLength, withCastonautAttribution } from './cast-attribution.js';
import { castEmbedUrls } from './cast-links.js';
import { fetchProfilePages, profileRecentStartTimestamp } from './profile-feed.js';
import { isNotFound } from './snapchain-errors.js';
import { publishWithConfirmation, removeWithConfirmation } from './write-flow.js';
import { normalizeProfileSearch } from './profile-search.js';
import { isVideoAvatarUrl } from './avatar-media.js';
import { DeviceReadCache, ReadCache } from './read-cache.js';
import { summarizeProfileActivity } from './profile-analytics.js';
import { recentOrbitCasts, summarizeOrbitActivity } from './desk-orbit.js';
import { orbitAtlasLayout } from './orbit-atlas.js';
import { isFarcasterMiniAppLink } from './mini-app-links.js';
import { initPlayTools, refreshMiniAppShelf } from './play-tools.js';
import { CURATED_TOP_ACCOUNTS } from './top-account-roster.js';

const ANALYTICS_CONSENT_STORAGE = 'castonaut.analytics-consent.v1';
let analyticsEnabled = false;
let analyticsModulePromise = null;

function enableAnalytics() {
  if (!import.meta.env.PROD) return Promise.resolve(null);
  analyticsEnabled = true;
  if (!analyticsModulePromise) analyticsModulePromise = import('@vercel/analytics').then((analytics) => {
    analytics.inject({
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
    return analytics;
  }).catch(() => { analyticsModulePromise = null; analyticsEnabled = false; return null; });
  return analyticsModulePromise;
}

function trackPageview(route) {
  if (!analyticsEnabled) return;
  enableAnalytics().then((analytics) => {
    if (analyticsEnabled) analytics?.pageview({ route, path: location.pathname });
  });
}

try { if (localStorage.getItem(ANALYTICS_CONSENT_STORAGE) === 'yes') enableAnalytics(); } catch { /* Analytics stays off when consent cannot be read. */ }

const $ = (selector) => document.querySelector(selector);
async function managedAuthRequest(action, options = {}) {
  const response = await fetch(`/api/neynar-auth?action=${encodeURIComponent(action)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Managed sign-in failed (${response.status}).`);
  return body;
}

async function managedWrite(payload) {
  const response = await fetch('/api/neynar-write', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Farcaster action failed (${response.status}).`);
  return body;
}

function managedParentHash(parent) {
  if (!parent) return '';
  return String(parent.hash || '');
}

async function finishManagedSignIn(fid) {
  try { localStorage.setItem(SIGN_IN_MODE_STORAGE, 'neynar'); } catch { /* The signed server cookie still restores this session. */ }
  state.fid = Number(fid);
  state.signer = null;
  state.signerMode = 'neynar';
  state.publicKey = '';
  state.custodyAddress = '';
  state.hasPendingKeyAdd = false;
  state.signerReady = true;
  state.following.clear();
  state.followStatusUnknown.clear();
  loadFlightLog(state.fid);
  loadTimeCapsules(state.fid);
  restoreComposerDraft(state.fid);
  renderIdentity();
  await fetchProfile(state.fid).catch(() => null);
  renderIdentity();
  await loadFeed(state.fid);
  setNotice('Your Farcaster account is ready. Loading your feed…', 'success');
  if ($('#connect-dialog').open) setTimeout(() => $('#connect-dialog').close(), 500);
}

function openMiniApp(value) {
  let url;
  try { url = new URL(value); } catch { return; }
  if (!isFarcasterMiniAppLink(url)) return;
  const dialog = $('#mini-app-dialog');
  const frame = $('#mini-app-frame');
  if (!dialog || !frame) return;
  const rawTitle = url.pathname.split('/').filter(Boolean).at(-1) || 'Mini App';
  let titleSlug = rawTitle;
  try { titleSlug = decodeURIComponent(rawTitle); } catch { /* Keep the URL-safe slug as its title. */ }
  const title = titleSlug
    .replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  $('#mini-app-dialog-title').textContent = title;
  $('#mini-app-dialog-host').textContent = `${url.hostname} · running inside Castonaut`;
  $('#mini-app-open-original').href = url.href;
  frame.title = `${title} · Farcaster Mini App`;
  $('#mini-app-loading').hidden = false;
  frame.src = url.href;
  if (!dialog.open) dialog.showModal();
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const appButton = target.closest('[data-mini-app-url]');
  if (appButton) {
    event.preventDefault();
    openMiniApp(appButton.dataset.miniAppUrl);
    return;
  }
  const link = target.closest('a[href]');
  if (!link || link.id === 'mini-app-open-original') return;
  let url;
  try { url = new URL(link.href); } catch { return; }
  if (!isFarcasterMiniAppLink(url)) return;
  event.preventDefault();
  openMiniApp(url.href);
}, true);

$('#mini-app-close')?.addEventListener('click', () => $('#mini-app-dialog')?.close());
$('#mini-app-frame')?.addEventListener('load', () => { $('#mini-app-loading').hidden = true; });
$('#mini-app-dialog')?.addEventListener('close', () => {
  $('#mini-app-frame').removeAttribute('src');
  $('#mini-app-loading').hidden = true;
});
$('#mini-app-dialog')?.addEventListener('click', (event) => {
  if (event.target === $('#mini-app-dialog')) $('#mini-app-dialog').close();
});

const connectionDetails = $('#status-card');
if (connectionDetails && typeof window.matchMedia === 'function') {
  const desktopLayout = window.matchMedia('(min-width: 761px)');
  const syncConnectionDetails = () => { connectionDetails.open = desktopLayout.matches; };
  syncConnectionDetails();
  desktopLayout.addEventListener?.('change', syncConnectionDetails);
}
const snapchainReadCache = new ReadCache({ maxEntries: 36, maxBytes: 2_000_000 });
const deviceReadCache = new DeviceReadCache({ maxEntries: 32, maxEntryBytes: 1_000_000 });
const snapchainReadRequests = new Map();
const engagementCountCache = new Map();
const engagementCountRequests = new Map();
const engagementCountEpochs = new Map();
const viewerReactionCache = new Map();
const viewerReactionRequests = new Map();
const viewerReactionEpochs = new Map();
const engagementObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      engagementObserver.unobserve(entry.target);
      void loadCastEngagement(entry.target);
    }
  }, { rootMargin: '180px 0px' })
  : null;
const castReferenceObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      castReferenceObserver.unobserve(entry.target);
      void loadCastReference(entry.target);
    }
  }, { rootMargin: '420px 0px' })
  : null;
const READ_CACHE_TTL = { info: 10_000, casts: 8_000, replies: 8_000, channelCasts: 8_000, links: 30_000, castById: 30_000, reactionsByCast: 20_000, userData: 60_000, username: 60_000 };
const DEVICE_READ_CACHE_TTL = { casts: 120_000, replies: 60_000, links: 900_000, castById: 120_000, reactionsByCast: 30_000, userData: 900_000, username: 21_600_000 };
let snapchainReadCacheVersion = 0;
function clearSnapchainReadCache({ clearDevice = false } = {}) {
  snapchainReadCacheVersion += 1;
  snapchainReadCache.clear();
  if (clearDevice) void deviceReadCache.clear();
}
function isAddress(value) { return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value); }
const FARCASTER_EPOCH_MS = Date.UTC(2021, 0, 1);
const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const LEGACY_KEY_STORAGE = 'openroom.snapchain.signer.v1';
const SIGN_IN_MODE_STORAGE = 'castonaut.sign-in-mode.v1';
const SIGNER_DB = 'castonaut-security';
const SIGNER_STORE = 'signers';
const DESK_STORAGE = 'packet-porch.desk-pins.v1';
const DESK_CASTS_STORAGE = 'castonaut.desk-casts.v1';
const DESK_NOTEPAD_STORAGE = 'castonaut.desk-notepad.v1';
const DESK_CAST_LABELS = ['', 'Read later', 'Idea', 'Keep'];
const DESK_TOPICS_STORAGE = 'castonaut.desk-topics.v1';
const DESK_SORT_STORAGE = 'castonaut.desk-sort.v1';
const DESK_SORT_VALUES = { people: ['saved', 'name'], posts: ['saved', 'newest', 'oldest'], topics: ['saved', 'name'] };
const PROFILE_NOTES_STORAGE = 'castonaut.profile-notes.v1';
const FLIGHT_LOG_STORAGE = 'castonaut.flight-log.v1';
const REMOTE_MEDIA_STORAGE = 'castonaut.remote-media.v2';
const REPEAT_GROUPING_STORAGE = 'castonaut.group-repeats.v1';
const THEME_STORAGE = 'castonaut.theme.v1';
const VOICE_STORAGE = 'castonaut.station-voice.v1';
const FRIENDS_STORAGE = 'castonaut.friends.v1';
const TOP_ROSTER_STORAGE = 'castonaut.top-roster.v1';
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
const PORTABLE_STORAGE_KEYS = [DESK_STORAGE, DESK_CASTS_STORAGE, DESK_NOTEPAD_STORAGE, DESK_TOPICS_STORAGE, DESK_SORT_STORAGE, PROFILE_NOTES_STORAGE, FLIGHT_LOG_STORAGE, REMOTE_MEDIA_STORAGE, REPEAT_GROUPING_STORAGE, THEME_STORAGE, VOICE_STORAGE, FRIENDS_STORAGE, CREW_STORAGE, CREW_NAME_STORAGE, MUTED_AUTHORS_STORAGE, MUTED_TOPICS_STORAGE, FEED_OPTIONS_STORAGE, FEED_SCROLL_STORAGE, PROFILE_PINS_STORAGE, PROFILE_COVERS_STORAGE];
const ID_REGISTRY_ADDRESS = '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b';
const ID_REGISTRY_ABI = [{ type: 'function', name: 'idOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: 'fid', type: 'uint256' }] }];
const state = { fid: null, signer: null, signerMode: 'none', publicKey: '', custodyAddress: '', signerReady: false, sessionRestoring: true, hasPendingKeyAdd: false, capsules: [], activeCapsule: '', nodeInfo: null, casts: [], feedFailedSources: 0, feedUpdatedAt: 0, deskActivityCasts: [], deskActivityOffset: 0, deskActivityBusy: false, visibleCasts: [], messages: new Map(), people: new Map(), following: new Map(), followStatusUnknown: new Set(), sourceBySigner: new Map(), conversation: null, parent: null, threadRoot: null, threadItems: [], threadPending: null, feedQuery: '', feedBusy: false, feedMoreBusy: false, feedPending: null, feedRequest: 0, feedSources: [], feedSourceOffset: 0, feedCastPageTokens: new Map(), feedFollowTotal: 0, feedFollowComplete: true, feedFollowNextPageToken: '', networkSearchKind: 'casts', networkSearchQuery: '', networkSearchCursor: '', networkSearchItems: [], networkSearchBusy: false, networkSearchRequest: 0, profileNextPageToken: '', profileWindowStart: 0, profileArchiveMode: false, profileSeenPageTokens: new Set(), suggestedPeople: [], suggestionsBusy: false, suggestionsError: false, suggestionsLoadedFor: 0, curatedTopAccounts: [], curatedTopLoadPromise: null, feedMode: 'following', feedSort: 'recent', feedTargetFid: null, boardMode: 'signals', profileTab: 'posts', savedCasts: [], deskPins: [], deskCasts: [], deskTopics: [], activeDeskTopic: '', friendFids: [], mutedAuthors: [], mutedTopics: [], profilePins: {}, profileCovers: {}, profileNotes: {}, remoteMediaEnabled: false, groupRepeats: true, repliesOnly: false, mediaOnly: false, appsOnly: false, orbitOnly: false, compactMode: false, feedScroll: {} };
state.quoteCast = null;
function loadDeskSortPreferences() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(DESK_SORT_STORAGE) || '{}'); } catch { /* Use the recent-first defaults. */ }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
  return Object.fromEntries(Object.entries(DESK_SORT_VALUES).map(([stack, values]) => [stack, values.includes(stored[stack]) ? stored[stack] : 'saved']));
}
state.deskSort = loadDeskSortPreferences();
let pendingWalletAccount = null;
let pendingRecoveryAccount = null;
let refreshSignerFlow = false;
let feedScrollSaved = false;
let currentArea = 'feed';
const areaScroll = new Map();
const profileRequests = new Map();
const signerSourceRequests = new Map();
const signerSourcesLoaded = new Set();
let optimismToolkitPromise;
let giphyConfig = null;
let giphyCooldownUntil = 0;
let giphyCooldownTimer = null;
let giphySearching = false;
let photoUploadEnabled = false;
let photoUploadStatusChecked = false;
let photoUploadBusy = false;
let photoUploadController = null;
let photoUploadMode = null;
let selectedPhotoFile = null;
let selectedPhotoPreviewUrl = '';
let uploadedPhotoUrl = '';
let nodeCheckInFlight = false;
let emojiCatalogPromise = null;
let emojiRenderVersion = 0;

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

function setStationTone() {
  const hour = new Date().getHours();
  document.documentElement.dataset.stationTone = hour < 10 ? 'morning' : hour < 16 ? 'day' : hour < 20 ? 'evening' : 'night';
}
function setTheme(theme) {
  const validThemes = ['atlas', 'soft-reset', 'night-radio', 'cyberpunk', 'manga-ink'];
  const selected = validThemes.includes(theme) ? theme : 'atlas';
  if (theme === 'orbit-glass') {
    try { localStorage.setItem(THEME_STORAGE, 'atlas'); } catch { /* The default remains active for this visit. */ }
  }
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
try {
  const savedMediaPreference = localStorage.getItem(REMOTE_MEDIA_STORAGE);
  state.remoteMediaEnabled = savedMediaPreference !== 'false';
} catch { state.remoteMediaEnabled = true; /* Media is on by default. */ }
try { state.groupRepeats = localStorage.getItem(REPEAT_GROUPING_STORAGE) !== 'false'; } catch { /* Repeated links are grouped by default. */ }
function readLocalFids(key) {
  try {
    const values = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(values) ? [...new Set(values.map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0))].slice(0, 36) : [];
  } catch { return []; }
}
state.friendFids = readLocalFids(FRIENDS_STORAGE);
function readTopRosterCache() {
  try {
    const stored = JSON.parse(localStorage.getItem(TOP_ROSTER_STORAGE) || '[]');
    const allowed = new Set(CURATED_TOP_ACCOUNTS.map((account) => account.username));
    return Array.isArray(stored) ? stored.filter((entry) => allowed.has(entry?.username) && Number.isSafeInteger(Number(entry?.fid)) && Number(entry.fid) > 0)
      .map((entry) => ({ ...CURATED_TOP_ACCOUNTS.find((account) => account.username === entry.username), fid: Number(entry.fid) })) : [];
  } catch { return []; }
}
state.curatedTopAccounts = readTopRosterCache();
state.mutedAuthors = readLocalFids(MUTED_AUTHORS_STORAGE);
try {
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
    state.hasPendingKeyAdd = false;
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

function clientErrorText(error) {
  const message = String(error?.message || error || 'Something went wrong.');
  if (/failed to fetch dynamically imported module|importing a module script failed/i.test(message)) {
    return 'This Castonaut tab is out of date. Refresh the page and try again. Your saved key and draft stay in this browser.';
  }
  return message;
}

function setConnectionStatus(message, { canRetry = false, canRefresh = false, canResume = false, busy = false } = {}) {
  const hasSavedSigner = !!state.signer || state.signerReady;
  const recoveringSavedRequest = canRetry || canResume || canRefresh;
  $('#dialog-status').textContent = message;
  $('#recovery-import').hidden = busy || recoveringSavedRequest || hasSavedSigner || !!pendingWalletAccount;
  // Castonaut's supported first-run sign-in uses the Farcaster recovery phrase.
  // Keep the legacy injected-wallet path out of the onboarding UI.
  $('#wallet-connect').hidden = true;
  const walletReview = $('#wallet-review');
  if (walletReview) walletReview.hidden = true;
  $('#wallet-authorize').hidden = true;
  $('#wallet-change').hidden = true;
  $('#check-signer').hidden = !canRetry;
  $('#refresh-signer').hidden = !canRefresh;
  $('#resume-signer').hidden = !canResume;
  $('#connect-actions').hidden = !$('#connect-actions').querySelector('button:not([hidden])');
}

function clearWalletReview() {
  pendingWalletAccount = null;
  const fid = $('#wallet-review-fid');
  const address = $('#wallet-review-address');
  const review = $('#wallet-review');
  const authorize = $('#wallet-authorize');
  const change = $('#wallet-change');
  if (fid) fid.textContent = '';
  if (address) address.textContent = '';
  if (review) review.hidden = true;
  if (authorize) authorize.hidden = true;
  if (change) change.hidden = true;
}

function openConnectDialog() {
  if (state.sessionRestoring) {
    if (!$('#connect-dialog').open) $('#connect-dialog').showModal();
    setConnectionStatus('Checking this browser for a saved sign-in…', { busy: true });
    return;
  }
  if (!state.signer && !state.signerReady) clearWalletReview();
  if (state.signer && !state.signerReady) {
    setConnectionStatus('Your app key is saved in this browser. Check whether Snapchain has confirmed it before creating anything else.', { active: 'approve', completed: ['sign'], canRetry: true, canResume: state.hasPendingKeyAdd });
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
  const { timeoutMs = 18_000, fresh = false, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const cacheKey = method === 'GET' && READ_CACHE_TTL[route] ? url.href : '';
  const deviceTtl = method === 'GET' ? DEVICE_READ_CACHE_TTL[route] || 0 : 0;
  if (fresh) url.searchParams.set('_fresh', '1');
  const cacheVersion = snapchainReadCacheVersion;
  if (cacheKey && !fresh) {
    const cached = snapchainReadCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const pending = snapchainReadRequests.get(cacheKey);
    if (pending) return pending;
  }
  const request = (async () => {
  if (cacheKey && deviceTtl && !fresh) {
    const stored = await deviceReadCache.get(cacheKey);
    if (stored !== undefined && cacheVersion === snapchainReadCacheVersion) {
      snapchainReadCache.set(cacheKey, stored, READ_CACHE_TTL[route]);
      return stored;
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = fetchOptions.signal
    ? AbortSignal.any([fetchOptions.signal, controller.signal])
    : controller.signal;
  try {
    const response = await fetch(url, { ...fetchOptions, cache: fresh ? 'no-store' : fetchOptions.cache, signal, headers: { accept: 'application/json', ...(fetchOptions.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || body.details || `Node request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    if (cacheKey && cacheVersion === snapchainReadCacheVersion) {
      snapchainReadCache.set(cacheKey, body, READ_CACHE_TTL[route]);
      if (deviceTtl) void deviceReadCache.set(cacheKey, body, deviceTtl);
    } else if (method !== 'GET') clearSnapchainReadCache({ clearDevice: true });
    return body;
  } catch (error) {
    if (controller.signal.aborted && !fetchOptions.signal?.aborted) {
      throw new Error('The node took too long to respond. Your signed key is saved in this browser; choose “Check connection again” before trying to authorize again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  })();
  if (!cacheKey) return request;
  snapchainReadRequests.set(cacheKey, request);
  try { return await request; }
  finally { if (snapchainReadRequests.get(cacheKey) === request) snapchainReadRequests.delete(cacheKey); }
}

async function fetchFollowGraph(fid, limits = {}, { fresh = false } = {}) {
  return loadFollowGraph(
    (params) => nodeRequest('links', { fid: Number(fid), link_type: 'follow', ...params }, { fresh }),
    { ownFid: Number(fid), maxPages: 100, maxFollows: 10_000, ...limits },
  );
}

async function fetchFollowGraphPage(fid, pageToken, { fresh = false } = {}) {
  return fetchFollowGraph(fid, { maxPages: 1, maxFollows: 100, pageToken }, { fresh });
}

function spreadFids(values, limit) {
  const unique = [...new Set((values || []).map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0))];
  const count = Math.max(0, Math.floor(Number(limit) || 0));
  if (unique.length <= count) return unique;
  if (count < 2) return count ? [unique[0]] : [];
  return Array.from({ length: count }, (_, index) => unique[Math.round(index * (unique.length - 1) / (count - 1))]);
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

function makeRemoteImage(url, className = '', { priority = false } = {}) {
  const image = document.createElement('img');
  image.className = ['remote-image', className].filter(Boolean).join(' ');
  image.src = url;
  image.alt = '';
  image.loading = priority ? 'eager' : 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  if (priority) image.fetchPriority = 'high';
  return image;
}

function makeRemoteAvatar(url, className = '', { priority = false } = {}) {
  if (!isVideoAvatarUrl(url)) return makeRemoteImage(url, className, { priority });
  const video = document.createElement('video');
  video.className = ['remote-image', 'remote-avatar-motion', className].filter(Boolean).join(' ');
  video.dataset.avatarSrc = url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'none';
  video.autoplay = false;
  video.setAttribute('aria-hidden', 'true');
  video.referrerPolicy = 'no-referrer';
  if (avatarMotionObserver) avatarMotionObserver.observe(video);
  else { video.src = url; video.preload = 'metadata'; }
  return video;
}

const avatarMotionObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (!entry.isIntersecting || document.hidden) {
        video.pause();
        continue;
      }
      if (!video.dataset.loaded) {
        video.src = video.dataset.avatarSrc;
        video.dataset.loaded = 'true';
        video.load();
      }
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData) {
        video.pause();
        continue;
      }
      video.play().catch(() => {});
    }
  }, { rootMargin: '100px' })
  : null;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) document.querySelectorAll('video.remote-avatar-motion').forEach((video) => video.pause());
  else document.querySelectorAll('video.remote-avatar-motion').forEach((video) => avatarMotionObserver?.observe(video));
});

function setRemoteAvatar(container, url, options = {}) {
  const fallback = container.textContent;
  const media = makeRemoteAvatar(url, '', options);
  container.classList.add('avatar-loading');
  const clearLoading = () => container.classList.remove('avatar-loading');
  media.addEventListener(isVideoAvatarUrl(url) ? 'loadeddata' : 'load', clearLoading, { once: true });
  media.addEventListener('error', () => {
    clearLoading();
    media.remove();
    if (!container.querySelector('img, video')) container.textContent = fallback;
  }, { once: true });
  container.replaceChildren(media);
  if (media.tagName === 'IMG' && media.complete && media.naturalWidth > 0) clearLoading();
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

async function fetchProfile(fid, { fresh = false } = {}) {
  fid = Number(fid);
  const existing = state.people.get(fid);
  if (existing?.profileLoaded && !fresh) return existing;
  if (profileRequests.has(fid)) return profileRequests.get(fid);
  const request = (async () => {
  let userData;
  try { userData = await nodeRequest('userData', { fid, pageSize: 20, reverse: true }, { fresh }); }
  catch { return existing || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}`, avatar: '', bio: '' }; }
  const messages = unwrapMessages(userData);
  if (!messages.length) return existing || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}`, avatar: '', bio: '' };
  const fields = latestUserData(messages);
  const profile = { fid, name: fields.display || fields.username || existing?.name || `Farcaster ${fid}`, username: fields.username || existing?.username || `fid-${fid}`, avatar: fields.pfp || '', bio: fields.bio || '', banner: fields.banner || '', profileLoaded: true };
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
  renderFeedStatusbar();
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
    if ([THEME_STORAGE, VOICE_STORAGE, CREW_NAME_STORAGE, DESK_NOTEPAD_STORAGE].includes(key)) parsed = raw;
    else try { parsed = JSON.parse(raw); } catch { throw new Error(`The backup has invalid data for ${key.replace(/^castonaut\./, '')}.`); }
    if (key === THEME_STORAGE && !['atlas', 'soft-reset', 'night-radio', 'cyberpunk', 'manga-ink', 'orbit-glass'].includes(raw)) throw new Error('The backup has an unsupported theme setting.');
    if (key === DESK_SORT_STORAGE && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.entries(parsed).some(([stack, sort]) => !DESK_SORT_VALUES[stack]?.includes(sort)))) throw new Error('The backup has an invalid Desk sort preference.');
    if (key.startsWith(`${TIME_CAPSULES_STORAGE}:`)) {
      if (!Array.isArray(parsed) || parsed.length > 14 || parseTimeCapsules(raw).length !== parsed.length) throw new Error('The backup contains an invalid Time Capsule archive.');
    }
    else if (key.startsWith(`${FLIGHT_LOG_STORAGE}:`)) {
      if (!Array.isArray(parsed) || parsed.length > 100 || parsed.some((cast) => !cast || !Number.isSafeInteger(Number(cast.fid)) || Number(cast.fid) < 1 || !/^0x[\da-f]{40,64}$/i.test(String(cast.hash || '')) || typeof cast.text !== 'string')) throw new Error('The backup contains an invalid Flight Log.');
    } else if ([DESK_STORAGE, FRIENDS_STORAGE, CREW_STORAGE, MUTED_AUTHORS_STORAGE].includes(key)) {
      const max = key === DESK_STORAGE ? 24 : 36;
      if (!Array.isArray(parsed) || parsed.length > max || parsed.some((fid) => !Number.isSafeInteger(Number(fid)) || Number(fid) < 1)) throw new Error('The backup contains an invalid people list.');
    } else if (key === DESK_CASTS_STORAGE && (!Array.isArray(parsed) || parsed.length > 8 || parsed.some((cast) => !cast || !Number.isSafeInteger(Number(cast.fid)) || Number(cast.fid) < 1 || !/^0x[\da-f]{40,64}$/i.test(String(cast.hash || '')) || typeof cast.text !== 'string' || (cast.note !== undefined && (typeof cast.note !== 'string' || cast.note.length > 280)) || (cast.label !== undefined && !DESK_CAST_LABELS.includes(cast.label))))) throw new Error('The backup contains an invalid saved signal list.');
    else if (key === DESK_TOPICS_STORAGE && (!Array.isArray(parsed) || parsed.length > 12 || parsed.some((topic) => typeof topic !== 'string' || !/^#[\p{L}\p{N}_]{2,40}$|^site:[a-z\d.-]{1,253}$/iu.test(topic)))) throw new Error('The backup contains invalid topic shortcuts.');
    else if ([REMOTE_MEDIA_STORAGE, REPEAT_GROUPING_STORAGE].includes(key) && !['true', 'false'].includes(raw)) throw new Error('The backup contains an invalid on/off preference.');
    else if (key === VOICE_STORAGE && !STATION_VOICES.some((voice) => voice.id === raw)) throw new Error('The backup contains an unsupported station voice.');
    else if (key === CREW_NAME_STORAGE && raw.length > 20) throw new Error('The backup contains an invalid crew name.');
    else if (key === DESK_NOTEPAD_STORAGE && raw.length > 4000) throw new Error('The backup contains an oversized Desk note.');
    else if (key === PROFILE_COVERS_STORAGE && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.values(parsed).some((cover) => !['atlas', 'dawn', 'orbit', 'dusk', 'platinum', 'blueberry', 'graphite', 'hypercard', 'cyberpunk', 'manga'].includes(cover)))) throw new Error('The backup contains an invalid profile appearance.');
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
    state.deskPins = readLocalFids(DESK_STORAGE); state.friendFids = readLocalFids(FRIENDS_STORAGE); state.mutedAuthors = readLocalFids(MUTED_AUTHORS_STORAGE);
    try { state.deskCasts = JSON.parse(localStorage.getItem(DESK_CASTS_STORAGE) || '[]'); state.deskTopics = JSON.parse(localStorage.getItem(DESK_TOPICS_STORAGE) || '[]'); state.deskSort = loadDeskSortPreferences(); state.profileNotes = JSON.parse(localStorage.getItem(PROFILE_NOTES_STORAGE) || '{}'); state.mutedTopics = JSON.parse(localStorage.getItem(MUTED_TOPICS_STORAGE) || '[]'); const options = JSON.parse(localStorage.getItem(FEED_OPTIONS_STORAGE) || '{}'); Object.assign(state, { repliesOnly: options.repliesOnly === true, mediaOnly: options.mediaOnly === true, appsOnly: options.appsOnly === true, orbitOnly: options.orbitOnly === true, compactMode: options.compactMode === true }); state.groupRepeats = localStorage.getItem(REPEAT_GROUPING_STORAGE) !== 'false'; setTheme(localStorage.getItem(THEME_STORAGE) || 'atlas'); } catch { /* Values were parsed during validation; recover through the normal render paths if storage has a browser limit. */ }
    if ($('#desk-notepad-text')) $('#desk-notepad-text').value = localStorage.getItem(DESK_NOTEPAD_STORAGE) || '';
    updateDeskNotepadControls();
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

function maxNodeDelay() {
  const delays = (state.nodeInfo?.shardInfos || []).map((shard) => Number(shard.blockDelay)).filter(Number.isFinite);
  return delays.length ? Math.max(...delays) : null;
}

async function checkNode() {
  if (nodeCheckInFlight) return;
  nodeCheckInFlight = true;
  const small = $('#refresh-node'); if (small) small.disabled = true;
  const large = $('#refresh-node-large');
  if (large) large.disabled = true;
  small?.setAttribute('aria-busy', 'true');
  large?.setAttribute('aria-busy', 'true');
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
    const chainVersion = $('#chain-version'); if (chainVersion) chainVersion.textContent = info.version || 'Unknown';
    const chainShardCount = $('#chain-shard-count'); if (chainShardCount) chainShardCount.textContent = String(shards.length || info.numShards || '—');
    const messageCounts = shards.map((shard) => Number(shard.numMessages)).filter(Number.isFinite);
    const chainMessages = $('#chain-message-count');
    if (chainMessages) chainMessages.textContent = messageCounts.length === shards.length && messageCounts.length
      ? messageCounts.reduce((total, count) => total + count, 0).toLocaleString()
      : 'Unavailable';
    const updated = $('#node-chain-updated');
    if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const inSync = maxDelay !== null && maxDelay <= 10;
    const title = inSync ? 'Snapchain is ready' : 'The feed is catching up';
    const detail = inSync ? 'Connected. Sign in to open your feed.' : `Connected, but the feed is not current: its latest network data is about ${maxDelay === null ? 'an unknown amount' : formatNodeDelay(maxDelay)} behind.`;
    setNodeState(inSync ? 'good' : '', title, detail);
    const foot = $('#telemetry-foot'); if (foot) foot.textContent = inSync ? 'Connection and network freshness are healthy.' : 'Connection works; feed results may be incomplete until catch-up finishes.';
    if (state.feedMode === 'following') updateFollowingCoverage();
    const list = $('#shard-list');
    if (list) list.replaceChildren();
    for (const shard of list ? shards : []) {
      const row = document.createElement('article'); row.className = 'node-shard-card';
      const heading = document.createElement('div'); heading.className = 'node-shard-heading';
      const label = document.createElement('strong'); label.textContent = Number(shard.shardId) === 0 ? 'Block shard' : `Shard ${shard.shardId}`;
      const delay = document.createElement('span');
      const delaySeconds = Number(shard.blockDelay);
      delay.className = `node-shard-delay${Number.isFinite(delaySeconds) && delaySeconds <= 10 ? ' is-current' : ''}`;
      delay.textContent = Number.isFinite(delaySeconds) ? `${formatNodeDelay(delaySeconds)} behind` : 'Freshness unknown';
      heading.append(label, delay);
      const facts = document.createElement('dl'); facts.className = 'node-shard-facts';
      const heightValue = Number(shard.maxHeight);
      for (const [term, value] of [
        ['Height', Number.isFinite(heightValue) ? heightValue.toLocaleString() : 'Unavailable'],
        ['Messages', Number.isFinite(Number(shard.numMessages)) ? Number(shard.numMessages).toLocaleString() : 'Unavailable'],
      ]) {
        const item = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
        dt.textContent = term; dd.textContent = value; item.append(dt, dd); facts.append(item);
      }
      row.append(heading, facts); list.append(row);
    }
  } catch (error) {
    state.nodeInfo = null;
    const telemetryDelay = $('#telemetry-delay'); if (telemetryDelay) telemetryDelay.textContent = '—';
    const meter = $('#delay-meter'); if (meter) meter.value = 0;
    const version = $('#node-version'); if (version) version.textContent = 'Not connected';
    const shardCount = $('#node-shards'); if (shardCount) shardCount.textContent = '—';
    const chainVersion = $('#chain-version'); if (chainVersion) chainVersion.textContent = '—';
    const chainShardCount = $('#chain-shard-count'); if (chainShardCount) chainShardCount.textContent = '—';
    const chainMessages = $('#chain-message-count'); if (chainMessages) chainMessages.textContent = '—';
    const updated = $('#node-chain-updated'); if (updated) updated.textContent = 'Could not refresh';
    const list = $('#shard-list');
    if (list) { const empty = document.createElement('p'); empty.className = 'node-chain-empty'; empty.textContent = 'Shard data is unavailable. Check the node connection and try again.'; list.replaceChildren(empty); }
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
    small?.removeAttribute('aria-busy');
    large?.removeAttribute('aria-busy');
    nodeCheckInFlight = false;
    renderDesk();
  }
}

function renderEmpty(title, copy, action = null) {
  const isLoading = /(?:\.\.\.|…|tuning in|loading|searching|checking)/i.test(title);
  const isNetworkState = !isLoading && /(?:node|unavailable|service|could not|catching up|behind|incomplete|waiting)/i.test(`${title} ${copy}`);
  const box = document.createElement('div'); box.className = `empty-message${isLoading ? ' is-loading' : ''}`;
  box.dataset.state = isLoading ? 'loading' : isNetworkState ? 'network' : 'empty';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-busy', String(isLoading));
  if (isLoading) {
    const indicator = document.createElement('span');
    indicator.className = 'loading-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    box.append(indicator);
  }
  const strong = document.createElement('strong'); strong.textContent = title;
  const p = document.createElement('p'); p.textContent = copy;
  box.append(strong, p);
  const actions = (Array.isArray(action) ? action : action ? [action] : []);
  if (actions.length) {
    const actionRow = document.createElement('div'); actionRow.className = 'empty-message-actions';
    for (const item of actions) {
      if (item.type === 'guide') {
        const link = document.createElement('a'); link.className = 'button button-outline'; link.href = '/tutorial.html'; link.textContent = item.label; actionRow.append(link);
        continue;
      }
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.textContent = item.label;
      if (item.type === 'retry') button.addEventListener('click', () => loadFeed(state.feedTargetFid || state.fid, state.feedMode, { fresh: true }));
      else if (item.type === 'profile') button.addEventListener('click', () => loadFeed(state.feedTargetFid || state.fid, 'profile', { fresh: true }));
      else if (item.type === 'search') button.addEventListener('click', () => { navigate('search'); requestAnimationFrame(() => $('#people-query').focus()); });
      else if (item.type === 'clear-source') button.addEventListener('click', () => { $('#source-fid').value = ''; $('#source-mode').value = 'include'; renderFeed(); });
      else if (item.type === 'clear-feed-filters') button.addEventListener('click', clearFeedFilters);
      else if (item.type === 'clear-desk-topic') button.addEventListener('click', () => { state.activeDeskTopic = ''; renderDeskShortcuts(); renderFeed(); });
      else if (item.type === 'clear-orbit-filter') button.addEventListener('click', () => { state.orbitOnly = false; $('#orbit-only').checked = false; saveFeedOptions(); syncQuickControls(); renderFeed(); });
      else if (item.type === 'feed') button.addEventListener('click', () => setFeedTab(item.mode));
      else if (item.type === 'discover') button.addEventListener('click', toggleSuggestedPeople);
      else if (item.type === 'node') button.addEventListener('click', () => { navigate('node'); void checkNode(); });
      else if (item.type === 'more-following') button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Checking more accounts…';
        await loadMoreFollowed();
        if (button.isConnected) { button.disabled = false; button.textContent = item.label; }
      });
      else continue;
      actionRow.append(button);
    }
    if (actionRow.childElementCount) box.append(actionRow);
  }
  const list = $('#feed-list');
  list.dataset.empty = 'true';
  list.replaceChildren(box);
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

function readableLinkPath(pathname) {
  return String(pathname || '').split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  }).join(' · ');
}

function originalCastUrl(profile, message) {
  const hash = postHash(message);
  if (!/^0x[\da-f]{40,64}$/i.test(hash)) return '';
  const username = String(profile?.username || '');
  if (!/^[a-z\d._-]{1,32}$/i.test(username) || /^fid-\d+$/.test(username)) return '';
  return `https://farcaster.xyz/${encodeURIComponent(username)}/${hash}`;
}

function originalProfileUrl(profile) {
  const username = String(profile?.username || '');
  if (!/^[a-z\d._-]{1,32}$/i.test(username) || /^fid-\d+$/.test(username)) return '';
  return `https://farcaster.xyz/${encodeURIComponent(username)}`;
}

function updateFeedTabs() {
  const profileView = state.boardMode === 'signals' && state.feedMode === 'profile';
  const profileLayout = $('.feed-layout');
  const feedWindow = $('#feed-window');
  if (profileLayout) profileLayout.dataset.profileView = String(profileView);
  if (feedWindow) feedWindow.dataset.profileView = String(profileView);
  updateTopPeopleCounts();
  const feedTools = $('.feed-view-controls');
  if (feedTools) feedTools.hidden = state.feedMode === 'profile' || state.boardMode !== 'signals';
  const sortHidden = state.boardMode !== 'signals' || state.feedMode === 'profile';
  const recentSort = $('#show-recent');
  const popularSort = $('#show-popular');
  for (const [button, active] of [[recentSort, state.feedSort === 'recent'], [popularSort, state.feedSort === 'popular']]) {
    if (!button) continue;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.hidden = sortHidden;
    button.disabled = false;
    button.textContent = button === recentSort ? 'Newest' : 'Popular';
  }
  const discover = $('#show-suggested');
  if (discover) {
    discover.hidden = state.boardMode !== 'signals' || state.feedMode === 'profile';
    if (discover.hidden) { $('#suggested-panel').hidden = true; discover.setAttribute('aria-expanded', 'false'); }
  }
  renderTopPeopleDrawer();
  updateFeedDestinationNav();
  renderFeedStatusbar();
}

function updateTopPeopleCounts() {
  const activePeople = state.feedMode === 'friends'
    ? new Set(state.casts.map((message) => Number(message?.data?.fid)).filter((fid) => fid > 0)).size
    : 0;
  const count = state.feedMode === 'friends'
    ? Math.max(activePeople, state.feedSources.length, state.friendFids.length, state.curatedTopAccounts.length)
    : state.friendFids.length;
  document.querySelectorAll('[data-friend-count]').forEach((friendCount) => {
    friendCount.textContent = String(count);
    friendCount.hidden = count === 0;
    friendCount.title = state.feedMode === 'friends'
      ? `${count} Top people sources checked · ${activePeople} with recent posts · ${state.friendFids.length} personal picks`
      : `${count} personal Top people picks on this device`;
  });
}

function updateFeedDestinationNav() {
  const discoveryOpen = currentArea === 'feed' && state.boardMode === 'signals' && !$('#suggested-panel')?.hidden;
  const feedWindow = $('#feed-window');
  if (feedWindow) feedWindow.dataset.discoverOpen = String(discoveryOpen);
  document.querySelectorAll('[data-feed-destination]').forEach((link) => {
    const destination = link.dataset.feedDestination;
    const active = currentArea === 'feed' && state.boardMode === 'signals'
      && (destination === 'discover' ? discoveryOpen : !discoveryOpen && destination === state.feedMode);
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
}

function renderFeedStatusbar() {
  const bar = $('#feed-statusbar');
  if (!bar) return;
  updateTopPeopleCounts();
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };
  renderFeedFreshness();
  const account = $('#feed-status-account');
  const profile = state.fid ? state.people.get(Number(state.fid)) : null;
  const handle = profile?.username && !/^fid-\d+$/.test(profile.username) ? `@${profile.username}` : '';
  setText(account, state.signerReady ? (handle || `FID ${Number(state.fid).toLocaleString()}`)
    : state.fid ? `FID ${Number(state.fid).toLocaleString()} · read-only` : 'Read-only');
  account.title = state.signerReady ? `Active Farcaster account${state.fid ? ` · FID ${Number(state.fid)}` : ''}. ${state.signerMode === 'neynar' ? 'Review the managed signer permissions in Farcaster; this key has no funds access.' : 'Castonaut’s browser key has no funds access.'}`
    : state.fid ? 'Account identified; social actions are paused until the signer is confirmed.' : 'Connect an account to post or react. Browsing is read-only.';

  const maxDelay = maxNodeDelay();
  const nodeKind = document.body.dataset.nodeState || '';
  const network = $('#feed-status-network');
  const led = $('#feed-status-led');
  const networkState = nodeKind === 'bad' ? 'unavailable' : maxDelay === null ? (state.nodeInfo ? 'unknown' : nodeKind === '' ? 'checking' : 'unknown') : maxDelay <= 10 ? 'current' : 'behind';
  setText(network, networkState === 'current' ? 'Node current' : networkState === 'behind' ? 'Node behind' : networkState === 'unavailable' ? 'Node unavailable' : networkState === 'checking' ? 'Checking node' : 'Freshness unknown');
  const mediaToggle = $('#feed-media-toggle');
  if (mediaToggle) {
    mediaToggle.textContent = state.remoteMediaEnabled ? '▧ Media on' : '▧ Media off';
    mediaToggle.setAttribute('aria-pressed', String(state.remoteMediaEnabled));
    mediaToggle.title = state.remoteMediaEnabled
      ? 'Post images load automatically. Media hosts can see your IP address. Click to turn previews off.'
      : 'Post images are hidden. Click to load media automatically; media hosts can see your IP address.';
  }
  led.dataset.state = networkState;
  bar.dataset.network = networkState;
  network.title = networkState === 'behind'
    ? `Node data is ${formatNodeDelay(maxDelay)} behind. Posts and follow status may be out of date; follow changes are checked before signing.`
    : networkState === 'current' ? 'The node is current. Follow changes are checked before signing.'
      : networkState === 'unavailable' ? 'The node could not be reached. Follow status cannot be checked right now.'
        : 'The node freshness and follow status have not been confirmed.';
  $('#feed-status-node')?.setAttribute('aria-label', `${network.textContent}. Open node details.`);

  const activity = $('#feed-status-activity');
  setText(activity, state.sessionRestoring && !state.feedBusy ? (state.fid ? 'Restoring account…' : 'Checking this browser…')
    : state.feedMoreBusy ? (state.feedMode === 'friends' ? 'Finding more active people…' : 'Checking more followed accounts…')
    : state.feedBusy ? (state.feedMode === 'friends' ? 'Loading Top people…' : state.feedMode === 'profile' ? 'Loading profile posts…' : 'Loading recent posts…')
      : state.feedFailedSources && !state.casts.length ? `Could not check ${state.feedFailedSources} ${state.feedMode === 'friends' ? 'people' : state.feedMode === 'profile' ? 'this profile' : `followed account${state.feedFailedSources === 1 ? '' : 's'}`}`
      : !state.nodeInfo && nodeKind === 'bad' ? 'Waiting for the node'
      : state.feedFailedSources ? `${state.feedFailedSources} source${state.feedFailedSources === 1 ? '' : 's'} unavailable · results may be partial`
      : !state.casts.length && maxDelay !== null && maxDelay > 10 ? `No posts visible · node ${formatNodeDelay(maxDelay)} behind`
      : !state.casts.length && state.feedMode === 'following' && state.feedSources.length ? `${state.feedSourceOffset} followed accounts checked · no posts visible`
      : !state.casts.length && state.feedMode === 'friends' ? 'No recent posts from Top people'
      : !state.casts.length && state.feedMode === 'profile' ? 'No recent profile posts'
      : state.feedMode === 'friends' && state.casts.length ? `${new Set(state.casts.map((message) => Number(message?.data?.fid)).filter((fid) => fid > 0)).size} active people · ${state.casts.length} recent posts`
          : state.feedMode === 'following' && state.casts.length ? `${state.casts.length} recent posts · ${state.feedSourceOffset} of ${state.feedFollowComplete ? state.feedFollowTotal : `at least ${state.feedFollowTotal}`} follows checked`
            : state.casts.length ? `${state.casts.length} recent ${state.casts.length === 1 ? 'post' : 'posts'} loaded`
          : 'No recent posts loaded');
  activity.title = maxDelay !== null && maxDelay > 10
    ? `Node data is ${formatNodeDelay(maxDelay)} behind; feed posts and follow relationships may be incomplete.${state.feedFailedSources ? ` ${state.feedFailedSources} sources also failed to load.` : ''}`
    : state.feedFailedSources ? `${state.feedFailedSources} feed sources did not respond. Refresh to retry; displayed posts may be incomplete.`
    : 'Posts are newest first by default. Popular sorts the loaded posts by reactions.';
  document.querySelectorAll('[data-action="follow"][data-fid]').forEach((button) => updateFollowButton(button, button.dataset.fid));
}

function renderFeedFreshness() {
  const label = $('#feed-updated');
  const refresh = $('#feed-refresh');
  if (!label || !refresh) return;
  const timestamp = Number(state.feedUpdatedAt) || 0;
  const elapsed = timestamp ? Math.max(0, Date.now() - timestamp) : 0;
  const relative = !timestamp ? 'Not refreshed yet'
    : elapsed < 60_000 ? 'Updated just now'
      : elapsed < 3_600_000 ? `Updated ${Math.floor(elapsed / 60_000)}m ago`
        : `Updated ${Math.floor(elapsed / 3_600_000)}h ago`;
  label.textContent = relative;
  label.title = timestamp ? `Feed last loaded ${new Date(timestamp).toLocaleString()}. Refresh keeps your current reading position.` : 'The feed has not loaded successfully yet.';
  refresh.title = timestamp ? `Refresh this view · ${relative.toLowerCase()}` : 'Refresh this view';
  refresh.setAttribute('aria-label', timestamp ? `Refresh this view. ${relative}.` : 'Refresh this view');
}

function feedWindowTitle() {
  if (state.boardMode === 'flight-log') return 'Saved';
  if (state.feedMode === 'profile') return 'Posts';
  if (state.feedMode === 'friends') return 'Top people';
  return 'Following';
}

function feedDescription(mode = state.feedMode) {
  if (mode === 'friends') return '20 curated Farcaster leaders, your picks, and active people · up to 2 posts each.';
  if (mode === 'profile') return 'Recent posts from this profile.';
  return '';
}

function recentFeedStartTimestamp(nowMs = Date.now()) { return profileRecentStartTimestamp(nowMs, 30); }

function popularScore(message) {
  const fid = Number(message?.data?.fid);
  const hash = postHash(message);
  return ['Like', 'Recast'].reduce((score, type) => {
    const result = engagementCountCache.get(engagementKey(fid, hash, type));
    return score + (result && result.expiresAt > Date.now() ? result.count : 0);
  }, 0);
}

async function loadPopularScores(messages) {
  await mapLimit(messages, 4, async (message) => {
    const card = { dataset: { castFid: String(Number(message?.data?.fid)), castHash: postHash(message) } };
    await Promise.all(['Like', 'Recast'].map((type) => readEngagementCount(card, type).catch(() => null)));
  });
}

async function selectFeedSort(sort) {
  if (!['recent', 'popular'].includes(sort) || state.feedMode === 'profile' || state.boardMode !== 'signals') return;
  if (sort === state.feedSort) return;
  const requestId = state.feedRequest;
  if (sort === 'popular') {
    const candidates = state.casts;
    if (candidates.length) {
      document.querySelectorAll('.feed-sort-switch .board-tab').forEach((button) => { button.disabled = true; });
      if ($('#show-popular')) $('#show-popular').textContent = 'Ranking…';
      await loadPopularScores(candidates);
      if (requestId !== state.feedRequest) { updateFeedTabs(); return; }
    }
  }
  state.feedSort = sort;
  updateFeedTabs();
  $('#feed-caption').textContent = feedDescription();
  renderFeed();
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

function captureFeedScrollAnchor() {
  const cards = [...($('#feed-list')?.querySelectorAll('.post-card[data-cast-hash]') || [])];
  const card = cards.find((item) => item.getBoundingClientRect().bottom > 0);
  return card ? {
    fid: card.dataset.castFid,
    hash: card.dataset.castHash,
    top: card.getBoundingClientRect().top,
  } : null;
}
function restoreFeedScrollAnchor(anchor) {
  if (!anchor) return;
  requestAnimationFrame(() => {
    const card = [...($('#feed-list')?.querySelectorAll('.post-card[data-cast-hash]') || [])]
      .find((item) => item.dataset.castFid === anchor.fid && item.dataset.castHash === anchor.hash);
    if (!card) return;
    const shift = card.getBoundingClientRect().top - anchor.top;
    if (Math.abs(shift) > 1) window.scrollBy(0, shift);
  });
}

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
  syncQuickControls();
}

function syncQuickControls() {
  const values = { compactMode: state.compactMode, remoteMediaEnabled: state.remoteMediaEnabled, repliesOnly: state.repliesOnly, mediaOnly: state.mediaOnly, appsOnly: state.appsOnly, orbitOnly: state.orbitOnly, groupRepeats: state.groupRepeats };
  document.querySelectorAll('[data-quick-setting]').forEach((input) => { input.checked = values[input.dataset.quickSetting] === true; });
}

function setProfileCover(fid, cover) {
  if (!['atlas', 'dawn', 'orbit', 'dusk', 'platinum', 'blueberry', 'graphite', 'hypercard', 'cyberpunk', 'manga'].includes(cover)) return;
  if (cover === 'atlas') delete state.profileCovers[fid];
  else state.profileCovers[fid] = cover;
  try { localStorage.setItem(PROFILE_COVERS_STORAGE, JSON.stringify(state.profileCovers)); }
  catch { setNotice('This browser could not save the profile cover.', 'error'); return; }
  const coverElement = $('#profile-summary .profile-cover');
  if (coverElement) coverElement.dataset.cover = cover;
}

function menuAction(label, action, fid, extra = {}) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'post-more-action'; button.dataset.action = action;
  button.dataset.fid = String(fid);
  for (const [key, value] of Object.entries(extra)) button.dataset[key] = String(value);
  button.textContent = label;
  return button;
}

function referenceId(embed) {
  const castId = embed?.castId;
  const fid = Number(castId?.fid);
  const hash = hashText(castId?.hash);
  return Number.isSafeInteger(fid) && fid > 0 && /^0x[\da-f]{40,64}$/i.test(hash) ? { fid, hash } : null;
}

async function loadCastReference(container) {
  if (!container?.isConnected || container.dataset.loaded === 'true') return;
  container.dataset.loaded = 'true';
  const fid = Number(container.dataset.fid);
  const hash = container.dataset.hash;
  const key = `${fid}:${hash.toLowerCase()}`;
  let message = state.messages.get(key);
  try {
    if (!message) message = unwrapMessages(await nodeRequest('castById', { fid, hash }))[0];
    if (!message?.data?.castAddBody) throw new Error('Referenced cast unavailable');
    state.messages.set(key, message);
    const profile = state.people.get(fid) || await fetchProfile(fid);
    if (!container.isConnected) return;
    const body = message.data.castAddBody;
    const heading = document.createElement('div'); heading.className = 'post-reference-heading';
    const author = document.createElement('button'); author.type = 'button'; author.className = 'post-reference-author'; author.dataset.openProfile = String(fid); author.textContent = `${localProfileName(profile)} · @${profile.username || `fid-${fid}`}`;
    const timestamp = document.createElement('time'); timestamp.className = 'post-reference-time'; timestamp.textContent = farcasterDate(message.data.timestamp);
    heading.append(author, timestamp);
    const copy = document.createElement('p'); copy.className = 'post-reference-copy'; copy.textContent = body.text || '(media cast)';
    const children = [heading, copy];
    const mediaEmbeds = [...(body.embeds || []), ...(body.embedsDeprecated || []).map((url) => ({ url }))]
      .filter((embed) => typeof embed?.url === 'string' && (isImageEmbedUrl(embed.url) || isVideoEmbedUrl(embed.url)))
      .slice(0, 2);
    if (state.remoteMediaEnabled) {
      for (const embed of mediaEmbeds) {
        const mediaUrl = safeExternalUrl(embed.url);
        if (!mediaUrl) continue;
        if (isImageEmbedUrl(embed.url)) {
          const image = makeRemoteImage(mediaUrl.href, 'post-reference-image');
          image.alt = `Image attached to a referenced cast by ${localProfileName(profile)}`;
          children.push(image);
        } else if (isVideoEmbedUrl(embed.url)) {
          const video = document.createElement('video'); video.className = 'post-reference-video'; video.controls = true; video.playsInline = true; video.preload = 'metadata'; video.referrerPolicy = 'no-referrer'; video.src = mediaUrl.href; video.setAttribute('aria-label', `Video attached to a referenced cast by ${localProfileName(profile)}`); children.push(video);
        }
      }
    } else if (mediaEmbeds.length) {
      const mediaNote = document.createElement('small'); mediaNote.className = 'post-reference-media-note'; mediaNote.textContent = `${mediaEmbeds.length} attached ${mediaEmbeds.length === 1 ? 'image' : 'images'} · media is off`;
      children.push(mediaNote);
    }
    const open = document.createElement('button'); open.type = 'button'; open.className = 'post-reference-open'; open.dataset.openConversation = 'true'; open.dataset.fid = String(fid); open.dataset.hash = hash; open.textContent = 'Open referenced cast ↗';
    children.push(open);
    container.replaceChildren(...children);
    container.dataset.loaded = 'true';
  } catch {
    if (!container.isConnected) return;
    const status = document.createElement('span'); status.className = 'post-reference-status'; status.textContent = 'Referenced cast is unavailable from this node.';
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'post-reference-open'; retry.textContent = 'Try again';
    retry.addEventListener('click', () => { container.dataset.loaded = ''; void loadCastReference(container); });
    container.replaceChildren(status, retry);
    container.dataset.loaded = 'error';
  }
}

function renderComposerQuote() {
  const section = $('#composer-quote');
  const reference = $('#composer-quote-reference');
  if (!section || !reference) return;
  const quote = state.quoteCast;
  section.hidden = !quote;
  reference.replaceChildren();
  if (!quote) return;
  reference.dataset.fid = String(quote.fid);
  reference.dataset.hash = quote.hash;
  reference.dataset.loaded = '';
  const status = document.createElement('span');
  status.className = 'post-reference-status';
  status.textContent = 'Loading cast preview…';
  reference.append(status);
  void loadCastReference(reference);
}

function renderCast(message, { priority = false } = {}) {
  if (message?.data?.fid && postHash(message)) {
    state.messages.set(`${Number(message.data.fid)}:${postHash(message)}`, message);
    if (state.messages.size > 500) state.messages.delete(state.messages.keys().next().value);
  }
  const data = message?.data || {};
  const body = data.castAddBody || {};
  const fid = Number(data.fid) || 0;
  const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}`, avatar: '' };
  const card = document.createElement('article'); card.className = 'post-card';
  card.dataset.castFid = String(fid);
  card.dataset.castHash = postHash(message);
  card.dataset.castRenderSignature = castRenderSignature(message);
  const avatar = document.createElement('button'); avatar.type = 'button'; avatar.className = 'post-avatar'; avatar.dataset.openProfile = String(fid); avatar.setAttribute('aria-label', `Open ${localProfileName(profile)}'s recent posts`);
  avatar.textContent = (profile.name || '?').trim().slice(0, 1).toUpperCase();
  const avatarUrl = safeImageUrl(profile.avatar);
  if (avatarUrl) setRemoteAvatar(avatar, avatarUrl, { priority });
  const content = document.createElement('div');
  const head = document.createElement('div'); head.className = 'post-head';
  const shownName = localProfileName(profile);
  const name = document.createElement('button'); name.type = 'button'; name.className = 'post-profile-link'; name.dataset.openProfile = String(fid); name.setAttribute('aria-label', `Open ${shownName}'s recent posts`); name.textContent = shownName;
  const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'post-handle post-handle-link'; handle.dataset.openProfile = String(fid); handle.setAttribute('aria-label', `Open @${profile.username}'s profile`); handle.textContent = `@${profile.username}`;
  const time = document.createElement('span'); time.className = 'post-time'; time.textContent = farcasterDate(data.timestamp);
  const source = document.createElement('span'); source.className = 'post-source';
  const sourceFid = state.sourceBySigner.get(signerHex(message.signer));
  source.textContent = sourceFid ? `APP ${sourceFid}` : '';
  source.hidden = !sourceFid;
  const relation = document.createElement('span'); relation.className = 'post-relation';
  const relationLabel = relationshipForCast(fid);
  if (relationLabel) {
    relation.textContent = relationLabel;
    relation.title = relationshipTitle(relationLabel);
  } else relation.hidden = true;
  head.append(name, handle, time, relation, source);
  const fullText = body.text || '(empty cast)';
  content.append(head);
  const parent = body.parentCastId;
  if (parent && Number(parent.fid) > 0 && parent.hash) {
    const parentHash = hashText(parent.hash);
    const parentMessage = state.casts.find((candidate) => Number(candidate?.data?.fid) === Number(parent.fid) && postHash(candidate) === parentHash);
    const parentProfile = state.people.get(Number(parent.fid));
    const context = document.createElement('div'); context.className = 'reply-context';
    context.append(document.createTextNode('↳ Replying to '));
    const label = document.createElement('button'); label.type = 'button'; label.className = 'reply-profile-link'; label.dataset.openProfile = String(Number(parent.fid));
    label.textContent = profileLabel(parentProfile, Number(parent.fid));
    context.append(label);
    if (parentMessage) {
      const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'reply-context-jump'; jump.dataset.focusCast = parentHash; jump.dataset.focusFid = String(Number(parent.fid)); jump.dataset.replyFid = String(fid); jump.dataset.replyHash = postHash(message); jump.textContent = 'View parent'; context.append(jump);
    } else if (/^0x[\da-f]{40,64}$/i.test(parentHash)) {
      const open = document.createElement('button'); open.type = 'button'; open.className = 'reply-context-jump'; open.dataset.openConversation = 'true'; open.dataset.fid = String(fid); open.dataset.hash = postHash(message); open.setAttribute('aria-label', 'Open this reply and its parent in Castonaut'); open.textContent = 'Open parent'; context.append(open);
    }
    content.append(context);
  }
  if (typeof body.parentUrl === 'string' && body.parentUrl) {
    const parentUrl = safeExternalUrl(body.parentUrl);
    if (parentUrl) {
      const channelContext = document.createElement('div'); channelContext.className = 'reply-context channel-context';
      channelContext.append(document.createTextNode('In channel · '));
      const channelLink = document.createElement('a'); channelLink.href = parentUrl.href; channelLink.target = '_blank'; channelLink.rel = 'noopener noreferrer nofollow';
      channelLink.textContent = readableLinkPath(parentUrl.pathname) || parentUrl.hostname.replace(/^www\./i, '');
      channelContext.append(channelLink); content.append(channelContext);
    }
  }
  if (fullText.length > 240) {
    const excerpt = document.createElement('p'); excerpt.className = 'post-copy post-excerpt'; excerpt.textContent = `${fullText.slice(0, 220).trimEnd()}…`;
    const expansion = document.createElement('details'); expansion.className = 'post-text-expansion';
    const summary = document.createElement('summary'); summary.textContent = 'Read full post';
    const full = document.createElement('p'); full.className = 'post-copy'; full.textContent = fullText;
    expansion.append(summary, full); content.append(excerpt, expansion);
    expansion.addEventListener('toggle', () => {
      excerpt.hidden = expansion.open;
      summary.textContent = expansion.open ? 'Collapse post' : 'Read full post';
    });
  } else {
    const copy = document.createElement('p'); copy.className = 'post-copy'; copy.textContent = fullText;
    content.append(copy);
  }
  const embeds = [
    ...(Array.isArray(body.embeds) ? body.embeds : []),
    ...(Array.isArray(body.embedsDeprecated) ? body.embedsDeprecated.map((url) => ({ url })) : []),
  ].slice(0, 4);
  const mediaEmbeds = embeds.filter((embed) => typeof embed?.url === 'string' && (isImageEmbedUrl(embed.url) || isVideoEmbedUrl(embed.url)));
  const castEmbeds = embeds.map(referenceId).filter(Boolean);
  for (const mediaEmbed of mediaEmbeds) {
    const mediaUrl = safeExternalUrl(mediaEmbed.url);
    if (!mediaUrl) continue;
    const isVideo = isVideoEmbedUrl(mediaEmbed.url);
    const isGif = isGifEmbedUrl(mediaEmbed.url);
    if (!state.remoteMediaEnabled) {
      const mediaNote = document.createElement('span'); mediaNote.className = 'media-hidden-note';
      mediaNote.textContent = `${isVideo ? 'Video' : isGif ? 'GIF' : 'Image'} hidden · Media off`; mediaNote.title = 'Turn on Load post media to show this attachment. The original media host can see your IP address.'; content.append(mediaNote);
    } else if (isVideo) {
      const media = document.createElement('figure'); media.className = 'post-media post-video-media';
      const video = document.createElement('video'); video.className = 'post-video'; video.controls = true; video.playsInline = true; video.preload = 'metadata'; video.referrerPolicy = 'no-referrer'; video.src = mediaUrl.href; video.setAttribute('aria-label', `Video attached by ${shownName}`);
      const videoFallback = document.createElement('span'); videoFallback.className = 'media-fallback'; videoFallback.hidden = true;
      videoFallback.append(document.createTextNode('Video unavailable · '));
      const videoLink = document.createElement('a'); videoLink.href = mediaUrl.href; videoLink.target = '_blank'; videoLink.rel = 'noopener noreferrer nofollow'; videoLink.textContent = 'open original'; videoFallback.append(videoLink);
      video.addEventListener('error', () => { videoFallback.hidden = false; });
      const caption = document.createElement('figcaption'); caption.className = 'post-media-caption';
      const kind = document.createElement('span'); kind.textContent = 'VIDEO';
      const open = document.createElement('a'); open.href = mediaUrl.href; open.target = '_blank'; open.rel = 'noopener noreferrer nofollow'; open.textContent = 'Open original ↗';
      caption.append(kind, open); media.append(video, caption, videoFallback); content.append(media);
    } else {
      const media = document.createElement('figure'); media.className = 'post-media image-media';
      const imageFrame = document.createElement('div'); imageFrame.className = 'post-image-frame'; imageFrame.setAttribute('aria-busy', 'true');
      const imageExpand = document.createElement('button'); imageExpand.type = 'button'; imageExpand.className = 'post-image-expand'; imageExpand.setAttribute('aria-label', `Expand ${isGif ? 'GIF' : 'image'} attached by ${shownName}`); imageExpand.setAttribute('aria-expanded', 'false');
      const image = makeRemoteImage(mediaUrl.href, 'post-image', { priority }); image.alt = `${isGif ? 'Animated GIF' : 'Image'} attached by ${shownName}`; imageExpand.append(image);
      imageExpand.addEventListener('click', () => {
        const expanded = imageFrame.classList.toggle('is-expanded'); imageExpand.setAttribute('aria-expanded', String(expanded));
        imageExpand.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${isGif ? 'GIF' : 'image'} attached by ${shownName}`);
      });
      const imageFallback = document.createElement('span'); imageFallback.className = 'media-fallback'; imageFallback.hidden = true;
      imageFallback.append(document.createTextNode(`${isGif ? 'GIF' : 'Image'} unavailable · `));
      const fallbackLink = document.createElement('a'); fallbackLink.href = mediaUrl.href; fallbackLink.target = '_blank'; fallbackLink.rel = 'noopener noreferrer nofollow'; fallbackLink.textContent = 'open original'; imageFallback.append(fallbackLink);
      image.addEventListener('load', () => { imageFrame.classList.remove('is-loading'); imageFrame.removeAttribute('aria-busy'); }, { once: true });
      image.addEventListener('error', () => { imageFrame.classList.remove('is-loading'); imageFrame.removeAttribute('aria-busy'); image.hidden = true; imageFallback.hidden = false; }, { once: true });
      imageFrame.classList.add('is-loading');
      if (image.complete && image.naturalWidth > 0) { imageFrame.classList.remove('is-loading'); imageFrame.removeAttribute('aria-busy'); }
      const mediaCaption = document.createElement('figcaption'); mediaCaption.className = 'post-media-caption';
      const mediaKind = document.createElement('span'); mediaKind.textContent = isGif ? 'GIF' : 'IMAGE';
      const mediaOpen = document.createElement('a'); mediaOpen.href = mediaUrl.href; mediaOpen.target = '_blank'; mediaOpen.rel = 'noopener noreferrer nofollow'; mediaOpen.textContent = 'Open original ↗';
      mediaCaption.append(mediaKind, mediaOpen); imageFrame.append(imageExpand); media.append(imageFrame, mediaCaption, imageFallback); content.append(media);
    }
  }
  for (const reference of castEmbeds) {
    const referenceCard = document.createElement('aside'); referenceCard.className = 'post-reference-card'; referenceCard.dataset.fid = String(reference.fid); referenceCard.dataset.hash = reference.hash;
    const status = document.createElement('span'); status.className = 'post-reference-status'; status.textContent = 'Loading referenced cast…'; referenceCard.append(status);
    content.append(referenceCard);
    if (castReferenceObserver) castReferenceObserver.observe(referenceCard);
    else void loadCastReference(referenceCard);
  }
  const textUrls = [...String(body.text || '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)].map((match) => match[0].replace(/[),.!?:;\]}]+$/g, ''));
  const linkUrls = [...embeds.map((embed) => embed?.url), ...textUrls]
    .filter((url) => typeof url === 'string' && !isImageEmbedUrl(url) && !isVideoEmbedUrl(url));
  const seenLinkUrls = new Set();
  for (const rawUrl of linkUrls) {
    const previewUrl = safeExternalUrl(rawUrl);
    if (!previewUrl || seenLinkUrls.has(previewUrl.href)) continue;
    seenLinkUrls.add(previewUrl.href);
    if (seenLinkUrls.size > 4) break;
    const isMiniApp = isFarcasterMiniAppLink(previewUrl);
    const preview = document.createElement('a'); preview.className = `post-link-preview${isMiniApp ? ' post-miniapp-preview' : ''}`; preview.href = previewUrl.href; preview.target = '_blank'; preview.rel = 'noopener noreferrer nofollow';
    preview.setAttribute('aria-label', isMiniApp ? `Open Farcaster Mini App: ${previewUrl.pathname.split('/')[3] || 'app'}` : `Open link at ${previewUrl.hostname}`);
    const siteMark = document.createElement('span'); siteMark.className = 'link-preview-mark'; siteMark.setAttribute('aria-hidden', 'true'); siteMark.textContent = isMiniApp ? '✦' : previewUrl.hostname.replace(/^www\./i, '').slice(0, 1).toUpperCase();
    const site = document.createElement('span'); site.className = 'link-preview-copy';
    const domain = document.createElement('strong'); domain.textContent = isMiniApp ? 'Farcaster Mini App' : previewUrl.hostname.replace(/^www\./i, '');
    const path = document.createElement('small'); path.textContent = isMiniApp ? (previewUrl.pathname.split('/')[3] || 'Open app') : readableLinkPath(previewUrl.pathname) || 'Open link';
    const open = document.createElement('span'); open.className = 'link-preview-open'; open.setAttribute('aria-hidden', 'true'); open.textContent = isMiniApp ? 'Open app ↗' : '↗';
    site.append(domain, path); preview.append(siteMark, site, open); content.append(preview);
  }
  const actions = document.createElement('div'); actions.className = 'post-actions';
  const like = document.createElement('button'); like.type = 'button'; like.className = 'post-action'; like.dataset.action = 'like';
  const likeGlyph = document.createElement('span'); likeGlyph.className = 'post-action-glyph'; likeGlyph.textContent = '♡';
  const likeCount = document.createElement('span'); likeCount.className = 'post-action-count'; likeCount.dataset.engagementCount = 'Like'; likeCount.textContent = '…';
  like.append(likeGlyph, likeCount); like.setAttribute('aria-label', Number(state.fid) > 0 ? 'Checking like status' : 'Like cast'); like.title = 'Like';
  like.dataset.reactionState = Number(state.fid) > 0 ? 'loading' : 'unknown';
  like.setAttribute('aria-pressed', 'false');
  const recast = document.createElement('button'); recast.type = 'button'; recast.className = 'post-action'; recast.dataset.action = 'recast';
  const recastGlyph = document.createElement('span'); recastGlyph.className = 'post-action-glyph'; recastGlyph.textContent = '⟳';
  const recastCount = document.createElement('span'); recastCount.className = 'post-action-count'; recastCount.dataset.engagementCount = 'Recast'; recastCount.textContent = '…';
  recast.append(recastGlyph, recastCount); recast.setAttribute('aria-label', Number(state.fid) > 0 ? 'Checking recast status' : 'Recast'); recast.title = 'Recast';
  recast.dataset.reactionState = Number(state.fid) > 0 ? 'loading' : 'unknown';
  recast.setAttribute('aria-pressed', 'false');
  const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'post-action'; reply.dataset.action = 'reply';
  const replyGlyph = document.createElement('span'); replyGlyph.className = 'post-action-glyph'; replyGlyph.textContent = '↩';
  const replyCount = document.createElement('span'); replyCount.className = 'post-action-count'; replyCount.dataset.engagementCount = 'Reply'; replyCount.textContent = '…';
  reply.append(replyGlyph, replyCount); reply.setAttribute('aria-label', 'Reply'); reply.title = 'Reply';
  const conversation = document.createElement('button'); conversation.type = 'button'; conversation.className = 'post-action conversation-action'; conversation.setAttribute('aria-label', 'View thread'); conversation.title = 'View thread'; conversation.dataset.openConversation = 'true'; conversation.dataset.fid = String(fid); conversation.dataset.hash = postHash(message);
  conversation.setAttribute('aria-controls', 'conversation-view');
  const threadIsOpen = state.conversation?.fid === fid && state.conversation?.hash === postHash(message);
  conversation.setAttribute('aria-expanded', String(threadIsOpen));
  conversation.classList.toggle('is-open', threadIsOpen);
  const conversationGlyph = document.createElement('span'); conversationGlyph.className = 'post-action-glyph'; conversationGlyph.textContent = '↳';
  const conversationLabel = document.createElement('span'); conversationLabel.className = 'post-action-label'; conversationLabel.textContent = 'Thread';
  const conversationCount = document.createElement('span'); conversationCount.className = 'conversation-count'; conversationCount.hidden = true; conversationCount.dataset.threadReplyCount = 'true';
  conversation.append(conversationGlyph, conversationLabel, conversationCount);
  const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'post-action'; follow.textContent = state.following.get(fid) ? '✓' : '＋'; follow.setAttribute('aria-label', state.following.get(fid) ? 'Unfollow' : 'Follow'); follow.title = state.following.get(fid) ? 'Unfollow' : 'Follow'; follow.dataset.action = 'follow'; follow.setAttribute('aria-pressed', String(!!state.following.get(fid)));
  const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'post-action pin-action'; pin.textContent = '⌖'; pin.setAttribute('aria-label', state.deskPins.includes(fid) ? 'Unpin person from Desk' : 'Pin person to Desk'); pin.title = pin.getAttribute('aria-label'); pin.dataset.action = 'pin-person';
  pin.setAttribute('aria-pressed', String(state.deskPins.includes(fid)));
  const deskSignal = document.createElement('button'); deskSignal.type = 'button'; deskSignal.className = 'post-action pin-action'; deskSignal.dataset.action = 'toggle-desk-cast'; deskSignal.dataset.fid = String(fid); deskSignal.dataset.hash = postHash(message);
  deskSignal.draggable = !matchMedia('(pointer: coarse)').matches;
  const signalSaved = state.deskCasts.some((cast) => Number(cast.fid) === fid && cast.hash === postHash(message));
  deskSignal.textContent = signalSaved ? '▣' : '⌑'; deskSignal.setAttribute('aria-label', signalSaved ? 'Remove cast from Desk' : 'Save cast to Desk'); deskSignal.title = signalSaved ? 'Remove cast from Desk' : 'Save to Desk · drag to Desk'; deskSignal.setAttribute('aria-pressed', String(signalSaved));
  const flightLog = document.createElement('button'); flightLog.type = 'button'; flightLog.className = 'post-more-action flight-log-action';
  flightLog.dataset.flightLog = 'true'; flightLog.dataset.fid = String(fid); flightLog.dataset.hash = postHash(message);
  const saved = state.savedCasts.some((cast) => Number(cast.fid) === fid && cast.hash === postHash(message));
  flightLog.textContent = saved ? '★ Saved' : '☆ Save'; flightLog.setAttribute('aria-pressed', String(saved));
  const quote = document.createElement('button'); quote.type = 'button'; quote.className = 'post-action quote-action'; quote.dataset.action = 'quote-cast'; quote.dataset.fid = String(fid); quote.dataset.hash = postHash(message); quote.textContent = '❞'; quote.setAttribute('aria-label', 'Quote cast'); quote.title = 'Quote cast';
  for (const button of [like, recast, reply, quote, follow, pin]) { button.dataset.fid = String(fid); button.dataset.hash = postHash(message); button.disabled = button !== pin && (!state.signerReady || (button === follow && fid === state.fid)); }
  const originalUrl = originalCastUrl(profile, message);
  actions.append(conversation, like, recast, reply, quote, deskSignal);
  const more = document.createElement('details'); more.className = 'post-more';
  const moreSummary = document.createElement('summary'); moreSummary.textContent = '•••'; moreSummary.setAttribute('aria-label', 'Save or manage this post');
  const menu = document.createElement('div'); menu.className = 'post-more-menu';
  const pinnedCast = state.deskCasts.some((cast) => Number(cast.fid) === fid && cast.hash === postHash(message));
  const primary = document.createElement('div'); primary.className = 'post-desk-actions'; primary.setAttribute('role', 'group'); primary.setAttribute('aria-label', 'Save, pin, follow, and shortlist');
  const saveToDesk = menuAction(pinnedCast ? '✓ Saved to Desk' : '＋ Save post to Desk', 'toggle-desk-cast', fid, { hash: postHash(message) }); saveToDesk.dataset.deskPrimary = 'save'; saveToDesk.setAttribute('aria-pressed', String(pinnedCast)); primary.append(saveToDesk);
  const personPinned = state.deskPins.includes(fid);
  const pinAuthor = menuAction(personPinned ? '✓ Author pinned to Desk' : '⌖ Pin author to Desk', personPinned ? 'unpin-person' : 'pin-person', fid); pinAuthor.dataset.deskPrimary = 'pin'; pinAuthor.setAttribute('aria-pressed', String(personPinned)); primary.append(pinAuthor);
  const followAuthor = menuAction(state.following.get(fid) ? `✓ Following @${profile.username || `fid-${fid}`}` : `＋ Follow @${profile.username || `fid-${fid}`}`, 'follow', fid, { hash: postHash(message) }); followAuthor.dataset.deskPrimary = 'follow'; followAuthor.setAttribute('aria-pressed', String(!!state.following.get(fid))); primary.append(followAuthor);
  const inTopPeople = state.friendFids.includes(fid);
  const topPeopleAction = menuAction(inTopPeople ? '✓ In Top people' : '＋ Add to Top people', 'toggle-friend', fid); topPeopleAction.setAttribute('aria-pressed', String(inTopPeople)); primary.append(topPeopleAction);
  more.addEventListener('toggle', () => {
    if (!more.open || !state.fid || fid === Number(state.fid)) return;
    const delay = maxNodeDelay();
    if (state.following.has(fid) && !state.followStatusUnknown.has(fid) && delay !== null && delay <= 10) return;
    followAuthor.textContent = 'Checking…';
    followAuthor.setAttribute('aria-label', `Checking follow status for @${profile.username || `fid-${fid}`}`);
    followAuthor.setAttribute('aria-busy', 'true');
    followAuthor.disabled = true;
    void refreshFollowState(fid).finally(() => {
      if (!followAuthor.isConnected) return;
      followAuthor.removeAttribute('aria-busy');
      updateFollowButton(followAuthor, fid);
    });
  });
  menu.append(primary);

  const secondary = document.createElement('details'); secondary.className = 'post-more-secondary';
  const secondarySummary = document.createElement('summary'); secondarySummary.textContent = 'More post actions';
  const secondaryList = document.createElement('div'); secondaryList.className = 'post-more-secondary-list';
  const share = document.createElement('button'); share.type = 'button'; share.className = 'post-more-action'; share.dataset.shareCast = 'true'; share.dataset.fid = String(fid); share.dataset.hash = postHash(message); share.textContent = 'Share cast'; secondaryList.append(share);
  const reactionDetails = document.createElement('button'); reactionDetails.type = 'button'; reactionDetails.className = 'post-more-action'; reactionDetails.dataset.reactionsCast = 'true'; reactionDetails.dataset.fid = String(fid); reactionDetails.dataset.hash = postHash(message); reactionDetails.textContent = 'Who liked or recast'; secondaryList.append(reactionDetails);
  secondaryList.append(flightLog);
  secondaryList.append(menuAction(state.mutedAuthors.includes(fid) ? 'Unhide author' : 'Hide author', 'toggle-author-mute', fid));
  const topics = topicsForCast(message);
  const deskTopic = topics.find((topic) => !state.deskTopics.includes(topic));
  if (deskTopic) secondaryList.append(menuAction(`Pin topic ${deskTopic.replace(/^site:/, '')}`, 'toggle-desk-topic', fid, { topic: deskTopic }));
  if (topics.length) secondaryList.append(menuAction(`Mute ${topics[0].replace(/^site:/, '')}`, 'mute-topic', fid, { topic: topics[0] }));
  secondaryList.append(menuAction('Quote cast', 'quote-cast', fid, { hash: postHash(message) }));
  if (originalUrl) {
    const open = document.createElement('a'); open.className = 'post-more-action'; open.href = originalUrl; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = 'Open original cast ↗'; secondaryList.append(open);
  }
  const pinLabel = state.profilePins[fid] === postHash(message) ? 'Unpin from profile' : 'Pin to profile';
  secondaryList.append(menuAction(pinLabel, 'toggle-profile-pin', fid, { hash: postHash(message) }));
  secondary.append(secondarySummary, secondaryList); menu.append(secondary);
  more.append(moreSummary, menu); actions.append(more);
  content.append(actions); card.append(avatar, content);
  return card;
}

function castRenderSignature(message) {
  const fid = Number(message?.data?.fid) || 0;
  const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}`, avatar: '' };
  const parentFid = Number(message?.data?.castAddBody?.parentCastId?.fid) || 0;
  const parentProfile = state.people.get(parentFid);
  const hash = postHash(message);
  return JSON.stringify([
    Number(state.fid), !!state.signerReady, !!state.remoteMediaEnabled,
    profile.name, profile.username, profile.avatar, localProfileName(profile),
    parentProfile?.name || '', parentProfile?.username || '', parentProfile?.avatar || '',
    !!state.following.get(fid), state.following.has(fid), state.followStatusUnknown.has(fid),
    state.friendFids.includes(fid), state.deskPins.includes(fid), state.mutedAuthors.includes(fid),
    state.deskCasts.some((cast) => Number(cast.fid) === fid && cast.hash === hash),
    state.savedCasts.some((cast) => Number(cast.fid) === fid && cast.hash === hash),
    state.profilePins[fid] === hash,
    state.sourceBySigner.get(signerHex(message.signer)) || null,
  ]);
}

function reactionMessages(response) {
  return (Array.isArray(response?.messages) ? response.messages : Array.isArray(response?.items) ? response.items : [])
    .filter((message) => Number(message?.data?.fid) > 0);
}

function engagementKey(fid, hash, type) { return `${Number(fid)}:${String(hash).toLowerCase()}:${type}`; }

function displayEngagementCount({ count, more }) {
  const formatted = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(count);
  return more ? `${formatted}+` : formatted;
}

function paintReactionButtonState(button, type, active) {
  if (!button) return;
  const isLike = type === 'Like';
  button.dataset.reactionState = active ? 'active' : 'inactive';
  button.setAttribute('aria-pressed', String(active));
  const glyph = button.querySelector('.post-action-glyph');
  if (glyph) glyph.textContent = isLike ? (active ? '♥' : '♡') : (active ? '✓' : '⟳');
  const count = button.querySelector(`[data-engagement-count="${type}"]`);
  const label = isLike ? (active ? 'Remove like' : 'Like cast') : (active ? 'Remove recast' : 'Recast');
  const countLabel = count?.dataset.countState === 'ready'
    ? ` · ${count.textContent} ${type === 'Like' ? 'likes' : 'recasts'}`
    : count?.dataset.countState === 'error' ? ` · ${type === 'Like' ? 'likes' : 'recasts'} count unavailable` : '';
  button.setAttribute('aria-label', `${label}${countLabel}`);
  button.title = label;
}

function paintEngagementCount(card, type, result) {
  const count = card.querySelector(`[data-engagement-count="${type}"]`);
  if (!count) return;
  count.textContent = result ? displayEngagementCount(result) : '—';
  count.dataset.countState = result ? 'ready' : 'error';
  count.dataset.countMore = result?.more ? 'true' : 'false';
  const label = type === 'Like' ? 'likes' : type === 'Recast' ? 'recasts' : 'replies';
  const button = count.closest('button');
  if (type === 'Like' || type === 'Recast') {
    paintReactionButtonState(button, type, button?.getAttribute('aria-pressed') === 'true');
    return;
  }
  if (button) {
    button.setAttribute('aria-label', `${result ? `${result.more ? 'At least ' : ''}${result.count} ${label}` : `${label} count unavailable`} · Reply`);
    button.title = result ? `${result.count} ${label}` : `${label} count unavailable`;
  }
  const threadCount = card.querySelector('.conversation-count');
  const threadButton = threadCount?.closest('.conversation-action');
  if (threadCount && threadButton) {
    threadCount.hidden = !result || result.count === 0;
    threadCount.textContent = result ? displayEngagementCount(result) : '';
    const threadLabel = threadButton.getAttribute('aria-expanded') === 'true' ? 'Close thread' : 'View thread';
    threadButton.setAttribute('aria-label', result?.count ? `${threadLabel} · ${displayEngagementCount(result)} replies` : threadLabel);
    threadButton.title = result?.count ? `${displayEngagementCount(result)} replies · ${threadLabel}` : threadLabel;
  }
}

function viewerReactionKey(viewerFid, targetFid, hash) {
  return `${Number(viewerFid)}:${Number(targetFid)}:${String(hash).toLowerCase()}`;
}

async function readViewerReactionState(viewerFid, targetFid, hash, type) {
  const key = `${viewerReactionKey(viewerFid, targetFid, hash)}:${type}`;
  const cached = viewerReactionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.active;
  if (viewerReactionRequests.has(key)) return viewerReactionRequests.get(key);
  const epoch = viewerReactionEpochs.get(key) || 0;
  const request = (async () => {
    let active = false;
    try {
      await nodeRequest('reactionById', { fid: Number(viewerFid), target_fid: Number(targetFid), target_hash: hash, reaction_type: type });
      active = true;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if ((viewerReactionEpochs.get(key) || 0) === epoch) {
      viewerReactionCache.set(key, { active, expiresAt: Date.now() + 30_000 });
      if (viewerReactionCache.size > 1200) viewerReactionCache.delete(viewerReactionCache.keys().next().value);
    }
    return active;
  })();
  viewerReactionRequests.set(key, request);
  try { return await request; }
  finally { if (viewerReactionRequests.get(key) === request) viewerReactionRequests.delete(key); }
}

function saveViewerReactionState(viewerFid, targetFid, hash, type, active) {
  const key = `${viewerReactionKey(viewerFid, targetFid, hash)}:${type}`;
  viewerReactionEpochs.set(key, (viewerReactionEpochs.get(key) || 0) + 1);
  viewerReactionRequests.delete(key);
  viewerReactionCache.set(key, { active, expiresAt: Date.now() + 30_000 });
}

function loadViewerReactionState(card, type) {
  const viewerFid = Number(state.fid);
  if (!Number.isSafeInteger(viewerFid) || viewerFid < 1) return;
  const targetFid = Number(card.dataset.castFid);
  const hash = card.dataset.castHash;
  const action = type === 'Like' ? 'like' : 'recast';
  const button = card.querySelector(`[data-action="${action}"]`);
  if (!button) return;
  const key = `${viewerReactionKey(viewerFid, targetFid, hash)}:${type}`;
  const epoch = viewerReactionEpochs.get(key) || 0;
  void readViewerReactionState(viewerFid, targetFid, hash, type).then((active) => {
    if (!card.isConnected || Number(state.fid) !== viewerFid) return;
    if ((viewerReactionEpochs.get(key) || 0) !== epoch) return;
    paintReactionButtonState(button, type, active);
  }).catch(() => {
    if (card.isConnected && Number(state.fid) === viewerFid) {
      button.dataset.reactionState = 'unavailable';
      const label = type === 'Like' ? 'Like' : 'Recast';
      button.setAttribute('aria-label', `${label} status unavailable · refresh to try again`);
      button.title = `${label} status unavailable`;
    }
  });
}

async function readEngagementCount(card, type) {
  const fid = Number(card.dataset.castFid);
  const hash = card.dataset.castHash;
  const key = engagementKey(fid, hash, type);
  const cached = engagementCountCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (engagementCountRequests.has(key)) return engagementCountRequests.get(key);
  const request = (async () => {
    const route = type === 'Like' || type === 'Recast' ? 'reactionsByCast' : 'replies';
    const params = type === 'Like' || type === 'Recast'
      ? { target_fid: fid, target_hash: hash, reaction_type: type, pageSize: 100, reverse: true }
      : { fid, hash, pageSize: 100, reverse: true };
    const response = await nodeRequest(route, params);
    const messages = type === 'Like' || type === 'Recast'
      ? reactionMessages(response)
      : unwrapMessages(response).filter((message) => message?.data?.castAddBody);
    const result = { count: messages.length, more: !!response?.nextPageToken, expiresAt: Date.now() + 60_000 };
    engagementCountCache.set(key, result);
    if (engagementCountCache.size > 900) engagementCountCache.delete(engagementCountCache.keys().next().value);
    return result;
  })();
  engagementCountRequests.set(key, request);
  try { return await request; }
  finally { if (engagementCountRequests.get(key) === request) engagementCountRequests.delete(key); }
}

async function loadCastEngagement(card) {
  if (!card?.isConnected) return;
  card.dataset.engagementLoaded = 'true';
  loadViewerReactionState(card, 'Like');
  loadViewerReactionState(card, 'Recast');
  await Promise.all(['Like', 'Recast', 'Reply'].map(async (type) => {
    const key = engagementKey(card.dataset.castFid, card.dataset.castHash, type);
    const epoch = engagementCountEpochs.get(key) || 0;
    try {
      const result = await readEngagementCount(card, type);
      if ((engagementCountEpochs.get(key) || 0) === epoch) paintEngagementCount(card, type, result);
    } catch { if ((engagementCountEpochs.get(key) || 0) === epoch) paintEngagementCount(card, type, null); }
  }));
}

function watchCastEngagement(root) {
  const cards = root.matches?.('.post-card') ? [root] : [...(root.querySelectorAll?.('.post-card') || [])];
  for (const card of cards) {
    if (card.dataset.engagementLoaded) continue;
    if (engagementObserver) engagementObserver.observe(card);
    else if (card.getBoundingClientRect().top < window.innerHeight + 180) void loadCastEngagement(card);
  }
}

function refreshCastEngagement(fid, hash) {
  for (const type of ['Like', 'Recast', 'Reply']) {
    const key = engagementKey(fid, hash, type);
    engagementCountCache.delete(key);
    engagementCountEpochs.set(key, (engagementCountEpochs.get(key) || 0) + 1);
    engagementCountRequests.delete(key);
  }
  document.querySelectorAll('.post-card').forEach((card) => {
    if (Number(card.dataset.castFid) !== Number(fid) || card.dataset.castHash !== hash) return;
    delete card.dataset.engagementLoaded;
    for (const count of card.querySelectorAll('[data-engagement-count]')) {
      count.textContent = '…';
      count.dataset.countState = 'loading';
    }
    const threadCount = card.querySelector('.conversation-count');
    if (threadCount) { threadCount.hidden = true; threadCount.textContent = ''; }
    watchCastEngagement(card);
  });
}

async function renderReactionGroup(panel, fid, hash, type, { append = false } = {}) {
  const group = panel.querySelector(`[data-reaction-group="${type}"]`);
  const list = group.querySelector('.reaction-people');
  const status = group.querySelector('.reaction-empty');
  const more = group.querySelector('[data-reaction-more]');
  const pageToken = append ? more.dataset.pageToken : '';
  more.disabled = true;
  more.textContent = 'Loading…';
  try {
    const response = await nodeRequest('reactionsByCast', {
      target_fid: fid, target_hash: hash, reaction_type: type, pageSize: 8, reverse: true, pageToken,
    });
    const messages = reactionMessages(response);
    const fids = [...new Set(messages.map((message) => Number(message.data.fid)))];
    await mapLimit(fids, 4, fetchProfile);
    for (const reaction of messages) {
      const reactorFid = Number(reaction.data.fid);
      if (list.querySelector(`[data-reaction-fid="${reactorFid}"]`)) continue;
      const profile = state.people.get(reactorFid) || { fid: reactorFid, name: `FID ${reactorFid}`, username: `fid-${reactorFid}` };
      const row = document.createElement('button'); row.type = 'button'; row.className = 'reaction-person'; row.dataset.openProfile = String(reactorFid); row.dataset.reactionFid = String(reactorFid);
      const avatar = document.createElement('span'); avatar.className = 'reaction-avatar'; avatar.textContent = String(profile.name || profile.username || '?').slice(0, 1).toUpperCase();
      if (profile.avatar && safeImageUrl(profile.avatar)) setRemoteAvatar(avatar, safeImageUrl(profile.avatar));
      const identity = document.createElement('span'); identity.className = 'reaction-identity';
      const name = document.createElement('strong'); name.textContent = localProfileName(profile);
      const handle = document.createElement('small'); handle.textContent = `@${profile.username || `fid-${reactorFid}`}`;
      identity.append(name, handle); row.append(avatar, identity); list.append(row);
    }
    status.hidden = messages.length > 0 || list.children.length > 0;
    status.textContent = append ? 'No more reactions.' : `No ${type === 'Like' ? 'likes' : 'recasts'} yet.`;
    more.dataset.pageToken = response?.nextPageToken || '';
    more.hidden = !more.dataset.pageToken;
    more.textContent = 'Show more';
  } catch (error) {
    status.hidden = false;
    status.textContent = `Could not load ${type === 'Like' ? 'likes' : 'recasts'}. ${clientErrorText(error)}`;
    more.hidden = true;
  } finally { more.disabled = false; }
}

async function openReactionDetails(button) {
  const card = button.closest('.post-card');
  if (!card) return;
  let panel = card.querySelector('.cast-reaction-panel');
  if (panel) {
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;
    button.closest('.post-more')?.removeAttribute('open');
    return;
  }
  panel = document.createElement('section'); panel.className = 'cast-reaction-panel'; panel.setAttribute('aria-label', 'Cast reactions');
  const heading = document.createElement('div'); heading.className = 'reaction-panel-head';
  const title = document.createElement('strong'); title.textContent = 'People who reacted';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'reaction-panel-close'; close.textContent = 'Close'; close.addEventListener('click', () => { panel.hidden = true; });
  heading.append(title, close);
  const groups = document.createElement('div'); groups.className = 'reaction-groups';
  for (const type of ['Like', 'Recast']) {
    const group = document.createElement('section'); group.className = 'reaction-group'; group.dataset.reactionGroup = type;
    const label = document.createElement('h4'); label.textContent = type === 'Like' ? 'Likes' : 'Recasts';
    const list = document.createElement('div'); list.className = 'reaction-people';
    const empty = document.createElement('p'); empty.className = 'reaction-empty'; empty.textContent = 'Loading…'; empty.setAttribute('role', 'status');
    const more = document.createElement('button'); more.type = 'button'; more.className = 'reaction-more'; more.textContent = 'Show more'; more.hidden = true; more.dataset.reactionMore = 'true';
    more.addEventListener('click', () => renderReactionGroup(panel, Number(card.dataset.castFid), card.dataset.castHash, type, { append: true }));
    group.append(label, list, empty, more); groups.append(group);
  }
  panel.append(heading, groups);
  card.querySelector('.post-actions')?.after(panel);
  button.closest('.post-more')?.removeAttribute('open');
  button.disabled = true;
  try {
    await Promise.all(['Like', 'Recast'].map((type) => renderReactionGroup(panel, Number(card.dataset.castFid), card.dataset.castHash, type)));
  } finally { button.disabled = false; }
}

function updateFeedFilterSummary() {
  const summary = $('#feed-filter-summary');
  if (!summary) return;
  const activeCount = [
    !!state.feedQuery.trim(), state.repliesOnly, state.mediaOnly, state.appsOnly, state.orbitOnly,
    Number($('#source-fid')?.value) > 0,
  ].filter(Boolean).length;
  summary.textContent = activeCount ? `Filters · ${activeCount} active` : 'Filters';
  const reset = $('#clear-feed-filters');
  if (reset) reset.hidden = activeCount === 0;
}

function renderSuggestedPeople() {
  const lists = [$('#suggested-list'), $('#search-network-list')].filter(Boolean);
  if (!lists.length) return;
  const showEmpty = (message, actionLabel, action) => {
    for (const list of lists) {
      const empty = document.createElement('div'); empty.className = 'suggested-empty';
      const copy = document.createElement('p'); copy.textContent = message; empty.append(copy);
      if (actionLabel && action) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.textContent = actionLabel;
        button.addEventListener('click', action);
        empty.append(button);
      }
      list.replaceChildren(empty);
    }
  };
  if (state.suggestionsBusy) {
    for (const list of lists) { const loading = document.createElement('p'); loading.className = 'suggested-empty'; loading.textContent = 'Finding people through your follows…'; list.replaceChildren(loading); }
    return;
  }
  if (!state.signerReady) {
    showEmpty('Connect your Farcaster account to check your follow graph for recommendations.');
    return;
  }
  const visibleSuggestions = state.suggestedPeople.filter((person) => !state.following.get(Number(person.fid)) && !state.friendFids.includes(Number(person.fid)));
  if (!visibleSuggestions.length) {
    const nodeDelay = maxNodeDelay();
    const nodeBehind = nodeDelay !== null && nodeDelay > 10;
    if (state.suggestionsError) {
      showEmpty(nodeBehind
        ? `The node is ${formatNodeDelay(nodeDelay)} behind, so it could not confirm your follow graph. Suggestions may be incomplete.`
        : 'The node could not confirm your follow graph. Your follow status was left unchanged.',
      nodeBehind ? 'Check node status' : 'Retry suggestions',
      nodeBehind ? () => { navigate('node'); void checkNode(); } : () => { state.suggestionsLoadedFor = 0; void loadSuggestedPeople(); });
    } else if (!state.following.size && !state.feedSources.length) {
      showEmpty('Discover reads the public follow graphs of people you follow. Search for an account to follow first.', 'Search people', () => { navigate('search'); requestAnimationFrame(() => $('#people-query')?.focus({ preventScroll: true })); });
    } else if (nodeBehind) {
      showEmpty(`No new people were confirmed in the loaded graph. The node is ${formatNodeDelay(nodeDelay)} behind, so suggestions may be incomplete.`, 'Check node status', () => { navigate('node'); void checkNode(); });
    } else {
      showEmpty('No new people were found in the loaded follow graph.', 'Search people', () => { navigate('search'); requestAnimationFrame(() => $('#people-query')?.focus({ preventScroll: true })); });
    }
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const suggestion of visibleSuggestions.slice(0, 12)) {
    const profile = state.people.get(suggestion.fid) || { fid: suggestion.fid, name: `Farcaster ${suggestion.fid}`, username: `fid-${suggestion.fid}` };
    const row = document.createElement('article'); row.className = 'suggested-person';
    const avatar = document.createElement('button'); avatar.type = 'button'; avatar.className = 'suggested-avatar profile-open-button'; avatar.dataset.openProfile = String(suggestion.fid); avatar.setAttribute('aria-label', `Open ${localProfileName(profile)}'s profile`);
    const avatarUrl = safeImageUrl(profile.avatar);
    if (avatarUrl) setRemoteAvatar(avatar, avatarUrl); else avatar.textContent = String(profile.name || profile.username || '?').slice(0, 1).toUpperCase();
    const identity = document.createElement('button'); identity.type = 'button'; identity.className = 'suggested-identity profile-open-button'; identity.dataset.openProfile = String(suggestion.fid); identity.setAttribute('aria-label', `Open ${localProfileName(profile)}'s profile`);
    const name = document.createElement('strong'); name.textContent = localProfileName(profile);
    const handle = document.createElement('span'); handle.textContent = `@${profile.username || `fid-${suggestion.fid}`}`;
    const context = document.createElement('small'); context.textContent = `${suggestion.mutualCount} people you follow also follow them`;
    identity.append(name, handle, context);
    const actions = document.createElement('div'); actions.className = 'suggested-actions';
    const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'button button-outline suggested-follow'; follow.dataset.action = 'follow'; follow.dataset.fid = String(suggestion.fid); updateFollowButton(follow, suggestion.fid);
    const topPerson = document.createElement('button'); topPerson.type = 'button'; topPerson.className = 'button button-outline suggested-top-person'; topPerson.dataset.action = 'toggle-friend'; topPerson.dataset.fid = String(suggestion.fid);
    const inTopPeople = state.friendFids.includes(Number(suggestion.fid));
    topPerson.textContent = inTopPeople ? '✓ Top people' : '＋ Top people';
    topPerson.setAttribute('aria-label', inTopPeople ? `Remove ${localProfileName(profile)} from Top people` : `Add ${localProfileName(profile)} to Top people`);
    topPerson.setAttribute('aria-pressed', String(inTopPeople));
    actions.append(follow, topPerson);
    row.append(avatar, identity, actions); fragment.append(row);
  }
  for (const list of lists) list.replaceChildren(...[...fragment.children].map((child) => child.cloneNode(true)));
}

async function loadSuggestedPeople() {
  if (state.suggestionsBusy || !state.fid || !state.signerReady) return;
  if (state.suggestionsLoadedFor === Number(state.fid)) { renderSuggestedPeople(); return; }
  state.suggestionsBusy = true; state.suggestionsError = false; renderSuggestedPeople();
  try {
    let followed = [...state.following.keys()];
    if (!followed.length) {
      const graph = await fetchFollowGraph(state.fid, { maxPages: 4, maxFollows: 400 });
      followed = graph.fids;
      state.following.clear();
      state.followStatusUnknown.clear();
      for (const target of followed) setFollowState(target, true);
    }
    const sources = (followed.length ? followed : state.feedSources).slice(0, 8).filter((fid) => fid !== Number(state.fid));
    const groups = await mapLimit(sources, 2, async (sourceFid) => {
      const response = await nodeRequest('links', { fid: sourceFid, link_type: 'follow', pageSize: 50, reverse: true });
      return { sourceFid, messages: unwrapMessages(response) };
    });
    if (sources.length && !groups.some(Boolean)) throw new Error('No follow graphs responded.');
    const alreadyKnown = new Set([...state.following.keys(), ...state.friendFids, ...state.mutedAuthors]);
    const ranked = rankFollowRecommendations(groups.filter(Boolean), { ownFid: state.fid, followingFids: alreadyKnown, limit: 12 });
    // The feed may only have loaded the first page of follows. Confirm each
    // suggestion against our node so accounts from later pages are excluded too.
    const nodeDelay = maxNodeDelay();
    const nodeCurrent = nodeDelay !== null && nodeDelay <= 10;
    let verificationFailed = false;
    const checked = await mapLimit(ranked, 3, async (person) => {
      try {
        await nodeRequest('linkById', { fid: state.fid, target_fid: person.fid, link_type: 'follow' }, { fresh: true });
        setFollowState(person.fid, true);
        return null;
      } catch (error) {
        if (isNotFound(error)) {
          if (!nodeCurrent) {
            state.followStatusUnknown.add(Number(person.fid));
            verificationFailed = true;
            return null;
          }
          setFollowState(person.fid, false);
          return person;
        }
        // When relationship state is unavailable, don't guess and recommend
        // someone who may already be followed.
        verificationFailed = true;
        return null;
      }
    });
    if (ranked.length && !checked.some(Boolean) && verificationFailed) throw new Error('Could not verify follow state.');
    state.suggestedPeople = checked.filter(Boolean);
    await mapLimit(state.suggestedPeople.map((person) => person.fid), 3, fetchProfile);
    state.suggestionsLoadedFor = Number(state.fid);
  } catch {
    state.suggestedPeople = [];
    state.suggestionsError = true;
  } finally {
    state.suggestionsBusy = false;
    renderSuggestedPeople();
  }
}

function toggleSuggestedPeople() {
  const panel = $('#suggested-panel');
  if (!panel) return;
  const opening = panel.hidden;
  panel.hidden = !opening;
  $('#show-suggested')?.setAttribute('aria-expanded', String(opening));
  $('#feed-title').textContent = opening ? 'Discover' : feedWindowTitle();
  $('#feed-caption').textContent = opening ? 'People your follows know · follow on Farcaster or add to Top people on this device.' : feedDescription();
  updateFeedDestinationNav();
  if (opening) { loadSuggestedPeople(); panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

async function fetchProfileRecentPages(fid, { fresh = false } = {}) {
  return fetchProfilePages(
    (params) => nodeRequest('casts', params, { fresh }),
    { fid, startTimestamp: state.profileWindowStart },
  );
}

async function loadFeed(fidValue = state.fid, mode = state.feedMode, { fresh = false } = {}) {
  if (fresh) {
    clearSnapchainReadCache();
    if (mode === 'profile') state.people.delete(Number(fidValue));
  }
  state.conversation = null;
  $('#conversation-view').hidden = true;
  $('#feed-list').hidden = false;
  const publicProfileRequest = mode === 'profile' && Number.isSafeInteger(Number(fidValue)) && Number(fidValue) > 0;
  if (!state.fid && !publicProfileRequest) {
    renderEmpty('Sign in to open your feed.', 'Public profiles are open.');
    return;
  }
  if (state.feedBusy) { state.feedPending = [fidValue, mode]; feedScrollSaved = false; return; }
  if (!feedScrollSaved) saveFeedScroll();
  feedScrollSaved = false;
  const previousFeed = {
    mode: state.feedMode,
    targetFid: Number(state.feedTargetFid),
    casts: state.casts,
  };
  let fid;
  let partialLoadFailures = 0;
  let friendGraphFailed = false;
  try {
    fid = asFid(fidValue);
    if (mode !== 'profile' && fid !== Number(state.fid)) throw new Error('Feeds can only be opened for the connected Farcaster account.');
  } catch (error) {
    renderEmpty('Could not load this station.', error.message, { type: 'retry', label: 'Try again' });
    $('#feed-count').textContent = '0 POSTS';
    setNotice(error.message, 'error');
    return;
  }
  state.feedMode = ['profile', 'friends'].includes(mode) ? mode : 'following';
  if (previousFeed.mode !== state.feedMode || state.feedMode === 'profile') state.feedSort = 'recent';
  if (state.feedMode === 'profile' && (previousFeed.mode !== 'profile' || Number(previousFeed.targetFid) !== Number(fid))) state.profileTab = 'posts';
  state.feedTargetFid = state.feedMode === 'profile' ? fid : Number(state.fid);
  if (previousFeed.mode !== state.feedMode || previousFeed.targetFid !== Number(state.feedTargetFid)) state.feedUpdatedAt = 0;
  const retainExistingPosts = state.boardMode === 'signals'
    && previousFeed.mode === state.feedMode
    && previousFeed.targetFid === Number(state.feedTargetFid)
    && previousFeed.casts.length > 0;
  if (currentArea === 'feed') updatePrimaryNav();
  if (state.feedMode === 'following') { state.suggestedPeople = []; state.suggestionsLoadedFor = 0; $('#suggested-panel').hidden = true; $('#show-suggested')?.setAttribute('aria-expanded', 'false'); }
  state.feedSources = [];
  state.feedFailedSources = 0;
  state.feedSourceOffset = 0;
  state.feedCastPageTokens = new Map();
  state.feedFollowNextPageToken = '';
  state.feedFollowComplete = true;
  state.profileNextPageToken = '';
  state.profileWindowStart = state.feedMode === 'profile' ? profileRecentStartTimestamp() : 0;
  state.profileArchiveMode = false;
  state.profileSeenPageTokens.clear();
  state.feedQuery = '';
  const loadedSearch = $('#loaded-search');
  if (loadedSearch) loadedSearch.value = '';
  renderFeedMore();
  renderIdentity();
  $('#feed-count').hidden = state.feedMode === 'profile';
  if (state.feedMode === 'profile' && fid !== Number(state.fid)) refreshFollowState(fid);
  updateFeedTabs();
  $('#page-label').textContent = state.feedMode === 'profile' ? 'PROFILE' : state.feedMode.toUpperCase();
  $('#composer').hidden = !state.signerReady || state.boardMode === 'flight-log' || (state.feedMode === 'profile' && !state.parent);
  const requestId = ++state.feedRequest;
  // Keep the last successful timeline visible while the same feed refreshes.
  // A slow node can take several seconds to answer, and replacing real posts
  // with an empty loading card makes Following look broken in the meantime.
  state.casts = retainExistingPosts ? previousFeed.casts : [];
  $('#feed-pulse').hidden = true;
  renderProfileSummary();
  state.feedBusy = true;
  renderFeedStatusbar();
  const discoverButton = $('#show-suggested');
  if (discoverButton) discoverButton.disabled = true;
  const list = $('#feed-list'); list.setAttribute('aria-busy', 'true');
  const feedLabel = state.feedMode === 'profile' ? 'Profile' : state.feedMode === 'friends' ? 'Top people' : 'Following';
  if (state.boardMode === 'signals') {
    $('#feed-title').textContent = feedWindowTitle();
    $('#feed-caption').textContent = state.feedMode === 'profile' ? 'Last 30 days · newest first.' : feedDescription(state.feedMode);
  }
  if (!retainExistingPosts) {
    renderEmpty('Loading posts…', state.feedMode === 'profile' ? 'Getting recent posts from this profile.' : state.feedMode === 'friends' ? 'Finding active people and mixing their recent posts.' : 'Checking people you follow for recent posts.');
  }
  try {
    if (!state.nodeInfo) checkNode();
    const [followGraph, profile, curatedTopFids] = await Promise.all([
      state.feedMode === 'following' ? fetchFollowGraph(fid, { maxPages: 100, maxFollows: 10_000 }, { fresh })
        : state.feedMode === 'friends' ? fetchFollowGraph(fid, { maxPages: 4, maxFollows: 400 }, { fresh }).catch(() => { friendGraphFailed = true; return { fids: [], complete: false, nextPageToken: '' }; })
          : Promise.resolve({ fids: [], complete: true, nextPageToken: '' }),
      state.feedMode === 'profile' ? fetchProfile(fid, { fresh }) : Promise.resolve(null),
      state.feedMode === 'friends' ? ensureCuratedTopAccounts() : Promise.resolve([]),
    ]);
    const followFids = followGraph.fids;
    if (state.feedMode === 'following') {
      state.following.clear();
      state.followStatusUnknown.clear();
      for (const target of followFids) setFollowState(target, true);
      state.feedFollowComplete = followGraph.complete;
      state.feedFollowNextPageToken = followGraph.nextPageToken || '';
    }
    const friendCandidates = state.feedMode === 'friends'
      ? [...new Set([
        ...curatedTopFids.filter((target) => Number(target) !== Number(fid)),
        ...state.friendFids.filter((target) => Number(target) !== Number(fid)),
        ...spreadFids(followFids.filter((target) => !curatedTopFids.includes(Number(target)) && !state.friendFids.includes(Number(target))), Math.max(12, 56 - curatedTopFids.length - state.friendFids.length)),
      ])].slice(0, 56)
      : [];
    const uniqueFids = state.feedMode === 'profile' ? [fid]
      : state.feedMode === 'friends' ? friendCandidates
        : [...new Set(followFids)];
    const limitedFids = [...new Set(uniqueFids)].filter((target) => Number.isSafeInteger(target) && target > 0);
    state.feedSources = ['following', 'friends'].includes(state.feedMode) ? limitedFids : [];
    state.feedSourceOffset = 0;
    state.feedFollowTotal = state.feedMode === 'following' ? state.following.size : 0;
    if (state.suggestionsLoadedFor !== Number(state.fid)) state.suggestedPeople = [];
    $('#suggested-panel').hidden = true;
    renderSuggestedPeople();
    if (state.boardMode === 'signals') {
      $('#feed-title').textContent = feedWindowTitle();
      $('#feed-caption').textContent = state.feedMode === 'profile' ? `@${profile.username} · last 30 days` : feedDescription();
    }
    if (!limitedFids.length && state.feedMode === 'friends') {
      state.casts = [];
      state.feedFailedSources = friendGraphFailed ? 1 : 0;
      state.feedUpdatedAt = Date.now();
      renderFeed();
      renderFeedFreshness();
      $('#feed-filters').hidden = false;
      restoreFeedScroll();
      return true;
    }
    let castGroups;
    if (state.feedMode === 'following') {
      const initialSources = limitedFids.slice(0, 12);
      const loadedGroups = await mapLimit(initialSources, 6, async (target) => {
        try {
          const response = await nodeRequest('casts', { fid: target, pageSize: 100, reverse: true, startTimestamp: recentFeedStartTimestamp() }, { fresh });
          if (requestId !== state.feedRequest) return null;
          const messages = unwrapMessages(response).filter((message) => message?.data?.castAddBody);
          const oldestTimestamp = messages.reduce((oldest, message) => Math.min(oldest, Number(message?.data?.timestamp) || Infinity), Infinity);
          const nextPageToken = messages.length && oldestTimestamp >= recentFeedStartTimestamp() ? String(response?.nextPageToken || response?.next_page_token || '') : '';
          if (nextPageToken) state.feedCastPageTokens.set(target, nextPageToken);
          return { fid: target, messages };
        } catch {
          partialLoadFailures += 1;
          return { fid: target, messages: [] };
        }
      });
      const firstUnloaded = loadedGroups.findIndex((group) => !group);
      state.feedSourceOffset = firstUnloaded < 0 ? initialSources.length : firstUnloaded;
      state.feedFailedSources = partialLoadFailures;
      castGroups = loadedGroups.filter(Boolean);
    } else {
      castGroups = await mapLimit(limitedFids, state.feedMode === 'friends' ? 8 : 6, async (target) => {
        if (state.feedMode === 'profile') {
          const [page, profileData] = await Promise.all([fetchProfileRecentPages(target, { fresh }), fetchProfile(target, { fresh })]);
          return { ...page, profileData };
        }
        try {
          const response = await nodeRequest('casts', { fid: target, pageSize: state.feedMode === 'friends' ? 12 : 100, reverse: true, startTimestamp: recentFeedStartTimestamp() }, { fresh });
          return { fid: target, messages: unwrapMessages(response).filter((message) => message?.data?.castAddBody), nextPageToken: response?.nextPageToken || '', seenPageTokens: new Set() };
        } catch (error) {
          if (state.feedMode !== 'friends') throw error;
          partialLoadFailures += 1;
          return { fid: target, messages: [], nextPageToken: '', seenPageTokens: new Set() };
        }
      });
    }
    if (requestId !== state.feedRequest) return false;
    if (state.feedMode === 'profile') {
      state.profileNextPageToken = castGroups[0]?.nextPageToken || '';
      state.profileSeenPageTokens = castGroups[0]?.seenPageTokens || new Set();
    }
    const recentStart = state.feedMode === 'profile' ? state.profileWindowStart : recentFeedStartTimestamp();
    const recentEnd = profileRecentStartTimestamp(Date.now(), 0);
    const activeFriendFids = state.feedMode === 'friends'
      ? rankActiveFeedSources(castGroups, { ownFid: fid, pinnedFids: [...curatedTopFids, ...state.friendFids], limit: 56, activeSince: recentEnd - (7 * 86_400) })
      : [];
    if (state.feedMode === 'friends') {
      state.feedSources = activeFriendFids;
      state.feedFailedSources = partialLoadFailures + (friendGraphFailed ? 1 : 0);
    }
    const activeFriendSet = new Set(activeFriendFids);
    const knownCastIds = new Set();
    const newestFirst = castGroups.flatMap((group) => group.messages)
      .filter((message) => {
        if (state.feedMode === 'friends' && !activeFriendSet.has(Number(message?.data?.fid))) return false;
        const timestamp = Number(message?.data?.timestamp);
        const key = `${Number(message?.data?.fid)}:${postHash(message)}`;
        if (timestamp < recentStart || timestamp > recentEnd || knownCastIds.has(key)) return false;
        knownCastIds.add(key);
        return true;
      })
      .sort((a, b) => Number(b.data.timestamp || 0) - Number(a.data.timestamp || 0));
    const fetchedMessages = state.feedMode === 'profile' ? newestFirst
      : state.feedMode === 'friends' ? mixAuthorTimeline(newestFirst, { maxPerAuthor: 2 }).slice(0, 40)
        : newestFirst;
    // A caught-up cache may be more useful than a successful but empty reply
    // from a node that is still behind. Keep it until the node can return posts.
    const keepPreviousWhileNodeCatchesUp = state.feedMode === 'following'
      && retainExistingPosts
      && fetchedMessages.length === 0
      && (maxNodeDelay() ?? 0) > 10;
    const messages = keepPreviousWhileNodeCatchesUp ? previousFeed.casts : fetchedMessages;
    state.casts = messages;
    if (state.feedSort === 'popular' && state.feedMode !== 'profile') await loadPopularScores(messages);
    if (requestId !== state.feedRequest) return false;
    if (Number($('#source-fid').value) > 0) await loadSignerSources(messages);
    state.feedUpdatedAt = Date.now();
    const profileFids = [...new Set(messages.flatMap((message) => [
      Number(message?.data?.fid), Number(message?.data?.castAddBody?.parentCastId?.fid),
    ]).filter((value) => value > 0))].slice(0, 80);
    const missingProfiles = profileFids.filter((target) => !state.people.has(target));
    const missingPins = state.deskPins.filter((target) => !state.people.has(target));
    renderDesk();
    renderFeed();
    renderFeedFreshness();
    $('#feed-filters').hidden = state.boardMode === 'flight-log';
    if (state.feedMode === 'profile') renderProfileSummary();
    if (!messages.length) $('#feed-count').textContent = '0 POSTS';
    renderFeedMore();
    updateFollowingCoverage();
    if (friendGraphFailed && state.feedMode === 'friends') setNotice('Could not read the full follow graph. Showing active posts from your local Top people picks; refresh when the node is reachable.', 'error');
    else if (partialLoadFailures && state.feedMode === 'friends') setNotice(`Loaded the active accounts the node returned. ${partialLoadFailures} Top people ${partialLoadFailures === 1 ? 'source could' : 'sources could'} not be checked; refresh to retry.`, 'error');
    else if (partialLoadFailures) setNotice(`Loaded what was available. ${partialLoadFailures} followed ${partialLoadFailures === 1 ? 'account could' : 'accounts could'} not be checked; use refresh to retry.`, 'error');
    else if (keepPreviousWhileNodeCatchesUp) setNotice(`The node returned no recent posts. Keeping the ${messages.length} posts already loaded while it catches up.`, 'info');
    restoreFeedScroll();
    if (state.feedMode === 'following' && state.feedSourceOffset < state.feedSources.length) {
      const checkedOffset = state.feedSourceOffset;
      window.setTimeout(() => {
        if (requestId === state.feedRequest && state.feedMode === 'following' && state.boardMode === 'signals'
          && state.feedSourceOffset === checkedOffset && !state.feedMoreBusy) {
          void loadMoreFollowed({ automatic: true });
        }
      }, 220);
    }
    // Show posts as soon as the cast requests finish. Hydrate names and avatars
    // afterward so slower profile lookups do not hold the whole feed hostage.
    void (async () => {
      await Promise.all([
        mapLimit(missingProfiles, 8, fetchProfile),
        mapLimit(missingPins, 6, fetchProfile),
      ]);
      if (requestId !== state.feedRequest) return;
      renderDesk();
      renderFeed();
    })();
    return true;
  } catch (error) {
    if (requestId !== state.feedRequest) return false;
    const sameFeed = previousFeed.mode === state.feedMode && previousFeed.targetFid === Number(state.feedTargetFid);
    if (sameFeed && previousFeed.casts.length) {
      state.casts = previousFeed.casts;
      renderFeed();
      if (state.feedMode === 'profile') renderProfileSummary();
      setNotice(`Could not refresh. Showing the posts already loaded. ${clientErrorText(error)}`, 'error');
      restoreFeedScroll();
      return false;
    }
    const needsSetup = /SNAPCHAIN_URL|not configured|not been configured/i.test(error.message);
    const localPreview = ['localhost', '127.0.0.1'].includes(location.hostname);
    const detail = needsSetup
      ? localPreview
        ? 'Connect a Snapchain node to load profiles and posts.'
        : 'Snapchain is not configured yet.'
      : clientErrorText(error);
    const action = needsSetup
      ? (localPreview ? { type: 'guide', label: 'Open feed setup guide' } : null)
      : { type: 'retry', label: 'Try this account again' };
    renderEmpty(needsSetup ? 'Feed service is not connected yet.' : 'Could not build this feed.', detail, action);
    $('#feed-count').textContent = '0 POSTS';
    restoreFeedScroll();
    return false;
  } finally {
    state.feedBusy = false;
    renderFeedStatusbar();
    if (discoverButton) discoverButton.disabled = false;
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
  const hasProfileMore = state.boardMode === 'signals' && state.feedMode === 'profile'
    && (!!state.profileNextPageToken || !state.profileArchiveMode);
  const hasMore = state.boardMode === 'signals' && ((state.feedMode === 'following' && (state.feedSourceOffset < state.feedSources.length || state.feedCastPageTokens.size > 0 || !!state.feedFollowNextPageToken)) || hasProfileMore);
  button.hidden = !hasMore;
  button.disabled = state.feedMoreBusy;
  button.textContent = state.feedMoreBusy
    ? (state.feedMode === 'profile' ? 'Loading older posts…' : 'Loading recent posts…')
    : hasProfileMore ? (state.profileArchiveMode ? 'Load older posts' : state.profileNextPageToken ? 'More from this month' : 'Load earlier posts')
      : 'Load more recent posts';
  if (label) {
    label.hidden = hasMore;
    label.textContent = hasProfileMore ? (state.profileArchiveMode ? 'MORE POSTS BELOW' : 'LAST 30 DAYS · MORE BELOW') : state.feedMode === 'following' && state.feedFollowTotal > 0
      ? `${state.feedFollowComplete ? 'CHECKED' : 'AT LEAST'} ${state.feedSourceOffset} OF ${state.feedFollowTotal} FOLLOWED ACCOUNTS · ${state.casts.length} RECENT POSTS LOADED`
      : state.feedMode === 'profile' ? 'END OF PROFILE' : 'END OF TRANSMISSION';
  }
  footer.hidden = !hasMore && state.casts.length === 0;
  renderFeedStatusbar();
  return hasMore;
}

async function loadOlderProfilePosts() {
  if (state.feedMoreBusy || state.feedMode !== 'profile' || (state.profileArchiveMode && !state.profileNextPageToken)) return;
  const requestId = state.feedRequest;
  const pageToken = state.profileNextPageToken;
  const enteringArchive = !state.profileArchiveMode && !pageToken;
  const targetFid = Number(state.feedTargetFid);
  state.feedMoreBusy = true;
  renderFeedMore();
  try {
    const pageParams = state.profileArchiveMode || enteringArchive
      ? { stopTimestamp: state.profileWindowStart }
      : { startTimestamp: state.profileWindowStart };
    if (pageToken) pageParams.pageToken = pageToken;
    const response = await nodeRequest('casts', { fid: targetFid, pageSize: 100, reverse: true, ...pageParams });
    if (requestId !== state.feedRequest || state.feedMode !== 'profile' || targetFid !== Number(state.feedTargetFid)) return;
    const existing = new Set(state.casts.map((message) => `${Number(message?.data?.fid)}:${postHash(message)}`));
    for (const message of unwrapMessages(response).filter((item) => item?.data?.castAddBody)) {
      const key = `${Number(message?.data?.fid)}:${postHash(message)}`;
      if (!existing.has(key)) { existing.add(key); state.casts.push(message); }
    }
    state.casts.sort((a, b) => Number(b?.data?.timestamp || 0) - Number(a?.data?.timestamp || 0));
    const nextPageToken = response?.nextPageToken || '';
    if (enteringArchive) state.profileArchiveMode = true;
    state.profileNextPageToken = nextPageToken && !state.profileSeenPageTokens.has(nextPageToken) ? nextPageToken : '';
    if (state.profileNextPageToken) state.profileSeenPageTokens.add(state.profileNextPageToken);
    const relatedFids = [...new Set(state.casts.flatMap((message) => [
      Number(message?.data?.fid), Number(message?.data?.castAddBody?.parentCastId?.fid),
    ]).filter((fid) => fid > 0 && !state.people.has(fid)))];
    await mapLimit(relatedFids, 6, fetchProfile);
    if (requestId !== state.feedRequest) return;
    renderFeed();
    setNotice(enteringArchive ? 'Showing posts from before the last 30 days.' : state.profileArchiveMode ? `Loaded ${unwrapMessages(response).length} earlier posts.` : `Loaded ${unwrapMessages(response).length} more from the last 30 days.`, 'success');
  } catch (error) {
    if (requestId === state.feedRequest) setNotice(`Could not load older posts. ${clientErrorText(error)}`, 'error');
  } finally {
    state.feedMoreBusy = false;
    renderFeedMore();
  }
}

function updateFollowingCoverage() {
  const caption = $('#feed-caption');
  if (!caption || state.feedMode !== 'following' || state.boardMode !== 'signals') return;
  const summary = state.feedSort === 'popular'
    ? 'Popular · most liked and recast among recent posts from your follows · last 30 days.'
    : 'Newest first · recent posts from your followed accounts · last 30 days.';
  const maxDelay = maxNodeDelay();
  caption.textContent = maxDelay !== null && maxDelay > 10
    ? `${summary} Node data is ${formatNodeDelay(maxDelay)} behind; recent posts may be missing.`
    : summary;
}

async function loadMoreFollowed({ automatic = false } = {}) {
  if (state.feedMoreBusy || state.feedMode !== 'following' || state.boardMode !== 'signals') return;
  const requestId = state.feedRequest;
  const sourceOffsetBefore = state.feedSourceOffset;
  const scrollAnchor = captureFeedScrollAnchor();
  const recentStart = recentFeedStartTimestamp();
  let pageFailures = 0;
  state.feedMoreBusy = true;
  renderFeedMore();
  try {
    let groups;
    let kind;
    let batch = [];
    const fetchRecentPage = async (target, pageToken = '') => {
      try {
        const response = await nodeRequest('casts', { fid: target, pageSize: 100, reverse: true, startTimestamp: recentStart, ...(pageToken ? { pageToken } : {}) });
        if (requestId !== state.feedRequest) return null;
        const pageMessages = unwrapMessages(response).filter((message) => message?.data?.castAddBody);
        const oldestTimestamp = pageMessages.reduce((oldest, message) => Math.min(oldest, Number(message?.data?.timestamp) || Infinity), Infinity);
        const nextPageToken = pageMessages.length && oldestTimestamp >= recentStart ? String(response?.nextPageToken || response?.next_page_token || '') : '';
        if (nextPageToken) state.feedCastPageTokens.set(target, nextPageToken);
        else state.feedCastPageTokens.delete(target);
        return { fid: target, messages: pageMessages };
      } catch {
        pageFailures += 1;
        return null;
      }
    };

    if (state.feedSourceOffset < state.feedSources.length) {
      kind = 'people';
      batch = state.feedSources.slice(state.feedSourceOffset, state.feedSourceOffset + 6);
      groups = await mapLimit(batch, 6, (target) => fetchRecentPage(target));
      if (requestId !== state.feedRequest) return;
      const firstUnloaded = groups.findIndex((group) => !group);
      state.feedSourceOffset += firstUnloaded < 0 ? batch.length : firstUnloaded;
    } else if (state.feedCastPageTokens.size) {
      kind = 'pages';
      const cursorBatch = [...state.feedCastPageTokens.entries()].slice(0, 6);
      batch = cursorBatch.map(([fid]) => fid);
      groups = await mapLimit(cursorBatch, 6, ([target, pageToken]) => fetchRecentPage(target, pageToken));
    } else if (state.feedFollowNextPageToken) {
      kind = 'people';
      const page = await fetchFollowGraphPage(state.fid, state.feedFollowNextPageToken);
      if (requestId !== state.feedRequest) return;
      state.feedFollowNextPageToken = page.nextPageToken || '';
      state.feedFollowComplete = page.complete;
      batch = page.fids.filter((target) => !state.following.has(target));
      for (const target of batch) { setFollowState(target, true); state.feedSources.push(target); }
      state.feedFollowTotal = state.following.size;
      const nextBatch = state.feedSources.slice(state.feedSourceOffset, state.feedSourceOffset + 6);
      groups = await mapLimit(nextBatch, 6, (target) => fetchRecentPage(target));
      if (requestId !== state.feedRequest) return;
      const firstUnloaded = groups.findIndex((group) => !group);
      state.feedSourceOffset += firstUnloaded < 0 ? nextBatch.length : firstUnloaded;
      batch = nextBatch;
    } else { renderFeedMore(); return; }

    if (requestId !== state.feedRequest) return;
    const previousPostCount = state.casts.length;
    const existing = new Set(state.casts.map((message) => `${Number(message?.data?.fid)}:${postHash(message)}`));
    for (const message of groups.filter(Boolean).flatMap((group) => group.messages || [])) {
      const key = `${Number(message?.data?.fid)}:${postHash(message)}`;
      if (!existing.has(key)) { existing.add(key); state.casts.push(message); }
    }
    state.casts.sort((a, b) => Number(b.data.timestamp || 0) - Number(a.data.timestamp || 0));
    if (state.feedSort === 'popular') await loadPopularScores(state.casts);
    if (requestId !== state.feedRequest) return;
    await mapLimit([...new Set(state.casts.flatMap((message) => [Number(message?.data?.fid), Number(message?.data?.castAddBody?.parentCastId?.fid)]).filter((fid) => fid > 0 && !state.people.has(fid)))], 6, fetchProfile);
    if (requestId !== state.feedRequest) return;
    state.feedUpdatedAt = Date.now();
    renderFeed();
    restoreFeedScrollAnchor(scrollAnchor);
    updateFollowingCoverage();
    const added = state.casts.length - previousPostCount;
    const checkedNow = groups.filter(Boolean).length;
    if (!automatic) {
      setNotice(pageFailures
        ? `${pageFailures} followed ${pageFailures === 1 ? 'account could' : 'accounts could'} not be checked. Kept their place in the queue; tap Load more recent posts to retry.`
        : kind === 'people'
        ? `Checked ${checkedNow} more followed ${checkedNow === 1 ? 'account' : 'accounts'} and loaded ${added} recent ${added === 1 ? 'post' : 'posts'}. ${state.feedSourceOffset} of ${state.feedFollowTotal} follows checked.`
        : `Loaded ${added} more recent ${added === 1 ? 'post' : 'posts'}. ${state.casts.length} posts are now in this timeline.`, pageFailures ? 'error' : 'success');
    }
  } catch (error) {
    if (requestId === state.feedRequest) setNotice(`Could not load more of your Following feed. ${error.message}`, 'error');
  } finally {
    state.feedMoreBusy = false;
    renderFeedMore();
    // Build a useful first page even when the first followed accounts are quiet.
    // Keep automatic work bounded; the button remains available for the rest.
    const automaticSourceLimit = Math.min(36, state.feedSources.length);
    const continueAutomatically = automatic && requestId === state.feedRequest && state.feedMode === 'following'
      && state.feedSourceOffset > sourceOffsetBefore && state.feedSourceOffset < automaticSourceLimit
      && state.boardMode === 'signals' && state.casts.length < 30 && !state.feedCastPageTokens.size;
    if (continueAutomatically) void loadMoreFollowed({ automatic: true });
    else if (requestId === state.feedRequest && state.feedMode === 'following' && !state.casts.length) renderFeed();
  }
}

function renderFeed() {
  const openThreadPanel = state.conversation ? $('#conversation-view') : null;
  renderFeedStatusbar();
  refreshMiniAppShelf(state.casts);
  updateFeedFilterSummary();
  const requestedSource = state.boardMode === 'signals' ? Number($('#source-fid').value) || null : null;
  const exclude = $('#source-mode').value === 'exclude';
  const sourceMessages = state.boardMode === 'flight-log' ? state.savedCasts.map(savedCastMessage) : [...state.casts];
  if (state.boardMode === 'signals' && state.feedMode !== 'profile' && state.feedSort === 'popular') {
    sourceMessages.sort((a, b) => popularScore(b) - popularScore(a) || Number(b?.data?.timestamp || 0) - Number(a?.data?.timestamp || 0));
  }
  const mutedTopics = new Set(state.mutedTopics);
  const query = state.feedQuery.trim().toLocaleLowerCase();
  const messages = sourceMessages.filter((message) => {
    if (state.boardMode === 'signals' && state.mutedAuthors.includes(Number(message?.data?.fid))) return false;
    if (state.boardMode === 'signals' && state.feedMode !== 'profile' && state.orbitOnly && !state.deskPins.includes(Number(message?.data?.fid))) return false;
    if (state.boardMode === 'signals' && state.feedMode === 'profile') {
      if (!visibleInProfileView(message, state.profileTab)) return false;
    }
    if (state.boardMode === 'signals' && state.activeDeskTopic && !topicsForCast(message).includes(state.activeDeskTopic)) return false;
    const isProfilePin = state.feedMode === 'profile' && state.profilePins[state.feedTargetFid] === postHash(message);
    if (isProfilePin) return false;
    if (state.boardMode === 'signals' && !visibleByFeedOptions(message, {
      repliesOnly: state.feedMode === 'profile' ? false : state.repliesOnly,
      mediaOnly: state.feedMode === 'profile' ? false : state.mediaOnly,
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
  const groups = state.boardMode === 'signals' && state.groupRepeats
    ? groupRepeatedCasts(messages)
    : messages.map((message) => ({ messages: [message], reason: null }));
  const repeatedGroupCount = groups.filter((group) => group.messages.length > 1).length;
  const list = $('#feed-list');
  $('#feed-count').hidden = state.boardMode === 'signals' && state.feedMode === 'profile';
  $('#group-repeats-control').hidden = state.boardMode !== 'signals';
  $('#orbit-only-control').hidden = state.boardMode !== 'signals' || state.feedMode === 'profile';
  renderFeedPulse(messages);
  renderProfileSummary();
  renderMutedManager();
  const nodeDelay = maxNodeDelay();
  const nodeBehind = nodeDelay !== null && nodeDelay > 10;
  if (!messages.length) {
    const sourceFilter = state.boardMode === 'signals' ? Number($('#source-fid').value) || null : null;
    if (state.boardMode === 'flight-log') {
      renderEmpty('Nothing saved yet.', 'Save a post from any feed to keep it here.', { type: 'feed', mode: 'following', label: 'Open Following' });
    } else if (state.feedMode === 'following' && !state.casts.length && state.feedMoreBusy && state.feedSourceOffset < state.feedSources.length) {
      renderEmpty('Checking more followed accounts…', 'Looking for recent posts in the next small group. Your timeline will be sorted newest first.');
    } else if (state.feedMode === 'following' && !state.casts.length && state.feedFailedSources) {
      const detail = `${state.feedFailedSources} followed ${state.feedFailedSources === 1 ? 'account was' : 'accounts were'} unavailable.${nodeBehind ? ` Node data is ${formatNodeDelay(nodeDelay)} behind, so feed and relationship results may be incomplete.` : ' The node could not return their posts.'}`;
      renderEmpty('The node could not check your Following feed.', detail, nodeBehind ? { type: 'node', label: 'Check node status' } : { type: 'retry', label: 'Retry Following' });
    } else if (state.feedMode === 'following' && !state.casts.length && state.feedSourceOffset < state.feedSources.length) {
      if (nodeBehind) renderEmpty('The node is still catching up.', `Node data is ${formatNodeDelay(nodeDelay)} behind, so recent posts and follow relationships may be missing.`, [
        { type: 'node', label: 'Check node status' },
        { type: 'retry', label: 'Retry Following' },
      ]);
      else renderEmpty('Your first group is quiet.', 'Check the next people you follow. Recent posts will be mixed together by time.', { type: 'more-following', label: `Check the next ${Math.min(6, state.feedSources.length - state.feedSourceOffset)} people` });
    } else if (state.feedMode === 'following' && !state.casts.length && state.feedFollowNextPageToken) {
      if (nodeBehind) renderEmpty('The node is still catching up.', `Node data is ${formatNodeDelay(nodeDelay)} behind, so recent posts and follow relationships may be missing.`, [
        { type: 'node', label: 'Check node status' },
        { type: 'retry', label: 'Retry Following' },
      ]);
      else renderEmpty('Your Following list continues.', 'No recent posts on this page. Check more followed accounts to keep the timeline moving.', { type: 'more-following', label: 'Check more followed accounts' });
    } else if (state.feedMode !== 'profile' && state.activeDeskTopic) {
      renderEmpty(`No posts match ${state.activeDeskTopic.replace(/^site:/, '')}.`, 'Try another topic or remove this shortcut to return to the full feed.', { type: 'clear-desk-topic', label: 'Clear topic shortcut' });
    } else if (state.feedMode !== 'profile' && state.orbitOnly) {
      renderEmpty(state.deskPins.length ? 'No posts from pinned people.' : 'No pinned people yet.', state.deskPins.length ? 'Turn off this filter to return to the full feed.' : 'Pin someone to your Desk or turn off this filter to see the full feed.', { type: 'clear-orbit-filter', label: 'Show everyone' });
    } else if (state.feedMode === 'following' && (state.repliesOnly || state.mediaOnly || state.appsOnly)) {
      renderEmpty('Filters hid your Following posts.', `${state.casts.length} recent posts loaded. Clear the active filters to see the full timeline.`, { type: 'clear-feed-filters', label: 'Show all Following posts' });
    } else if (state.feedMode !== 'profile' && state.feedMode !== 'following' && (state.repliesOnly || state.mediaOnly || state.appsOnly)) {
      renderEmpty(`Filters hid your ${feedWindowTitle()} posts.`, `${state.casts.length} recent posts loaded. Clear the active filters to see this timeline.`, { type: 'clear-feed-filters', label: 'Show all posts' });
    } else if (query) {
      renderEmpty('No loaded posts match.', 'Try another search or clear the current search and filters.', { type: 'clear-feed-filters', label: 'Clear search and filters' });
    } else if (sourceFilter) {
      renderEmpty('No posts match this source.', 'Clear the source filter to see more posts.', { type: 'clear-source', label: 'Clear source' });
    } else if (state.feedMode === 'profile') {
      const profile = state.people.get(state.feedTargetFid);
      const isMediaTab = state.profileTab === 'media';
      const isRepliesTab = state.profileTab === 'replies';
      const handle = profile?.username ? `@${profile.username}` : 'this profile';
      renderEmpty(isMediaTab ? 'No media yet.' : isRepliesTab ? 'No replies yet.' : 'No original posts yet.', `Nothing to show for ${handle}.`, isMediaTab ? null : { type: 'search', label: 'Search another profile' });
    } else if (state.feedMode === 'friends' && !state.friendFids.length && !state.feedSources.length) {
      const detail = state.feedFailedSources
        ? 'The node could not check your follow graph. Try refreshing, or search for people to add to your local shortlist.'
        : 'Follow a few people and this feed will surface the most active accounts in their graph. You can also add your own picks from any post.';
      renderEmpty('Looking for active people.', detail, [
        { type: 'discover', label: 'Discover people' },
        { type: 'search', label: 'Search people' },
      ]);
    } else if (state.feedMode === 'following' && !state.casts.length && state.feedSources.length) {
      const checked = Math.max(state.feedSourceOffset, Math.min(state.feedSources.length, state.feedFollowTotal || state.feedSources.length));
      if (nodeBehind) renderEmpty('No recent posts are visible yet.', `Checked ${checked} followed accounts, but node data is ${formatNodeDelay(nodeDelay)} behind. New posts may be missing.`, [
        { type: 'node', label: 'Check node status' },
        { type: 'retry', label: 'Retry Following' },
      ]);
      else renderEmpty('No recent posts from people you follow.', `Checked ${checked} followed accounts. Discover can help you find more people to follow.`, { type: 'discover', label: 'Discover people' });
    } else if (state.feedMode === 'following' && !state.casts.length && nodeBehind) {
      renderEmpty('Your Following list may be incomplete.', `Node data is ${formatNodeDelay(nodeDelay)} behind, so the people and posts in this feed may be missing.`, [
        { type: 'node', label: 'Check node status' },
        { type: 'retry', label: 'Retry Following' },
        { type: 'search', label: 'Find people' },
      ]);
    } else if (state.feedMode === 'following' && !state.casts.length) {
      renderEmpty('Follow people to start your timeline.', 'Search for someone by name. Once you follow them, their recent posts will appear here.', { type: 'search', label: 'Search people' });
    } else if (state.feedMode === 'friends' && !state.casts.length) {
      if (nodeBehind) renderEmpty('No recent posts are visible yet.', `Node data is ${formatNodeDelay(nodeDelay)} behind, so some posts from your Top people may be missing.`, [
        { type: 'node', label: 'Check node status' },
        { type: 'feed', mode: 'following', label: 'Open Following' },
      ]);
      else renderEmpty('No recent posts from your Top people.', 'Your Following timeline may have newer activity. Discover more people or open Following.', [
        { type: 'feed', mode: 'following', label: 'Open Following' },
        { type: 'discover', label: 'Discover people' },
        { type: 'search', label: 'Search people' },
      ]);
    } else if (state.casts.length) {
      renderEmpty('Nothing matches these filters.', 'Adjust View options to bring posts back.');
    } else {
      renderEmpty('Your feed is quiet.', 'Follow people to see their posts.', { type: 'profile', label: 'View your posts' });
    }
    $('#feed-count').textContent = state.boardMode === 'flight-log' ? '0 SAVED' : '0 POSTS';
    const morePeople = renderFeedMore();
    if (state.feedMode === 'following' && !state.casts.length && morePeople) $('#feed-end').hidden = true;
    else if (!morePeople) $('#feed-end').hidden = true;
    placeConversationPanel(openThreadPanel);
    return;
  }
  $('#feed-count').textContent = state.boardMode === 'flight-log'
    ? `${messages.length} SAVED`
    : state.feedMode === 'following' && !requestedSource
      ? `${state.casts.length} RECENT · ${messages.length} SHOWN${repeatedGroupCount ? ` · ${repeatedGroupCount} GROUPED` : ''}`
      : `${requestedSource ? `${messages.length} OF ${state.casts.length}` : messages.length} POSTS${repeatedGroupCount ? ` · ${repeatedGroupCount} GROUPED` : ''}`;
  $('#feed-end').hidden = false;
  const fragment = document.createDocumentFragment();
  const existingCards = new Map([...list.querySelectorAll('.post-card[data-cast-hash]')].map((card) => [`${card.dataset.castFid}:${card.dataset.castHash}`, card]));
  const renderedCards = new Set();
  const appendCast = (message, options) => {
    const key = `${Number(message?.data?.fid)}:${postHash(message)}`;
    const existing = existingCards.get(key);
    if (existing && !renderedCards.has(key) && existing.dataset.castRenderSignature === castRenderSignature(message)) {
      renderedCards.add(key);
      fragment.append(existing);
      return;
    }
    const card = renderCast(message, options);
    renderedCards.add(key);
    fragment.append(card);
  };
  groups.forEach((group, index) => {
    const priority = index < 3;
    if (group.messages.length === 1) { appendCast(group.messages[0], { priority }); return; }
    const cluster = document.createElement('section'); cluster.className = 'repeat-cluster';
    appendCast(group.messages[0], { priority });
    cluster.append(fragment.lastElementChild);
    const more = document.createElement('details'); more.className = 'repeat-cluster-more';
    const summary = document.createElement('summary');
    const people = new Set(group.messages.map((message) => Number(message?.data?.fid)).filter((fid) => fid > 0)).size;
    const itemLabel = group.reason === 'link' ? 'posts share this link' : 'matching posts';
    const updateSummary = () => { summary.textContent = `${group.messages.length} ${itemLabel}${people > 1 ? ` · ${people} people` : ''} · ${more.open ? 'Collapse' : 'Expand'} ${group.messages.length - 1} more`; };
    updateSummary();
    more.addEventListener('toggle', updateSummary);
    const others = document.createElement('div'); others.className = 'repeat-cluster-posts';
    group.messages.slice(1).forEach((message) => {
      const key = `${Number(message?.data?.fid)}:${postHash(message)}`;
      const existing = existingCards.get(key);
      if (existing && !renderedCards.has(key) && existing.dataset.castRenderSignature === castRenderSignature(message)) { renderedCards.add(key); others.append(existing); }
      else { renderedCards.add(key); others.append(renderCast(message)); }
    });
    more.append(summary, others); cluster.append(more); fragment.append(cluster);
  });
  list.removeAttribute('data-empty');
  list.replaceChildren(fragment);
  placeConversationPanel(openThreadPanel);
  watchCastEngagement(list);
  renderFeedMore();
}

function localProfileName(profile) {
  const nickname = state.profileNotes[profile.fid]?.nickname;
  return typeof nickname === 'string' && nickname.trim() ? nickname.trim() : profile.name;
}

function profileLabel(profile, fid) {
  const handle = profile?.username && !/^fid-\d+$/.test(profile.username) ? `@${profile.username}` : '';
  const name = profile ? localProfileName(profile).trim() : '';
  if (name && !/^farcaster \d+$/i.test(name) && name.toLocaleLowerCase() !== handle.toLocaleLowerCase()) return handle ? `${name} · ${handle}` : name;
  return handle || `FID ${Number(fid)}`;
}

async function ensureCuratedTopAccounts() {
  if (state.curatedTopLoadPromise) return state.curatedTopLoadPromise;
  state.curatedTopLoadPromise = (async () => {
    const known = new Map(state.curatedTopAccounts.map((account) => [account.username, account]));
    const missing = CURATED_TOP_ACCOUNTS.filter((account) => !known.has(account.username));
    const resolved = await mapLimit(missing, 4, async (account) => {
      try { return { ...account, fid: await resolveProfileFid(account.username) }; }
      catch { return null; }
    });
    for (const account of resolved.filter(Boolean)) known.set(account.username, account);
    state.curatedTopAccounts = CURATED_TOP_ACCOUNTS.map((account) => known.get(account.username)).filter(Boolean);
    try {
      localStorage.setItem(TOP_ROSTER_STORAGE, JSON.stringify(state.curatedTopAccounts.map(({ username, fid }) => ({ username, fid }))));
    } catch { /* A resolved roster still works for this visit if storage is unavailable. */ }
    renderTopPeopleDrawer();
    return state.curatedTopAccounts.map((account) => Number(account.fid)).filter((fid) => fid > 0 && fid !== Number(state.fid));
  })();
  try { return await state.curatedTopLoadPromise; }
  finally { state.curatedTopLoadPromise = null; renderTopPeopleDrawer(); }
}

function renderTopPeopleDrawer() {
  const drawer = $('#top-people-drawer');
  const list = $('#top-people-roster');
  const count = $('#top-people-roster-count');
  if (!drawer || !list) return;
  drawer.hidden = state.boardMode !== 'signals' || state.feedMode !== 'friends';
  if (count) count.textContent = `${CURATED_TOP_ACCOUNTS.length} curated · ${state.friendFids.length} your picks`;
  list.replaceChildren();
  const known = new Map(state.curatedTopAccounts.map((account) => [Number(account.fid), account]));
  for (const account of CURATED_TOP_ACCOUNTS) {
    const resolved = state.curatedTopAccounts.find((entry) => entry.username === account.username);
    const row = document.createElement('div'); row.className = 'top-person-row';
    const identity = document.createElement('span'); identity.className = 'top-person-identity';
    const name = document.createElement('strong'); name.textContent = account.name;
    const handle = document.createElement('small'); handle.textContent = `@${account.username} · ${account.role}`;
    identity.append(name, handle);
    const action = document.createElement('button'); action.type = 'button'; action.className = 'button button-outline top-person-toggle';
    if (resolved) {
      const added = state.friendFids.includes(Number(resolved.fid));
      action.dataset.action = 'toggle-friend'; action.dataset.fid = String(resolved.fid);
      action.setAttribute('aria-pressed', String(added)); action.textContent = added ? 'Added ✓' : 'Add';
      action.setAttribute('aria-label', `${added ? 'Remove' : 'Add'} ${account.name} ${added ? 'from' : 'to'} your Top people picks`);
    } else {
      action.disabled = true;
      action.textContent = state.curatedTopLoadPromise ? 'Loading…' : 'Unavailable';
      action.title = 'This username could not be resolved by the configured Snapchain node.';
    }
    row.append(identity, action); list.append(row);
  }
  const extraPicks = state.friendFids.filter((fid) => !known.has(Number(fid)));
  if (extraPicks.length) {
    const heading = document.createElement('h4'); heading.className = 'top-people-local-heading'; heading.textContent = 'Your other picks'; list.append(heading);
    for (const fid of extraPicks) {
      const profile = state.people.get(Number(fid));
      const row = document.createElement('div'); row.className = 'top-person-row';
      const identity = document.createElement('span'); identity.className = 'top-person-identity';
      const name = document.createElement('strong'); name.textContent = localProfileName(profile || { fid, name: `FID ${fid}` });
      const handle = document.createElement('small'); handle.textContent = profile?.username ? `@${profile.username}` : `FID ${fid}`;
      identity.append(name, handle);
      const action = document.createElement('button'); action.type = 'button'; action.className = 'button button-outline top-person-toggle';
      action.dataset.action = 'toggle-friend'; action.dataset.fid = String(fid); action.setAttribute('aria-pressed', 'true'); action.textContent = 'Added ✓';
      action.setAttribute('aria-label', `Remove ${name.textContent} from your Top people picks`);
      row.append(identity, action); list.append(row);
    }
  }
  if (!state.curatedTopAccounts.length) {
    const status = document.createElement('p'); status.className = 'top-people-roster-status';
    status.textContent = state.nodeInfo ? 'Could not resolve the curated list from this node. Search by username or FID to add people.' : 'Checking the curated roster against your Snapchain node…';
    list.prepend(status);
  }
}

function relationshipForCast(fid) {
  if (Number(state.fid) === Number(fid)) return 'You';
  if (state.friendFids.includes(Number(fid))) return 'Top person';
  if (state.following.get(Number(fid))) return 'Following';
  return '';
}

function relationshipTitle(label) {
  if (label === 'Top person') return 'You added this person to Top people on this device.';
  if (label === 'Following') return 'You follow this person on Farcaster.';
  if (label === 'You') return 'This is your account.';
  return 'This profile is in your feed.';
}

function setFollowState(fid, following) {
  const targetFid = Number(fid);
  if (!Number.isSafeInteger(targetFid) || targetFid <= 0) return;
  state.following.set(targetFid, Boolean(following));
  state.followStatusUnknown.delete(targetFid);
}

function updateFollowButton(button, fid) {
  const targetFid = Number(fid);
  const profile = state.people.get(targetFid);
  const following = !!state.following.get(targetFid);
  const isSelf = targetFid === Number(state.fid);
  const action = following ? 'Unfollow' : 'Follow';
  const delay = maxNodeDelay();
  const stale = delay !== null && delay > 10;
  const freshnessUnknown = delay === null;
  const statusUnknown = !state.following.has(targetFid) || state.followStatusUnknown.has(targetFid);
  const unknown = statusUnknown || freshnessUnknown;
  const confidence = unknown ? 'unknown' : stale ? 'stale' : 'confirmed';
  const confidenceNote = state.followStatusUnknown.has(targetFid)
    ? 'The node could not confirm this follow status. Try again when the node is reachable; Castonaut checks before signing.'
    : !state.following.has(targetFid)
      ? 'Follow status has not been checked. Castonaut checks your node before signing a follow change.'
      : freshnessUnknown
        ? 'Follow status was loaded, but node freshness is unknown. Castonaut checks before signing.'
    : stale ? `Follow status may be out of date because the node is ${formatNodeDelay(delay)} behind. Castonaut checks before signing.`
      : `${action} status confirmed by your node.`;
  const label = button.dataset.deskPrimary === 'follow'
    ? (isSelf ? 'Your account' : `${following ? '✓ Following' : '＋ Follow'} @${profile?.username || `fid-${targetFid}`}`)
    : isSelf ? 'You' : button.classList.contains('post-action') ? (following ? '✓' : '＋') : action;
  button.replaceChildren(document.createTextNode(label));
  if (!isSelf && (unknown || stale)) {
    const marker = document.createElement('span'); marker.className = 'follow-confidence-mark'; marker.setAttribute('aria-hidden', 'true'); marker.textContent = '?';
    button.append(marker);
  }
  button.setAttribute('aria-label', isSelf ? 'This is your account' : `${action} @${profile?.username || `fid-${targetFid}`}`);
  button.setAttribute('aria-description', isSelf ? 'This is your active account.' : confidenceNote);
  button.dataset.followConfidence = confidence;
  button.title = isSelf ? 'This is your active account.' : confidenceNote;
  button.setAttribute('aria-pressed', String(following));
  button.disabled = isSelf || !state.signerReady || button.hasAttribute('aria-busy');
}

function updateCastRelationship(fid) {
  document.querySelectorAll(`.post-card[data-cast-fid="${Number(fid)}"] .post-relation`).forEach((badge) => {
    const label = relationshipForCast(fid);
    badge.textContent = label;
    badge.title = label ? relationshipTitle(label) : '';
    badge.hidden = !label;
  });
}

function renderFeedPulse(messages) {
  const panel = $('#feed-pulse');
  if (!panel) return;
  // The feed summary repeated counts already visible elsewhere and crowded the
  // timeline. Keep the data calculation out of the primary reading path.
  panel.hidden = true;
  return;
}

function renderProfileSummary() {
  const card = $('#profile-summary');
  if (!card) return;
  const timelineControls = $('#profile-timeline-controls');
  const gameLink = $('#profile-game-link');
  const isProfile = state.boardMode === 'signals' && state.feedMode === 'profile' && state.feedTargetFid;
  card.hidden = !isProfile;
  if (timelineControls) timelineControls.hidden = !isProfile;
  if (gameLink) gameLink.hidden = true;
  if (!isProfile) return;
  const profile = state.people.get(state.feedTargetFid) || { fid: state.feedTargetFid, name: `Farcaster ${state.feedTargetFid}`, username: `fid-${state.feedTargetFid}`, avatar: '', bio: '' };
  const isOwnProfile = !!state.signerReady && Number(profile.fid) === Number(state.fid);
  if (gameLink) gameLink.hidden = !isOwnProfile;
  const local = state.profileNotes[profile.fid] || {};
  const shell = document.createElement('div'); shell.className = 'profile-summary-main';
  const cover = document.createElement('div');
  const coverTone = ['atlas', 'dawn', 'orbit', 'dusk', 'platinum', 'blueberry', 'graphite', 'hypercard', 'cyberpunk', 'manga'].includes(state.profileCovers[profile.fid]) ? state.profileCovers[profile.fid] : 'atlas';
  cover.className = 'profile-cover'; cover.dataset.cover = coverTone;
  const bannerUrl = state.remoteMediaEnabled ? safeImageUrl(profile.banner) : '';
  if (bannerUrl) { const banner = makeRemoteImage(bannerUrl, 'profile-cover-image', { priority: true }); banner.alt = `${localProfileName(profile)}’s profile cover`; cover.append(banner); }
  const avatar = document.createElement('span'); avatar.className = 'profile-summary-avatar'; avatar.textContent = localProfileName(profile).slice(0, 1).toUpperCase();
  const avatarUrl = safeImageUrl(profile.avatar);
  if (avatarUrl) setRemoteAvatar(avatar, avatarUrl, { priority: true });
  const identity = document.createElement('div'); identity.className = 'profile-summary-identity';
  const kicker = document.createElement('span'); kicker.className = 'profile-summary-kicker'; kicker.textContent = isOwnProfile ? 'YOUR FARCASTER PROFILE' : 'FARCASTER PROFILE';
  const name = document.createElement('h3'); name.textContent = localProfileName(profile);
  const handle = document.createElement('p'); handle.textContent = `@${profile.username} · FID ${profile.fid}`;
  identity.append(kicker, name, handle);
  const visibility = document.createElement('div'); visibility.className = 'profile-visibility'; visibility.setAttribute('aria-label', 'Public and local profile details');
  const publicTag = document.createElement('span'); publicTag.className = 'profile-visibility-public'; publicTag.textContent = 'Public on Farcaster';
  const localTag = document.createElement('span'); localTag.className = 'profile-visibility-local'; localTag.textContent = 'Style and notes · this device';
  visibility.append(publicTag, localTag); identity.append(visibility);
  if (profile.bio) { const bio = document.createElement('p'); bio.className = 'profile-summary-bio'; bio.textContent = profile.bio; identity.append(bio); }
  if (local.nickname || local.note) { const note = document.createElement('p'); note.className = 'profile-private-note'; note.textContent = local.note ? `Your note: ${local.note}` : 'Your personal nickname is saved on this device.'; identity.append(note); }
  const actions = document.createElement('div'); actions.className = 'profile-summary-actions';
  const compose = document.createElement('button'); compose.type = 'button'; compose.className = 'button button-orange'; compose.dataset.composeCast = 'true'; compose.textContent = 'Write a cast'; compose.setAttribute('aria-label', 'Write a cast from your account');
  const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'button button-outline'; pin.dataset.profilePin = String(profile.fid); pin.textContent = state.deskPins.includes(profile.fid) ? 'On your Desk ✓' : 'Pin to Desk';
  const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'button button-outline'; follow.dataset.action = 'follow'; follow.dataset.fid = String(profile.fid); updateFollowButton(follow, profile.fid);
  const friend = document.createElement('button'); friend.type = 'button'; friend.className = 'button button-outline'; friend.dataset.action = 'toggle-friend'; friend.dataset.fid = String(profile.fid); friend.textContent = state.friendFids.includes(Number(profile.fid)) ? '✓ In Top people' : '＋ Add to Top people'; friend.disabled = Number(profile.fid) === Number(state.fid);
  const share = document.createElement('button'); share.type = 'button'; share.className = 'button button-outline'; share.dataset.castProfile = String(profile.fid); share.textContent = 'Cast profile'; share.setAttribute('aria-label', `Write a Farcaster cast about ${localProfileName(profile)}’s profile`);
  const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button button-outline'; edit.dataset.editProfile = String(profile.fid); edit.textContent = isOwnProfile ? 'Local name & note' : 'Personalize';
  const more = document.createElement('details'); more.className = 'profile-more-options';
  const moreLabel = document.createElement('summary'); moreLabel.textContent = isOwnProfile ? 'Customize' : 'Personalize';
  const morePanel = document.createElement('div'); morePanel.className = 'profile-more-panel';
  const coverFieldset = document.createElement('fieldset'); coverFieldset.className = 'profile-cover-picker';
  const coverLegend = document.createElement('legend'); coverLegend.textContent = 'Choose a profile cover'; coverFieldset.append(coverLegend);
  const coverOptions = [['atlas', 'Atlas'], ['platinum', 'Spacebar'], ['blueberry', 'Blueberry'], ['graphite', 'Graphite'], ['hypercard', 'HyperCard'], ['cyberpunk', 'Cyberpunk'], ['manga', 'Manga ink'], ['dawn', 'Dawn'], ['orbit', 'Orbit'], ['dusk', 'Dusk']];
  for (const [value, label] of coverOptions) {
    const choice = document.createElement('label'); choice.className = 'profile-cover-choice';
    const input = document.createElement('input'); input.type = 'radio'; input.name = `profile-cover-${profile.fid}`; input.value = value; input.checked = coverTone === value; input.dataset.coverFid = String(profile.fid); input.setAttribute('aria-label', `${label} profile cover`);
    const preview = document.createElement('span'); preview.className = 'profile-cover-swatch-art'; preview.dataset.cover = value; preview.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'profile-cover-swatch-label'; text.textContent = label;
    choice.append(input, preview, text); coverFieldset.append(choice);
  }
  const detailsSection = document.createElement('section'); detailsSection.className = 'profile-customize-details';
  const detailsHeading = document.createElement('strong'); detailsHeading.textContent = 'Profile details';
  detailsSection.append(detailsHeading, edit);
  if (isOwnProfile) {
    const manageDeskPins = document.createElement('button'); manageDeskPins.type = 'button'; manageDeskPins.className = 'button button-outline';
    manageDeskPins.dataset.manageDeskLeaders = 'true'; manageDeskPins.textContent = 'Choose pinned people';
    detailsSection.append(manageDeskPins);
  }
  morePanel.append(coverFieldset, detailsSection);
  const profileUrl = originalProfileUrl(profile);
  if (profileUrl) {
    const openOriginal = document.createElement('a'); openOriginal.className = 'button button-outline'; openOriginal.href = profileUrl; openOriginal.target = '_blank'; openOriginal.rel = 'noopener noreferrer'; openOriginal.textContent = 'Open on Farcaster ↗';
    detailsSection.append(openOriginal);
  }
  more.open = false;
  more.append(moreLabel, morePanel);
  more.addEventListener('toggle', () => shell.classList.toggle('is-customizing', more.open));
  morePanel.addEventListener('click', (event) => {
    if (event.target.closest('button, a')) queueMicrotask(() => { more.open = false; });
  });
  if (isOwnProfile) actions.append(compose, share, more);
  else actions.append(compose, pin, follow, friend, share, more);
  shell.append(avatar, identity, actions);
  const tabs = document.createElement('div'); tabs.className = 'profile-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Profile posts');
  const postCount = state.casts.filter((message) => !isReply(message)).length;
  const replyCount = state.casts.filter(isReply).length;
  const mediaCount = state.casts.filter((message) => !isReply(message) && hasMedia(message)).length;
  for (const [mode, label, count] of [['posts', 'Posts', postCount], ['replies', 'Replies', replyCount], ['media', 'Media', mediaCount]]) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = `profile-tab${state.profileTab === mode ? ' is-active' : ''}`;
    tab.dataset.profileTab = mode; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.profileTab === mode));
    tab.tabIndex = state.profileTab === mode ? 0 : -1;
    const tabLabel = document.createElement('span'); tabLabel.className = 'profile-tab-label'; tabLabel.textContent = label;
    const tabCount = document.createElement('span'); tabCount.className = 'profile-tab-count'; tabCount.textContent = String(count); tabCount.setAttribute('aria-label', `${count} loaded`);
    tab.append(tabLabel, tabCount); tabs.append(tab);
  }
  tabs.addEventListener('keydown', (event) => {
    const buttons = [...tabs.querySelectorAll('[data-profile-tab]')];
    const currentIndex = buttons.indexOf(document.activeElement);
    if (currentIndex < 0) return;
    const nextIndex = event.key === 'ArrowRight' ? (currentIndex + 1) % buttons.length
      : event.key === 'ArrowLeft' ? (currentIndex - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = buttons[nextIndex];
    state.profileTab = next.dataset.profileTab;
    renderProfileSummary(); renderFeed();
    requestAnimationFrame(() => timelineControls?.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }));
  });
  const tabsNote = document.createElement('p'); tabsNote.className = 'profile-tabs-note'; tabsNote.textContent = 'Counts show posts currently loaded from this profile.';
  const pinnedSlot = document.createElement('div'); pinnedSlot.className = 'profile-pinned-slot';
  const profileCasts = state.casts.filter((message) => Number(message?.data?.fid) === Number(profile.fid));
  const activity = summarizeProfileActivity(profileCasts);
  if (activity.loaded) {
    const analytics = document.createElement('details'); analytics.className = 'profile-activity';
    const summary = document.createElement('summary');
    const label = document.createElement('span'); label.textContent = 'Activity';
    const hint = document.createElement('small'); hint.textContent = `${activity.recent} this week · ${activity.activeDays} active days`; summary.append(label, hint);
    const grid = document.createElement('div'); grid.className = 'profile-activity-grid';
    for (const [value, caption] of [[activity.posts, 'Posts loaded'], [activity.replies, 'Replies'], [activity.media, 'With media'], [activity.averageLength, 'Avg. characters']]) {
      const stat = document.createElement('div'); stat.className = 'profile-activity-stat';
      const number = document.createElement('strong'); number.textContent = String(value);
      const name = document.createElement('span'); name.textContent = caption;
      stat.append(number, name); grid.append(stat);
    }
    const note = document.createElement('p'); note.className = 'profile-activity-note'; note.textContent = `From ${activity.loaded} posts already loaded · last 30 days for active days`;
    const rhythm = document.createElement('section'); rhythm.className = 'profile-activity-rhythm';
    const rhythmHeading = document.createElement('div'); rhythmHeading.className = 'profile-rhythm-heading';
    const rhythmLabel = document.createElement('strong'); rhythmLabel.textContent = 'Post rhythm';
    const rhythmScope = document.createElement('small'); rhythmScope.textContent = '7 days · loaded posts'; rhythmHeading.append(rhythmLabel, rhythmScope);
    const rhythmChart = document.createElement('div'); rhythmChart.className = 'profile-rhythm-chart'; rhythmChart.setAttribute('role', 'img'); rhythmChart.setAttribute('aria-label', 'Original posts per day from posts loaded in this profile');
    const rhythmMax = Math.max(1, ...activity.dailyPosts.map((day) => day.count));
    for (const day of activity.dailyPosts) {
      const column = document.createElement('div'); column.className = 'profile-rhythm-day'; column.title = `${day.date}: ${day.count} ${day.count === 1 ? 'post' : 'posts'}`;
      const bar = document.createElement('i'); bar.style.height = `${Math.max(day.count ? 12 : 4, day.count / rhythmMax * 34)}px`;
      const dayLabel = document.createElement('small'); dayLabel.textContent = day.label === 'Today' ? 'Now' : day.label;
      column.append(bar, dayLabel); rhythmChart.append(column);
    }
    rhythm.append(rhythmHeading, rhythmChart);
    analytics.append(summary, grid, rhythm, note); pinnedSlot.append(analytics);
  }
  const pinnedHash = state.profilePins[profile.fid];
  const pinned = state.casts.find((message) => !isReply(message) && postHash(message) === pinnedHash && Number(message?.data?.fid) === Number(profile.fid));
  if (pinned) {
    const label = document.createElement('div'); label.className = 'profile-pinned-label'; label.textContent = 'Pinned here · only you';
    pinnedSlot.append(label, renderCast(pinned));
  }
  cover.append(shell); card.replaceChildren(cover);
  timelineControls?.replaceChildren(tabs, tabsNote, pinnedSlot);
  watchCastEngagement(card);
}

async function refreshFollowState(fid) {
  if (!state.fid || Number(fid) === Number(state.fid)) return;
  try { await nodeRequest('linkById', { fid: state.fid, target_fid: fid, link_type: 'follow' }, { fresh: true }); setFollowState(fid, true); }
  catch (error) {
    if (isNotFound(error)) setFollowState(fid, false);
    else { state.followStatusUnknown.add(Number(fid)); }
  }
  updateCastRelationship(fid);
  if (state.feedMode === 'profile' && Number(state.feedTargetFid) === Number(fid)) renderProfileSummary();
  document.querySelectorAll(`[data-action="follow"][data-fid="${Number(fid)}"]`).forEach((button) => {
    updateFollowButton(button, fid);
  });
}

function setProfileRoute(fid) {
  history.pushState(null, '', `#profile=${Number(fid)}`);
}

async function resolveProfileFid(rawQuery) {
  const query = normalizeProfileSearch(rawQuery);
  if (!query) throw new Error('Enter a username, FID, or Farcaster profile link.');
  if (/^[1-9]\d{0,14}$/.test(query)) return asFid(query);
  const proof = await nodeRequest('username', { name: query });
  return asFid(proof.fid);
}

async function searchProfile(rawQuery) {
  const status = $('#people-search-status');
  const form = $('#people-search');
  const submit = form.querySelector('button[type="submit"]');
  let query;
  status.hidden = false;
  status.dataset.state = 'idle';
  try { query = normalizeProfileSearch(rawQuery); }
  catch (error) { status.dataset.state = 'error'; status.textContent = error.message; return; }
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
  status.textContent = 'Searching Snapchain…';
  const originalLabel = submit.textContent;
  submit.textContent = 'Searching…';
  try {
    const fid = await resolveProfileFid(query);
    await fetchProfile(fid);
    $('#people-query').value = '';
    status.textContent = `Opening @${state.people.get(fid)?.username || `fid-${fid}`} · FID ${fid}.`;
    if (state.boardMode !== 'signals') setBoardMode('signals');
    setProfileRoute(fid);
    navigate('feed', { preserveHash: true });
    const feedLoaded = await loadFeed(fid, 'profile');
    status.dataset.state = feedLoaded ? 'success' : 'error';
    if (!feedLoaded) status.textContent = `Found @${state.people.get(fid)?.username || `fid-${fid}`} · the profile is open, but its posts could not be loaded.`;
    $('#profile-summary').focus({ preventScroll: true });
    window.setTimeout(() => { status.hidden = true; }, 2200);
  } catch (error) {
    status.dataset.state = 'error';
    const message = String(error?.message || '');
    if (isNotFound(error)) status.textContent = 'No Farcaster profile found. Check the spelling or try its FID.';
    else if (/SNAPCHAIN_URL|not configured|not been configured/i.test(message)) status.textContent = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'This local preview needs a Snapchain endpoint before search can work.'
      : 'The app’s Snapchain endpoint needs configuration before search can work.';
    else if (/failed to fetch|network|timed out|timeout/i.test(message)) status.textContent = 'Could not reach the feed service. Check your connection and try again.';
    else status.textContent = 'Could not find that profile. Please check the username or FID and try again.';
  } finally {
    form.removeAttribute('aria-busy');
    submit.disabled = false;
    submit.textContent = originalLabel;
    $('#people-query').disabled = false;
  }
}

function setNetworkSearchKind(kind) {
  if (state.networkSearchBusy) state.networkSearchRequest += 1;
  state.networkSearchBusy = false;
  $('#network-search-form button[type="submit"]')?.removeAttribute('disabled');
  $('#network-search-more')?.removeAttribute('disabled');
  state.networkSearchKind = ['people', 'channels'].includes(kind) ? kind : 'casts';
  document.querySelectorAll('[data-network-search-kind]').forEach((button) => {
    const selected = button.dataset.networkSearchKind === state.networkSearchKind;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  const field = $('#network-search-query');
  if (field) field.placeholder = state.networkSearchKind === 'people'
    ? 'Exact username, FID, or profile link…' : state.networkSearchKind === 'channels' ? 'Channel ID, such as degen…' : 'Search posts already loaded in your feed…';
  const note = $('#network-search-note');
  if (note) note.textContent = state.networkSearchKind === 'people'
    ? 'People lookup uses Snapchain username records. Enter an exact username or FID.'
    : state.networkSearchKind === 'channels'
      ? 'Channel posts are read from your configured Snapchain node. Enter a channel ID such as degen.'
      : 'Searches posts already loaded from your feed. Load more in Following, then search again.';
  $('#network-search-status').hidden = true;
  $('#network-search-results').replaceChildren();
  $('#network-search-more-wrap').hidden = true;
  const more = $('#network-search-more');
  if (more) more.textContent = state.networkSearchKind === 'channels' ? 'Load more channel posts' : 'Load more from Following';
}

function renderNetworkSearchResults(messages) {
  const target = $('#network-search-results');
  if (!target) return;
  target.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('div'); empty.className = 'network-search-empty';
    const title = document.createElement('strong'); title.textContent = 'No matches in this search scope.';
    const detail = document.createElement('span'); detail.textContent = state.networkSearchKind === 'casts'
      ? 'Load more posts in Following, or try another word.' : 'Check the spelling or try a channel ID.';
    empty.append(title, detail); target.append(empty); return;
  }
  const fragment = document.createDocumentFragment();
  for (const message of messages) {
    const card = renderCast(message);
    card.classList.add('network-search-cast');
    fragment.append(card);
  }
  target.append(fragment);
}

function channelUrlFromQuery(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) throw new Error('Enter a channel ID, such as degen.');
  if (/^https:\/\//i.test(query)) {
    const parsed = new URL(query);
    if (!['warpcast.com', 'farcaster.xyz'].includes(parsed.hostname.toLowerCase()) || !/^\/~\/channel\/[a-z0-9-]{1,64}\/?$/i.test(parsed.pathname) || parsed.search || parsed.hash) {
      throw new Error('Use a Farcaster channel link such as warpcast.com/~/channel/degen.');
    }
    return `https://warpcast.com${parsed.pathname.replace(/\/$/, '')}`;
  }
  const clean = query.replace(/^\//, '').replace(/^channel\//i, '');
  if (!/^[a-z0-9-]{1,64}$/i.test(clean)) throw new Error('Enter one channel ID, such as degen.');
  return `https://warpcast.com/~/channel/${clean}`;
}

async function searchNetwork(rawQuery, { append = false } = {}) {
  const query = String(rawQuery || '').trim().slice(0, 100);
  const status = $('#network-search-status');
  const results = $('#network-search-results');
  const more = $('#network-search-more');
  const moreWrap = $('#network-search-more-wrap');
  const submit = $('#network-search-form button[type="submit"]');
  const field = $('#network-search-query');
  if (!query) {
    if (state.networkSearchBusy) state.networkSearchRequest += 1;
    state.networkSearchBusy = false;
    submit.disabled = false; more.disabled = false;
    status.hidden = false; status.dataset.state = 'error'; status.textContent = 'Enter a search term.'; field.focus(); return;
  }
  if (state.networkSearchBusy && !append) state.networkSearchRequest += 1;
  if (state.networkSearchBusy && append) return;
  const requestId = ++state.networkSearchRequest;
  state.networkSearchBusy = true;
  state.networkSearchQuery = query;
  if (!append) { results.replaceChildren(); moreWrap.hidden = true; state.networkSearchItems = []; state.networkSearchCursor = ''; }
  status.hidden = false; status.dataset.state = 'loading';
  status.textContent = state.networkSearchKind === 'people' ? 'Looking up this account on Snapchain…'
    : state.networkSearchKind === 'channels' ? 'Loading recent channel posts from your node…' : 'Searching loaded posts…';
  submit.disabled = true; more.disabled = true;
  try {
    if (state.networkSearchKind === 'people') {
      const fid = await resolveProfileFid(query);
      if (requestId !== state.networkSearchRequest) return;
      await fetchProfile(fid);
      setProfileRoute(fid);
      navigate('feed', { preserveHash: true });
      const loaded = await loadFeed(fid, 'profile');
      status.dataset.state = loaded ? 'success' : 'error';
      status.textContent = loaded ? `Opened @${state.people.get(fid)?.username || `fid-${fid}`} · FID ${fid}.` : 'Profile found, but its posts could not be loaded.';
      return;
    }
    let items = [];
    if (state.networkSearchKind === 'channels') {
      const channel = channelUrlFromQuery(query);
      const params = { url: channel, pageSize: 50, reverse: true, ...(append && state.networkSearchCursor ? { pageToken: state.networkSearchCursor } : {}) };
      const response = await nodeRequest('channelCasts', params, { fresh: true, timeoutMs: 20_000 });
      if (requestId !== state.networkSearchRequest) return;
      items = unwrapMessages(response).filter((message) => message?.data?.castAddBody);
      const next = String(response?.nextPageToken || response?.next_page_token || '');
      state.networkSearchCursor = next;
      moreWrap.hidden = !next;
    } else {
      const needle = query.toLocaleLowerCase();
      items = state.casts.filter((message) => {
        const body = message?.data?.castAddBody || {};
        const profile = state.people.get(Number(message?.data?.fid));
        return [body.text, profile?.username, profile?.name, ...(body.embeds || []).map((embed) => embed.url)]
          .some((value) => String(value || '').toLocaleLowerCase().includes(needle));
      });
      state.networkSearchCursor = '';
      moreWrap.hidden = state.feedMode !== 'following' || state.feedSourceOffset >= state.feedSources.length && !state.feedFollowNextPageToken && !state.feedCastPageTokens.size;
    }
    if (requestId !== state.networkSearchRequest) return;
    const prior = new Set(state.networkSearchItems.map((message) => `${Number(message?.data?.fid)}:${postHash(message)}`));
    const fresh = items.filter((message) => !prior.has(`${Number(message?.data?.fid)}:${postHash(message)}`));
    state.networkSearchItems = append ? [...state.networkSearchItems, ...fresh] : fresh;
    const missingProfiles = [...new Set(state.networkSearchItems.map((message) => Number(message?.data?.fid)).filter((fid) => fid > 0 && !state.people.has(fid)))];
    await mapLimit(missingProfiles, 6, fetchProfile);
    if (requestId !== state.networkSearchRequest) return;
    renderNetworkSearchResults(state.networkSearchItems);
    status.dataset.state = 'success';
    status.textContent = state.networkSearchKind === 'channels'
      ? `${state.networkSearchItems.length} recent post${state.networkSearchItems.length === 1 ? '' : 's'} from ${query.startsWith('/') ? query : `/${query}`}${state.networkSearchCursor ? ' · more available' : ''}.`
      : `${state.networkSearchItems.length} matching post${state.networkSearchItems.length === 1 ? '' : 's'} among ${state.casts.length} posts loaded in your feed.`;
  } catch (error) {
    if (requestId !== state.networkSearchRequest) return;
    status.dataset.state = 'error';
    status.textContent = isNotFound(error) && state.networkSearchKind === 'people'
      ? 'No account found. Try the exact username or FID.'
      : error?.name === 'TimeoutError' ? 'The node took too long. Try again.' : clientErrorText(error);
    if (!append) results.replaceChildren();
  } finally {
    if (requestId === state.networkSearchRequest) { state.networkSearchBusy = false; submit.disabled = false; more.disabled = false; }
  }
}

async function addDeskPerson(rawQuery) {
  const form = $('#desk-add-person');
  const input = $('#desk-person-query');
  const status = $('#desk-person-status');
  const submit = form.querySelector('button[type="submit"]');
  status.hidden = false; status.dataset.state = 'loading'; status.textContent = 'Finding profile…';
  form.setAttribute('aria-busy', 'true'); submit.disabled = true; input.disabled = true;
  try {
    const fid = await resolveProfileFid(rawQuery);
    await fetchProfile(fid);
    if (state.deskPins.includes(fid)) {
      status.dataset.state = 'success'; status.textContent = `@${state.people.get(fid)?.username || `fid-${fid}`} is already on your Desk.`;
    } else {
      const added = await toggleDeskPin(fid, null);
      if (!added) throw new Error(state.deskPins.length >= 24 ? 'Your Desk is full. Remove someone before adding another.' : 'This browser could not save your Desk. Check local storage and try again.');
      input.value = '';
      status.dataset.state = 'success'; status.textContent = `Added @${state.people.get(fid)?.username || `fid-${fid}`} to your Desk.`;
    }
  } catch (error) {
    status.dataset.state = 'error';
    status.textContent = isNotFound(error) ? 'No profile found. Check the handle or FID.' : clientErrorText(error);
  } finally {
    form.removeAttribute('aria-busy'); submit.disabled = false; input.disabled = false;
  }
}

async function searchLoadedFeed(rawQuery) {
  const status = $('#feed-search-status');
  const query = String(rawQuery || '').trim().slice(0, 100);
  status.hidden = false;
  if (!query) { status.dataset.state = 'error'; status.textContent = 'Enter a word, person, or link to search.'; $('#feed-search-query').focus(); return; }
  if (!state.casts.length) {
    status.dataset.state = 'error';
    status.textContent = 'No posts are loaded yet. Open a profile or sign in and load your feed first.';
    return;
  }
  navigate('feed');
  const filters = $('#feed-filters');
  if (filters) filters.open = true;
  const field = $('#loaded-search');
  field.value = query;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  status.dataset.state = 'success';
  status.textContent = `Searching ${state.casts.length} loaded posts. Results stay on this device.`;
  requestAnimationFrame(() => { field.focus({ preventScroll: true }); field.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
}

function placeConversationPanel(panel) {
  if (!panel || !state.conversation || panel.hidden) return;
  const list = $('#feed-list');
  const { fid, hash } = state.conversation;
  const anchor = [...list.querySelectorAll('.post-card')].find((card) => Number(card.dataset.castFid) === Number(fid) && card.dataset.castHash === hash);
  if (anchor) {
    const collapsedGroup = anchor.closest('details:not([open])');
    if (collapsedGroup) collapsedGroup.open = true;
    anchor.after(panel);
  }
  else list.append(panel);
}

function updateConversationTriggers() {
  document.querySelectorAll('[data-open-conversation="true"]').forEach((button) => {
    const isOpen = state.conversation?.fid === Number(button.dataset.fid) && state.conversation?.hash === button.dataset.hash;
    button.setAttribute('aria-expanded', String(!!isOpen));
    button.classList.toggle('is-open', !!isOpen);
    const count = button.querySelector('.conversation-count:not([hidden])')?.textContent;
    const label = isOpen ? 'Close thread' : 'View thread';
    button.setAttribute('aria-label', count ? `${label} · ${count} replies` : label);
    button.title = count ? `${count} replies · ${label}` : label;
  });
}

function renderConversationReplies(conversation, { append = false } = {}) {
  const replies = $('#conversation-replies');
  const fragment = document.createDocumentFragment();
  for (const message of conversation.replies) fragment.append(renderCast(message));
  if (append) replies.append(fragment);
  else replies.replaceChildren(fragment);
  watchCastEngagement(replies);
  const count = conversation.replies.length;
  $('#conversation-title').textContent = `${conversation.nextPageToken ? 'At least ' : ''}${count} ${count === 1 ? 'reply' : 'replies'}`;
  const delay = maxNodeDelay();
  $('#conversation-status').textContent = conversation.rootLoadError || conversation.loadError || (count
    ? conversation.nextPageToken ? 'Oldest first · more replies are available.' : 'Oldest first · all replies on this node are loaded.'
    : delay !== null && delay > 10 ? `No replies visible yet · this node is ${formatNodeDelay(delay)} behind.` : 'No replies found on this node yet.');
  $('#conversation-retry').hidden = !conversation.rootLoadError;
  const more = $('#conversation-load-more');
  more.hidden = !conversation.nextPageToken;
  more.disabled = !!conversation.loadingMore;
  more.textContent = conversation.loadingMore ? 'Loading replies…' : conversation.loadError ? 'Retry replies' : 'Load more replies';
}

async function loadMoreConversationReplies() {
  const conversation = state.conversation;
  if (!conversation?.nextPageToken || conversation.loadingMore) return;
  conversation.loadingMore = true;
  const moreButton = $('#conversation-load-more');
  moreButton.disabled = true;
  moreButton.textContent = 'Loading replies…';
  conversation.loadError = '';
  try {
    const pageToken = conversation.nextPageToken;
    const response = await nodeRequest('replies', {
      fid: conversation.rootFid,
      hash: conversation.rootHash,
      pageSize: 100,
      reverse: true,
      pageToken,
    }, { fresh: true });
    if (state.conversation !== conversation) return;
    const additions = unwrapMessages(response).filter((message) => message?.data?.castAddBody);
    const seen = new Set(conversation.replies.map((message) => `${Number(message?.data?.fid)}/${postHash(message)}`));
    for (const message of additions) {
      const key = `${Number(message?.data?.fid)}/${postHash(message)}`;
      if (!seen.has(key)) { seen.add(key); conversation.replies.push(message); }
    }
    conversation.replies.sort((a, b) => Number(a.data.timestamp || 0) - Number(b.data.timestamp || 0));
    const nextToken = String(response?.nextPageToken || response?.next_page_token || '');
    conversation.nextPageToken = nextToken && nextToken !== pageToken && !conversation.seenPageTokens.has(nextToken) ? nextToken : '';
    if (conversation.nextPageToken) conversation.seenPageTokens.add(conversation.nextPageToken);
    const fids = [...new Set(additions.map((message) => Number(message?.data?.fid)).filter((fid) => fid > 0 && !state.people.has(fid)))];
    await mapLimit(fids, 6, fetchProfile);
    if (state.conversation !== conversation) return;
    renderConversationReplies(conversation);
  } catch (error) {
    if (state.conversation === conversation) {
      conversation.loadError = `Could not load more replies. ${error.message}`;
    }
  } finally {
    if (state.conversation === conversation) {
      conversation.loadingMore = false;
      renderConversationReplies(conversation);
    }
  }
}

async function openConversation(fidValue, hashValue, { updateRoute = true, fresh = false } = {}) {
  const fid = asFid(fidValue);
  const hash = hashText(hashValue);
  if (!/^0x[\da-f]{40,64}$/i.test(hash)) { setNotice('This post has an invalid cast link.', 'error'); return; }
  if (state.conversation?.fid === fid && state.conversation?.hash === hash && !fresh) { closeConversation(); return; }
  const conversation = { fid, hash, rootFid: fid, rootHash: hash, nextPageToken: '', seenPageTokens: new Set(), replies: [], loadingMore: false };
  state.conversation = conversation;
  updateConversationTriggers();
  if (updateRoute) history.pushState(null, '', `#cast=${fid}/${hash}`);
  const panel = $('#conversation-view');
  const root = $('#conversation-root');
  const status = $('#conversation-status');
  panel.hidden = false;
  panel.setAttribute('aria-busy', 'true');
  root.replaceChildren(); $('#conversation-replies').replaceChildren();
  $('#conversation-title').textContent = 'Opening conversation…';
  status.textContent = 'Loading the cast and checking for replies on your node.';
  $('#conversation-retry').hidden = true;
  $('#conversation-load-more').hidden = true;
  placeConversationPanel(panel);
  try {
    let original = state.casts.find((message) => Number(message?.data?.fid) === fid && postHash(message) === hash)
      || state.savedCasts.find((message) => Number(message.fid) === fid && message.hash === hash);
    if (original && !original.data) original = savedCastMessage(original);
    if (!original) original = await nodeRequest('castById', { fid, hash }, { fresh });
    const parent = original?.data?.castAddBody?.parentCastId;
    const selectedIsReply = !!(parent?.fid && parent?.hash);
    if (parent?.fid && parent?.hash) {
      try { original = await nodeRequest('castById', { fid: Number(parent.fid), hash: hashText(parent.hash) }); }
      catch { /* Keep the selected reply as the conversation root when its parent is unavailable. */ }
    }
    if (state.conversation !== conversation) return;
    conversation.rootFid = Number(original?.data?.fid) || fid;
    conversation.rootHash = postHash(original) || hash;
    const rootAlreadyVisible = selectedIsReply && [...$('#feed-list').querySelectorAll('.post-card')].some((card) => Number(card.dataset.castFid) === conversation.rootFid && card.dataset.castHash === conversation.rootHash);
    if (selectedIsReply && !rootAlreadyVisible) {
      root.replaceChildren(renderCast(original));
      watchCastEngagement(root);
    }
    const response = await nodeRequest('replies', { fid: conversation.rootFid, hash: conversation.rootHash, pageSize: 100, reverse: true }, { fresh });
    if (state.conversation !== conversation) return;
    const messages = unwrapMessages(response).filter((message) => message?.data?.castAddBody).sort((a, b) => Number(a.data.timestamp || 0) - Number(b.data.timestamp || 0));
    conversation.replies = messages;
    const nextToken = String(response?.nextPageToken || response?.next_page_token || '');
    conversation.nextPageToken = nextToken;
    if (nextToken) conversation.seenPageTokens.add(nextToken);
    const profiles = [...new Set([conversation.rootFid, ...messages.map((message) => Number(message?.data?.fid)).filter(Boolean)])];
    await mapLimit(profiles, 6, fetchProfile);
    if (state.conversation !== conversation) return;
    if (!rootAlreadyVisible && selectedIsReply && root.firstElementChild) {
      const updatedRoot = renderCast(original); root.replaceChildren(updatedRoot); watchCastEngagement(root);
    }
    renderConversationReplies(conversation);
    panel.setAttribute('aria-busy', 'false');
    placeConversationPanel(panel);
    requestAnimationFrame(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  } catch (error) {
    if (state.conversation === conversation) {
      conversation.rootLoadError = `Could not load this conversation. ${clientErrorText(error)}`;
      status.textContent = conversation.rootLoadError;
      panel.setAttribute('aria-busy', 'false');
      $('#conversation-retry').hidden = false;
    }
  }
}

function closeConversation({ updateRoute = true } = {}) {
  state.conversation = null;
  updateConversationTriggers();
  const panel = $('#conversation-view');
  panel.hidden = true;
  $('#feed-filters').after(panel);
  if (updateRoute) history.pushState(null, '', state.feedMode === 'profile' ? `#profile=${Number(state.feedTargetFid)}` : '#feed');
}

function openProfileEditor(fid) {
  const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}` };
  const isOwnProfile = !!state.signerReady && Number(fid) === Number(state.fid);
  const local = state.profileNotes[fid] || {};
  $('#profile-edit-title').textContent = isOwnProfile ? 'Your Castonaut profile details.' : `Your notes for ${localProfileName(profile)}.`;
  $('#profile-edit-hint').textContent = isOwnProfile
    ? 'Your display name and note change how this profile appears in Castonaut on this device. Your public Farcaster profile stays the same.'
    : 'These details stay in this browser. They don’t edit or publish the person’s Farcaster profile.';
  $('#profile-nickname-label').textContent = isOwnProfile ? 'Display name on this device' : 'Your nickname for them';
  $('#profile-nickname').placeholder = isOwnProfile ? (profile.name || 'Your Farcaster name') : 'Use their profile name';
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

function deskSortedPeople() {
  const people = [...state.deskPins];
  if (state.deskSort.people === 'name') people.sort((a, b) => localProfileName(state.people.get(a) || { fid: a, name: `Farcaster ${a}` }).localeCompare(localProfileName(state.people.get(b) || { fid: b, name: `Farcaster ${b}` }), undefined, { sensitivity: 'base', numeric: true }));
  return people;
}

function deskSortedPosts() {
  const posts = [...state.deskCasts];
  if (state.deskSort.posts === 'newest') posts.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  else if (state.deskSort.posts === 'oldest') posts.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  else if (posts.some((post) => Number(post.savedAt) > 0)) posts.sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
  return posts;
}

function deskSortedTopics() {
  const topics = [...state.deskTopics];
  if (state.deskSort.topics === 'name') topics.sort((a, b) => a.replace(/^site:/, '').localeCompare(b.replace(/^site:/, ''), undefined, { sensitivity: 'base', numeric: true }));
  return topics;
}

function renderDesk() {
  const container = $('#desk-pins');
  if (!container) return;
  renderDeskStatus();
  $('#desk-people-count').textContent = `${state.deskPins.length} pinned`;
  const peopleSort = $('[data-desk-sort="people"]');
  if (peopleSort) peopleSort.value = state.deskSort.people;
  container.replaceChildren();
  if (!state.deskPins.length) {
    const empty = document.createElement('span'); empty.className = 'desk-empty'; empty.textContent = 'No pinned people yet.'; container.append(empty);
  } else {
    for (const fid of deskSortedPeople()) {
      const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}`, avatar: '' };
      const chip = document.createElement('div'); chip.className = 'desk-person';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'desk-person-open'; open.dataset.deskFid = String(fid);
      const shownName = localProfileName(profile);
      const avatar = document.createElement('span'); avatar.className = 'desk-avatar'; avatar.textContent = shownName.slice(0, 1).toUpperCase();
      const avatarUrl = safeImageUrl(profile.avatar);
      if (avatarUrl) setRemoteAvatar(avatar, avatarUrl);
      const labels = document.createElement('span'); labels.className = 'desk-person-label';
      const name = document.createElement('strong'); name.textContent = shownName;
      const handle = document.createElement('small'); handle.textContent = `@${profile.username}`;
      labels.append(name, handle); open.append(avatar, labels);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'desk-unpin'; remove.dataset.action = 'unpin-person'; remove.dataset.fid = String(fid); remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${shownName} from your desk`);
      chip.append(open, remove); container.append(chip);
    }
  }
  renderDeskLeaderPicker();
  renderDeskShortcuts();
  renderDeskAtlas();
  renderCapsuleShelf();
  renderDeskActivity();
}

function renderDeskLeaderPicker() {
  const list = $('#desk-leader-list');
  const count = $('#desk-leader-picker-count');
  if (!list) return;
  if (count) count.textContent = `${CURATED_TOP_ACCOUNTS.length} leaders · ${state.deskPins.length}/24 pinned`;
  list.replaceChildren();
  const resolvedByName = new Map(state.curatedTopAccounts.map((account) => [account.username, account]));
  for (const leader of CURATED_TOP_ACCOUNTS) {
    const resolved = resolvedByName.get(leader.username);
    const row = document.createElement('div'); row.className = 'desk-leader-row';
    const identity = document.createElement('span'); identity.className = 'desk-leader-identity';
    const name = document.createElement('strong'); name.textContent = leader.name;
    const handle = document.createElement('small'); handle.textContent = `@${leader.username} · ${leader.role}`;
    identity.append(name, handle);
    const action = document.createElement('button'); action.type = 'button'; action.className = 'button button-outline desk-leader-toggle';
    if (resolved?.fid) {
      const pinned = state.deskPins.includes(Number(resolved.fid));
      action.dataset.action = pinned ? 'unpin-person' : 'pin-person'; action.dataset.fid = String(resolved.fid);
      action.setAttribute('aria-pressed', String(pinned)); action.textContent = pinned ? 'Pinned ✓' : 'Pin';
      action.setAttribute('aria-label', `${pinned ? 'Remove' : 'Pin'} ${leader.name} ${pinned ? 'from' : 'to'} your Desk`);
      action.disabled = !pinned && state.deskPins.length >= 24;
    } else {
      action.disabled = true; action.textContent = state.curatedTopLoadPromise ? 'Loading…' : 'Unavailable';
      action.title = 'This username could not be resolved by the configured Snapchain node.';
    }
    row.append(identity, action); list.append(row);
  }
  if (!state.curatedTopAccounts.length) {
    const status = document.createElement('p'); status.className = 'desk-leader-status';
    status.textContent = state.curatedTopLoadPromise ? 'Loading the leader list…' : 'Open the list to check these accounts against your node.';
    list.append(status);
  }
}

$('#desk-leader-picker')?.addEventListener('toggle', async (event) => {
  if (!event.currentTarget.open) return;
  renderDeskLeaderPicker();
  if (state.curatedTopAccounts.length < CURATED_TOP_ACCOUNTS.length) {
    const list = $('#desk-leader-list');
    if (list && !state.curatedTopAccounts.length) {
      const status = document.createElement('p'); status.className = 'desk-leader-status'; status.textContent = 'Checking leaders on your Snapchain node…'; list.replaceChildren(status);
    }
    await ensureCuratedTopAccounts();
    renderDeskLeaderPicker();
  }
});

function updateDeskNotepadControls() {
  const field = $('#desk-notepad-text');
  const useInCast = $('#desk-note-to-cast');
  if (useInCast) useInCast.disabled = !state.signerReady || !field?.value.trim();
}

function renderDeskAtlas() {
  const details = $('#desk-atlas');
  const map = $('#desk-atlas-map');
  const count = $('#desk-atlas-count');
  if (!details || !map || !count) return;
  count.textContent = String(state.deskPins.length);
  if (!details.open) return;
  map.replaceChildren();
  if (!state.deskPins.length) {
    const empty = document.createElement('p'); empty.className = 'desk-atlas-empty';
    empty.textContent = 'Pin a few people and your constellation will appear here.';
    map.append(empty);
    return;
  }

  const stage = document.createElement('div'); stage.className = 'desk-atlas-stage';
  stage.innerHTML = '<svg class="desk-atlas-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="50" cy="50" rx="24" ry="22"/><ellipse cx="50" cy="50" rx="37" ry="35"/><ellipse cx="50" cy="50" rx="48" ry="45"/><path d="M50 4v92M4 50h92M17.5 17.5l65 65m0-65-65 65"/><circle cx="50" cy="50" r="2.5"/></svg>';
  const selfProfile = state.people.get(Number(state.fid)) || { name: 'You', username: 'you' };
  const center = document.createElement('div'); center.className = 'desk-atlas-self';
  const selfMark = document.createElement('span'); selfMark.className = 'desk-atlas-avatar'; selfMark.textContent = localProfileName(selfProfile).slice(0, 1).toUpperCase();
  const selfAvatarUrl = safeImageUrl(selfProfile.avatar);
  if (selfAvatarUrl) setRemoteAvatar(selfMark, selfAvatarUrl);
  const selfLabel = document.createElement('small'); selfLabel.textContent = 'YOU';
  center.append(selfMark, selfLabel); stage.append(center);

  for (const node of orbitAtlasLayout(state.deskPins)) {
    const profile = state.people.get(node.fid) || { fid: node.fid, name: `Farcaster ${node.fid}`, username: `fid-${node.fid}` };
    const name = localProfileName(profile);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'desk-atlas-person';
    button.dataset.deskFid = String(node.fid); button.style.left = `${node.x}%`; button.style.top = `${node.y}%`;
    button.textContent = name.trim().slice(0, 1).toUpperCase() || '✳';
    const avatarUrl = safeImageUrl(profile.avatar);
    if (avatarUrl) setRemoteAvatar(button, avatarUrl);
    button.title = `Open @${profile.username || `fid-${node.fid}`}`;
    button.setAttribute('aria-label', `Open ${name}, @${profile.username || `fid-${node.fid}`}, from your Orbit`);
    stage.append(button);
  }
  const caption = document.createElement('span'); caption.className = 'desk-atlas-caption'; caption.textContent = 'Select a satellite to visit their profile';
  map.append(stage, caption);
}

function renderDeskStatus() {
  const strip = $('#desk-status');
  if (!strip) return;
  const maxDelay = maxNodeDelay();
  const networkLabel = maxDelay === null ? 'Checking' : maxDelay <= 10 ? 'Synced' : 'Catching up';
  const rows = [
    ['ACCOUNT', state.fid ? `FID ${Number(state.fid).toLocaleString()}` : 'Not connected'],
    ['SIGNER', state.signerReady ? 'Ready · on Snapchain' : 'Read only'],
    ['NETWORK', networkLabel],
  ];
  strip.replaceChildren();
  for (const [label, value] of rows) {
    const item = document.createElement('div'); item.className = 'desk-status-item';
    item.dataset.state = label === 'SIGNER' ? (state.signerReady ? 'ready' : 'idle') : label === 'NETWORK' ? (maxDelay !== null && maxDelay <= 10 ? 'ready' : maxDelay === null ? 'idle' : 'lagging') : (state.fid ? 'ready' : 'idle');
    const name = document.createElement('span'); name.textContent = label;
    const data = document.createElement('strong'); data.textContent = value;
    item.append(name, data); strip.append(item);
  }
}

function renderDeskActivity() {
  const list = $('#desk-activity-list');
  const count = $('#desk-activity-count');
  if (!list || !count) return;
  const unique = new Map();
  for (const message of [...state.casts, ...state.deskActivityCasts]) {
    const key = postHash(message);
    if (key) unique.set(key, message);
  }
  const posts = recentOrbitCasts([...unique.values()], state.deskPins, 4);
  renderDeskOrbitPulse(summarizeOrbitActivity([...unique.values()], state.deskPins));
  count.textContent = `${posts.length} recent`;
  list.replaceChildren();
  if (!state.deskPins.length) {
    const empty = document.createElement('p'); empty.className = 'desk-activity-empty'; empty.textContent = 'Pin a person to build your Orbit.'; list.append(empty); return;
  }
  if (!posts.length) {
    const empty = document.createElement('p'); empty.className = 'desk-activity-empty';
    empty.textContent = state.deskActivityOffset ? 'No original posts found in the profiles checked.' : 'Recent posts from pinned people, loaded only when you ask.';
    list.append(empty);
  } else for (const message of posts) {
    const fid = Number(message.data.fid);
    const profile = state.people.get(fid) || { fid, username: `fid-${fid}`, name: `Farcaster ${fid}` };
    const item = document.createElement('article'); item.className = 'desk-activity-item';
    const avatar = document.createElement('button'); avatar.type = 'button'; avatar.className = 'desk-activity-avatar'; avatar.dataset.openProfile = String(fid); avatar.textContent = localProfileName(profile).slice(0, 1).toUpperCase();
    const avatarUrl = safeImageUrl(profile.avatar); if (avatarUrl) setRemoteAvatar(avatar, avatarUrl);
    const body = document.createElement('div'); body.className = 'desk-activity-copy';
    const meta = document.createElement('div'); meta.className = 'desk-activity-meta';
    const author = document.createElement('button'); author.type = 'button'; author.dataset.openProfile = String(fid); author.textContent = `@${profile.username || `fid-${fid}`}`;
    const date = document.createElement('time'); date.textContent = farcasterDate(message.data.timestamp); meta.append(author, date);
    const text = document.createElement('p'); text.textContent = String(message.data.castAddBody.text || 'Posted a cast.');
    body.append(meta, text);
    const open = document.createElement('button'); open.type = 'button'; open.className = 'desk-activity-open'; open.dataset.openConversation = 'true'; open.dataset.fid = String(fid); open.dataset.hash = postHash(message); open.setAttribute('aria-label', `Open cast from @${profile.username || fid}`); open.textContent = '↗';
    item.append(avatar, body, open); list.append(item);
  }
  const action = document.createElement('button'); action.type = 'button'; action.className = 'desk-activity-refresh'; action.dataset.deskActivityRefresh = 'true'; action.disabled = state.deskActivityBusy;
  action.textContent = state.deskActivityBusy ? 'Checking…' : state.deskActivityOffset >= state.deskPins.length && state.deskActivityCasts.length ? 'Refresh Orbit ↻' : state.deskActivityOffset ? 'Load next 6 people ↓' : 'Load pinned activity ↓';
  list.append(action);
}

function renderDeskOrbitPulse(pulse) {
  const panel = $('#desk-orbit-pulse');
  if (!panel) return;
  panel.replaceChildren();
  panel.hidden = !pulse.loaded;
  if (!pulse.loaded) return;
  const days = pulse.dailyPosts;
  const max = Math.max(1, ...days.map((day) => day.count));
  const heading = document.createElement('div'); heading.className = 'desk-orbit-pulse-head';
  const title = document.createElement('strong'); title.textContent = `${pulse.thisWeek} ${pulse.thisWeek === 1 ? 'post' : 'posts'}`;
  const sample = document.createElement('small'); sample.textContent = `${pulse.activePeople} ${pulse.activePeople === 1 ? 'person' : 'people'} · loaded this week`;
  heading.append(title, sample);
  const chart = document.createElement('div'); chart.className = 'desk-orbit-pulse-chart'; chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', 'Original posts per day in the last seven days, from loaded pinned profiles');
  for (const day of days) {
    const column = document.createElement('div'); column.className = 'desk-orbit-pulse-day';
    column.title = `${day.date}: ${day.count} ${day.count === 1 ? 'post' : 'posts'}`;
    const bar = document.createElement('i'); bar.style.height = `${Math.max(day.count ? 12 : 4, day.count / max * 34)}px`;
    const label = document.createElement('small'); label.textContent = day.label === 'Today' ? 'Now' : day.label;
    column.append(bar, label); chart.append(column);
  }
  panel.append(heading, chart);
}

async function loadDeskActivity(button) {
  if (!state.signerReady || state.deskActivityBusy || !state.deskPins.length) return;
  const start = state.deskActivityOffset >= state.deskPins.length ? 0 : state.deskActivityOffset;
  const pins = state.deskPins.slice(start, start + 6);
  if (!pins.length) return;
  state.deskActivityBusy = true; renderDeskActivity();
  let results;
  try {
    results = await mapLimit(pins, 3, async (fid) => {
      const response = await nodeRequest('casts', { fid, pageSize: 8, reverse: true });
      return { fid, messages: unwrapMessages(response).filter((message) => message?.data?.castAddBody) };
    });
  } catch (error) {
    state.deskActivityBusy = false;
    renderDeskActivity();
    setNotice(`Could not load pinned activity. ${clientErrorText(error)}`, 'error');
    return;
  }
  const successful = results.filter(Boolean);
  if (!successful.length) {
    state.deskActivityBusy = false; renderDeskActivity();
    setNotice('Could not load pinned activity. Check the node connection and try again.', 'error'); return;
  }
  if (start === 0) state.deskActivityCasts = [];
  const existing = new Set(state.deskActivityCasts.map(postHash));
  for (const result of successful) for (const message of result.messages) {
    state.messages.set(`${result.fid}:${postHash(message)}`, message);
    if (!existing.has(postHash(message))) { state.deskActivityCasts.push(message); existing.add(postHash(message)); }
  }
  state.deskActivityOffset = start + pins.length;
  state.deskActivityBusy = false; renderDeskActivity();
  setNotice(`Loaded recent posts from ${successful.length} pinned ${successful.length === 1 ? 'person' : 'people'}.`, 'success');
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
    feed: state.feedMode,
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
  $('#desk-cast-count').textContent = `${state.deskCasts.length} saved`;
  $('#desk-topic-count').textContent = `${state.deskTopics.length} pinned`;
  const postsSort = $('[data-desk-sort="posts"]');
  const topicsSort = $('[data-desk-sort="topics"]');
  if (postsSort) postsSort.value = state.deskSort.posts;
  if (topicsSort) topicsSort.value = state.deskSort.topics;
  if (!state.deskCasts.length) {
    const empty = document.createElement('div'); empty.className = 'desk-shortcut-empty';
    const message = document.createElement('p'); message.textContent = 'No saved posts yet. Save a post from its action menu to keep it here.';
    const browse = document.createElement('button'); browse.type = 'button'; browse.className = 'button button-outline'; browse.textContent = 'Browse Following';
    browse.addEventListener('click', () => { navigate('feed'); setFeedTab('following'); });
    empty.append(message, browse); casts.append(empty);
  }
  if (!state.deskTopics.length) {
    const empty = document.createElement('div'); empty.className = 'desk-shortcut-empty';
    const message = document.createElement('p'); message.textContent = 'No pinned topics yet. Pin a topic from a post menu to make a quick feed shortcut.';
    const browse = document.createElement('button'); browse.type = 'button'; browse.className = 'button button-outline'; browse.textContent = 'Open Following';
    browse.addEventListener('click', () => { navigate('feed'); setFeedTab('following'); });
    empty.append(message, browse); topics.append(empty);
  }
  for (const saved of deskSortedPosts()) {
    const item = document.createElement('article'); item.className = 'desk-signal';
    const meta = document.createElement('span'); meta.className = 'desk-signal-meta'; meta.textContent = `SIGNAL · @${saved.username || `fid-${saved.fid}`}`;
    const text = document.createElement('p'); text.textContent = saved.text || 'Saved signal';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'desk-signal-remove'; remove.dataset.action = 'toggle-desk-cast'; remove.dataset.fid = String(saved.fid); remove.dataset.hash = saved.hash; remove.setAttribute('aria-label', 'Remove signal from your Desk'); remove.textContent = '×';
    const profile = state.people.get(Number(saved.fid)) || { username: saved.username || `fid-${saved.fid}` };
    const original = originalCastUrl(profile, { hash: saved.hash });
    item.append(meta, text);
    const open = document.createElement('button'); open.type = 'button'; open.className = 'desk-signal-open';
    open.dataset.openDeskCast = 'true'; open.dataset.fid = String(saved.fid); open.dataset.hash = saved.hash;
    open.textContent = 'Read in Castonaut'; item.append(open);
    if (original) { const link = document.createElement('a'); link.href = original; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Original ↗'; item.append(link); }
    const annotations = document.createElement('details'); annotations.className = 'desk-cast-annotations';
    const annotationSummary = document.createElement('summary'); annotationSummary.textContent = saved.label || saved.note ? `${saved.label || 'Private note'} · edit` : 'Add a private note or label';
    const annotationBody = document.createElement('div'); annotationBody.className = 'desk-cast-annotation-body';
    const label = document.createElement('select'); label.setAttribute('aria-label', 'Label this saved post'); label.dataset.deskCastLabel = 'true'; label.dataset.fid = String(saved.fid); label.dataset.hash = saved.hash;
    for (const value of DESK_CAST_LABELS) { const option = document.createElement('option'); option.value = value; option.textContent = value || 'No label'; label.append(option); }
    label.value = DESK_CAST_LABELS.includes(saved.label || '') ? saved.label || '' : '';
    const note = document.createElement('textarea'); note.maxLength = 280; note.rows = 2; note.placeholder = 'A private reminder…'; note.value = String(saved.note || ''); note.setAttribute('aria-label', 'Private note for this saved post'); note.dataset.deskCastNote = 'true'; note.dataset.fid = String(saved.fid); note.dataset.hash = saved.hash;
    annotationBody.append(label, note); annotations.append(annotationSummary, annotationBody); item.append(annotations);
    item.append(remove); casts.append(item);
  }
  for (const topic of deskSortedTopics()) {
    const chip = document.createElement('span'); chip.className = `desk-topic${state.activeDeskTopic === topic ? ' is-active' : ''}`;
    const view = document.createElement('button'); view.type = 'button'; view.dataset.deskTopic = topic; view.textContent = topic.replace(/^site:/, ''); view.setAttribute('aria-pressed', String(state.activeDeskTopic === topic));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'desk-topic-remove'; remove.dataset.action = 'toggle-desk-topic'; remove.dataset.topic = topic; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${topic.replace(/^site:/, '')} from your Desk`);
    chip.append(view, remove); topics.append(chip);
  }
  casts.hidden = false;
  topics.hidden = false;
  active.hidden = !state.activeDeskTopic || state.boardMode !== 'signals';
  if (state.activeDeskTopic && state.boardMode === 'signals') {
    active.replaceChildren(document.createTextNode(`Showing ${state.activeDeskTopic.replace(/^site:/, '')} in this feed `));
    const clear = document.createElement('button'); clear.type = 'button'; clear.dataset.clearDeskTopic = 'true'; clear.textContent = 'Clear'; active.append(clear);
  }
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
    state.deskCasts.unshift({ fid, hash, username: String(profile.username || `fid-${fid}`).slice(0, 32), text: String(message.data?.castAddBody?.text || '').slice(0, 500), timestamp: Number(message.data?.timestamp) || 0, savedAt: Date.now(), label: '', note: '' });
  }
  try { localStorage.setItem(DESK_CASTS_STORAGE, JSON.stringify(state.deskCasts)); }
  catch { state.deskCasts = previous; setNotice('This browser could not save the Desk signal.', 'error'); return; }
  renderDeskShortcuts(); renderFeed();
  setNotice(existing >= 0 ? 'Signal removed from your Desk.' : 'Signal pinned to your Desk on this device.', 'success');
}

function saveDraggedCast(payload) {
  const fid = Number(payload?.fid), hash = String(payload?.hash || '').toLowerCase();
  if (!Number.isSafeInteger(fid) || fid <= 0 || !/^[0-9a-f]{40,128}$/.test(hash)) return false;
  const exists = state.deskCasts.some((cast) => Number(cast.fid) === fid && String(cast.hash).toLowerCase() === hash);
  if (!exists) toggleDeskCast(fid, hash);
  return exists || state.deskCasts.some((cast) => Number(cast.fid) === fid && String(cast.hash).toLowerCase() === hash);
}

document.addEventListener('dragstart', (event) => {
  const button = event.target.closest('[data-action="toggle-desk-cast"][draggable="true"]');
  if (!button || !event.dataTransfer) return;
  const payload = JSON.stringify({ fid: Number(button.dataset.fid), hash: String(button.dataset.hash || '') });
  event.dataTransfer.setData('application/x-castonaut-desk-cast', payload);
  event.dataTransfer.setData('text/plain', 'Castonaut saved post');
  event.dataTransfer.effectAllowed = 'copy';
});
document.addEventListener('dragend', () => document.querySelectorAll('.desk-drop-target, .is-drop-target').forEach((item) => item.classList.remove('desk-drop-target', 'is-drop-target')));
function readDeskDrag(event) {
  try { return JSON.parse(event.dataTransfer?.getData('application/x-castonaut-desk-cast') || 'null'); }
  catch { return null; }
}
function acceptDeskDrop(event, target) {
  if (!event.dataTransfer?.types?.includes('application/x-castonaut-desk-cast')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  target?.classList.add('is-drop-target');
}
function completeDeskDrop(event) {
  const payload = readDeskDrag(event);
  if (!payload) return;
  event.preventDefault();
  return saveDraggedCast(payload);
}
document.addEventListener('dragover', (event) => {
  const target = event.target.closest('[data-view="desk"], #desk-casts');
  if (target) acceptDeskDrop(event, target);
});
document.addEventListener('dragleave', (event) => {
  const target = event.target.closest('[data-view="desk"], #desk-casts');
  if (target && !target.contains(event.relatedTarget)) target.classList.remove('is-drop-target');
});
document.addEventListener('drop', (event) => {
  if (!event.target.closest('[data-view="desk"], #desk-casts')) return;
  const saved = completeDeskDrop(event);
  document.querySelectorAll('.is-drop-target').forEach((item) => item.classList.remove('is-drop-target'));
  if (saved && currentArea !== 'desk') navigate('desk');
});

function updateDeskCastAnnotation(fidValue, hashValue, field, value) {
  const fid = Number(fidValue), hash = String(hashValue || '').toLowerCase();
  const index = state.deskCasts.findIndex((cast) => Number(cast.fid) === fid && String(cast.hash).toLowerCase() === hash);
  if (index < 0 || !['label', 'note'].includes(field)) return;
  const safeValue = field === 'label' ? DESK_CAST_LABELS.includes(value) ? value : '' : String(value).slice(0, 280);
  const previous = state.deskCasts;
  state.deskCasts = state.deskCasts.map((cast, itemIndex) => itemIndex === index ? { ...cast, [field]: safeValue } : cast);
  try { localStorage.setItem(DESK_CASTS_STORAGE, JSON.stringify(state.deskCasts)); }
  catch { state.deskCasts = previous; setNotice('This browser could not save the private note.', 'error'); return; }
  setNotice(field === 'label' ? 'Saved-post label updated on this device.' : 'Private note saved on this device.', 'success');
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
  updatePrimaryNav();
  updateFeedTabs();
  renderDeskShortcuts();
  $('#page-label').textContent = logMode ? 'SAVED' : state.feedMode === 'profile' ? 'PROFILE' : 'FEED';
  $('#feed-title').textContent = feedWindowTitle();
  $('#feed-caption').textContent = logMode
    ? 'Saved on this device.'
    : state.feedMode === 'profile' ? `@${state.people.get(state.feedTargetFid)?.username || 'this profile'}` : feedDescription();
  $('#feed-filters').hidden = logMode;
  $('#composer').hidden = !state.signerReady || logMode || (state.feedMode === 'profile' && !state.parent);
  renderFeed();
  restoreFeedScroll();
}

function setFeedTab(mode) {
  saveFeedScroll();
  feedScrollSaved = true;
  state.boardMode = 'signals';
  $('#composer').hidden = !state.signerReady || (mode === 'profile' && !state.parent);
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
    const embeds = (body.embeds || []).filter((embed) => typeof embed?.url === 'string' && utf8ByteLength(embed.url) <= CAST_EMBED_URL_LIMIT).slice(0, CAST_EMBED_LIMIT).map((embed) => ({ url: embed.url }));
    state.savedCasts.unshift({ fid, hash, signer: signerHex(message.signer), text: truncateUtf8(body.text || '', CAST_LIMIT), timestamp: Number(message.data?.timestamp) || 0, name: String(profile.name || '').slice(0, 80), username: String(profile.username || '').slice(0, 80), embeds, savedAt: Date.now() });
  }
  try { localStorage.setItem(flightLogStorageKey(), JSON.stringify(state.savedCasts)); }
  catch { state.savedCasts = prior; setNotice('Browser storage is unavailable. Your saved list could not be updated.', 'error'); return; }
  renderFlightLogCount();
  renderFeed();
  setNotice(existing >= 0 ? 'Post removed from Saved.' : 'Post saved on this device.', 'success');
}

async function toggleDeskPin(fidValue, button) {
  const fid = asFid(fidValue);
  const previous = [...state.deskPins];
  if (state.deskPins.includes(fid)) state.deskPins = state.deskPins.filter((value) => value !== fid);
  else if (state.deskPins.length < 24) state.deskPins.unshift(fid);
  else { setNotice('Your Desk is full. Remove someone before pinning another person.'); return false; }
  try { localStorage.setItem(DESK_STORAGE, JSON.stringify(state.deskPins)); }
  catch { state.deskPins = previous; renderDesk(); setNotice('Browser storage is unavailable, so this Desk change could not be saved.', 'error'); return false; }
  state.deskActivityOffset = 0;
  state.deskActivityCasts = state.deskActivityCasts.filter((message) => state.deskPins.includes(Number(message?.data?.fid)));
  if (!state.people.has(fid)) await fetchProfile(fid);
  renderDesk();
  if (button) {
    const pinned = state.deskPins.includes(fid);
    button.textContent = pinned ? '⌖ Pinned' : '⌖ Pin';
    button.setAttribute('aria-pressed', String(pinned));
  }
  setNotice(state.deskPins.includes(fid) ? 'Pinned to your desk on this device.' : 'Removed from your desk.', 'success');
  return true;
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
    if (!registeredFid || BigInt(registeredFid) < 1n) throw new Error('No Farcaster account was found for this phrase. Check the words and try again.');
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
  let recoveryStage = 'loading the account checker';
  pendingRecoveryAccount = null;
  if (!phrase) { setConnectionStatus('Enter your Farcaster recovery phrase.'); return; }
  if (!isSupportedRecoveryPhraseLength(phrase)) { phrase = ''; setConnectionStatus('Use a standard 12, 15, 18, 21, or 24-word phrase. The field has been cleared.'); return; }
  connectButton.disabled = true;
  const originalLabel = connectButton.textContent;
  connectButton.textContent = 'Connecting…';
  connectButton.setAttribute('aria-busy', 'true');
  setConnectionStatus('Checking account…', { active: 'sign', busy: true });
  try {
    const { mnemonicToAccount } = await import('viem/accounts');
    const { createPublicClient, fallback, http, optimism } = await optimismToolkit();
    recoveryStage = 'deriving your Farcaster account';
    try { candidates = deriveRecoveryAccountCandidates(phrase, mnemonicToAccount); }
    catch { throw new Error('That phrase could not be imported. Check the words and try again.'); }
    phrase = '';
    recoveryStage = 'checking your account on Optimism';
    const publicClient = createPublicClient({ chain: optimism, transport: optimismReadTransport(fallback, http) });
    const { account, fid } = await findRegisteredRecoveryAccount(candidates, (candidate) => publicClient.readContract({
      address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [candidate.address],
    }));
    candidates = null;
    pendingRecoveryAccount = { account, address: account.address, fid: asFid(fid.toString()) };
    recoveryStage = 'starting the limited browser-key authorization';
    setConnectionStatus(`Farcaster account found · FID ${pendingRecoveryAccount.fid}. Preparing your limited browser key…`, { active: 'approve', completed: ['sign'], busy: true });
    await authorizeSigner(pendingRecoveryAccount);
  } catch (error) {
    const safeMessage = error?.message === 'That phrase could not be imported. Check the words and try again.'
      || error?.message === 'Could not reach the Optimism account registry. Check your connection and try again.'
      || error?.message === 'No Farcaster account was found for this phrase. Check the words and try again.'
      ? error.message
      : recoveryStage === 'loading the account checker'
        ? 'Could not load the sign-in tools. Reload Castonaut and try again.'
        : recoveryStage === 'deriving your Farcaster account'
          ? 'Could not read that recovery phrase. Check the words and try again.'
          : recoveryStage === 'checking your account on Optimism'
            ? 'Could not finish the Optimism account check. Check your connection and try again.'
            : 'Your account was found, but the limited key setup could not start. Reload Castonaut and check the saved key before retrying.';
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
    setConnectionStatus('Preparing Castonaut’s limited browser-key authorization…', {
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
      ? 'Confirming your Farcaster account for Castonaut…'
      : walletAccount
        ? 'Confirming your wallet and Farcaster account for Castonaut…'
        : 'Finding the Farcaster account for Castonaut…', {
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
    setConnectionStatus('Authorize Castonaut’s limited browser key. It can post, follow, react, and recast; it cannot move funds.', {
      active: 'approve',
      completed: ['sign'],
      busy: true,
    });
    const scopes = [protocol.MessageType.CAST_ADD, protocol.MessageType.CAST_REMOVE, protocol.MessageType.REACTION_ADD, protocol.MessageType.REACTION_REMOVE, protocol.MessageType.LINK_ADD, protocol.MessageType.LINK_REMOVE];
    const appKeyBytes = resultOrThrow(protocol.hexStringToBytes(publicKey), 'Could not prepare the browser app key');
    // Without a registered Castonaut FID, the core helper creates a valid
    // self-request: requestFid defaults to this user's FID and is signed by
    // the same custody key. Never invent an app FID here.
    const keyBody = resultOrThrow(await protocol.makeKeyAddBody({ fid: BigInt(fid), key: appKeyBytes, scopes, ttl: KEY_TTL_SECONDS, nonce: nonce + 1, deadline }, eip712Signer), 'Could not authorize the app key');
    const message = resultOrThrow(await protocol.makeKeyAdd(keyBody, { fid, network: protocol.FarcasterNetwork.MAINNET }, signer), 'Could not sign key registration');
    const signedRequest = protocol.Message.encode(message).finish();
    await storeSigner({ ...(saved || {}), fid, publicKey, custodyAddress, privateKey, signedKeyAdd: toBase64(signedRequest) });
    try { localStorage.setItem(SIGN_IN_MODE_STORAGE, 'browser'); } catch { /* The browser key remains in IndexedDB if preferences are unavailable. */ }
    void managedAuthRequest('logout', { method: 'POST', body: '{}' }).catch(() => {});
    state.hasPendingKeyAdd = true;
    setConnectionStatus(`Castonaut authorization signed. Sending the app-key request to Snapchain…`, { active: 'approve', completed: ['sign'], busy: true });
    state.following.clear();
    state.followStatusUnknown.clear();
    state.fid = fid;
    state.signerMode = 'browser';
    state.suggestedPeople = [];
    state.suggestionsLoadedFor = 0;
    state.suggestionsError = false;
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
    renderIdentity();
    if (confirmed) {
      refreshSignerFlow = false;
      setConnectionStatus('Account verified. Castonaut is ready.', { active: 'done', completed: ['sign', 'approve', 'done'] });
      setNotice('Your account is ready. Loading your feed…', 'success');
      await loadFeed(fid);
      setTimeout(() => { if ($('#connect-dialog').open) $('#connect-dialog').close(); }, 2200);
    } else {
      setConnectionStatus('The request reached Snapchain, but confirmation is taking longer. Your key is saved here. Check again in a moment; posting stays paused until confirmed.', { active: 'approve', completed: ['sign'], canRetry: true });
      setNotice('Key relayed; merge is still pending. Writes stay locked until the node confirms it.', 'pending');
    }
  } catch (error) {
    if (relayAttempted && error?.status >= 400 && error.status < 500 && error.status !== 429) {
      // Keep the exact signed request. A 4xx can come from a node-side merge
      // failure after the message was accepted; deleting it would force the
      // user back through recovery-phrase authorization and risk new keys.
      state.hasPendingKeyAdd = true;
      state.signerReady = false;
      renderIdentity();
      setConnectionStatus(`Snapchain rejected this authorization (${error.status}). Your app key and signed request are still saved in this browser. Do not enter your recovery phrase again or create another key. Check the saved key, then resume this same request after the node is healthy. ${clientErrorText(error)}`, { active: 'approve', completed: ['sign'], canRetry: true, canResume: true });
    } else if (relayAttempted) {
      state.signerReady = false;
      renderIdentity();
      setConnectionStatus(`The request may have reached the node, but confirmation failed. Your key is saved here. Resume the same request or check its status; don't create another key. ${clientErrorText(error)}`, { active: 'approve', completed: ['sign'], canRetry: true, canResume: state.hasPendingKeyAdd });
    } else setConnectionStatus(clientErrorText(error) || 'Authorization could not start. Reload and try again.', {
      active: pendingWalletAccount || recoveryAccount || walletAccount ? 'approve' : 'sign',
      completed: pendingWalletAccount || recoveryAccount || walletAccount ? ['sign'] : [],
    });
    setNotice(clientErrorText(error) || 'Authorization could not start. Reload and try again.', 'error');
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
    if (!state.fid || !state.publicKey || !state.signer) throw new Error('No saved app key was found in this browser. Start again with your Farcaster recovery phrase.');
    const confirmed = await findSigner(state.fid, state.publicKey);
    state.signerReady = confirmed;
    if (confirmed) await clearPendingRegistration();
    // Public profile data can load while the app signer is pending. Keep the
    // account identity visible even when posting authorization is unavailable.
    await fetchProfile(state.fid).catch(() => null);
    renderIdentity();
    if (confirmed) {
      setConnectionStatus('Account verified. Castonaut is ready.', { active: 'done', completed: ['sign', 'approve', 'done'] });
      setNotice('Your account is ready. Loading your feed…', 'success');
      await loadFeed(state.fid);
    } else {
      setConnectionStatus(state.hasPendingKeyAdd
        ? 'Snapchain does not list this browser key. It is still saved here. Resume the exact saved request first; no phrase or new key is needed.'
        : 'Snapchain does not list this browser key. The rejected request was cleared. You can retry authorization for this same saved key; Farcaster must approve the new request.',
      { active: 'approve', completed: ['sign'], canRetry: true, canResume: state.hasPendingKeyAdd, canRefresh: !state.hasPendingKeyAdd });
    }
  } catch (error) {
    setConnectionStatus(`Could not check the saved key. It remains in this browser. ${error.message}`, { active: 'approve', completed: ['sign'], canRetry: true });
  } finally { button.disabled = false; }
}

async function resumeSavedKeyAdd() {
  const button = $('#resume-signer');
  button.disabled = true;
  setConnectionStatus('Checking the saved request…', { active: 'approve', busy: true });
  try {
    if (!state.fid || !state.publicKey || !state.signer) await restoreSession();
    const saved = await loadSigner();
    if (!saved?.signedKeyAdd || !saved.privateKey || !saved.publicKey) throw new Error('No saved authorization request is available in this browser.');
    state.hasPendingKeyAdd = true;
    const fid = Number(saved.fid);
    if (await findSigner(fid, saved.publicKey)) {
      state.signerReady = true;
      await clearPendingRegistration();
      renderIdentity();
      setConnectionStatus('Account verified. Castonaut is ready.', { active: 'done', completed: ['sign', 'approve', 'done'] });
      setNotice('Your account is ready. Loading your feed…', 'success');
      await loadFeed(fid);
      return;
    }
    const encoded = fromBase64(saved.signedKeyAdd);
    if (!encoded.length || encoded.length > 64 * 1024) throw new Error('The saved request is incomplete. Your app key remains stored here.');
    setConnectionStatus('Resending the exact saved request. No seed phrase is used and no new key is created…', { active: 'approve', busy: true });
    await submitEncodedMessage(encoded);
    const confirmed = await waitForSigner(fid, saved.publicKey, 6, (attempt, total) => {
      setConnectionStatus(`Request accepted. Waiting for confirmation · ${attempt}/${total}`, { active: 'approve', busy: true });
    });
    state.signerReady = confirmed;
    if (confirmed) {
      await clearPendingRegistration();
      await fetchProfile(fid).catch(() => null);
      renderIdentity();
      setConnectionStatus('Account verified. Castonaut is ready.', { active: 'done', completed: ['sign', 'approve', 'done'] });
      setNotice('Your account is ready. Loading your feed…', 'success');
      await loadFeed(fid);
      setTimeout(() => { if ($('#connect-dialog').open) $('#connect-dialog').close(); }, 1500);
    } else {
      setConnectionStatus('Snapchain accepted the saved request but has not confirmed it yet. Check again shortly; the request and key remain saved.', { active: 'approve', canRetry: true, canResume: true });
    }
  } catch (error) {
    const rejected = error?.status >= 400 && error.status < 500 && error.status !== 429;
    // Even a rejected replay is retained: node merge/replica errors can
    // surface as 4xx responses after the signed message reached Snapchain.
    state.hasPendingKeyAdd = true;
    setConnectionStatus(rejected
      ? `Snapchain rejected the saved authorization (${error.status}). The key and exact signed request remain stored here. Do not enter your recovery phrase or create another key. Check again after the node is healthy. ${clientErrorText(error)}`
      : `Could not resume the saved authorization. The same request and key remain in this browser. Try again later. ${clientErrorText(error)}`,
    { active: 'approve', canRetry: true, canResume: true, canRefresh: false });
  } finally { button.disabled = false; }
}

function beginSignerRefresh() {
  refreshSignerFlow = true;
  setConnectionStatus('Approve a fresh registration for the key already saved in this browser. Castonaut will reuse it, not create another key. Verify your Farcaster account again with your recovery phrase if asked.', { active: 'approve', completed: ['sign'] });
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
    try { await nodeRequest(route, params, { fresh: true }); return true; } catch { await new Promise((resolve) => setTimeout(resolve, 1800)); }
  }
  return false;
}

async function waitForRemoval(route, params, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try { await nodeRequest(route, params, { fresh: true }); }
    catch (error) { if (isNotFound(error)) return true; }
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  return false;
}

async function getActiveSigner() {
  if (!state.fid || !state.signer) throw new Error('Connect a Farcaster signer before writing.');
  return state.signer;
}

async function signAndRelay(messageResult, successRoute, successParams, successText) {
  const message = resultOrThrow(messageResult, 'Could not create message');
  // Check the signed message's final state before relaying it. If an earlier
  // request reached Snapchain but the browser lost its response, retrying the
  // same signed message must not make the user guess whether it was published.
  return publishWithConfirmation({
    lookup: async () => {
      try { await nodeRequest(successRoute, successParams, { fresh: true }); }
      catch (error) { if (isNotFound(error)) error.notFound = true; throw error; }
    },
    submit: () => submitMessage(message),
    onStatus: setNotice,
    successText,
    waitForMerge: (tries) => waitForMerge(successRoute, successParams, tries),
  });
}

async function signAndRelayRemoval(messageResult, route, params, successText) {
  const message = resultOrThrow(messageResult, 'Could not create removal message');
  return removeWithConfirmation({
    lookup: async () => {
      try { await nodeRequest(route, params, { fresh: true }); }
      catch (error) { if (isNotFound(error)) error.notFound = true; throw error; }
    },
    submit: () => submitMessage(message),
    onStatus: setNotice,
    successText,
    waitForRemoval: (tries) => waitForRemoval(route, params, tries),
  });
}

function renderIdentity() {
  const empty = $('#identity-empty'); const connected = $('#identity-connected');
  const accountReady = !!state.fid && !!state.signerReady;
  const ready = accountReady;
  const publicProfilePreview = !state.fid && state.feedMode === 'profile' && !!state.feedTargetFid;
  renderDeskStatus();
  renderFeedStatusbar();
  document.body.dataset.accountView = ready ? 'member' : publicProfilePreview ? 'visitor-profile' : accountReady ? 'pending' : 'visitor';
  $('#portal-gate').hidden = accountReady;
  $('#member-workspace').hidden = !ready && !publicProfilePreview;
  const deskGate = $('#desk-guest-gate');
  if (deskGate) deskGate.hidden = currentArea !== 'desk' || ready;
  $('#public-browse-note').hidden = ready || accountReady;
  empty.hidden = !!state.fid; connected.hidden = !state.fid;
  $('#portal-enter').textContent = state.fid && !ready ? 'Check app key status ↻' : 'Connect existing account ↗';
  if (state.sessionRestoring) $('#portal-enter').textContent = 'Checking this browser…';
  $('#portal-enter').disabled = state.sessionRestoring;
  $('#open-account').disabled = state.sessionRestoring;
  const portalStatus = $('#portal-status');
  if (portalStatus) portalStatus.textContent = state.sessionRestoring
    ? 'Checking for your saved sign-in on this device…'
    : state.fid && !ready
    ? 'Account found. Castonaut is checking whether this browser’s social key is confirmed on your node.'
    : state.signerMode === 'neynar' ? 'Connected with a revocable Farcaster signer.' : 'Your existing account is all you need. The next step creates a separate, limited social key.';
  if (!state.fid) {
    $('#avatar-initial').textContent = '?';
    $('#open-account').setAttribute('aria-label', 'Connect your Farcaster account');
    $('#open-account').title = 'Connect your Farcaster account';
    $('#composer').hidden = true;
    return;
  }
  const profile = state.people.get(state.fid) || { fid: state.fid, name: `Farcaster ${state.fid}`, username: `fid-${state.fid}` };
  const shownName = localProfileName(profile);
  $('#avatar-initial').textContent = shownName.slice(0, 1).toUpperCase();
  const profileLabel = `@${profile.username || `fid-${state.fid}`}`;
  $('#open-account').setAttribute('aria-label', state.signerReady ? `Open your profile, ${profileLabel}` : 'Review your connected account');
  $('#open-account').title = state.signerReady ? `Your profile · ${profileLabel}` : 'Review your connected account and signer';
  $('#profile-name').textContent = shownName;
  $('#profile-handle').textContent = `@${profile.username} · FID ${state.fid}`;
  $('#profile-avatar').textContent = profile.name.slice(0, 1).toUpperCase();
  const avatarUrl = safeImageUrl(profile.avatar);
  if (avatarUrl) setRemoteAvatar($('#profile-avatar'), avatarUrl);
  $('#composer').hidden = !ready || state.boardMode === 'flight-log' || (state.feedMode === 'profile' && !state.parent);
  $('#composer-text').disabled = !ready;
  $('#composer button[type="submit"]').disabled = !ready;
  updateDeskNotepadControls();
  document.querySelectorAll('.post-action:not(.pin-action)').forEach((button) => { button.disabled = !state.signerReady; });
}

async function restoreSession() {
  let preferredMode = '';
  try { preferredMode = localStorage.getItem(SIGN_IN_MODE_STORAGE) || ''; } catch { /* Continue with an available authenticated session. */ }
  // Only check a managed session when this browser explicitly selected that
  // legacy mode. A fresh visitor should reach the browser-key flow directly,
  // without waiting on the retired Neynar endpoint.
  // Do not silently switch signers if an explicitly selected legacy session
  // cannot be checked.
  if (preferredMode === 'neynar') {
    try {
      const managed = await managedAuthRequest('me');
      if (managed.signedIn && Number.isSafeInteger(Number(managed.fid)) && Number(managed.fid) > 0) {
        await finishManagedSignIn(Number(managed.fid));
        return;
      }
      if (preferredMode === 'neynar') {
        setNotice('Your managed Farcaster session expired or was revoked. Sign in again to continue.');
        return;
      }
    } catch (error) {
      if (preferredMode === 'neynar') {
        setNotice(`Could not verify your managed Farcaster session. Check your connection and retry. ${error.message}`, 'error');
        return;
      }
    }
  }
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
  if (!saved) return;
  if (!Number.isSafeInteger(Number(saved.fid)) || !saved.privateKey || !saved.publicKey) return;
  state.hasPendingKeyAdd = Boolean(saved.signedKeyAdd);
  state.signerMode = 'browser';
  try { localStorage.setItem(SIGN_IN_MODE_STORAGE, 'browser'); } catch { /* IndexedDB still restores the saved browser key. */ }
  try {
    const publicKeyHex = String(saved.publicKey).replace(/^0x/i, '');
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !saved.privateKey.usages?.includes('sign')) throw new Error('Stored app key has an invalid format.');
    const publicKey = Uint8Array.from(publicKeyHex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
    state.following.clear();
    state.followStatusUnknown.clear();
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
  $('#feed-list').setAttribute('aria-busy', 'true');
  renderEmpty('Restoring your feed…', 'Checking your saved account and loading recent posts.');
  try {
    state.signerReady = await findSigner(state.fid, saved.publicKey);
    if (state.signerReady) await clearPendingRegistration();
  } catch (error) {
    state.signerReady = false;
    setNotice(`Could not confirm the saved app key. Loading your feed in read-only mode. ${error.message}`);
  }
  // Reading the account's feed only needs its FID. Keep the timeline useful
  // while signer approval is pending or unavailable; writes remain locked.
  await fetchProfile(state.fid).catch(() => null);
  renderIdentity();
  if (!state.signerReady) setNotice('This app key is not confirmed on the current node. Your feed is available read-only; posting and reactions are paused.');
  else {
    const restoredName = localProfileName(state.people.get(state.fid) || { username: `fid-${state.fid}` });
    setNotice(`Welcome back, ${restoredName}. Your browser key is ready; loading your timeline…`, 'success');
  }
  await loadFeed(state.fid);
}

async function clearLocalSigner() {
  refreshSignerFlow = false;
  const wasManaged = state.signerMode === 'neynar';
  if (wasManaged) {
    try { await managedAuthRequest('logout', { method: 'POST', body: '{}' }); }
    catch (error) { setNotice(`Could not clear the managed session on this server. ${error.message}`, 'error'); return; }
  } else void managedAuthRequest('logout', { method: 'POST', body: '{}' }).catch(() => {});
  try { localStorage.removeItem(LEGACY_KEY_STORAGE); } catch { /* Continue clearing the current session. */ }
  const cleared = await removeStoredSigner();
  try { localStorage.removeItem(SIGN_IN_MODE_STORAGE); } catch { /* Session cleanup continues if preferences are unavailable. */ }
  state.fid = null; state.signer = null; state.signerMode = 'none'; state.publicKey = ''; state.signerReady = false; state.hasPendingKeyAdd = false; state.custodyAddress = ''; state.boardMode = 'signals'; state.following.clear(); state.followStatusUnknown.clear();
  state.suggestedPeople = []; state.suggestionsLoadedFor = 0; state.suggestionsError = false; state.suggestionsBusy = false; renderSuggestedPeople();
  state.feedRequest += 1; state.feedPending = null; state.casts = []; state.feedTargetFid = null; state.feedMode = 'following';
  state.savedCasts = []; renderFlightLogCount();
  updateFeedTabs(); $('#page-label').textContent = 'FEED';
  $('#feed-title').textContent = 'Following'; $('#feed-caption').textContent = 'Sign in to open your feed.';
  $('#feed-filters').hidden = true; $('#feed-pulse').hidden = true; $('#profile-summary').hidden = true; $('#feed-count').textContent = '0 POSTS';
      renderEmpty('Account disconnected.', 'Sign in to open your feed.');
  renderIdentity();
  if (!cleared) { setNotice('This session is signed out, but browser storage could not delete the app key. Revoke it in Farcaster account settings and clear this site’s browser data.', 'error'); return; }
  setNotice(wasManaged ? 'Castonaut signed out on this device. Revoke its signer separately in Farcaster settings.' : 'This browser forgot its signing key. The Farcaster signer remains active until you revoke it from account settings or it expires.', 'pending');
}

function updatePrimaryNav(selection = '') {
  const ownProfile = !!state.signerReady && state.feedMode === 'profile' && Number(state.feedTargetFid) === Number(state.fid);
  const activeView = selection || (ownProfile ? 'profile' : currentArea);
  document.querySelectorAll('[data-view]').forEach((link) => {
    const active = link.dataset.view === activeView;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const shellMenu = document.querySelector('.site-menu-more');
  const shellItems = [...document.querySelectorAll('.site-menu-more [data-shell-view]')];
  for (const item of shellItems) {
    const active = item.dataset.shellView === activeView;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  const savedItem = document.querySelector('.site-menu-more [data-shell-saved]');
  const savedActive = currentArea === 'feed' && state.boardMode === 'flight-log';
  if (savedItem) {
    savedItem.classList.toggle('active', savedActive);
    if (savedActive) savedItem.setAttribute('aria-current', 'page'); else savedItem.removeAttribute('aria-current');
  }
  if (shellMenu) shellMenu.dataset.active = String(savedActive || shellItems.some((item) => item.classList.contains('active')));
  updateFeedDestinationNav();
  document.querySelectorAll('.site-header [data-site-link="about"]').forEach((link) => {
    if (currentArea === 'node') link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function navigate(view, { preserveHash = false, restoreScroll = true } = {}) {
  const profileView = view === 'profile';
  const area = ['node', 'tools'].includes(view) ? view : ['desk', 'search'].includes(view) ? view : 'feed';
  const target = ['node', 'tools'].includes(area) ? area : 'desk';
  if (area !== currentArea && currentArea !== 'node') areaScroll.set(currentArea, window.scrollY);
  currentArea = area;
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== target; });
  document.querySelectorAll('[data-area]').forEach((panel) => { panel.hidden = panel.dataset.area !== area; });
  const deskGate = $('#desk-guest-gate');
  if (deskGate) deskGate.hidden = area !== 'desk' || (!!state.fid && !!state.signerReady);
  updatePrimaryNav(profileView ? 'profile' : area);
  if (area === 'search') {
    renderSuggestedPeople();
    if (state.signerReady) loadSuggestedPeople();
  }
  $('#page-label').textContent = area === 'node' ? 'NODE' : area === 'tools' ? 'PLAY & TOOLS' : area === 'desk' ? 'DESK' : area === 'search' ? 'SEARCH' : profileView || state.feedMode === 'profile' ? 'PROFILE' : state.boardMode === 'flight-log' ? 'SAVED' : 'FEED';
  const expectedHash = profileView && state.fid ? `#profile=${Number(state.fid)}` : area === 'node' ? '#about' : area === 'tools' ? '#play-tools' : area === 'desk' ? '#my-desk' : area === 'search' ? '#people-search' : '#feed';
  if (!preserveHash && location.hash !== expectedHash) history.pushState(null, '', expectedHash);
  trackPageview(profileView ? 'profile' : area);
  if (area === 'node') {
    if (!state.nodeInfo) checkNode();
    $('#node-view').scrollIntoView({ block: 'start' });
  }
  else if (restoreScroll) requestAnimationFrame(() => window.scrollTo(0, areaScroll.get(area) || 0));
}

function applyLocationRoute() {
  if (!/^#cast=\d+\/0x[\da-f]{40,64}$/i.test(location.hash) && state.conversation) closeConversation({ updateRoute: false });
  if (location.hash === '#node' || location.hash === '#about') { navigate('node', { preserveHash: true }); return; }
  if (location.hash === '#play-tools') { navigate('tools', { preserveHash: true }); return; }
  if (location.hash === '#my-desk') { navigate('desk', { preserveHash: true }); return; }
  if (location.hash === '#people-search' || location.hash === '#search') {
    navigate('search', { preserveHash: true });
    requestAnimationFrame(() => $('#people-query')?.focus({ preventScroll: true }));
    return;
  }
  const profile = location.hash.match(/^#profile=(\d{1,15})$/);
  if (profile) {
    const fid = Number(profile[1]);
    const isOwnProfile = !!state.signerReady && fid === Number(state.fid);
    navigate(isOwnProfile ? 'profile' : 'feed', { preserveHash: true });
    if (state.boardMode !== 'signals') setBoardMode('signals');
    loadFeed(fid, 'profile');
    return;
  }
  navigate('feed', { preserveHash: true });
  const cast = location.hash.match(/^#cast=(\d{1,15})\/(0x[\da-f]{40,64})$/i);
  if (cast && state.signerReady) openConversation(Number(cast[1]), cast[2], { updateRoute: false });
  else if ((!location.hash || location.hash === '#desk') && state.signerReady && (state.feedMode !== 'following' || state.boardMode !== 'signals')) {
    if (state.boardMode !== 'signals') setBoardMode('signals');
    loadFeed(state.fid, 'following');
  }
}

function castBody(text, parent, protocol, embeds = [], linkText = text, quoteCast = null) {
  if (utf8ByteLength(text) > CAST_LIMIT) throw new Error(`This cast is over Farcaster’s ${CAST_LIMIT}-byte limit.`);
  const embedUrls = castEmbedUrls(linkText, embeds, { limit: CAST_EMBED_LIMIT, maxUrlBytes: CAST_EMBED_URL_LIMIT });
  if (embeds.length > CAST_EMBED_LIMIT || embeds.some((url) => utf8ByteLength(url) > CAST_EMBED_URL_LIMIT)) {
    throw new Error(`Farcaster allows up to ${CAST_EMBED_LIMIT} embeds, each no longer than ${CAST_EMBED_URL_LIMIT} UTF-8 bytes.`);
  }
  if (quoteCast && (!Number.isSafeInteger(Number(quoteCast.fid)) || Number(quoteCast.fid) <= 0 || !/^0x[\da-f]{40}$/i.test(quoteCast.hash || ''))) throw new Error('This cast cannot be quoted because its Farcaster ID is invalid.');
  if (embedUrls.length + Number(!!quoteCast) > CAST_EMBED_LIMIT) throw new Error(`Farcaster allows up to ${CAST_EMBED_LIMIT} embeds per cast. Remove a link or attachment to quote this post.`);
  const castEmbeds = embedUrls.map((url) => ({ url }));
  if (quoteCast) castEmbeds.push({ castId: { fid: Number(quoteCast.fid), hash: resultOrThrow(protocol.hexStringToBytes(quoteCast.hash), 'Could not read the quoted cast hash') } });
  const body = { text, type: castTypeForText(text, protocol.CastType), embeds: castEmbeds, embedsDeprecated: [], mentions: [], mentionsPositions: [] };
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
    text: truncateUtf8($('#composer-text').value),
    mediaUrl: $('#composer-media-url').value.trim().slice(0, 2048),
    parent: state.parent && { fid: Number(state.parent.fid), hash: String(state.parent.hash).slice(0, 66) },
    quoteCast: state.quoteCast && { fid: Number(state.quoteCast.fid), hash: String(state.quoteCast.hash) },
    root: state.threadRoot && { fid: Number(state.threadRoot.fid), hash: String(state.threadRoot.hash).slice(0, 66) },
    items: state.threadItems.slice(0, 10).map((text) => truncateUtf8(text)),
    pending: state.threadPending && (state.threadPending.managed || state.threadPending.encoded?.length <= 100_000) ? state.threadPending : null,
    pendingCast: state.pendingCast && (state.pendingCast.managed || state.pendingCast.encoded?.length <= 100_000) ? state.pendingCast : null,
  };
  try {
    localStorage.setItem(`${COMPOSE_STORAGE}:${state.fid}`, JSON.stringify(draft));
    $('#draft-discard').hidden = !(draft.text.trim() || draft.mediaUrl || draft.quoteCast || draft.pendingCast || selectedPhotoFile);
    if (status) status.textContent = draft.pendingCast ? (draft.pendingCast.managed ? 'Post request saved on this device; resume it safely.' : 'Signed post saved on this device; resume it to confirm.') : 'Draft saved on this device.';
  } catch { if (status) status.textContent = 'Draft could not be saved in this browser.'; }
}

function setComposerExpanded(expanded, { focus = false } = {}) {
  const composer = $('#composer');
  const toggle = $('#composer-toggle');
  if (!composer || !toggle) return;
  const open = Boolean(expanded);
  composer.classList.toggle('is-expanded', open);
  toggle.setAttribute('aria-expanded', String(open));
  const title = toggle.querySelector('.composer-toggle-title');
  if (title) title.textContent = state.pendingCast && !open ? (state.pendingCast.managed ? 'Post waiting to resume' : 'Signed post waiting for confirmation') : 'Write a cast';
  const reviewPending = $('#composer-review-pending');
  if (reviewPending) reviewPending.hidden = !state.pendingCast || open;
  const mark = toggle.querySelector('.composer-toggle-mark');
  if (mark) mark.textContent = open ? '−' : '＋';
  if (focus && open) focusComposerInput();
}

function focusComposerInput() {
  const field = $('#composer-text');
  if (!field) return;
  const touchInput = matchMedia('(pointer: coarse)').matches;
  // Keep mobile focus in the original tap gesture so iOS and Android open the
  // software keyboard. A smooth scroll immediately after focus can dismiss it.
  field.focus({ preventScroll: !touchInput });
  if (!touchInput) $('#composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function restoreComposerDraft(fid) {
  state.parent = null; state.quoteCast = null; state.threadRoot = null; state.threadItems = []; state.threadPending = null; state.pendingCast = null;
  setPendingCastControls(false);
  setComposerSubmitLabel('Post');
  try {
    const saved = JSON.parse(localStorage.getItem(`${COMPOSE_STORAGE}:${fid}`) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.text === 'string') $('#composer-text').value = truncateUtf8(saved.text);
      if (typeof saved.mediaUrl === 'string') { $('#composer-media-url').value = safeExternalUrl(saved.mediaUrl)?.href || ''; $('#composer-media').hidden = !$('#composer-media-url').value; }
      const validParent = (value) => value && Number.isSafeInteger(Number(value.fid)) && Number(value.fid) > 0 && /^0x[\da-f]{40,64}$/i.test(value.hash);
      if (validParent(saved.parent)) state.parent = { fid: Number(saved.parent.fid), hash: saved.parent.hash };
      if (saved.quoteCast && Number.isSafeInteger(Number(saved.quoteCast.fid)) && Number(saved.quoteCast.fid) > 0 && /^0x[\da-f]{40}$/i.test(saved.quoteCast.hash || '')) state.quoteCast = { fid: Number(saved.quoteCast.fid), hash: saved.quoteCast.hash };
      if (validParent(saved.root)) state.threadRoot = { fid: Number(saved.root.fid), hash: saved.root.hash };
      if (Array.isArray(saved.items)) state.threadItems = saved.items.filter((text) => typeof text === 'string' && text.trim()).slice(0, 10).map((text) => truncateUtf8(text));
      const validManagedPending = (pending) => pending?.managed === true && /^[a-zA-Z0-9_-]{12,64}$/.test(pending.idem || '') && typeof pending.text === 'string' && typeof pending.bodyText === 'string';
      if (validManagedPending(saved.pending)) {
        state.threadPending = { managed: true, idem: saved.pending.idem, text: truncateUtf8(saved.pending.text), bodyText: truncateUtf8(saved.pending.bodyText), parent: validParent(saved.pending.parent) ? { fid: Number(saved.pending.parent.fid), hash: saved.pending.parent.hash } : null };
        if (!state.threadItems.length) { state.threadItems = [state.threadPending.text]; state.threadRoot = state.parent; }
      } else if (saved.pending && typeof saved.pending === 'object' && /^0x[\da-f]{40,64}$/i.test(saved.pending.hash) && typeof saved.pending.encoded === 'string' && saved.pending.encoded.length <= 100_000 && typeof saved.pending.text === 'string') {
        state.threadPending = { hash: saved.pending.hash, encoded: saved.pending.encoded, text: truncateUtf8(saved.pending.text) };
        if (!state.threadItems.length) { state.threadItems = [state.threadPending.text]; state.threadRoot = state.parent; }
      }
      if (validManagedPending(saved.pendingCast) && utf8ByteLength(saved.pendingCast.text) <= CAST_USER_LIMIT && typeof saved.pendingCast.mediaUrl === 'string' && saved.pendingCast.mediaUrl.length <= 2048) {
        state.pendingCast = { managed: true, idem: saved.pendingCast.idem, text: truncateUtf8(saved.pendingCast.text), bodyText: truncateUtf8(saved.pendingCast.bodyText), mediaUrl: safeExternalUrl(saved.pendingCast.mediaUrl)?.href || '', parent: validParent(saved.pendingCast.parent) ? { fid: Number(saved.pendingCast.parent.fid), hash: saved.pendingCast.parent.hash } : null };
      } else if (saved.pendingCast && typeof saved.pendingCast === 'object' && /^0x[\da-f]{40,64}$/i.test(saved.pendingCast.hash) && typeof saved.pendingCast.encoded === 'string' && /^[A-Za-z0-9+/]+=*$/.test(saved.pendingCast.encoded) && saved.pendingCast.encoded.length > 0 && saved.pendingCast.encoded.length <= 100_000 && typeof saved.pendingCast.text === 'string' && utf8ByteLength(saved.pendingCast.text) <= CAST_USER_LIMIT && typeof saved.pendingCast.mediaUrl === 'string' && saved.pendingCast.mediaUrl.length <= 2048) {
        try {
          if (toBase64(fromBase64(saved.pendingCast.encoded)) === saved.pendingCast.encoded) state.pendingCast = { hash: saved.pendingCast.hash, encoded: saved.pendingCast.encoded, text: saved.pendingCast.text, mediaUrl: safeExternalUrl(saved.pendingCast.mediaUrl)?.href || '' };
        } catch { /* Corrupt pending data is ignored; keep the editable draft text. */ }
      }
    }
  } catch { /* An invalid or unavailable local draft never blocks sign-in. */ }
  $('#char-count').textContent = `${utf8ByteLength($('#composer-text').value)} / ${CAST_USER_LIMIT} bytes`;
  renderComposerQuote();
  $('#composer-label').textContent = state.quoteCast ? 'Quote cast · add a thought' : state.parent ? `Reply to ${profileLabel(state.people.get(Number(state.parent.fid)), state.parent.fid)}` : 'Write a cast';
  $('#composer-text').placeholder = state.parent ? `Replying to ${profileLabel(state.people.get(Number(state.parent.fid)), state.parent.fid)}…` : state.quoteCast ? 'Add a thought about this cast…' : 'What’s on your mind?';
  $('#draft-discard').hidden = !($('#composer-text').value.trim() || $('#composer-media-url').value || state.quoteCast || state.pendingCast);
  if (state.pendingCast) {
    $('#composer-text').value = state.pendingCast.text;
    $('#composer-media-url').value = state.pendingCast.mediaUrl;
    $('#composer-media').hidden = !state.pendingCast.mediaUrl;
    setPendingCastControls(true);
    setComposerSubmitLabel('Resume saved post');
    $('#draft-status').textContent = state.pendingCast.managed ? 'A post request is saved here. Resume it to safely retry the same request.' : 'A signed post is waiting for confirmation. Resume it to avoid creating a duplicate.';
  }
  setComposerExpanded(Boolean(!state.pendingCast && ($('#composer-text').value.trim() || $('#composer-media-url').value.trim() || state.quoteCast || state.threadItems.length || state.threadPending)));
  renderThreadDraft();
}

function clearCurrentDraft() {
  $('#composer-text').value = '';
  $('#composer-media-url').value = '';
  clearSelectedPhoto();
  $('#composer-media').hidden = true;
  setPendingCastControls(false);
  $('#char-count').textContent = `0 / ${CAST_USER_LIMIT} bytes`;
  state.parent = null;
  state.quoteCast = null;
  state.pendingCast = null;
  renderComposerQuote();
  $('#composer-label').textContent = 'Write a cast';
  $('#composer-text').placeholder = 'What’s on your mind?';
  $('#draft-discard').hidden = true;
  setComposerExpanded(false);
  saveComposerDraft();
}

function setPendingCastControls(pending) {
  $('#composer-text').readOnly = pending;
  $('#composer-media-url').disabled = pending;
  $('#composer-image-file').disabled = pending;
  $('#composer')?.querySelectorAll('button').forEach((button) => {
    if (button.type === 'submit' || button.id === 'draft-discard' || button.id === 'composer-toggle' || button.id === 'composer-review-pending') return;
    button.disabled = pending;
  });
  const submit = $('#composer-submit');
  if (submit && !pending) submit.disabled = !state.signerReady;
  updatePhotoUploadControls(pending);
}

function setComposerSubmitLabel(label) {
  const submit = $('#composer-submit');
  if (!submit) return;
  const compactResume = label === 'Resume saved post' && matchMedia('(max-width: 380px)').matches;
  submit.textContent = compactResume ? 'Resume' : label;
  if (compactResume) submit.setAttribute('aria-label', label);
  else submit.removeAttribute('aria-label');
}

async function publishPendingCast(pending) {
  if (pending.managed) {
    const result = await managedWrite({
      action: 'cast', idem: pending.idem, text: pending.bodyText,
      embeds: pending.mediaUrl ? [pending.mediaUrl] : [],
      ...(pending.parent ? { parent: managedParentHash(pending.parent), parent_author_fid: pending.parent.fid } : {}),
    });
    const hash = result.cast?.hash || result.hash;
    if (!/^0x[\da-f]{40,64}$/i.test(String(hash || ''))) throw new Error('Neynar accepted the request but returned no cast hash. Resume the saved post to retry safely.');
    setNotice('Post accepted by Farcaster through Neynar. Your Snapchain node may take a moment to show it.', 'success');
    return;
  }
  const params = { fid: state.fid, hash: pending.hash };
  try {
    await nodeRequest('castById', params);
  } catch (error) {
    if (!isNotFound(error)) throw error;
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
  const button = $('#thread-publish');
  state.threadBusy = true; button.setAttribute('aria-busy', 'true'); $('#thread-draft')?.setAttribute('aria-busy', 'true'); renderThreadDraft();
  let confirmed = 0;
  try {
    const managed = state.signerMode === 'neynar';
    const protocol = managed ? null : await import('./protocol.js');
    const signer = managed ? null : await getActiveSigner();
    while (state.threadItems.length) {
      let pending = state.threadPending;
      if (!pending) {
        const text = state.threadItems[0];
        const parent = state.threadRoot;
        const attributedText = withCastonautAttribution(text);
        if (managed) pending = { managed: true, idem: crypto.randomUUID().replaceAll('-', '').slice(0, 24), text, bodyText: attributedText, parent };
        else {
          const result = await protocol.makeCastAdd(castBody(attributedText, parent, protocol), { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, signer);
          const signed = resultOrThrow(result, 'Could not sign thread post');
          const hash = postHash(signed);
          if (!/^0x[\da-f]{40,64}$/i.test(hash)) throw new Error('Could not verify the signed post hash. The draft remains saved.');
          pending = { hash, encoded: toBase64(protocol.Message.encode(signed).finish()), text };
        }
        state.threadPending = pending; saveComposerDraft();
      }
      if (pending.managed) {
        const result = await managedWrite({ action: 'cast', idem: pending.idem, text: pending.bodyText, embeds: [], ...(pending.parent ? { parent: managedParentHash(pending.parent), parent_author_fid: pending.parent.fid } : {}) });
        pending.hash = String(result.cast?.hash || result.hash || '');
        if (!/^0x[\da-f]{40,64}$/i.test(pending.hash)) throw new Error('Neynar accepted the request but returned no cast hash. Resume the saved thread to retry safely.');
      } else {
        const params = { fid: state.fid, hash: pending.hash };
        try { await nodeRequest('castById', params); }
        catch (error) {
          if (!isNotFound(error)) throw error;
          await submitEncodedMessage(fromBase64(pending.encoded));
          setNotice('Thread post relayed. Waiting for Snapchain confirmation…', 'pending');
          if (!await waitForMerge('castById', params)) throw new Error('This post was relayed but is not confirmed yet. Resume the thread to check it safely.');
        }
      }
      state.threadRoot = { fid: state.fid, hash: pending.hash };
      state.threadItems.shift(); state.threadPending = null; confirmed += 1;
      saveComposerDraft(); renderThreadDraft();
      $('#thread-draft-status').textContent = `${confirmed} post${confirmed === 1 ? '' : 's'} confirmed. Remaining posts are saved on this device.`;
    }
    state.threadRoot = null;
    saveComposerDraft(); renderThreadDraft();
    $('#thread-draft-status').textContent = 'Thread confirmed on Snapchain.';
    setNotice(state.signerMode === 'neynar' ? 'Thread accepted by Farcaster through Neynar.' : 'Thread confirmed on Snapchain.', 'success');
    await loadFeed(state.fid, 'following');
  } catch (error) {
    $('#thread-draft-status').textContent = `${confirmed ? `${confirmed} post${confirmed === 1 ? '' : 's'} confirmed. ` : ''}${clientErrorText(error)} Your remaining thread is saved; resume to check the last post and continue.`;
    setNotice(clientErrorText(error), 'error');
  } finally {
    state.threadBusy = false; button.removeAttribute('aria-busy'); $('#thread-draft')?.removeAttribute('aria-busy'); renderThreadDraft(); button.disabled = !state.signerReady || !state.threadItems.length;
  }
}

$('#feed-refresh').addEventListener('click', () => {
  const button = $('#feed-refresh');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  clearSnapchainReadCache();
  const task = state.conversation
    ? openConversation(state.conversation.fid, state.conversation.hash, { updateRoute: false, fresh: true })
    : state.boardMode === 'flight-log' ? Promise.resolve(renderFeed()) : loadFeed(state.feedTargetFid || state.fid, state.feedMode, { fresh: true });
  Promise.resolve(task).finally(() => { button.disabled = false; button.removeAttribute('aria-busy'); });
});
$('#top-people-drawer')?.addEventListener('toggle', () => {
  if (!$('#top-people-drawer').open) return;
  renderTopPeopleDrawer();
  if (state.curatedTopAccounts.length < CURATED_TOP_ACCOUNTS.length) void ensureCuratedTopAccounts();
});
$('#top-people-search')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const field = $('#top-people-query');
  const status = $('#top-people-search-status');
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  const query = field.value.trim();
  status.hidden = false;
  status.dataset.state = 'loading';
  status.textContent = 'Looking up that Farcaster account…';
  submit.disabled = true;
  try {
    const fid = await resolveProfileFid(query);
    if (Number(fid) === Number(state.fid)) throw new Error('Your active account is already in this feed.');
    const profile = await fetchProfile(fid);
    if (state.friendFids.includes(Number(fid))) {
      status.dataset.state = 'success';
      status.textContent = `${profile?.username ? `@${profile.username}` : `FID ${fid}`} is already in your Top people picks.`;
    } else if (state.friendFids.length >= 36) {
      throw new Error('Your local Top people list has reached 36 accounts. Remove a pick before adding another.');
    } else {
      const saved = writeFidList(FRIENDS_STORAGE, [...state.friendFids, fid]);
      if (!saved?.includes(Number(fid))) throw new Error('This browser could not save that Top people pick.');
      state.friendFids = saved;
      field.value = '';
      status.dataset.state = 'success';
      status.textContent = `Added ${profile?.username ? `@${profile.username}` : `FID ${fid}`} to Top people on this device.`;
      updateFeedTabs();
      if (state.feedMode === 'friends') await loadFeed(state.fid, 'friends');
      else renderFeed();
    }
    renderTopPeopleDrawer();
  } catch (error) {
    status.dataset.state = 'error';
    status.textContent = error?.message || 'Could not find that Farcaster account. Check the username or FID and try again.';
  } finally { submit.disabled = false; }
});
$('#feed-status-node')?.addEventListener('click', () => { navigate('node'); void checkNode(); });
$('#feed-more')?.addEventListener('click', () => state.feedMode === 'profile' ? loadOlderProfilePosts() : loadMoreFollowed());
$('#show-suggested')?.addEventListener('click', toggleSuggestedPeople);
$('#suggested-close')?.addEventListener('click', toggleSuggestedPeople);
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
$('#network-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); void searchNetwork($('#network-search-query').value); });
$('#network-search-more')?.addEventListener('click', () => {
  if (state.networkSearchKind === 'channels' && state.networkSearchCursor) void searchNetwork(state.networkSearchQuery, { append: true });
  else if (state.networkSearchKind === 'casts' && state.feedMode === 'following') {
    void loadMoreFollowed({ automatic: false }).then(() => searchNetwork(state.networkSearchQuery));
  }
});
$('.network-search-tabs')?.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-network-search-kind]');
  if (tab) setNetworkSearchKind(tab.dataset.networkSearchKind);
});
$('.network-search-tabs')?.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-network-search-kind]')];
  const current = Math.max(0, tabs.indexOf(document.activeElement));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[next]?.focus(); setNetworkSearchKind(tabs[next]?.dataset.networkSearchKind);
});
$('#search-examples')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-profile-example]');
  if (button) {
    $('#people-query').value = button.dataset.profileExample;
    searchProfile(button.dataset.profileExample);
    return;
  }
  const findMore = event.target.closest('[data-directory-search]');
  if (findMore) {
    const input = $('#people-query');
    input.placeholder = `Search ${findMore.dataset.directorySearch} by username or FID`;
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
$('#desk-add-person')?.addEventListener('submit', (event) => { event.preventDefault(); addDeskPerson($('#desk-person-query').value); });
$('#my-desk')?.addEventListener('change', (event) => {
  const select = event.target.closest('[data-desk-sort]');
  if (!select) return;
  const options = DESK_SORT_VALUES;
  const stack = select.dataset.deskSort;
  if (!options[stack]?.includes(select.value)) return;
  state.deskSort[stack] = select.value;
  try { localStorage.setItem(DESK_SORT_STORAGE, JSON.stringify(state.deskSort)); } catch { /* Sorting still applies for this visit. */ }
  if (stack === 'people') renderDesk(); else renderDeskShortcuts();
});
$('#desk-atlas')?.addEventListener('toggle', () => { if ($('#desk-atlas')?.open) renderDeskAtlas(); });
document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('[data-desk-cast-label]')) {
    updateDeskCastAnnotation(target.dataset.fid, target.dataset.hash, 'label', target.value);
    const note = target.closest('.desk-cast-annotations')?.querySelector('[data-desk-cast-note]')?.value.trim();
    const summary = target.closest('.desk-cast-annotations')?.querySelector('summary');
    if (summary) summary.textContent = target.value || note ? `${target.value || 'Private note'} · edit` : 'Add a private note or label';
  } else if (target.matches('[data-desk-cast-note]')) {
    updateDeskCastAnnotation(target.dataset.fid, target.dataset.hash, 'note', target.value);
    const label = target.closest('.desk-cast-annotations')?.querySelector('[data-desk-cast-label]')?.value;
    const summary = target.closest('.desk-cast-annotations')?.querySelector('summary');
    if (summary) summary.textContent = label || target.value.trim() ? `${label || 'Private note'} · edit` : 'Add a private note or label';
  }
});
const deskNotepad = $('#desk-notepad-text');
if (deskNotepad) {
  try { deskNotepad.value = localStorage.getItem(DESK_NOTEPAD_STORAGE) || ''; } catch { /* The scratchpad remains usable for this visit. */ }
  deskNotepad.addEventListener('input', () => {
    const status = $('#desk-notepad-status');
    try {
      localStorage.setItem(DESK_NOTEPAD_STORAGE, deskNotepad.value.slice(0, 4000));
      if (status) status.textContent = 'Saved only in this browser.';
    } catch {
      if (status) status.textContent = 'Browser storage is full; this edit may not be saved.';
    }
    updateDeskNotepadControls();
  });
  $('#desk-note-clear')?.addEventListener('click', () => {
    deskNotepad.value = '';
    deskNotepad.dispatchEvent(new Event('input', { bubbles: true }));
    deskNotepad.focus();
  });
  $('#desk-note-to-cast')?.addEventListener('click', () => {
    const note = deskNotepad.value.trim();
    if (!note || !state.signerReady) return;
    const composer = $('#composer-text');
    composer.value = [composer.value.trim(), note].filter(Boolean).join('\n\n');
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    navigate('feed');
    composer.focus({ preventScroll: true });
    composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setNotice('Copied to the composer. Review it before posting.', 'success');
  });
  updateDeskNotepadControls();
}
$('#desk-activity-list')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-desk-activity-refresh]');
  if (button) await loadDeskActivity(button);
});
$('#feed-search-launch')?.addEventListener('submit', (event) => { event.preventDefault(); searchLoadedFeed($('#feed-search-query').value); });
$('#search-network-refresh')?.addEventListener('click', () => {
  if (!state.signerReady) { setNotice('Sign in to discover people through your follows.', 'pending'); return; }
  state.suggestionsLoadedFor = 0;
  loadSuggestedPeople();
});
$('#conversation-close').addEventListener('click', closeConversation);
$('#conversation-retry').addEventListener('click', () => {
  const conversation = state.conversation;
  if (conversation) void openConversation(conversation.fid, conversation.hash, { updateRoute: false, fresh: true });
});
$('#conversation-load-more').addEventListener('click', loadMoreConversationReplies);
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
    if (event.currentTarget.checked) trackPageview('about');
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
document.querySelector('[data-saved-feed]')?.addEventListener('click', (event) => {
  event.preventDefault();
  navigate('feed');
  setBoardMode('flight-log');
  document.querySelector('.nav-more')?.removeAttribute('open');
});
$('#show-recent')?.addEventListener('click', () => selectFeedSort('recent'));
$('#show-popular')?.addEventListener('click', () => selectFeedSort('popular'));
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
  document.querySelectorAll('.nav-more[open]').forEach((menu) => { menu.open = false; });
  if (link.dataset.view === 'profile') {
    if (!state.signerReady || !state.fid) { openConnectDialog(); return; }
    state.parent = null;
    if (state.boardMode !== 'signals') setBoardMode('signals');
    navigate('profile', { restoreScroll: false });
    loadFeed(state.fid, 'profile');
    return;
  }
  navigate(link.dataset.view);
  if (link.dataset.view === 'search') requestAnimationFrame(() => $('#people-query')?.focus({ preventScroll: true }));
  if (link.dataset.view === 'feed' && state.signerReady && (state.feedMode !== 'following' || state.boardMode !== 'signals')) {
    if (state.boardMode !== 'signals') setBoardMode('signals');
    loadFeed(state.fid, 'following');
  }
}));
async function openFeedDestination(destination) {
  navigate('feed', { restoreScroll: false });
  if (destination === 'following' && !state.fid) {
    setNotice('Connect a Farcaster account to load your Following feed. Here is a sample timeline.', 'pending');
    requestAnimationFrame(() => $('#client-preview')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
    return;
  }
  if (destination === 'discover') {
    if (state.boardMode !== 'signals') setBoardMode('signals');
    if (state.feedMode === 'profile') await loadFeed(state.fid, 'following');
    toggleSuggestedPeople();
    return;
  }
  setFeedTab(destination);
}
document.querySelectorAll('[data-feed-destination]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  void openFeedDestination(link.dataset.feedDestination);
}));
$('#desk-signin')?.addEventListener('click', openConnectDialog);
document.querySelectorAll('[data-scroll-to]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  const destination = link.dataset.scrollTo;
  navigate(destination === 'people-search' ? 'search' : destination === 'client-preview' ? 'feed' : 'desk', { preserveHash: true, restoreScroll: false });
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
window.addEventListener('popstate', applyLocationRoute);
async function shareOrCopyLink(url, { title, text, copiedMessage } = {}) {
  const shareData = { title: String(title || 'Castonaut'), text: String(text || ''), url: String(url) };
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(shareData);
      setNotice('Shared.', 'success');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(shareData.url);
    setNotice(`${copiedMessage || 'Link'} copied.`, 'success');
  } catch {
    setNotice(shareData.url, 'pending');
  }
}

document.addEventListener('click', async (event) => {
  const composeButton = event.target.closest('[data-compose-cast]');
  if (composeButton) {
    if (state.sessionRestoring) {
      setNotice('Checking this browser for your saved Farcaster account. Try Write again in a moment.', 'pending');
      return;
    }
    if (!state.signerReady) { openConnectDialog(); return; }
    navigate('feed', { restoreScroll: false });
    if (state.boardMode !== 'signals') setBoardMode('signals');
    setComposerExpanded(true, { focus: true });
    // Feed refreshes can wait on the node. Keep the button responsive by
    // opening the composer first and refreshing the timeline in the background.
    void loadFeed(state.fid, 'following');
    return;
  }
  const deskButton = event.target.closest('[data-desk-fid]');
  if (!deskButton) return;
  const fid = Number(deskButton.dataset.deskFid);
  navigate('feed');
  setProfileRoute(fid);
  if (state.boardMode !== 'signals') setBoardMode('signals');
  await loadFeed(fid, 'profile');
});
async function refreshSourceFilter() {
  if (Number($('#source-fid').value) > 0) await loadSignerSources(state.casts);
  renderFeed();
}
$('#source-fid').addEventListener('change', refreshSourceFilter);
$('#source-mode').addEventListener('change', refreshSourceFilter);
$('#loaded-search')?.addEventListener('input', (event) => {
  state.feedQuery = event.currentTarget.value.slice(0, 100);
  renderFeed();
});
function clearFeedFilters() {
  state.feedQuery = '';
  state.activeDeskTopic = '';
  state.repliesOnly = false; state.mediaOnly = false; state.appsOnly = false; state.orbitOnly = false;
  $('#loaded-search').value = ''; $('#filter-replies').checked = false; $('#filter-media').checked = false;
  $('#filter-apps').checked = false; $('#orbit-only').checked = false; $('#source-fid').value = ''; $('#source-mode').value = 'include';
  saveFeedOptions(); renderDeskShortcuts(); renderFeed();
}
$('#clear-feed-filters')?.addEventListener('click', clearFeedFilters);
$('#group-repeats').checked = state.groupRepeats;
$('#group-repeats').addEventListener('change', (event) => {
  state.groupRepeats = event.currentTarget.checked;
  try { localStorage.setItem(REPEAT_GROUPING_STORAGE, String(state.groupRepeats)); } catch { /* The preference still applies for this visit. */ }
  syncQuickControls();
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
$('#feed-filters')?.addEventListener('change', (event) => {
  const setting = event.target.dataset.quickSetting;
  if (!setting) return;
  if (setting === 'remoteMediaEnabled') { setRemoteMediaEnabled(event.target.checked); return; }
  const paired = { compactMode: '#compact-mode', repliesOnly: '#filter-replies', mediaOnly: '#filter-media', appsOnly: '#filter-apps', groupRepeats: '#group-repeats' }[setting];
  const target = paired ? $(paired) : null;
  if (target && target !== event.target) { target.checked = event.target.checked; target.dispatchEvent(new Event('change', { bubbles: true })); }
  syncQuickControls();
});
syncQuickControls();
document.addEventListener('change', (event) => {
  const coverSelect = event.target.closest('[data-cover-fid]');
  if (!coverSelect) return;
  setProfileCover(Number(coverSelect.dataset.coverFid), coverSelect.value);
});
function setRemoteMediaEnabled(enabled) {
  state.remoteMediaEnabled = Boolean(enabled);
  try { localStorage.setItem(REMOTE_MEDIA_STORAGE, String(state.remoteMediaEnabled)); } catch { /* Apply for this page even if preferences cannot be saved. */ }
  if (!state.remoteMediaEnabled) {
    document.querySelectorAll('video').forEach((video) => { video.pause(); video.removeAttribute('src'); video.load(); });
    document.querySelectorAll('img.remote-image').forEach((image) => image.removeAttribute('src'));
  }
  renderFeed(); renderDesk(); renderProfileSummary(); renderIdentity(); renderSuggestedPeople();
  setNotice(state.remoteMediaEnabled ? 'Post images and GIFs are on. Media hosts can see your IP address.' : 'Post images and GIFs are off. Profile photos still load automatically.', state.remoteMediaEnabled ? 'pending' : 'success');
  syncQuickControls();
}
$('#feed-media-toggle')?.addEventListener('click', () => setRemoteMediaEnabled(!state.remoteMediaEnabled));
const commandPalette = $('#command-palette');
const commandQuery = $('#command-query');
const shortcutPlatform = navigator.userAgentData?.platform || navigator.platform || '';
$('#search-shortcut-hint').textContent = /mac|iphone|ipad|ipod/i.test(shortcutPlatform) ? '⌘K' : 'Ctrl K';
let commandReturnFocus = null;
function renderCommandPersonalItems() {
  const container = $('#command-personal-items');
  if (!container) return;
  container.replaceChildren();
  const section = (title) => { const heading = document.createElement('p'); heading.className = 'command-personal-heading'; heading.textContent = title; container.append(heading); };
  const add = (icon, title, description, data) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'command-item';
    for (const [key, value] of Object.entries(data)) button.dataset[key] = String(value);
    const mark = document.createElement('span'); mark.className = 'command-icon'; mark.textContent = icon;
    const copy = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = title; const small = document.createElement('small'); small.textContent = description;
    copy.append(strong, small); button.append(mark, copy); container.append(button);
  };
  if (state.deskPins.length) {
    section('PINNED PEOPLE');
    for (const fid of deskSortedPeople()) {
      const profile = state.people.get(Number(fid)) || { fid, name: `FID ${fid}`, username: `fid-${fid}` };
      add('◎', localProfileName(profile), `@${profile.username || `fid-${fid}`} · open profile`, { commandProfile: fid });
    }
  }
  const saved = [...state.deskCasts, ...state.savedCasts].filter((cast, index, list) => list.findIndex((item) => Number(item.fid) === Number(cast.fid) && String(item.hash).toLowerCase() === String(cast.hash).toLowerCase()) === index).slice(0, 16);
  if (saved.length) {
    section('SAVED CASTS');
    for (const cast of saved) add('▣', String(cast.text || 'Saved cast').replace(/\s+/g, ' ').slice(0, 64), `@${cast.username || state.people.get(Number(cast.fid))?.username || `fid-${cast.fid}`} · open conversation`, { commandCastFid: cast.fid, commandCastHash: cast.hash });
  }
  if (state.deskTopics.length) {
    section('PINNED TOPICS');
    for (const topic of deskSortedTopics()) add('#', topic.replace(/^site:/, ''), 'Show this topic in your feed', { commandTopic: topic });
  }
}
function filterCommandItems(query) {
  const term = String(query).trim().toLocaleLowerCase();
  let visible = 0;
  document.querySelectorAll('.command-item').forEach((item) => {
    item.hidden = !!term && !item.textContent.toLocaleLowerCase().includes(term);
    if (!item.hidden) visible += 1;
  });
  document.querySelectorAll('.command-personal-heading').forEach((heading) => {
    let entry = heading.nextElementSibling;
    let hasVisibleItems = false;
    while (entry && !entry.classList.contains('command-personal-heading')) {
      if (entry.matches('.command-item:not([hidden])')) hasVisibleItems = true;
      entry = entry.nextElementSibling;
    }
    heading.hidden = !hasVisibleItems;
  });
  $('#command-empty').hidden = visible > 0;
}
function openCommandPalette(returnFocus = document.activeElement) {
  if (!commandPalette || commandPalette.open || document.querySelector('dialog[open]')) return;
  commandReturnFocus = returnFocus instanceof HTMLElement ? returnFocus : $('#command-open');
  renderCommandPersonalItems();
  commandQuery.value = '';
  filterCommandItems('');
  commandPalette.showModal();
  requestAnimationFrame(() => commandQuery.focus({ preventScroll: true }));
}
$('#command-open')?.addEventListener('click', (event) => openCommandPalette(event.currentTarget));
$('#command-close').addEventListener('click', () => commandPalette.close());
commandPalette.addEventListener('close', () => {
  if (!document.querySelector('dialog[open]') && commandReturnFocus?.isConnected) commandReturnFocus.focus({ preventScroll: true });
  commandReturnFocus = null;
});
commandQuery.addEventListener('input', (event) => filterCommandItems(event.currentTarget.value));
commandQuery.addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const items = [...document.querySelectorAll('.command-item:not([hidden])')];
  if (!items.length) return;
  event.preventDefault();
  (event.key === 'ArrowDown' ? items[0] : items.at(-1))?.focus();
});
$('#command-items').addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const items = [...document.querySelectorAll('.command-item:not([hidden])')];
  if (!items.length) return;
  const index = items.indexOf(event.target.closest('.command-item'));
  const next = event.key === 'ArrowDown'
    ? (index + 1) % items.length
    : index <= 0 ? items.length - 1 : index - 1;
  event.preventDefault();
  items[next]?.focus();
});
$('#command-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  document.querySelector('.command-item:not([hidden])')?.click();
});
$('#command-items').addEventListener('click', (event) => {
  const item = event.target.closest('.command-item');
  if (!item) return;
  commandPalette.close();
  if (item.dataset.commandProfile) {
    const fid = Number(item.dataset.commandProfile); navigate('feed'); setProfileRoute(fid); void loadFeed(fid, 'profile'); return;
  }
  if (item.dataset.commandCastFid && item.dataset.commandCastHash) {
    navigate('feed'); void openConversation(Number(item.dataset.commandCastFid), item.dataset.commandCastHash); return;
  }
  if (item.dataset.commandTopic) {
    state.activeDeskTopic = item.dataset.commandTopic; navigate('feed');
    if (state.boardMode !== 'signals') { setBoardMode('signals'); return; }
    renderDeskShortcuts(); renderFeed(); return;
  }
  if (item.dataset.commandAction === 'compose') {
    if (state.boardMode !== 'signals') setBoardMode('signals');
    if (state.feedMode === 'profile') setFeedTab('following');
    navigate('feed');
    if (!state.signerReady) { openConnectDialog(); return; }
    setComposerExpanded(true);
    requestAnimationFrame(() => { $('#composer-text').focus({ preventScroll: true }); $('#composer-text').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    return;
  }
  if (item.dataset.commandAction === 'refresh') { navigate('feed'); $('#feed-refresh').click(); return; }
  if (item.dataset.commandAction === 'appearance') { $('#theme-select').focus({ preventScroll: true }); return; }
  if (item.dataset.commandAction === 'account') { $('#open-account').click(); return; }
  if (item.dataset.commandAction === 'saved') { navigate('feed'); setBoardMode('flight-log'); return; }
  if (item.dataset.commandFeedDestination) { void openFeedDestination(item.dataset.commandFeedDestination); return; }
  document.querySelector(`[data-view="${item.dataset.commandView}"]`)?.click();
});
document.querySelectorAll('.classic-app-menu').forEach((menu) => {
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    document.querySelectorAll('.classic-app-menu').forEach((other) => { if (other !== menu) other.open = false; });
  });
  menu.querySelector('summary')?.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    menu.open = true;
    requestAnimationFrame(() => menu.querySelector('.classic-menu-panel a, .classic-menu-panel button')?.focus());
  });
  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll('.classic-menu-panel a, .classic-menu-panel button')];
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    items[next].focus();
  });
  menu.addEventListener('click', (event) => {
    if (event.target.closest('.classic-menu-panel a')) { menu.open = false; return; }
    const action = event.target.closest('[data-app-menu-action]');
    if (!action) return;
    menu.open = false;
    document.querySelector(`#command-items [data-command-action="${action.dataset.appMenuAction}"]`)?.click();
  });
});
document.addEventListener('click', (event) => {
  if (event.target.closest('.classic-app-menus')) return;
  document.querySelectorAll('.classic-app-menu[open]').forEach((menu) => { menu.open = false; });
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const menu = document.querySelector('.classic-app-menu[open]');
  if (!menu) return;
  menu.open = false;
  menu.querySelector('summary')?.focus();
});
commandPalette.addEventListener('click', (event) => { if (event.target === commandPalette) commandPalette.close(); });
document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (!event.altKey && (event.ctrlKey || event.metaKey) && key === 'k' && !event.isComposing) {
    event.preventDefault();
    if (commandPalette.open) commandQuery.focus({ preventScroll: true });
    else openCommandPalette();
    return;
  }
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if (editing || document.querySelector('dialog[open]')) return;
  if (key === '?') {
    event.preventDefault();
    const options = $('#feed-filters');
    if (!options.hidden) { options.open = true; options.querySelector('summary').focus(); }
    return;
  }
  if (['1', '2'].includes(key) && state.signerReady) {
    event.preventDefault();
    setFeedTab(({ '1': 'following', '2': 'friends' })[key]);
    return;
  }
  if (key === '3') {
    event.preventDefault();
    void openFeedDestination('discover');
    return;
  }
  if (key === '4') { event.preventDefault(); navigate('feed'); setBoardMode('flight-log'); return; }
  if (key === 'c' && state.signerReady && state.boardMode !== 'flight-log') {
    event.preventDefault();
    setComposerExpanded(true);
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
$('#open-account').addEventListener('click', () => {
  if (!state.signerReady || !state.fid) { openConnectDialog(); return; }
  state.parent = null;
  if (state.boardMode !== 'signals') setBoardMode('signals');
  navigate('profile', { restoreScroll: false });
  void loadFeed(state.fid, 'profile');
});
$('#hero-connect')?.addEventListener('click', openConnectDialog);
$('#welcome-card [data-open-account]')?.addEventListener('click', openConnectDialog);
$('#portal-enter').addEventListener('click', () => {
  openConnectDialog();
  if (state.signer && !state.signerReady) $('#check-signer').hidden = false;
});
$('#capsule-seal').addEventListener('click', sealTimeCapsule);
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
$('#resume-signer').addEventListener('click', () => resumeSavedKeyAdd());
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
$('#composer-toggle').addEventListener('click', () => {
  const opening = !$('#composer').classList.contains('is-expanded');
  setComposerExpanded(opening, { focus: opening });
});
$('#composer-review-pending').addEventListener('click', () => setComposerExpanded(true));
$('#composer-quote-remove').addEventListener('click', () => {
  state.quoteCast = null;
  renderComposerQuote();
  $('#composer-label').textContent = state.parent ? `Reply to ${profileLabel(state.people.get(Number(state.parent.fid)), state.parent.fid)}` : 'Write a cast';
  $('#composer-text').placeholder = state.parent ? `Replying to ${profileLabel(state.people.get(Number(state.parent.fid)), state.parent.fid)}…` : 'What’s on your mind?';
  $('#draft-discard').hidden = !($('#composer-text').value.trim() || $('#composer-media-url').value.trim() || state.parent || state.pendingCast);
  saveComposerDraft();
});
$('#composer-text').addEventListener('input', (event) => {
  const field = event.currentTarget;
  if (utf8ByteLength(field.value) > CAST_USER_LIMIT) {
    const cursor = field.selectionStart ?? field.value.length;
    field.value = truncateUtf8(field.value);
    const position = Math.min(cursor, field.value.length);
    field.setSelectionRange(position, position);
  }
  $('#char-count').textContent = `${utf8ByteLength($('#composer-text').value)} / ${CAST_USER_LIMIT} bytes`;
  $('#draft-discard').hidden = !($('#composer-text').value || $('#composer-media-url').value.trim() || state.quoteCast || state.parent || state.pendingCast);
  saveComposerDraft();
});
$('#composer-media-toggle').addEventListener('click', () => {
  const panel = $('#composer-media');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    $('#composer-media-url').focus();
    if (!photoUploadStatusChecked) loadPhotoUploadStatus();
  }
});
function updatePhotoUploadControls(pending = Boolean(state.pendingCast)) {
  const choose = $('#composer-image-choose');
  const upload = $('#composer-image-upload');
  if (!choose || !upload) return;
  choose.disabled = pending || photoUploadBusy || !photoUploadEnabled;
  upload.disabled = pending || photoUploadBusy || !photoUploadEnabled || !selectedPhotoFile;
}

async function loadPhotoUploadStatus() {
  const status = $('#composer-image-status');
  if (!status) return;
  status.textContent = 'Checking photo upload…';
  try {
    const response = await fetch('/api/upload-image', { headers: { accept: 'application/json' }, cache: 'no-store' });
    const result = await response.json();
    photoUploadEnabled = response.ok && result.enabled === true;
    photoUploadMode = photoUploadEnabled && ['token', 'presigned'].includes(result.mode) ? result.mode : null;
    photoUploadStatusChecked = true;
    status.textContent = photoUploadEnabled
      ? 'Choose a photo · JPEG, PNG, GIF, or WebP · up to 10 MB. Uploads are public links.'
      : 'Photo upload is unavailable on this site. Paste a public image link below instead.';
  } catch {
    photoUploadEnabled = false;
    photoUploadMode = null;
    photoUploadStatusChecked = true;
    status.textContent = 'Photo upload is unavailable here. Paste a public image link below instead.';
  }
  updatePhotoUploadControls();
}

function clearSelectedPhoto() {
  photoUploadController?.abort();
  photoUploadController = null;
  selectedPhotoFile = null;
  photoUploadBusy = false;
  $('#draft-discard').disabled = false;
  $('#composer-image-file').value = '';
  if (selectedPhotoPreviewUrl) URL.revokeObjectURL(selectedPhotoPreviewUrl);
  selectedPhotoPreviewUrl = '';
  $('#composer-photo-preview').hidden = true;
  $('#composer-photo-preview-image').removeAttribute('src');
  $('#composer-photo-name').textContent = '';
  if (uploadedPhotoUrl && $('#composer-media-url').value.trim() === uploadedPhotoUrl) {
    $('#composer-media-url').value = '';
    $('#composer-media-url').dispatchEvent(new Event('input', { bubbles: true }));
  }
  uploadedPhotoUrl = '';
  updatePhotoUploadControls();
}

$('#composer-image-choose').addEventListener('click', () => $('#composer-image-file').click());
$('#composer-image-file').addEventListener('change', () => {
  const file = $('#composer-image-file').files?.[0];
  if (!file) return;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
    $('#composer-image-status').textContent = file.size > 10 * 1024 * 1024
      ? 'This photo is over 10 MB. Choose a smaller image.'
      : 'Choose a JPEG, PNG, GIF, or WebP image.';
    $('#composer-image-file').value = '';
    return;
  }
  if (selectedPhotoPreviewUrl) URL.revokeObjectURL(selectedPhotoPreviewUrl);
  selectedPhotoFile = file;
  selectedPhotoPreviewUrl = URL.createObjectURL(file);
  $('#composer-photo-preview-image').src = selectedPhotoPreviewUrl;
  $('#composer-photo-name').textContent = `${file.name.slice(0, 56)} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  $('#composer-photo-preview').hidden = false;
  $('#composer-image-status').textContent = 'Photo selected. Upload it to attach a public copy to your cast.';
  $('#draft-discard').hidden = false;
  updatePhotoUploadControls();
});

$('#composer-image-upload').addEventListener('click', async () => {
  if (!selectedPhotoFile || !photoUploadEnabled || photoUploadBusy) return;
  photoUploadBusy = true;
  const controller = new AbortController();
  photoUploadController = controller;
  $('#draft-discard').disabled = true;
  updatePhotoUploadControls();
  $('#composer-image-status').textContent = 'Uploading photo to public Vercel Blob…';
  const extension = selectedPhotoFile.type === 'image/jpeg' ? 'jpg' : selectedPhotoFile.type.split('/')[1];
  const pathname = `casts/${Date.now()}-${crypto.randomUUID().replaceAll('-', '')}.${extension}`;
  const uploadOptions = {
    access: 'public',
    handleUploadUrl: '/api/upload-image',
    contentType: selectedPhotoFile.type,
    abortSignal: controller.signal,
  };
  try {
    const result = photoUploadMode === 'presigned'
      ? await uploadPublicBlobPresigned(pathname, selectedPhotoFile, uploadOptions)
      : await uploadPublicBlob(pathname, selectedPhotoFile, uploadOptions);
    const url = safeExternalUrl(result.url);
    if (!url || /\.private\.blob\.vercel-storage\.com$/i.test(url.hostname) || utf8ByteLength(url.href) > CAST_EMBED_URL_LIMIT) throw new Error('The photo service returned a link Farcaster cannot embed.');
    uploadedPhotoUrl = url.href;
    $('#composer-media-url').value = uploadedPhotoUrl;
    $('#composer-media-url').dispatchEvent(new Event('input', { bubbles: true }));
    $('#composer-media-note').textContent = 'Photo attached. Its public image URL will be included in your Farcaster cast.';
    $('#composer-image-status').textContent = 'Photo uploaded and attached. You can post it now.';
    selectedPhotoFile = null;
    $('#composer-image-file').value = '';
  } catch (error) {
    if (error.name !== 'AbortError') $('#composer-image-status').textContent = error.message || 'Photo upload failed. Try again or use a direct image link.';
  } finally {
    if (photoUploadController === controller) {
      photoUploadController = null;
      photoUploadBusy = false;
      $('#draft-discard').disabled = false;
    }
    updatePhotoUploadControls();
  }
});
$('#composer-photo-remove').addEventListener('click', () => {
  clearSelectedPhoto();
  $('#composer-image-status').textContent = photoUploadEnabled ? 'Choose a photo to attach.' : 'Paste a public image link below instead.';
});
function safeGiphyImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && /(^|\.)giphy\.com$/i.test(url.hostname) ? url.href : '';
  } catch { return ''; }
}

function updateGiphyCooldown(milliseconds) {
  giphyCooldownUntil = Date.now() + Math.max(0, Math.min(60_000, Number(milliseconds) || 0));
  if (giphyCooldownTimer) clearInterval(giphyCooldownTimer);
  const button = $('#giphy-search-button');
  const status = $('#giphy-status');
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((giphyCooldownUntil - Date.now()) / 1000));
    button.disabled = giphySearching || seconds > 0 || !giphyConfig;
    button.textContent = seconds ? `Wait ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Search';
    if (!seconds) {
      clearInterval(giphyCooldownTimer);
      giphyCooldownTimer = null;
      if (giphyConfig && !giphySearching && /shared search is in use|someone just searched/i.test(status.textContent)) status.textContent = 'Ready. One shared search is available.';
    }
  };
  tick();
  if (giphyCooldownUntil > Date.now()) giphyCooldownTimer = setInterval(tick, 250);
}

async function loadGiphyStatus() {
  const status = $('#giphy-status');
  const button = $('#giphy-search-button');
  status.textContent = 'Checking shared GIF search…';
  button.disabled = true;
  try {
    const response = await fetch('/api/giphy', { headers: { accept: 'application/json' }, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.enabled) throw new Error(result.error || 'GIF search is not configured.');
    giphyConfig = { enabled: true };
    updateGiphyCooldown(result.retryAfterMs);
    if (Number(result.retryAfterMs) > 0) status.textContent = 'Shared search is in use. Your timer is running.';
  } catch (error) {
    giphyConfig = null;
    button.disabled = true;
    button.textContent = 'Unavailable';
    status.textContent = error.message || 'GIF search is temporarily unavailable. Direct media links still work.';
  }
}

function renderGiphyResults(items) {
  const results = $('#giphy-results');
  results.replaceChildren();
  for (const item of items) {
    const originalUrl = [item?.images?.original?.url, item?.images?.fixed_width_small?.url, item?.images?.preview_gif?.url]
      .map(safeGiphyImage).find((url) => url && utf8ByteLength(url) <= CAST_EMBED_URL_LIMIT) || '';
    const previewUrl = safeGiphyImage(item?.images?.fixed_width_small?.url || item?.images?.preview_gif?.url || item?.images?.original?.url);
    if (!originalUrl || !previewUrl) continue;
    const title = String(item.title || 'GIF').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) || 'GIF';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'giphy-result';
    button.setAttribute('aria-label', `Attach GIF: ${title}`);
    const image = document.createElement('img');
    image.src = previewUrl;
    image.alt = title;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    const caption = document.createElement('span');
    caption.textContent = title;
    button.append(image, caption);
    button.addEventListener('click', () => {
      $('#composer-media-url').value = originalUrl;
      $('#composer-media-url').dispatchEvent(new Event('input', { bubbles: true }));
      $('#composer-media-note').textContent = `GIPHY GIF selected. Remote previews remain off unless you enable them.`;
      $('#giphy-picker').open = false;
    });
    results.append(button);
  }
}

$('#giphy-picker').addEventListener('toggle', (event) => { if (event.currentTarget.open) loadGiphyStatus(); });
async function searchGifs() {
  const query = $('#giphy-search-query').value.trim().slice(0, 50);
  if (!query) { $('#giphy-status').textContent = 'Type a word to search GIFs.'; $('#giphy-search-query').focus(); return; }
  if (!giphyConfig) await loadGiphyStatus();
  if (!giphyConfig || Date.now() < giphyCooldownUntil || giphySearching) return;
  const button = $('#giphy-search-button');
  const status = $('#giphy-status');
  const results = $('#giphy-results');
  giphySearching = true;
  button.disabled = true;
  button.textContent = 'Searching…';
  status.textContent = 'Searching GIPHY…';
  results.replaceChildren();
  try {
    const searchResponse = await fetch('/api/giphy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ action: 'search', query }),
      cache: 'no-store',
    });
    const payload = await searchResponse.json();
    if (Number(payload.retryAfterMs) > 0) updateGiphyCooldown(payload.retryAfterMs);
    if (searchResponse.status === 429) {
      status.textContent = payload.error || 'Someone just searched. Try again when the timer clears.';
      return;
    }
    if (!searchResponse.ok || !Array.isArray(payload.data)) throw new Error(payload.error || 'GIPHY could not complete that search. Try again when the timer clears.');
    updateGiphyCooldown(payload.retryAfterMs || 60_000);
    renderGiphyResults(payload.data);
    status.textContent = $('#giphy-results').childElementCount ? `${$('#giphy-results').childElementCount} GIFs · select one to attach` : 'No GIFs found. Try another search when the timer clears.';
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' ? 'GIPHY took too long. Try again when the timer clears.' : error.message || 'GIF search failed. Direct media links still work.';
  } finally {
    giphySearching = false;
    if (Date.now() >= giphyCooldownUntil) updateGiphyCooldown(0);
    else {
      button.disabled = true;
      const seconds = Math.ceil((giphyCooldownUntil - Date.now()) / 1000);
      button.textContent = `Wait ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
  }
}
$('#giphy-search-button').addEventListener('click', searchGifs);
$('#giphy-picker').addEventListener('click', (event) => {
  const quickSearch = event.target.closest('[data-giphy-query]');
  if (!quickSearch) return;
  $('#giphy-search-query').value = quickSearch.dataset.giphyQuery;
  searchGifs();
});
$('#giphy-search-query').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); searchGifs(); }
});
$('#composer-media-url').addEventListener('input', () => {
  const candidate = safeExternalUrl($('#composer-media-url').value.trim());
  const withinLimit = candidate && utf8ByteLength(candidate.href) <= CAST_EMBED_URL_LIMIT;
  $('#composer-media-note').textContent = candidate
    ? withinLimit ? `${candidate.hostname} will be attached. Previews are on by default; turn them off in Profile → Customize.` : `This link is over Farcaster’s ${CAST_EMBED_URL_LIMIT}-byte embed limit.`
    : 'Choose a photo to upload, or paste a direct HTTPS image or GIF link. Remote previews can be disabled in Profile → Customize.';
  $('#draft-discard').hidden = !($('#composer-text').value.trim() || $('#composer-media-url').value.trim() || state.quoteCast || state.parent || state.pendingCast);
  saveComposerDraft();
});
$('#composer-media-clear').addEventListener('click', () => {
  clearSelectedPhoto();
  $('#composer-media-url').value = ''; $('#composer-media-url').dispatchEvent(new Event('input', { bubbles: true })); $('#composer-media').hidden = true;
  $('#composer-media-note').textContent = 'Choose a photo to upload, or paste a direct HTTPS image or GIF link. Remote previews can be disabled in Profile → Customize.';
  $('#draft-discard').hidden = !($('#composer-text').value.trim() || state.quoteCast || state.parent || state.pendingCast);
  saveComposerDraft();
});
async function renderEmojiResults(query = '') {
  const grid = $('#emoji-picker-grid');
  const version = ++emojiRenderVersion;
  $('#emoji-search-status').textContent = 'Loading…';
  try {
    emojiCatalogPromise ||= import('./emoji-catalog.js');
    const { searchEmojis } = await emojiCatalogPromise;
    if (version !== emojiRenderVersion || !$('.emoji-picker')?.open) return;
    const results = searchEmojis(query);
    grid.replaceChildren(...results.map(([emoji, name]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.emoji = emoji;
      button.setAttribute('aria-label', name);
      button.title = name;
      button.textContent = emoji;
      return button;
    }));
    $('#emoji-search-status').textContent = results.length ? `${results.length} emoji${results.length === 1 ? '' : 's'}` : 'No matches. Try another word.';
  } catch {
    if (version === emojiRenderVersion) $('#emoji-search-status').textContent = 'Emoji search is unavailable. You can still type normally.';
  }
}

function placeEmojiPicker() {
  const picker = $('.emoji-picker');
  if (!picker?.open) return;
  const summary = picker.querySelector('summary').getBoundingClientRect();
  const panel = $('.emoji-picker-popover');
  const rect = panel.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewTop = viewport?.offsetTop || 0;
  const viewBottom = viewTop + (viewport?.height || window.innerHeight);
  const topAbove = summary.top - rect.height - 8;
  const top = topAbove >= viewTop + 8 ? topAbove : Math.min(summary.bottom + 8, viewBottom - rect.height - 8);
  const left = Math.max(8, Math.min(summary.right - rect.width, window.innerWidth - rect.width - 8));
  panel.style.top = `${Math.max(viewTop + 8, top)}px`;
  panel.style.left = `${left}px`;
}

$('.emoji-picker').addEventListener('toggle', () => {
  if (!$('.emoji-picker').open) return;
  $('#emoji-search').value = '';
  renderEmojiResults();
  requestAnimationFrame(() => { placeEmojiPicker(); $('#emoji-search').focus({ preventScroll: true }); });
});
$('.emoji-picker').addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  $('.emoji-picker').open = false;
  $('.emoji-picker>summary').focus();
});
$('#emoji-search').addEventListener('input', (event) => renderEmojiResults(event.currentTarget.value));
window.addEventListener('resize', placeEmojiPicker);
window.addEventListener('scroll', placeEmojiPicker, { passive: true });
window.visualViewport?.addEventListener('resize', placeEmojiPicker);
document.addEventListener('click', (event) => {
  const picker = $('.emoji-picker');
  if (picker?.open && !picker.contains(event.target)) picker.open = false;
});
$('.emoji-picker').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-emoji]');
  if (!button) return;
  const field = $('#composer-text');
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  if (utf8ByteLength(field.value) - utf8ByteLength(field.value.slice(start, end)) + utf8ByteLength(button.dataset.emoji) > CAST_USER_LIMIT) {
    setNotice(`The cast has room for ${CAST_USER_LIMIT} UTF-8 bytes before the Castonaut link.`, 'pending');
    return;
  }
  field.setRangeText(button.dataset.emoji, start, end, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  $('.emoji-picker').open = false;
  field.focus();
});
$('#composer-text').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (state.parent || state.quoteCast)) {
    state.parent = null;
    state.quoteCast = null;
    renderComposerQuote();
    $('#composer-label').textContent = 'Write a cast';
    $('#composer-text').placeholder = 'What’s on your mind?';
    if (state.feedMode === 'profile') $('#composer').hidden = true;
    saveComposerDraft();
    setNotice('Reply or quote cancelled.');
  }
});

$('#draft-discard').addEventListener('click', () => {
  if (state.pendingCast && !window.confirm('This signed post may already have reached Farcaster. Discarding it can make it easier to accidentally publish a duplicate. Discard it anyway?')) return;
  clearCurrentDraft(); setNotice('Current draft discarded.');
});
$('#thread-add').addEventListener('click', () => {
  if ($('#composer-media-url').value.trim() || selectedPhotoFile) { setNotice('Finish attaching or remove the image before adding this post to a text thread.'); return; }
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
  if (selectedPhotoFile) { setNotice(photoUploadBusy ? 'Wait for the photo upload to finish.' : 'Upload the selected photo or remove it before posting.', 'error'); $('#composer-image-upload').focus(); return; }
  const text = $('#composer-text').value.trim();
  const mediaValue = $('#composer-media-url').value.trim();
  const mediaUrl = mediaValue ? safeExternalUrl(mediaValue) : null;
  if (mediaValue && (!mediaUrl || utf8ByteLength(mediaUrl.href) > CAST_EMBED_URL_LIMIT)) { setNotice(`Use a valid HTTPS GIF or image URL up to ${CAST_EMBED_URL_LIMIT} UTF-8 bytes.`, 'error'); return; }
  if (!text && !mediaUrl && !state.quoteCast) return;
  if (state.quoteCast && state.signerMode === 'neynar') { setNotice('Native quote casts need the local Farcaster seed-code signer. Managed Neynar sign-in currently supports URL embeds only.', 'error'); return; }
  const submit = $('#composer button[type="submit"]'); submit.disabled = true; $('#composer').setAttribute('aria-busy', 'true');
  try {
    let pending = state.pendingCast;
    if (!pending) {
      setComposerSubmitLabel('Preparing…');
      const attributedText = withCastonautAttribution(text);
      if (state.signerMode === 'neynar') {
        pending = { managed: true, idem: crypto.randomUUID().replaceAll('-', '').slice(0, 24), text, bodyText: attributedText, mediaUrl: mediaUrl?.href || '', parent: state.parent && { fid: Number(state.parent.fid), hash: String(state.parent.hash) } };
      } else {
        const protocol = await import('./protocol.js');
        const signer = await getActiveSigner();
        const message = await protocol.makeCastAdd(castBody(attributedText, state.parent, protocol, mediaUrl ? [mediaUrl.href] : [], text, state.quoteCast), { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, signer);
        const signedMessage = resultOrThrow(message, 'Could not sign cast');
        const hash = postHash(signedMessage);
        if (!/^0x[\da-f]{40,64}$/i.test(hash)) throw new Error('Could not verify the signed post hash. Your draft remains saved.');
        pending = { hash, encoded: toBase64((await import('./protocol.js')).Message.encode(signedMessage).finish()), text, mediaUrl: mediaUrl?.href || '' };
      }
      state.pendingCast = pending;
      setPendingCastControls(true);
      $('#draft-discard').hidden = false;
      $('#draft-status').textContent = 'Signed post saved on this device. Checking network status…';
      saveComposerDraft();
    }
    setComposerSubmitLabel('Checking post…');
    await publishPendingCast(pending);
    state.pendingCast = null;
    clearCurrentDraft();
    await loadFeed(state.fid, 'following');
  } catch (error) {
    if (state.pendingCast) {
      saveComposerDraft();
      $('#draft-status').textContent = 'Post status is not confirmed. Submit again to safely check or resume the same signed post.';
    }
    setNotice(clientErrorText(error), 'error');
  }
  finally { $('#composer').removeAttribute('aria-busy'); setComposerSubmitLabel(state.pendingCast ? 'Resume saved post' : 'Post'); submit.disabled = !state.signerReady; }
});

document.addEventListener('click', async (event) => {
  const reactionButton = event.target.closest('[data-reactions-cast]');
  if (reactionButton) { await openReactionDetails(reactionButton); return; }
  const savedCast = event.target.closest('[data-open-desk-cast]');
  if (savedCast) {
    navigate('feed');
    await openConversation(savedCast.dataset.fid, savedCast.dataset.hash);
    return;
  }
  const conversationButton = event.target.closest('[data-open-conversation]');
  if (conversationButton) { await openConversation(conversationButton.dataset.fid, conversationButton.dataset.hash); return; }
  if (event.target.closest('[data-share-app]')) {
    if (state.sessionRestoring) {
      setNotice('Checking this browser for your saved Farcaster account. Try Invite again in a moment.', 'pending');
      return;
    }
    if (!state.signerReady) { openConnectDialog(); return; }
    const appUrl = $('link[rel="canonical"]')?.href || new URL('/', location.origin).href;
    const inviteText = `Join me on Castonaut — an independent Farcaster client with a chronological feed and a personal Desk.\n\n${appUrl}`;
    navigate('feed', { restoreScroll: false });
    if (state.boardMode !== 'signals') setBoardMode('signals');
    const composer = $('#composer-text');
    const existing = composer.value.trimEnd();
    composer.value = [existing, inviteText].filter(Boolean).join('\n\n');
    composer.setSelectionRange(composer.value.length, composer.value.length);
    $('#composer-label').textContent = 'Invite friends';
    $('#composer').hidden = false;
    setComposerExpanded(true, { focus: true });
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    void loadFeed(state.fid, 'following');
    return;
  }
  const castProfile = event.target.closest('[data-cast-profile]');
  if (castProfile) {
    if (!state.signerReady) { openConnectDialog(); return; }
    const fid = Number(castProfile.dataset.castProfile);
    const profile = state.people.get(fid) || { fid, username: `fid-${fid}`, name: `Farcaster ${fid}` };
    const username = String(profile.username || '');
    const profileUrl = originalProfileUrl(profile) || (() => { const url = new URL(`${location.pathname}${location.search}`, location.origin); url.hash = `profile=${fid}`; return url.href; })();
    const introduction = /^[a-z\d._-]{1,32}$/i.test(username) && !/^fid-\d+$/.test(username)
      ? `Take a look at ${localProfileName(profile)} on Farcaster:`
      : 'Take a look at this Farcaster profile:';
    const castText = `${introduction}\n${profileUrl}`;
    navigate('feed');
    if (state.boardMode !== 'signals') setBoardMode('signals');
    await loadFeed(state.fid, 'following');
    state.parent = null;
    const composer = $('#composer-text');
    const existing = composer.value.trimEnd();
    const separator = existing ? `${existing}\n\n` : '';
    composer.value = `${separator}${castText}`;
    composer.setSelectionRange(composer.value.length, composer.value.length);
    $('#composer-label').textContent = 'Cast profile';
    $('#composer').hidden = false;
    setComposerExpanded(true);
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    composer.focus();
    $('#composer').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    return;
  }
  const shareCast = event.target.closest('[data-share-cast]');
  if (shareCast) {
    const url = new URL(`${location.pathname}${location.search}`, location.origin);
    const fid = Number(shareCast.dataset.fid);
    const hash = String(shareCast.dataset.hash).toLowerCase();
    url.hash = `cast=${fid}/${hash}`;
    const profile = state.people.get(fid);
    const cast = state.casts.find((item) => Number(item?.data?.fid) === fid && postHash(item) === hash);
    const castText = String(cast?.data?.castAddBody?.text || '').trim();
    await shareOrCopyLink(url.href, {
      title: `Cast by @${profile?.username || `fid-${fid}`}`,
      text: castText ? castText.slice(0, 240) : 'Open this conversation on Castonaut.',
      copiedMessage: 'Cast link',
    });
    return;
  }
  const deskTopic = event.target.closest('[data-desk-topic]');
  if (deskTopic) {
    state.activeDeskTopic = state.activeDeskTopic === deskTopic.dataset.deskTopic ? '' : deskTopic.dataset.deskTopic;
    navigate('feed');
    if (state.boardMode !== 'signals') { setBoardMode('signals'); return; }
    updateFeedTabs(); renderDeskShortcuts(); renderFeed();
    return;
  }
  if (event.target.closest('[data-clear-desk-topic]')) { state.activeDeskTopic = ''; renderDeskShortcuts(); renderFeed(); return; }
  const parentJump = event.target.closest('[data-focus-cast]');
  if (parentJump) {
    const card = [...document.querySelectorAll('#feed-list [data-cast-hash]')].find((item) => item.dataset.castHash === parentJump.dataset.focusCast && Number(item.dataset.castFid) === Number(parentJump.dataset.focusFid));
    if (card) { const collapsed = card.closest('details:not([open])'); if (collapsed) collapsed.open = true; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('cast-focus'); setTimeout(() => card.classList.remove('cast-focus'), 1500); }
    else if (parentJump.dataset.replyFid && parentJump.dataset.replyHash) void openConversation(parentJump.dataset.replyFid, parentJump.dataset.replyHash);
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
  if (profileTab) {
    state.profileTab = ['media', 'replies'].includes(profileTab.dataset.profileTab) ? profileTab.dataset.profileTab : 'posts';
    renderProfileSummary(); renderFeed();
    requestAnimationFrame(() => $('#profile-timeline-controls [aria-selected="true"]')?.focus({ preventScroll: true }));
    return;
  }
  const profilePin = event.target.closest('[data-profile-pin]');
  if (profilePin) {
    await toggleDeskPin(profilePin.dataset.profilePin, null);
    renderProfileSummary();
    return;
  }
  const manageDeskLeaders = event.target.closest('[data-manage-desk-leaders]');
  if (manageDeskLeaders) {
    navigate('desk', { restoreScroll: false });
    requestAnimationFrame(() => {
      const picker = $('#desk-leader-picker');
      if (picker) { picker.open = true; picker.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); }
    });
    return;
  }
  const profileEdit = event.target.closest('[data-edit-profile]');
  if (profileEdit) { openProfileEditor(Number(profileEdit.dataset.editProfile)); return; }
  const profileButton = event.target.closest('[data-open-profile]');
  if (profileButton) {
    const fid = Number(profileButton.dataset.openProfile);
    if (currentArea !== 'feed') navigate('feed', { preserveHash: true });
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
      if (!state.friendFids.includes(targetFid) && state.friendFids.length >= 36) {
        setNotice('Your local Top people list can hold up to 36 accounts. Remove a pick before adding another.', 'error'); return;
      }
      const next = state.friendFids.includes(targetFid) ? state.friendFids.filter((fid) => fid !== targetFid) : [...state.friendFids, targetFid];
      const saved = writeFidList(FRIENDS_STORAGE, next); if (!saved) return; state.friendFids = saved;
      updateFeedTabs();
      if (state.feedMode === 'friends') await loadFeed(state.fid, 'friends');
      else renderFeed();
      renderSuggestedPeople();
      renderTopPeopleDrawer();
      if (state.feedMode === 'profile' && Number(state.feedTargetFid) === targetFid) renderProfileSummary();
      setNotice(state.friendFids.includes(targetFid) ? 'Added to Top people on this device.' : 'Removed from Top people.', 'success'); return;
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
    if (button.dataset.action === 'pin-person' || button.dataset.action === 'unpin-person') { await toggleDeskPin(button.dataset.fid, null); renderFeed(); return; }
    if (button.dataset.action === 'reply') {
      if (!state.signerReady) { $('#connect-dialog').showModal(); return; }
      state.quoteCast = null;
      renderComposerQuote();
      state.parent = { fid: targetFid, hash: button.dataset.hash };
      $('#composer-label').textContent = `Reply to ${profileLabel(state.people.get(targetFid), targetFid)}`;
      $('#composer').hidden = false;
      setComposerExpanded(true);
      $('#composer-text').placeholder = `Replying to ${profileLabel(state.people.get(targetFid), targetFid)}…`;
      focusComposerInput();
      return;
    }
    if (button.dataset.action === 'quote-cast') {
      if (!state.signerReady) { $('#connect-dialog').showModal(); return; }
      if (state.signerMode === 'neynar') { setNotice('Native quote casts need the local Farcaster seed-code signer. Managed Neynar sign-in currently supports URL embeds only.', 'error'); return; }
      const quoteFid = Number(button.dataset.fid || targetFid);
      const quoteHash = button.dataset.hash || '';
      if (!Number.isSafeInteger(quoteFid) || quoteFid <= 0 || !/^0x[\da-f]{40}$/i.test(quoteHash)) throw new Error('This cast cannot be quoted because its Farcaster ID is invalid.');
      state.quoteCast = { fid: quoteFid, hash: quoteHash };
      state.parent = null;
      $('#composer-label').textContent = 'Quote cast · add a thought';
      $('#composer-text').placeholder = 'Add a thought about this cast…';
      $('#composer').hidden = false;
      setComposerExpanded(true);
      renderComposerQuote();
      $('#draft-discard').hidden = false;
      saveComposerDraft();
      focusComposerInput();
      return;
    }
    if (!state.signerReady) { $('#connect-dialog').showModal(); return; }
    const hash = button.dataset.hash;
    button.disabled = true;
    const protocol = await import('./protocol.js');
    if (button.dataset.action === 'follow') {
      const params = { fid: state.fid, target_fid: targetFid, link_type: 'follow' };
      let following = false;
      button.setAttribute('aria-busy', 'true');
      if (state.signerMode === 'neynar') {
        if (!state.following.has(targetFid) || state.followStatusUnknown.has(targetFid)) throw new Error('Follow status is not confirmed yet. Refresh the feed or node status, then try again.');
        following = !!state.following.get(targetFid);
        await managedWrite({ action: following ? 'unfollow' : 'follow', target_fid: targetFid });
        setFollowState(targetFid, !following);
        state.suggestionsLoadedFor = 0;
        updateCastRelationship(targetFid);
        if (!following) { state.suggestedPeople = state.suggestedPeople.filter((person) => person.fid !== targetFid); renderSuggestedPeople(); }
        document.querySelectorAll(`[data-action="follow"][data-fid="${targetFid}"]`).forEach((item) => updateFollowButton(item, targetFid));
        button.removeAttribute('aria-busy'); button.disabled = false;
        setNotice(following ? 'Unfollow sent through Farcaster.' : 'Follow sent through Farcaster.', 'success');
        return;
      }
      if (maxNodeDelay() === null) await checkNode();
      const nodeDelay = maxNodeDelay();
      if (nodeDelay === null || nodeDelay > 10) {
        state.followStatusUnknown.add(targetFid);
        document.querySelectorAll(`[data-action="follow"][data-fid="${targetFid}"]`).forEach((item) => updateFollowButton(item, targetFid));
        throw new Error(`${nodeDelay === null ? 'Node freshness could not be confirmed' : `The node is ${formatNodeDelay(nodeDelay)} behind`}. Follow status may be stale, so no change was signed. Check node status and retry when the node is current.`);
      }
      try { await nodeRequest('linkById', params, { fresh: true }); following = true; setFollowState(targetFid, true); }
      catch (error) {
        if (isNotFound(error)) setFollowState(targetFid, false);
        else {
          state.followStatusUnknown.add(targetFid);
          document.querySelectorAll(`[data-action="follow"][data-fid="${targetFid}"]`).forEach((item) => updateFollowButton(item, targetFid));
          throw new Error(`Could not confirm your follow status with the node. No follow change was signed. ${clientErrorText(error)}`);
        }
      }
      const message = following
        ? await protocol.makeLinkRemove({ type: 'follow', targetFid }, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner())
        : await protocol.makeLinkAdd({ type: 'follow', targetFid }, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner());
      if (following) await signAndRelayRemoval(message, 'linkById', params, `Unfollow of FID ${targetFid} confirmed.`);
      else await signAndRelay(message, 'linkById', params, `Follow of FID ${targetFid} confirmed.`);
      setFollowState(targetFid, following ? false : true);
      state.suggestionsLoadedFor = 0;
      updateCastRelationship(targetFid);
      if (!following) { state.suggestedPeople = state.suggestedPeople.filter((person) => person.fid !== targetFid); renderSuggestedPeople(); }
      document.querySelectorAll(`[data-action="follow"][data-fid="${targetFid}"]`).forEach((item) => {
        updateFollowButton(item, targetFid);
      });
      button.removeAttribute('aria-busy');
    } else {
      const reactionType = button.dataset.action === 'like' ? protocol.ReactionType.LIKE : protocol.ReactionType.RECAST;
      const routeType = button.dataset.action === 'like' ? 'Like' : 'Recast';
      const params = { fid: state.fid, target_fid: targetFid, target_hash: hash, reaction_type: routeType };
      let active = false;
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-label', `${routeType === 'Like' ? 'Like' : 'Recast'} update waiting for node confirmation`);
      try { await nodeRequest('reactionById', params, { fresh: true }); active = true; }
      catch (error) { if (!isNotFound(error)) throw error; }
      if (state.signerMode === 'neynar') {
        const kind = routeType.toLowerCase();
        await managedWrite({ action: active ? `un${kind}` : kind, target_fid: targetFid, hash, idem: crypto.randomUUID().replaceAll('-', '').slice(0, 24) });
        saveViewerReactionState(state.fid, targetFid, hash, routeType, !active);
        paintReactionButtonState(button, routeType, !active);
        button.removeAttribute('aria-busy'); button.disabled = false;
        refreshCastEngagement(targetFid, hash);
        setNotice(`${routeType === 'Like' ? 'Like' : 'Recast'} sent through Farcaster; your node may take a moment to catch up.`, 'success');
        return;
      }
      const body = { type: reactionType, targetCastId: { fid: targetFid, hash: resultOrThrow(protocol.hexStringToBytes(hash), 'Could not read the reaction cast hash') } };
      const message = active
        ? await protocol.makeReactionRemove(body, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner())
        : await protocol.makeReactionAdd(body, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner());
      const label = routeType === 'Like' ? (active ? 'Like removed from Snapchain.' : 'Like confirmed in Snapchain.') : (active ? 'Recast removed from Snapchain.' : 'Recast confirmed in Snapchain.');
      if (active) await signAndRelayRemoval(message, 'reactionById', params, label);
      else await signAndRelay(message, 'reactionById', params, label);
      saveViewerReactionState(state.fid, targetFid, hash, routeType, !active);
      paintReactionButtonState(button, routeType, !active);
      refreshCastEngagement(targetFid, hash);
      button.removeAttribute('aria-busy');
    }
    button.disabled = false;
  } catch (error) {
    button.removeAttribute('aria-busy');
    if (button.dataset.action === 'like' || button.dataset.action === 'recast') {
      const type = button.dataset.action === 'like' ? 'Like' : 'Recast';
      paintReactionButtonState(button, type, button.getAttribute('aria-pressed') === 'true');
    }
    setNotice(error.message, 'error'); button.disabled = !state.signerReady;
  }
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

initPlayTools({ onShareScore: (score) => {
  navigate('feed');
  if (state.boardMode !== 'signals') setBoardMode('signals');
  if (state.feedMode === 'profile') setFeedTab('following');
  setComposerExpanded(true);
  const field = $('#composer-text');
  field.value = `I scored ${Number(score).toLocaleString()} in Neon Rush on Castonaut. Can you beat me?`;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => {
    field.focus({ preventScroll: true });
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!state.signerReady) openConnectDialog();
  });
} });

if (location.hash === '#node' || location.hash === '#about') navigate('node', { preserveHash: true });
else if (location.hash === '#play-tools') navigate('tools', { preserveHash: true });
else if (location.hash === '#my-desk') navigate('desk', { preserveHash: true });
else if (location.hash === '#people-search' || location.hash === '#search') navigate('search', { preserveHash: true });
else navigate('feed', { preserveHash: true });
renderDesk();
renderFlightLogCount();
setBoardMode('signals');
renderIdentity();
restoreSession().catch((error) => {
  setNotice(`Could not check this browser’s saved sign-in. Your key has not been deleted. ${error.message}`, 'error');
}).finally(() => {
  state.sessionRestoring = false;
  renderIdentity();
  if ($('#connect-dialog').open) {
    if (state.signer && !state.signerReady) {
      setConnectionStatus('A saved app key was found. Check whether the node has confirmed it before creating anything else.', { canRetry: true, canResume: state.hasPendingKeyAdd });
    } else if (state.signerReady) {
      setConnectionStatus('This browser is connected and ready for social actions.');
    } else {
      setConnectionStatus('');
    }
  }
  applyLocationRoute();
});
setInterval(() => {
  if (document.hidden) return;
  setStationTone();
  renderFeedFreshness();
}, 60_000);
