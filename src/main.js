import './styles.css';
import { createPublicClient, createWalletClient, custom, decodeAbiParameters, http, isAddress } from 'viem';
import { optimism } from 'viem/chains';

const $ = (selector) => document.querySelector(selector);
const FARCASTER_EPOCH_MS = Date.UTC(2021, 0, 1);
const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const LEGACY_KEY_STORAGE = 'openroom.snapchain.signer.v1';
const SIGNER_DB = 'castonaut-security';
const SIGNER_STORE = 'signers';
const DESK_STORAGE = 'packet-porch.desk-pins.v1';
const PROFILE_NOTES_STORAGE = 'castonaut.profile-notes.v1';
const FLIGHT_LOG_STORAGE = 'castonaut.flight-log.v1';
const REMOTE_MEDIA_STORAGE = 'castonaut.remote-media.v1';
const ID_REGISTRY_ADDRESS = '0x00000000Fc6c5F01Fc30151999387Bb99A9f489';
const ID_REGISTRY_ABI = [{ type: 'function', name: 'idOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: 'fid', type: 'uint256' }] }];
const state = { fid: null, signer: null, publicKey: '', custodyAddress: '', signerReady: false, nodeInfo: null, casts: [], people: new Map(), sourceBySigner: new Map(), parent: null, feedBusy: false, feedPending: null, feedRequest: 0, feedMode: 'following', feedTargetFid: null, boardMode: 'signals', savedCasts: [], deskPins: [], profileNotes: {}, remoteMediaEnabled: false };
let pendingRecoveryAccount = null;

function setStationTone() {
  const hour = new Date().getHours();
  document.documentElement.dataset.stationTone = hour < 10 ? 'morning' : hour < 16 ? 'day' : hour < 20 ? 'evening' : 'night';
}
setStationTone();

try {
  const pins = JSON.parse(localStorage.getItem(DESK_STORAGE) || '[]');
  if (Array.isArray(pins)) state.deskPins = [...new Set(pins.map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0))].slice(0, 24);
} catch { /* The desk stays usable when local storage is unavailable. */ }
try {
  const storedNotes = JSON.parse(localStorage.getItem(PROFILE_NOTES_STORAGE) || '{}');
  if (storedNotes && typeof storedNotes === 'object' && !Array.isArray(storedNotes)) state.profileNotes = storedNotes;
} catch { /* Local profile touches are optional. */ }
try { state.remoteMediaEnabled = localStorage.getItem(REMOTE_MEDIA_STORAGE) === 'true'; } catch { /* Remote media stays off when browser storage is unavailable. */ }

function resultOrThrow(result, label) {
  if (!result || (typeof result.isErr === 'function' && result.isErr())) throw new Error(`${label}: ${result?.error || 'could not create protocol message'}`);
  return result.value ?? result;
}

function hubOk(value) { return { value, isErr: () => false }; }

class BrowserEd25519Signer {
  constructor(privateKey, publicKey) { this.privateKey = privateKey; this.publicKey = new Uint8Array(publicKey); }
  async getSignerKey() { return hubOk(this.publicKey); }
  async signMessageHash(hash) {
    try { return hubOk(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, this.privateKey, hash))); }
    catch (error) { return { error, isErr: () => true }; }
  }
}

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

function updateConnectSteps(activeStep, completed = []) {
  const done = new Set(completed);
  document.querySelectorAll('[data-connect-step]').forEach((item) => {
    const step = item.dataset.connectStep;
    const isDone = done.has(step);
    item.classList.toggle('is-complete', isDone);
    item.classList.toggle('is-current', step === activeStep && !isDone);
    const label = item.querySelector('.step-state');
    if (label) label.textContent = isDone ? 'DONE' : step === activeStep ? 'NOW' : 'NEXT';
    const number = item.querySelector('.step-number');
    if (number) number.textContent = isDone ? '✓' : String([...document.querySelectorAll('[data-connect-step]')].indexOf(item) + 1);
  });
}

function setConnectionStatus(message, { active = 'sign', completed = [], canRetry = false, showTestAccount = false } = {}) {
  $('#dialog-status').textContent = message;
  updateConnectSteps(active, completed);
  $('#wallet-connect').hidden = canRetry || state.signerReady;
  $('#check-signer').hidden = !canRetry;
  $('#open-test-account').hidden = !showTestAccount;
}

function openConnectDialog() {
  if (state.signer && !state.signerReady) {
    setConnectionStatus('Your app key is saved in this browser. Check whether Snapchain has confirmed it before creating anything else.', { active: 'approve', completed: ['sign'], canRetry: true });
  } else if (state.signerReady) {
    setConnectionStatus('This browser is connected and ready for social actions.', { active: 'done', completed: ['sign', 'approve', 'done'] });
  } else {
    setConnectionStatus('', { active: 'sign', completed: [], canRetry: false });
  }
  $('#connect-dialog').showModal();
}

async function nodeRequest(route, params = {}, options = {}) {
  const url = new URL('/api/snapchain', window.location.origin);
  url.searchParams.set('route', route);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { ...options, headers: { accept: 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.details || `Node request failed (${response.status})`);
  return body;
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
  if (className) image.className = className;
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
  const numericTypes = { 1: 'pfp', 2: 'display', 3: 'bio', 5: 'url', 6: 'username' };
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
    if (bytes.length < 64) return null;
    const [decoded] = decodeAbiParameters([{
      type: 'tuple',
      components: [
        { name: 'requestFid', type: 'uint256' },
        { name: 'requestSigner', type: 'address' },
        { name: 'signature', type: 'bytes' },
        { name: 'deadline', type: 'uint256' },
      ],
    }], bytesHex(bytes));
    const fid = Number(decoded.requestFid);
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
  if (state.people.has(fid)) return state.people.get(fid);
  const [userData, signers] = await Promise.all([
    nodeRequest('userData', { fid, pageSize: 100, reverse: true }).catch(() => ({ messages: [] })),
    nodeRequest('signers', { fid, pageSize: 100 }).catch(() => ({ signers: [] })),
  ]);
  const fields = latestUserData(unwrapMessages(userData));
  const signerRows = Array.isArray(signers.signers) ? signers.signers : (signers.messages || []);
  for (const row of signerRows) {
    const keyBody = row?.data?.keyAddBody || row?.data?.signerAddBody || row;
    const signer = signerHex(keyBody.key || keyBody.signer);
    let clientFid = Number(keyBody.requesterFid || keyBody.request_fid || keyBody.sourceFid || row.requesterFid || 0) || null;
    if (!clientFid && keyBody.metadata) clientFid = decodeRequesterFid(keyBody.metadata);
    if (signer && clientFid && clientFid !== fid) state.sourceBySigner.set(signer, clientFid);
  }
  const profile = { fid, name: fields.display || fields.username || `Farcaster ${fid}`, username: fields.username || `fid-${fid}`, avatar: fields.pfp || '', bio: fields.bio || '' };
  state.people.set(fid, profile);
  return profile;
}

function setNodeState(kind, title, detail) {
  const led = $('#node-led');
  if (led) led.className = `node-led ${kind}`;
  $('#node-state').textContent = title;
  $('#node-detail').textContent = detail;
  const largeLed = $('#node-led-large'); if (largeLed) largeLed.className = `node-led large ${kind}`;
  const largeState = $('#node-state-large'); if (largeState) largeState.textContent = title;
  const largeDetail = $('#node-detail-large'); if (largeDetail) largeDetail.textContent = detail;
  $('#status-live').textContent = kind === 'good' ? '● READY' : kind === 'bad' ? '● UNAVAILABLE' : '● CHECKING';
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
    const shards = (info.shardInfos || []).filter((shard) => Number(shard.shardId) > 0);
    const delays = shards.map((shard) => Number(shard.blockDelay)).filter(Number.isFinite);
    const maxDelay = delays.length ? Math.max(...delays) : null;
    const telemetryDelay = $('#telemetry-delay'); if (telemetryDelay) telemetryDelay.textContent = maxDelay === null ? '—' : String(maxDelay);
    const meter = $('#delay-meter'); if (meter) meter.style.width = maxDelay === null ? '0%' : `${Math.max(6, Math.min(100, maxDelay * 3))}%`;
    const version = $('#node-version'); if (version) version.textContent = info.version || 'Unknown';
    const shardCount = $('#node-shards'); if (shardCount) shardCount.textContent = `${shards.length || info.numShards || '—'} ACTIVE`;
    const inSync = maxDelay !== null && maxDelay <= 10;
    const title = inSync ? 'Waystation service is ready' : 'The feed is catching up';
    const detail = inSync ? 'The service is connected. Verify your account to open your station.' : `The service is catching up${maxDelay === null ? '.' : `; its latest update is ${maxDelay} seconds behind.`}`;
    setNodeState(inSync ? 'good' : '', title, detail);
    const foot = $('#telemetry-foot'); if (foot) foot.textContent = inSync ? 'Connection is healthy. Sign in to open your account desk.' : 'The service is loading older network data. Try your feed again shortly.';
    const list = $('#shard-list');
    if (list) list.replaceChildren();
    for (const shard of list ? (info.shardInfos || []) : []) {
      const row = document.createElement('div'); row.className = 'shard-row';
      const label = document.createElement('span'); label.textContent = Number(shard.shardId) === 0 ? 'BLOCK SHARD' : `SHARD ${shard.shardId}`;
      const height = document.createElement('strong'); height.textContent = `HEIGHT ${Number(shard.maxHeight || 0).toLocaleString()}`;
      const delay = document.createElement('small'); delay.textContent = `${Number(shard.blockDelay || 0)}s delay`;
      row.append(label, height, delay); list.append(row);
    }
  } catch (error) {
    state.nodeInfo = null;
    const telemetryDelay = $('#telemetry-delay'); if (telemetryDelay) telemetryDelay.textContent = '—';
    const meter = $('#delay-meter'); if (meter) meter.style.width = '0%';
    const version = $('#node-version'); if (version) version.textContent = 'Not connected';
    const shardCount = $('#node-shards'); if (shardCount) shardCount.textContent = '—';
    const list = $('#shard-list');
    if (list) { const empty = document.createElement('div'); empty.className = 'empty-shards'; empty.textContent = 'App service is not connected.'; list.replaceChildren(empty); }
    const needsSetup = /SNAPCHAIN_URL|not configured|not been configured/i.test(error.message);
    const setupLink = $('#node-setup-link'); if (setupLink) setupLink.hidden = !needsSetup;
    if (setupLink && needsSetup) setupLink.textContent = 'See feed setup ↗';
    const localPreview = ['localhost', '127.0.0.1'].includes(location.hostname);
    const detail = needsSetup
      ? localPreview
        ? 'This preview needs a Snapchain endpoint. The hosted app connects for you.'
        : 'The app’s server needs its Snapchain URL configured before account desks can open.'
      : 'Feed service unavailable. Try again shortly.';
    const message = needsSetup ? (localPreview ? 'Local preview needs a node' : 'Feed service setup needed') : 'Feed service unavailable';
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

function renderCast(message) {
  const data = message?.data || {};
  const body = data.castAddBody || {};
  const fid = Number(data.fid) || 0;
  const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}`, avatar: '' };
  const card = document.createElement('article'); card.className = 'post-card';
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
  const copy = document.createElement('p'); copy.className = 'post-copy'; copy.textContent = body.text || '(empty cast)';
  content.append(head, copy);
  const imageEmbed = (body.embeds || []).find((embed) => /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(embed.url || ''));
  const embedUrl = state.remoteMediaEnabled ? safeImageUrl(imageEmbed?.url) : '';
  if (embedUrl && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(embedUrl)) content.append(makeRemoteImage(embedUrl, 'post-image'));
  else if (imageEmbed && !state.remoteMediaEnabled) { const mediaNote = document.createElement('span'); mediaNote.className = 'media-hidden-note'; mediaNote.textContent = 'IMAGE NOT LOADED · remote images are off'; content.append(mediaNote); }
  const actions = document.createElement('div'); actions.className = 'post-actions';
  const like = document.createElement('button'); like.type = 'button'; like.className = 'post-action'; like.textContent = '♡ Like'; like.dataset.action = 'like';
  const recast = document.createElement('button'); recast.type = 'button'; recast.className = 'post-action'; recast.textContent = '⟳ Recast'; recast.dataset.action = 'recast';
  const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'post-action'; reply.textContent = '↩ Reply'; reply.dataset.action = 'reply';
  const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'post-action'; follow.textContent = '＋ Follow'; follow.dataset.action = 'follow';
  const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'post-action pin-action'; pin.textContent = state.deskPins.includes(fid) ? '⌖ Pinned' : '⌖ Pin'; pin.dataset.action = 'pin-person';
  pin.setAttribute('aria-pressed', String(state.deskPins.includes(fid)));
  const flightLog = document.createElement('button'); flightLog.type = 'button'; flightLog.className = 'post-action flight-log-action';
  flightLog.dataset.flightLog = 'true'; flightLog.dataset.fid = String(fid); flightLog.dataset.hash = postHash(message);
  const saved = state.savedCasts.some((cast) => Number(cast.fid) === fid && cast.hash === postHash(message));
  flightLog.textContent = saved ? '★ Saved' : '☆ Save'; flightLog.setAttribute('aria-pressed', String(saved));
  for (const button of [like, recast, reply, follow, pin]) { button.dataset.fid = String(fid); button.dataset.hash = postHash(message); button.disabled = button !== pin && (!state.signerReady || (button === follow && fid === state.fid)); }
  actions.append(like, recast, reply, follow, pin, flightLog);
  content.append(actions); card.append(avatar, content);
  return card;
}

async function loadFeed(fidValue = state.fid, mode = state.feedMode) {
  if (!state.fid || !state.signerReady) {
    renderEmpty('Sign in to open your station.', 'Connect the wallet linked to your Farcaster account. Your identity and posting access are verified together.');
    return;
  }
  if (state.feedBusy) { state.feedPending = [fidValue, mode]; return; }
  let fid;
  try {
    fid = asFid(fidValue);
    if (mode !== 'profile' && fid !== Number(state.fid)) throw new Error('Your following feed can only be opened for the connected Farcaster account.');
  } catch (error) {
    renderEmpty('Could not load this station.', error.message, { type: 'retry', label: 'Try again' });
    $('#feed-count').textContent = '0 POSTS';
    setNotice(error.message, 'error');
    return;
  }
  state.feedMode = mode === 'profile' ? 'profile' : 'following';
  state.feedTargetFid = fid;
  const requestId = ++state.feedRequest;
  state.casts = [];
  $('#feed-pulse').hidden = true;
  renderProfileSummary();
  state.feedBusy = true;
  const list = $('#feed-list'); list.setAttribute('aria-busy', 'true');
  if (state.boardMode === 'signals') {
    $('#feed-title').textContent = state.feedMode === 'profile' ? 'Profile' : 'Signals';
    $('#feed-caption').textContent = state.feedMode === 'profile' ? `Recent posts by FID ${fid}.` : `Recent posts from the people followed by FID ${fid}.`;
  }
  renderEmpty('Gathering your people…', state.feedMode === 'profile' ? 'Loading this profile’s recent posts.' : 'Putting recent posts from the accounts you follow in one place.');
  try {
    if (!state.nodeInfo) checkNode();
    const [followResponse, profile] = await Promise.all([
      state.feedMode === 'following' ? nodeRequest('links', { fid, link_type: 'follow', pageSize: 100, reverse: true }) : Promise.resolve({ messages: [] }),
      fetchProfile(fid),
    ]);
    const followFids = unwrapMessages(followResponse).map((message) => Number(message?.data?.linkBody?.targetFid)).filter((target) => Number.isSafeInteger(target) && target > 0 && target !== fid);
    const uniqueFids = state.feedMode === 'profile' ? [fid] : [fid, ...new Set(followFids)].slice(0, 36);
    if (state.boardMode === 'signals') {
      $('#feed-title').textContent = state.feedMode === 'profile' ? localProfileName(profile) : 'Signals';
      $('#feed-caption').textContent = state.feedMode === 'profile' ? `@${profile.username} · FID ${fid} · recent posts` : `Recent posts from the people followed by FID ${fid}.`;
    }
    const castGroups = await mapLimit(uniqueFids, 8, async (target) => {
      const [response] = await Promise.all([nodeRequest('casts', { fid: target, pageSize: 12, reverse: true }), fetchProfile(target)]);
      return unwrapMessages(response).filter((message) => message?.data?.castAddBody);
    });
    if (requestId !== state.feedRequest) return;
    const messages = castGroups.flat().sort((a, b) => Number(b.data.timestamp || 0) - Number(a.data.timestamp || 0)).slice(0, 60);
    state.casts = messages;
    const profileFids = [...new Set(messages.map((message) => Number(message?.data?.fid)).filter((value) => value > 0))];
    const missingProfiles = profileFids.filter((target) => !state.people.has(target));
    await mapLimit(missingProfiles, 8, fetchProfile);
    const missingPins = state.deskPins.filter((target) => !state.people.has(target));
    await mapLimit(missingPins, 6, fetchProfile);
    renderDesk();
    renderFeed();
    $('#feed-filters').hidden = state.boardMode === 'flight-log';
    if (!messages.length) $('#feed-count').textContent = '0 POSTS';
    if (followFids.length > 35) setNotice('Showing the 35 most recent follows so the node stays responsive.');
  } catch (error) {
    if (requestId !== state.feedRequest) return;
    const needsSetup = /SNAPCHAIN_URL|not configured|not been configured/i.test(error.message);
    const localPreview = ['localhost', '127.0.0.1'].includes(location.hostname);
    const detail = needsSetup
      ? localPreview
        ? 'This local preview is not connected to a Snapchain node. Visitors to the hosted app will not need to run one.'
        : 'The app’s server needs its Snapchain URL configured before your station can load.'
      : error.message;
    const action = needsSetup
      ? (localPreview ? { type: 'guide', label: 'Open feed setup guide' } : null)
      : { type: 'retry', label: 'Try this account again' };
    renderEmpty(needsSetup ? 'Feed service is not connected yet.' : 'Could not build this feed.', detail, action);
    $('#feed-count').textContent = '0 POSTS';
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

function renderFeed() {
  const requestedSource = state.boardMode === 'signals' ? Number($('#source-fid').value) || null : null;
  const exclude = $('#source-mode').value === 'exclude';
  const sourceMessages = state.boardMode === 'flight-log' ? state.savedCasts.map(savedCastMessage) : state.casts;
  const messages = sourceMessages.filter((message) => {
    const source = state.sourceBySigner.get(signerHex(message.signer)) || null;
    if (!requestedSource) return true;
    return exclude ? source !== requestedSource : source === requestedSource;
  });
  const list = $('#feed-list');
  renderFeedPulse(messages);
  renderProfileSummary();
  if (!messages.length) {
    const sourceFilter = state.boardMode === 'signals' ? Number($('#source-fid').value) || null : null;
    if (state.boardMode === 'flight-log') {
      renderEmpty('Your Flight Log is empty.', 'Save a post from Signals and it will be waiting here on this device.');
    } else if (state.casts.length && sourceFilter) {
      renderEmpty('No posts match this source filter.', 'Source attribution can be unknown when a signer was not retained or registered as a gasless app key.', { type: 'clear-source', label: 'Clear source filter' });
    } else if (state.feedMode === 'profile') {
      const profile = state.people.get(state.feedTargetFid);
      renderEmpty('No recent posts on this profile.', profile ? `@${profile.username} has no posts in the recent history available from this node.` : 'This profile has no posts in the recent history available from this node.');
    } else {
      renderEmpty('Your feed is quiet for now.', 'There are no recent posts from the accounts you follow in the history available from this node.', { type: 'profile', label: 'View your own posts' });
    }
    $('#feed-count').textContent = state.boardMode === 'flight-log' ? '0 SAVED' : '0 POSTS';
    $('#feed-end').hidden = true;
    return;
  }
  $('#feed-count').textContent = state.boardMode === 'flight-log' ? `${messages.length} SAVED` : requestedSource ? `${messages.length} OF ${state.casts.length} POSTS` : `${messages.length} POSTS`;
  $('#feed-end').hidden = false;
  const fragment = document.createDocumentFragment();
  messages.forEach((message) => fragment.append(renderCast(message)));
  list.replaceChildren(fragment);
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
  const stats = $('#pulse-stats');
  stats.replaceChildren();
  const addStat = (label, value) => {
    const item = document.createElement('div'); item.className = 'pulse-stat';
    const strong = document.createElement('strong'); strong.textContent = value;
    const small = document.createElement('small'); small.textContent = label;
    item.append(strong, small); stats.append(item);
  };
  addStat('posts in this view', String(messages.length));
  addStat('people in this view', String(people.size));
  if (busiest) {
    const profile = state.people.get(busiest[0]) || { fid: busiest[0], name: `FID ${busiest[0]}` };
    addStat('most active', `${localProfileName(profile)} · ${busiest[1]}`);
  }
  $('#pulse-insight').textContent = busiest
    ? `${localProfileName(state.people.get(busiest[0]) || { fid: busiest[0], name: `FID ${busiest[0]}` })} appears most in the posts currently loaded. Counts are calculated in this tab; they are not network-wide analytics.`
    : 'No posts match the current view. Adjust the source filter to see this snapshot.';
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
  const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button button-outline'; edit.dataset.editProfile = String(profile.fid); edit.textContent = 'Personalize';
  actions.append(pin, edit); shell.append(avatar, identity, actions); card.replaceChildren(shell);
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

function renderDesk() {
  const container = $('#desk-pins');
  if (!container) return;
  container.replaceChildren();
  if (!state.deskPins.length) {
    const empty = document.createElement('span'); empty.className = 'desk-empty'; empty.textContent = 'Your desk is ready. Pin a person from any post to keep them here.'; container.append(empty); return;
  }
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
  state.boardMode = mode === 'flight-log' ? 'flight-log' : 'signals';
  const logMode = state.boardMode === 'flight-log';
  $('#show-signals').classList.toggle('is-active', !logMode);
  $('#show-signals').setAttribute('aria-pressed', String(!logMode));
  $('#show-flight-log').classList.toggle('is-active', logMode);
  $('#show-flight-log').setAttribute('aria-pressed', String(logMode));
  $('#page-label').textContent = logMode ? 'FLIGHT LOG' : state.feedMode === 'profile' ? 'PROFILE' : 'SIGNALS';
  $('#feed-title').textContent = logMode ? 'Flight Log' : state.feedMode === 'profile' ? (state.people.get(state.feedTargetFid)?.name || 'Profile file') : 'Signals';
  $('#feed-caption').textContent = logMode
    ? 'Posts saved on this device only. They are not shared to the Farcaster network.'
    : state.feedMode === 'profile' ? `Recent posts from @${state.people.get(state.feedTargetFid)?.username || 'this profile'}.` : 'Newest posts first.';
  $('#feed-filters').hidden = logMode || !state.casts.length;
  $('#composer').hidden = !state.signerReady || logMode;
  renderFeed();
}

function toggleFlightLog(fidValue, hashValue) {
  const fid = Number(fidValue);
  const hash = String(hashValue || '').toLowerCase();
  const match = (cast) => Number(cast.fid) === fid && String(cast.hash).toLowerCase() === hash;
  const prior = [...state.savedCasts];
  const existing = state.savedCasts.findIndex(match);
  if (existing >= 0) state.savedCasts.splice(existing, 1);
  else {
    const message = state.casts.find((cast) => Number(cast?.data?.fid) === fid && postHash(cast) === hash);
    if (!message) { setNotice('This transmission is no longer available to save. Refresh your signal board and try again.', 'error'); return; }
    if (state.savedCasts.length >= 100) { setNotice('Your Flight Log is full. Remove a saved post before adding another.'); return; }
    const profile = state.people.get(fid) || { fid, name: `Farcaster ${fid}`, username: `fid-${fid}` };
    const body = message.data?.castAddBody || {};
    const embeds = (body.embeds || []).filter((embed) => typeof embed?.url === 'string' && embed.url.length <= 2048).slice(0, 4).map((embed) => ({ url: embed.url }));
    state.savedCasts.unshift({ fid, hash, signer: signerHex(message.signer), text: String(body.text || '').slice(0, 320), timestamp: Number(message.data?.timestamp) || 0, name: String(profile.name || '').slice(0, 80), username: String(profile.username || '').slice(0, 80), embeds, savedAt: Date.now() });
  }
  try { localStorage.setItem(flightLogStorageKey(), JSON.stringify(state.savedCasts)); }
  catch { state.savedCasts = prior; setNotice('Browser storage is unavailable. Your Flight Log could not be updated.', 'error'); return; }
  renderFlightLogCount();
  renderFeed();
  setNotice(existing >= 0 ? 'Transmission removed from your Flight Log.' : 'Transmission saved to your Flight Log on this device.', 'success');
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
  if (recoveryAccount) {
    const custodyAddress = recoveryAccount.address;
    let registeredFid;
    try {
      const publicClient = createPublicClient({ chain: optimism, transport: http() });
      registeredFid = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [custodyAddress] });
    } catch (error) {
      throw new Error(`Could not verify this account on Optimism: ${error.message}`);
    }
    if (!registeredFid || BigInt(registeredFid) < 1n) throw new Error('This phrase’s first account is not linked to a Farcaster ID. Check the phrase and account index, or use your linked wallet.');
    const fid = asFid(registeredFid.toString());
    const eip712Signer = new protocol.ViemLocalEip712Signer(recoveryAccount);
    return { eip712Signer, custodyAddress, fid };
  }
  if (!window.ethereum) throw new Error('No compatible browser wallet was found. Use your linked wallet or open the advanced test-account option below.');
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
  } catch (error) {
    throw new Error(`Could not verify this custody address on Optimism: ${error.message}`);
  }
  if (!registeredFid || BigInt(registeredFid) < 1n) throw new Error('This wallet is not connected to a Farcaster account yet. Connect the custody wallet for your account and try again.');
  const fid = asFid(registeredFid.toString());
  const eip712Signer = new protocol.ViemWalletEip712Signer(createWalletClient({ account: custodyAddress, chain: optimism, transport: custom(window.ethereum) }));
  return { eip712Signer, custodyAddress, fid };
}

async function lookupRecoveryAccount() {
  const phraseField = $('#recovery-phrase');
  const lookupButton = $('#recovery-lookup');
  const accountPanel = $('#recovery-account');
  const phrase = phraseField.value.trim().toLowerCase().replace(/\s+/g, ' ');
  phraseField.value = '';
  pendingRecoveryAccount = null;
  accountPanel.hidden = true;
  if (!phrase) { setConnectionStatus('Enter the disposable test account phrase, or connect with your wallet.'); return; }
  const wordCount = phrase.split(' ').length;
  if (![12, 15, 18, 21, 24].includes(wordCount)) { setConnectionStatus('Use a standard 12, 15, 18, 21, or 24-word phrase. The field has been cleared.'); return; }
  lookupButton.disabled = true;
  setConnectionStatus('Deriving the first account in this tab and checking its Farcaster ID…', { active: 'sign' });
  try {
    const { mnemonicToAccount } = await import('viem/accounts');
    let account;
    try { account = mnemonicToAccount(phrase); }
    catch { throw new Error('That phrase could not be imported. Check the words and try again.'); }
    const publicClient = createPublicClient({ chain: optimism, transport: http() });
    let fid;
    try {
      fid = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [account.address] });
    } catch (error) {
      throw new Error(`Could not check the account on Optimism: ${error.message}`);
    }
    if (!fid || BigInt(fid) < 1n) throw new Error('The first account from this phrase is not linked to a Farcaster ID. Check the phrase/account or use your linked wallet.');
    pendingRecoveryAccount = { account, address: account.address, fid: asFid(fid.toString()) };
    $('#recovery-account-fid').textContent = `Farcaster account · FID ${pendingRecoveryAccount.fid}`;
    $('#recovery-account-address').textContent = `Custody address · ${account.address}`;
    $('#recovery-authorize').textContent = `Authorize key for FID ${pendingRecoveryAccount.fid}`;
    accountPanel.hidden = false;
    setConnectionStatus('Account found. Check the FID and custody address, then explicitly authorize this browser key.', { active: 'sign' });
  } catch (error) {
    setConnectionStatus(`${error.message} The phrase field has been cleared.`, { active: 'sign' });
  } finally {
    lookupButton.disabled = false;
  }
}

async function readCurrentNonce(fid) {
  const result = await nodeRequest('signers', { fid, pageSize: 100 });
  return Number(result.currentUserNonce || 0);
}

async function findSigner(fid, publicKey) {
  const result = await nodeRequest('signers', { fid, pageSize: 100 });
  const rows = Array.isArray(result.signers) ? result.signers : (result.messages || []);
  return rows.some((row) => {
    const body = row?.data?.keyAddBody || row?.data?.signerAddBody || row;
    return signerHex(body.key || body.signer) === publicKey.toLowerCase();
  });
}

async function waitForSigner(fid, publicKey, tries = 8) {
  for (let i = 0; i < tries; i++) {
    if (await findSigner(fid, publicKey)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  return false;
}

async function authorizeSigner(recoveryAccount = null) {
  const protocol = await import('./protocol.js');
  const status = $('#dialog-status');
  const connectButton = $('#wallet-connect');
  connectButton.disabled = true;
  const recoveryButton = $('#recovery-authorize');
  if (recoveryButton) recoveryButton.disabled = true;
  let relayAttempted = false;
  try {
    const saved = await loadSigner();
    const legacy = localStorage.getItem(LEGACY_KEY_STORAGE);
    if (state.signer || saved || legacy) throw new Error('This browser already has an app key saved. Reload to check its status, or use “Forget this browser” before creating another one.');
    setConnectionStatus(recoveryAccount
      ? 'Checking the disposable test account you verified…'
      : 'Finding the Farcaster account controlled by your wallet…', { active: 'sign' });
    const { eip712Signer, custodyAddress, fid } = await createCustodySigner(recoveryAccount?.account || null);
    if (recoveryAccount && (fid !== recoveryAccount.fid || custodyAddress.toLowerCase() !== recoveryAccount.address.toLowerCase())) throw new Error('The checked account changed. Close this panel and verify the test account again.');
    if (recoveryAccount) pendingRecoveryAccount = null;
    const { signer, publicKey: publicKeyBytes, privateKey } = await createBrowserSigner();
    const publicKey = bytesHex(publicKeyBytes);
    const nonce = await readCurrentNonce(fid);
    const deadline = Number(resultOrThrow(protocol.getFarcasterTime(), 'Could not read Farcaster time')) + 60 * 60;
    setConnectionStatus(recoveryAccount
      ? 'Your disposable test account will sign a limited app key locally. This gasless request cannot move funds.'
      : 'Review the wallet request. It authorizes a limited app key for up to 30 days; it does not move funds.', { active: 'sign' });
    const scopes = [protocol.MessageType.CAST_ADD, protocol.MessageType.CAST_REMOVE, protocol.MessageType.REACTION_ADD, protocol.MessageType.REACTION_REMOVE, protocol.MessageType.LINK_ADD, protocol.MessageType.LINK_REMOVE];
    const keyBody = resultOrThrow(await protocol.makeKeyAddBody({ fid: BigInt(fid), key: protocol.hexStringToBytes(publicKey), scopes, ttl: KEY_TTL_SECONDS, nonce: nonce + 1, deadline }, eip712Signer), 'Could not authorize the app key');
    const message = resultOrThrow(await protocol.makeKeyAdd(keyBody, { fid, network: protocol.FarcasterNetwork.MAINNET }, signer), 'Could not sign key registration');
    const signedRequest = protocol.Message.encode(message).finish();
    await storeSigner({ fid, publicKey, custodyAddress, privateKey, signedKeyAdd: toBase64(signedRequest) });
    setConnectionStatus(`${recoveryAccount ? 'Local test-account authorization' : 'Wallet authorization'} signed. Sending the app-key request to Snapchain…`, { active: 'approve', completed: ['sign'] });
    state.fid = fid;
    loadFlightLog(fid);
    state.signer = signer;
    state.publicKey = publicKey;
    state.custodyAddress = custodyAddress;
    state.signerReady = false;
    renderIdentity();
    status.textContent = 'Checking for network confirmation…';
    relayAttempted = true;
    const relayed = await submitMessage(message);
    if (!relayed.hash) throw new Error('The node accepted no message hash. Check node health and try again.');
    const confirmed = await waitForSigner(fid, publicKey);
    state.signerReady = confirmed;
    if (confirmed) loadFlightLog(state.fid);
    if (confirmed) await clearPendingRegistration();
    if (confirmed) await fetchProfile(fid).catch(() => null);
    renderIdentity();
    if (confirmed) {
      setConnectionStatus('Approved and confirmed. This browser is ready to post, follow, and react.', { active: 'done', completed: ['sign', 'approve', 'done'] });
      setNotice('Gasless app key confirmed. This browser is ready to write.', 'success');
      await loadFeed(fid);
      setTimeout(() => { if ($('#connect-dialog').open) $('#connect-dialog').close(); }, 2200);
    } else {
      setConnectionStatus('Snapchain accepted the request, but confirmation is still pending. Your key is saved here. Check again in a moment; posting stays paused until confirmation.', { active: 'approve', completed: ['sign'], canRetry: true });
      setNotice('Key relayed; merge is still pending. Writes stay locked until the node confirms it.', 'pending');
    }
  } catch (error) {
    if (relayAttempted) {
      state.signerReady = false;
      renderIdentity();
      setConnectionStatus(`The request may have reached the node, but confirmation failed. Your key is saved here. Check again before trying anything else. ${error.message}`, { active: 'approve', completed: ['sign'], canRetry: true });
    } else setConnectionStatus(error.message, {
      active: 'sign',
      showTestAccount: error.message.includes('No compatible browser wallet'),
    });
    setNotice(error.message, 'error');
  } finally {
    connectButton.disabled = false;
    if (recoveryButton) recoveryButton.disabled = false;
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
    if (!confirmed && saved?.signedKeyAdd) {
      setConnectionStatus('The key is not visible yet. Retrying its signed registration request, then checking for confirmation…', { active: 'approve', completed: ['sign'], canRetry: true });
      const encoded = fromBase64(saved.signedKeyAdd);
      try { await submitEncodedMessage(encoded); } catch { /* The first relay may already have accepted it; verify network state below. */ }
      confirmed = await waitForSigner(state.fid, state.publicKey);
    }
    state.signerReady = confirmed;
    if (confirmed) await clearPendingRegistration();
    if (confirmed) await fetchProfile(state.fid).catch(() => null);
    renderIdentity();
    if (confirmed) {
      setConnectionStatus('Approved and confirmed. This browser is ready to post, follow, and react.', { active: 'done', completed: ['sign', 'approve', 'done'] });
      setNotice('App key confirmed. This browser is ready to write.', 'success');
      await loadFeed(state.fid);
    } else {
      setConnectionStatus('Snapchain has not confirmed this key yet. Try again in a moment; do not create another key while this one is pending.', { active: 'approve', completed: ['sign'], canRetry: true });
    }
  } catch (error) {
    setConnectionStatus(`Could not check the saved key. It remains in this browser. ${error.message}`, { active: 'approve', completed: ['sign'], canRetry: true });
  } finally { button.disabled = false; }
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

async function getActiveSigner() {
  if (!state.fid || !state.signer) throw new Error('Connect a Farcaster signer before writing.');
  return state.signer;
}

async function signAndRelay(messageResult, successRoute, successParams, successText) {
  const message = resultOrThrow(messageResult, 'Could not create message');
  const accepted = await submitMessage(message);
  setNotice('The app service accepted your message for relay. Waiting for network confirmation…', 'pending');
  const confirmed = await waitForMerge(successRoute, successParams);
  if (!confirmed) throw new Error('The node accepted the message for relay, but merge is not confirmed yet. Try refresh in a moment.');
  setNotice(successText, 'success');
  return accepted;
}

function renderIdentity() {
  const empty = $('#identity-empty'); const connected = $('#identity-connected');
  const ready = !!state.fid && !!state.signerReady;
  $('#portal-gate').hidden = ready;
  $('#member-workspace').hidden = !ready;
  empty.hidden = !!state.fid; connected.hidden = !state.fid;
  $('#portal-enter').textContent = state.fid && !ready ? 'Check account authorization ↻' : 'Connect account & launch ↗';
  const portalStatus = $('#portal-status');
  if (portalStatus) portalStatus.textContent = state.fid && !ready ? 'Your account is identified. The app key is still awaiting confirmation, so the desk stays locked.' : 'Your identity and posting access unlock together.';
  if (!state.fid) { $('#avatar-initial').textContent = '?'; $('#composer').hidden = true; return; }
  const profile = state.people.get(state.fid) || { fid: state.fid, name: `Farcaster ${state.fid}`, username: `fid-${state.fid}` };
  const shownName = localProfileName(profile);
  $('#avatar-initial').textContent = shownName.slice(0, 1).toUpperCase();
  $('#profile-name').textContent = shownName;
  $('#profile-handle').textContent = `@${profile.username} · FID ${state.fid}`;
  $('#profile-avatar').textContent = profile.name.slice(0, 1).toUpperCase();
  const avatarUrl = state.remoteMediaEnabled ? safeImageUrl(profile.avatar) : '';
  if (avatarUrl) $('#profile-avatar').replaceChildren(makeRemoteImage(avatarUrl));
  $('#composer').hidden = !state.signerReady || state.boardMode === 'flight-log';
  $('#composer-context').textContent = state.signerReady ? 'Scoped key · stored in this browser' : 'App key is awaiting merge confirmation';
  $('#composer-text').disabled = !state.signerReady;
  $('#composer button[type="submit"]').disabled = !state.signerReady;
  document.querySelectorAll('.post-action:not(.pin-action)').forEach((button) => { button.disabled = !state.signerReady; });
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
    renderIdentity();
    if (!state.signerReady) setNotice('This app key is not confirmed on the current node. Your station stays locked.');
    else await loadFeed(state.fid);
  } catch (error) {
    state.signerReady = false;
    renderIdentity();
    setNotice(`Could not confirm the saved app key with the app service. It remains stored in this browser. ${error.message}`);
  }
}

async function clearLocalSigner() {
  try { localStorage.removeItem(LEGACY_KEY_STORAGE); } catch { /* Continue clearing the current session. */ }
  const cleared = await removeStoredSigner();
  state.fid = null; state.signer = null; state.publicKey = ''; state.signerReady = false; state.custodyAddress = ''; state.boardMode = 'signals';
  state.feedRequest += 1; state.feedPending = null; state.casts = []; state.feedTargetFid = null; state.feedMode = 'following';
  state.savedCasts = []; renderFlightLogCount();
  $('#show-signals').classList.add('is-active'); $('#show-signals').setAttribute('aria-pressed', 'true');
  $('#show-flight-log').classList.remove('is-active'); $('#show-flight-log').setAttribute('aria-pressed', 'false'); $('#page-label').textContent = 'SIGNALS';
  $('#feed-title').textContent = 'Signals'; $('#feed-caption').textContent = 'Sign in to open your chronological following feed.';
  $('#feed-filters').hidden = true; $('#feed-pulse').hidden = true; $('#profile-summary').hidden = true; $('#feed-count').textContent = '0 POSTS';
  renderEmpty('Your station is locked.', 'Sign in with the wallet linked to your Farcaster account to continue.');
  renderIdentity();
  if (!cleared) { setNotice('This session is signed out, but browser storage could not delete the app key. Revoke it in Farcaster account settings and clear this site’s browser data.', 'error'); return; }
  setNotice('This browser forgot its signing key. The Farcaster signer remains active until you revoke it from account settings or it expires.', 'pending');
}

function navigate(view) {
  const target = view === 'node' ? 'node' : 'desk';
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== target; });
  document.querySelectorAll('[data-view]').forEach((link) => link.classList.toggle('active', link.dataset.view === target));
  $('#page-label').textContent = target === 'node' ? 'ABOUT' : state.boardMode === 'flight-log' ? 'FLIGHT LOG' : state.feedMode === 'profile' ? 'PROFILE' : 'SIGNALS';
  const expectedHash = target === 'node' ? '#about' : '#desk';
  if (location.hash !== expectedHash) history.replaceState(null, '', expectedHash);
  if (target === 'node') $('#node-view').scrollIntoView({ block: 'start' });
}

function castBody(text, parent, protocol) {
  const body = { text, type: protocol.CastType.CAST, embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [] };
  if (parent) body.parentCastId = { fid: Number(parent.fid), hash: protocol.hexStringToBytes(parent.hash) };
  return body;
}

$('#feed-refresh').addEventListener('click', () => state.boardMode === 'flight-log' ? renderFeed() : loadFeed(state.feedTargetFid || state.fid));
$('#show-signals').addEventListener('click', () => setBoardMode('signals'));
$('#show-flight-log').addEventListener('click', () => setBoardMode('flight-log'));
$('#refresh-node').addEventListener('click', checkNode);
$('#refresh-node-large')?.addEventListener('click', checkNode);
document.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); navigate(link.dataset.view); }));
window.addEventListener('hashchange', () => navigate(location.hash === '#node' || location.hash === '#about' ? 'node' : 'desk'));
document.addEventListener('click', async (event) => {
  const deskButton = event.target.closest('[data-desk-fid]');
  if (!deskButton) return;
  const fid = Number(deskButton.dataset.deskFid);
  navigate('desk');
  if (state.boardMode !== 'signals') setBoardMode('signals');
  await loadFeed(fid, 'profile');
});
$('#source-fid').addEventListener('input', renderFeed);
$('#source-mode').addEventListener('change', renderFeed);
$('#external-images').checked = state.remoteMediaEnabled;
$('#external-images').addEventListener('change', (event) => {
  state.remoteMediaEnabled = event.currentTarget.checked;
  try { localStorage.setItem(REMOTE_MEDIA_STORAGE, String(state.remoteMediaEnabled)); } catch { /* Apply for this page even if preferences cannot be saved. */ }
  renderFeed(); renderDesk(); renderProfileSummary(); renderIdentity();
  setNotice(state.remoteMediaEnabled ? 'Remote images are on. Their hosts can see your IP address.' : 'Remote images are off. Your browser will not request profile or cast images.', state.remoteMediaEnabled ? 'pending' : 'success');
});
$('#open-account').addEventListener('click', openConnectDialog);
$('#portal-enter').addEventListener('click', () => {
  openConnectDialog();
  if (state.signer && !state.signerReady) $('#check-signer').hidden = false;
});
$('#manage-key').addEventListener('click', () => { if (confirm('Delete Castonaut’s signing key from this browser? This pauses posting here, but does not revoke the Farcaster signer. Revoke it separately in Farcaster account settings.')) clearLocalSigner(); });
$('#wallet-connect').addEventListener('click', () => authorizeSigner());
$('#check-signer').addEventListener('click', () => checkSavedSigner());
$('#open-test-account').addEventListener('click', () => {
  const recoveryImport = $('#recovery-import');
  recoveryImport.open = true;
  recoveryImport.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#recovery-phrase').focus({ preventScroll: true });
});
$('#recovery-lookup').addEventListener('click', () => lookupRecoveryAccount());
$('#recovery-authorize').addEventListener('click', () => {
  if (!pendingRecoveryAccount) { setConnectionStatus('Verify the test account again before authorizing a key.'); return; }
  authorizeSigner(pendingRecoveryAccount);
});
function clearRecoveryImport() {
  pendingRecoveryAccount = null;
  const phraseField = $('#recovery-phrase'); if (phraseField) phraseField.value = '';
  const accountPanel = $('#recovery-account'); if (accountPanel) accountPanel.hidden = true;
}
$('#recovery-import').addEventListener('toggle', (event) => { if (!event.currentTarget.open) clearRecoveryImport(); });
$('#connect-dialog').addEventListener('close', clearRecoveryImport);
$('#connect-dialog').addEventListener('click', (event) => { if (event.target === $('#connect-dialog')) $('#connect-dialog').close(); });
$('#composer-text').addEventListener('input', () => { $('#char-count').textContent = `${[...$('#composer-text').value].length} / 320`; });
$('#composer-text').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.parent) {
    state.parent = null;
    $('#composer-text').placeholder = 'Send a signal to the network…';
    setNotice('Reply cancelled.');
  }
});

$('#composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('#composer-text').value.trim();
  if (!text) return;
  const submit = $('#composer button[type="submit"]'); submit.disabled = true;
  try {
    const protocol = await import('./protocol.js');
    const signer = await getActiveSigner();
    const message = await protocol.makeCastAdd(castBody(text, state.parent, protocol), { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, signer);
    const signedMessage = resultOrThrow(message, 'Could not sign cast');
    const hash = postHash(signedMessage);
    await signAndRelay({ value: signedMessage }, 'castById', { fid: state.fid, hash }, 'Cast merged into Snapchain.');
    $('#composer-text').value = ''; $('#char-count').textContent = '0 / 320'; state.parent = null; $('#composer-text').placeholder = 'Send a signal to the network…';
    await loadFeed(state.fid, 'following');
  } catch (error) { setNotice(error.message, 'error'); }
  finally { submit.disabled = !state.signerReady; }
});

document.addEventListener('click', async (event) => {
  const flightButton = event.target.closest('[data-flight-log]');
  if (flightButton) { toggleFlightLog(flightButton.dataset.fid, flightButton.dataset.hash); return; }
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
    await loadFeed(fid, 'profile');
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  try {
    if (button.dataset.action === 'pin-person' || button.dataset.action === 'unpin-person') { await toggleDeskPin(button.dataset.fid, button.dataset.action === 'pin-person' ? button : null); if (button.dataset.action === 'unpin-person') renderFeed(); return; }
    if (!state.signerReady) { $('#connect-dialog').showModal(); return; }
    const targetFid = Number(button.dataset.fid); const hash = button.dataset.hash;
    if (button.dataset.action === 'reply') {
      state.parent = { fid: targetFid, hash };
      $('#composer-text').placeholder = `Replying to FID ${targetFid}…`;
      $('#composer-text').focus(); $('#composer').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    button.disabled = true;
    const protocol = await import('./protocol.js');
    if (button.dataset.action === 'follow') {
      const message = await protocol.makeLinkAdd({ type: 'follow', targetFid }, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner());
      await signAndRelay(message, 'linkById', { fid: state.fid, target_fid: targetFid, link_type: 'follow' }, `Follow of FID ${targetFid} confirmed.`);
      button.textContent = '✓ Following';
    } else {
      const reactionType = button.dataset.action === 'like' ? protocol.ReactionType.LIKE : protocol.ReactionType.RECAST;
      const routeType = button.dataset.action === 'like' ? 'Like' : 'Recast';
      const message = await protocol.makeReactionAdd({ type: reactionType, targetCastId: { fid: targetFid, hash: protocol.hexStringToBytes(hash) } }, { fid: state.fid, network: protocol.FarcasterNetwork.MAINNET }, await getActiveSigner());
      await signAndRelay(message, 'reactionById', { fid: state.fid, target_fid: targetFid, target_hash: hash, reaction_type: routeType }, routeType === 'Like' ? 'Like confirmed in Snapchain.' : 'Recast confirmed in Snapchain.');
      button.textContent = routeType === 'Like' ? '♥ Liked' : '✓ Recast';
    }
    button.setAttribute('aria-pressed', 'true');
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

if (location.hash === '#node' || location.hash === '#about') navigate('node');
renderDesk();
renderFlightLogCount();
setBoardMode('signals');
checkNode().then(() => renderDesk());
restoreSession();
setInterval(() => { if (!document.hidden) { setStationTone(); checkNode(); } }, 60_000);
