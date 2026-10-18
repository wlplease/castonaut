import './styles.css';
import { createPublicClient, createWalletClient, custom, isAddress } from 'viem';
import { optimism } from 'viem/chains';

const $ = (selector) => document.querySelector(selector);
const FARCASTER_EPOCH_MS = Date.UTC(2021, 0, 1);
const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const KEY_STORAGE = 'openroom.snapchain.signer.v1';
const FEED_STORAGE = 'openroom.last-feed.v1';
const DESK_STORAGE = 'packet-porch.desk-pins.v1';
const ID_REGISTRY_ADDRESS = '0x00000000Fc6c5F01Fc30151999387Bb99A9f489';
const ID_REGISTRY_ABI = [{ type: 'function', name: 'idOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: 'fid', type: 'uint256' }] }];
const state = { fid: null, signerKey: null, signer: null, custodyAddress: '', signerReady: false, nodeInfo: null, casts: [], people: new Map(), sourceBySigner: new Map(), parent: null, feedBusy: false, feedMode: 'following', deskPins: [] };

try {
  const pins = JSON.parse(localStorage.getItem(DESK_STORAGE) || '[]');
  if (Array.isArray(pins)) state.deskPins = [...new Set(pins.map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0))].slice(0, 24);
} catch { /* The desk stays usable when local storage is unavailable. */ }

function resultOrThrow(result, label) {
  if (!result || (typeof result.isErr === 'function' && result.isErr())) throw new Error(`${label}: ${result?.error || 'could not create protocol message'}`);
  return result.value ?? result;
}

function setNotice(message, kind = 'info') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.hidden = false;
  clearTimeout(setNotice.timer);
  setNotice.timer = setTimeout(() => { toast.hidden = true; }, 5600);
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
  const fid = Number(value);
  if (!Number.isSafeInteger(fid) || fid < 1) throw new Error('Enter a valid Farcaster ID (a positive whole number).');
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

function unwrapMessages(response) {
  if (Array.isArray(response?.messages)) return response.messages;
  if (Array.isArray(response?.items)) return response.items;
  if (response?.data?.castAddBody || response?.data?.userDataBody || response?.data?.linkBody) return [response];
  return [];
}

function latestUserData(messages) {
  const fields = {};
  const numericTypes = { 1: 'display', 2: 'pfp', 3: 'username' };
  for (const message of messages) {
    const body = message?.data?.userDataBody;
    if (!body) continue;
    const type = typeof body.type === 'number' ? numericTypes[body.type] : String(body.type || '').replace('USER_DATA_TYPE_', '').toLowerCase();
    if (type && !(type in fields)) fields[type] = body.value;
  }
  return fields;
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
    const clientFid = Number(keyBody.requesterFid || keyBody.request_fid || keyBody.sourceFid || row.requesterFid || 0) || null;
    if (signer && clientFid && clientFid !== fid) state.sourceBySigner.set(signer, clientFid);
  }
  const profile = { fid, name: fields.display || fields.username || `Farcaster ${fid}`, username: fields.username || `fid-${fid}`, avatar: fields.pfp || '' };
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
    const title = inSync ? 'You’re ready to read' : 'The feed is catching up';
    const detail = inSync ? 'The service is connected and your Farcaster feed is ready.' : `The service is catching up${maxDelay === null ? '.' : `; its latest update is ${maxDelay} seconds behind.`}`;
    setNodeState(inSync ? 'good' : '', title, detail);
    const foot = $('#telemetry-foot'); if (foot) foot.textContent = inSync ? 'Connection is healthy. You can read without connecting a wallet.' : 'The service is loading older network data. Try your feed again shortly.';
    const list = $('#shard-list');
    if (list) list.replaceChildren();
    for (const shard of list ? (info.shardInfos || []) : []) {
      const row = document.createElement('div'); row.className = 'shard-row';
      const label = document.createElement('span'); label.textContent = shard.shardId === 0 ? 'BLOCK SHARD' : `SHARD ${shard.shardId}`;
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
    const list = $('#shard-list'); if (list) list.innerHTML = '<div class="empty-shards">App service is not connected.</div>';
    const needsSetup = /SNAPCHAIN_URL|not configured|not been configured/i.test(error.message);
    const setupLink = $('#node-setup-link'); if (setupLink) setupLink.hidden = !needsSetup;
    setNodeState('bad', needsSetup ? 'Feed service needs setup' : 'Feed service unavailable', needsSetup ? 'The site host needs a Snapchain endpoint before feeds can load.' : 'The shared feed service is not responding right now. Try again shortly.');
    const largeDetail = $('#node-detail-large'); if (largeDetail) largeDetail.textContent = error.message;
    const foot = $('#telemetry-foot'); if (foot) foot.textContent = 'The app service is not connected. The app team can check the optional setup guide.';
  } finally {
    if (small) small.disabled = false;
    if (large) large.disabled = false;
  }
}

function renderEmpty(title, copy, buttonText) {
  const box = document.createElement('div'); box.className = 'empty-message';
  const strong = document.createElement('strong'); strong.textContent = title;
  const p = document.createElement('p'); p.textContent = copy;
  box.append(strong, p);
  if (buttonText) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.textContent = buttonText;
    button.addEventListener('click', () => buttonText.toLowerCase().startsWith('try') ? loadFeed($('#fid-input').value, state.feedMode) : $('#fid-input').focus());
    box.append(button);
  }
  $('#feed-list').replaceChildren(box);
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
  if (profile.avatar && /^https?:\/\//i.test(profile.avatar)) { const image = document.createElement('img'); image.src = profile.avatar; image.alt = ''; image.loading = 'lazy'; avatar.append(image); }
  else avatar.textContent = (profile.name || '?').trim().slice(0, 1).toUpperCase();
  const content = document.createElement('div');
  const head = document.createElement('div'); head.className = 'post-head';
  const name = document.createElement('button'); name.type = 'button'; name.className = 'post-profile-link'; name.dataset.openProfile = String(fid); name.setAttribute('aria-label', `Open ${profile.name}'s recent posts`); name.textContent = profile.name;
  const handle = document.createElement('span'); handle.className = 'post-handle'; handle.textContent = `@${profile.username}`;
  const time = document.createElement('span'); time.className = 'post-time'; time.textContent = farcasterDate(data.timestamp);
  const source = document.createElement('span'); source.className = 'post-source';
  const sourceFid = state.sourceBySigner.get(signerHex(message.signer));
  source.textContent = sourceFid ? `APP FID ${sourceFid}` : 'SOURCE UNKNOWN';
  head.append(name, handle, time, source);
  const copy = document.createElement('p'); copy.className = 'post-copy'; copy.textContent = body.text || '(empty cast)';
  content.append(head, copy);
  const imageEmbed = (body.embeds || []).find((embed) => /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(embed.url || ''));
  if (imageEmbed && /^https?:\/\//i.test(imageEmbed.url)) { const image = document.createElement('img'); image.className = 'post-image'; image.src = imageEmbed.url; image.alt = 'Cast attachment'; image.loading = 'lazy'; content.append(image); }
  const actions = document.createElement('div'); actions.className = 'post-actions';
  const like = document.createElement('button'); like.type = 'button'; like.className = 'post-action'; like.textContent = '♡ Like'; like.dataset.action = 'like';
  const recast = document.createElement('button'); recast.type = 'button'; recast.className = 'post-action'; recast.textContent = '⟳ Recast'; recast.dataset.action = 'recast';
  const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'post-action'; reply.textContent = '↩ Reply'; reply.dataset.action = 'reply';
  const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'post-action'; follow.textContent = '＋ Follow'; follow.dataset.action = 'follow';
  const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'post-action pin-action'; pin.textContent = state.deskPins.includes(fid) ? '⌖ On your desk' : '⌖ Pin'; pin.dataset.action = 'pin-person';
  pin.setAttribute('aria-pressed', String(state.deskPins.includes(fid)));
  for (const button of [like, recast, reply, follow, pin]) { button.dataset.fid = String(fid); button.dataset.hash = postHash(message); button.disabled = button !== pin && (!state.signerReady || (button === follow && fid === state.fid)); }
  actions.append(like, recast, reply, follow, pin);
  const context = document.createElement('span'); context.className = 'post-context'; context.textContent = `FID ${fid}`;
  actions.append(context); content.append(actions); card.append(avatar, content);
  return card;
}

async function loadFeed(fidValue = $('#fid-input').value, mode = state.feedMode) {
  if (state.feedBusy) return;
  let fid;
  try { fid = asFid(fidValue); } catch (error) { setNotice(error.message); return; }
  try { localStorage.setItem(FEED_STORAGE, String(fid)); } catch { /* Feed reading still works if browser storage is unavailable. */ }
  $('#forget-feed').hidden = false;
  state.feedMode = mode === 'profile' ? 'profile' : 'following';
  state.feedBusy = true;
  const list = $('#feed-list'); list.setAttribute('aria-busy', 'true');
  $('#feed-title').textContent = state.feedMode === 'profile' ? 'Profile' : 'Following feed';
  $('#feed-caption').textContent = state.feedMode === 'profile' ? `Recent posts by FID ${fid}.` : `Recent posts from the people followed by FID ${fid}.`;
  list.innerHTML = '<div class="empty-message"><strong>Gathering your people…</strong><p>Putting recent posts from the accounts you follow in one place.</p></div>';
  try {
    if (!state.nodeInfo) checkNode();
    const [followResponse, profile] = await Promise.all([
      state.feedMode === 'following' ? nodeRequest('links', { fid, link_type: 'follow', pageSize: 100, reverse: true }) : Promise.resolve({ messages: [] }),
      fetchProfile(fid),
    ]);
    const followFids = unwrapMessages(followResponse).map((message) => Number(message?.data?.linkBody?.targetFid)).filter((target) => Number.isSafeInteger(target) && target > 0 && target !== fid);
    const uniqueFids = state.feedMode === 'profile' ? [fid] : [fid, ...new Set(followFids)].slice(0, 36);
    $('#feed-title').textContent = state.feedMode === 'profile' ? profile.name : 'Following feed';
    $('#feed-caption').textContent = state.feedMode === 'profile' ? `@${profile.username} · FID ${fid} · recent posts` : `Recent posts from the people followed by FID ${fid}.`;
    const castGroups = await mapLimit(uniqueFids, 8, async (target) => {
      const [response] = await Promise.all([nodeRequest('casts', { fid: target, pageSize: 12, reverse: true }), fetchProfile(target)]);
      return unwrapMessages(response).filter((message) => message?.data?.castAddBody);
    });
    const messages = castGroups.flat().sort((a, b) => Number(b.data.timestamp || 0) - Number(a.data.timestamp || 0)).slice(0, 60);
    state.casts = messages;
    const profileFids = [...new Set(messages.map((message) => Number(message?.data?.fid)).filter((value) => value > 0))];
    const missingProfiles = profileFids.filter((target) => !state.people.has(target));
    await mapLimit(missingProfiles, 8, fetchProfile);
    renderFeed();
    $('#feed-filters').hidden = false;
    $('#feed-end').hidden = messages.length === 0;
    $('#feed-count').textContent = `${messages.length} CAST${messages.length === 1 ? '' : 'S'}`;
    if (followFids.length > 35) setNotice('Showing the 35 most recent follows so the node stays responsive.');
  } catch (error) {
    const needsSetup = /SNAPCHAIN_URL|not configured|not been configured/i.test(error.message);
    const detail = needsSetup
      ? 'The site host needs to connect a Snapchain endpoint. Use the Host setup link above for the server steps.'
      : error.message;
    renderEmpty(needsSetup ? 'The feed service needs setup.' : 'Could not build this feed.', detail, needsSetup ? null : 'Try this FID again');
    $('#feed-count').textContent = '0 POSTS';
  } finally {
    state.feedBusy = false;
    list.setAttribute('aria-busy', 'false');
  }
}

function renderFeed() {
  const requestedSource = Number($('#source-fid').value) || null;
  const exclude = $('#source-mode').value === 'exclude';
  const messages = state.casts.filter((message) => {
    const source = state.sourceBySigner.get(String(message.signer || '').toLowerCase()) || null;
    if (!requestedSource) return true;
    return exclude ? source !== requestedSource : source === requestedSource;
  });
  const list = $('#feed-list');
  if (!messages.length) { renderEmpty('Nothing matches this view.', 'No casts were returned, or your source filter removed them. Source attribution can be unknown when the signer was not retained or registered as a gasless app key.'); return; }
  const fragment = document.createDocumentFragment();
  messages.forEach((message) => fragment.append(renderCast(message)));
  list.replaceChildren(fragment);
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
    const avatar = document.createElement('span'); avatar.className = 'desk-avatar'; avatar.textContent = (profile.name || '?').trim().slice(0, 1).toUpperCase();
    if (profile.avatar && /^https?:\/\//i.test(profile.avatar)) { const image = document.createElement('img'); image.src = profile.avatar; image.alt = ''; image.loading = 'lazy'; avatar.replaceChildren(image); }
    const labels = document.createElement('span'); labels.className = 'desk-person-label';
    const name = document.createElement('strong'); name.textContent = profile.name;
    const handle = document.createElement('small'); handle.textContent = `@${profile.username}`;
    labels.append(name, handle); open.append(avatar, labels);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'desk-unpin'; remove.dataset.action = 'unpin-person'; remove.dataset.fid = String(fid); remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${profile.name} from your desk`);
    chip.append(open, remove); container.append(chip);
  }
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
    button.textContent = pinned ? '⌖ On your desk' : '⌖ Pin';
    button.setAttribute('aria-pressed', String(pinned));
  }
  setNotice(state.deskPins.includes(fid) ? 'Pinned to your desk on this device.' : 'Removed from your desk.', 'success');
}

function base64(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function fromBase64(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function bytesHex(bytes) { return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`; }

async function createCustodySigner(mode) {
  const protocol = await import('./protocol.js');
  let custodyAccount;
  if (mode === 'seed') {
    const phrase = $('#seed-input').value.trim().replace(/\s+/g, ' ');
    if (phrase.split(' ').length < 12) throw new Error('Enter a complete disposable test phrase.');
    $('#seed-input').value = '';
    const { mnemonicToAccount } = await import('viem/accounts');
    custodyAccount = mnemonicToAccount(phrase);
    // Drop the local reference as soon as the wallet account has been derived.
    // This mode is only exposed on localhost; no API request contains the phrase.
  } else {
    if (!window.ethereum) throw new Error('No Ethereum wallet was found. Install or open a wallet, then try again.');
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (Number.parseInt(chainId, 16) !== 10) await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa' }] });
    const addresses = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = addresses?.[0];
    if (!address || !isAddress(address)) throw new Error('The wallet did not return a valid address.');
    custodyAccount = address;
  }

  const custodyAddress = typeof custodyAccount === 'string' ? custodyAccount : custodyAccount.address;
  let registeredFid;
  try {
    if (typeof custodyAccount === 'string') {
      const publicClient = createPublicClient({ chain: optimism, transport: custom(window.ethereum) });
      registeredFid = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [custodyAddress] });
    } else {
      // The development-only path never sends custody material to a service. It reads the public
      // registry over the user's configured wallet RPC and signs the authorization locally.
      const { createPublicClient, http } = await import('viem');
      const publicClient = createPublicClient({ chain: optimism, transport: http('https://mainnet.optimism.io') });
      registeredFid = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [custodyAddress] });
    }
  } catch (error) {
    throw new Error(`Could not verify this custody address on Optimism: ${error.message}`);
  }
  if (!registeredFid || BigInt(registeredFid) < 1n) throw new Error('This wallet is not connected to a Farcaster account yet. Connect the custody wallet for your account and try again.');
  const fid = asFid(registeredFid.toString());
  const eip712Signer = typeof custodyAccount === 'string'
    ? new protocol.ViemWalletEip712Signer(createWalletClient({ account: custodyAddress, chain: optimism, transport: custom(window.ethereum) }))
    : new protocol.ViemLocalEip712Signer(custodyAccount);
  return { eip712Signer, custodyAddress, fid };
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

async function authorizeSigner(mode) {
  const protocol = await import('./protocol.js');
  const status = $('#dialog-status');
  const connectButton = mode === 'seed' ? $('#seed-connect') : $('#wallet-connect');
  connectButton.disabled = true;
  try {
    status.textContent = 'Finding your Farcaster account and preparing a scoped key…';
    const { eip712Signer, custodyAddress, fid } = await createCustodySigner(mode);
    const signerKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const signer = new protocol.NobleEd25519Signer(signerKeyBytes);
    const publicKey = bytesHex(resultOrThrow(await signer.getSignerKey(), 'Could not create app key'));
    const nonce = await readCurrentNonce(fid);
    const deadline = Number(resultOrThrow(protocol.getFarcasterTime(), 'Could not read Farcaster time')) + 60 * 60;
    status.textContent = 'Your wallet will authorize a 30-day gasless app key. No transaction or network fee is requested.';
    const scopes = [protocol.MessageType.CAST_ADD, protocol.MessageType.CAST_REMOVE, protocol.MessageType.REACTION_ADD, protocol.MessageType.REACTION_REMOVE, protocol.MessageType.LINK_ADD, protocol.MessageType.LINK_REMOVE];
    const keyBody = resultOrThrow(await protocol.makeKeyAddBody({ fid: BigInt(fid), key: protocol.hexStringToBytes(publicKey), scopes, ttl: KEY_TTL_SECONDS, nonce: nonce + 1, deadline }, eip712Signer), 'Could not authorize the app key');
    const message = resultOrThrow(await protocol.makeKeyAdd(keyBody, { fid, network: protocol.FarcasterNetwork.MAINNET }, signer), 'Could not sign key registration');
    status.textContent = 'Sending KEY_ADD through your read node…';
    const relayed = await submitMessage(message);
    if (!relayed.hash) throw new Error('The node accepted no message hash. Check node health and try again.');
    const confirmed = await waitForSigner(fid, publicKey);
    state.fid = fid;
    state.signerKey = signerKeyBytes;
    state.signer = signer;
    state.custodyAddress = custodyAddress;
    state.signerReady = confirmed;
    $('#fid-input').value = String(fid);
    try { localStorage.setItem(FEED_STORAGE, String(fid)); } catch { /* Account connection still works without feed preference storage. */ }
    localStorage.setItem(KEY_STORAGE, JSON.stringify({ fid, key: base64(signerKeyBytes), publicKey, custodyAddress }));
    await fetchProfile(fid);
    renderIdentity();
    if (confirmed) {
      status.textContent = 'App key confirmed in Snapchain. This browser can now post, follow, and react.';
      setNotice('Gasless app key confirmed. This browser is ready to write.', 'success');
      loadFeed(String(fid));
      setTimeout(() => $('#connect-dialog').close(), 1300);
    } else {
      status.textContent = 'The read node accepted the key for relay but has not confirmed merge yet. The key is saved locally; try again after the next block.';
      setNotice('Key relayed; merge is still pending. Writes stay locked until the node confirms it.', 'pending');
    }
  } catch (error) {
    status.textContent = error.message;
    setNotice(error.message, 'error');
  } finally {
    connectButton.disabled = false;
    if (mode === 'seed') $('#seed-input').value = '';
  }
}

async function submitMessage(message) {
  const { Message } = await import('./protocol.js');
  const encoded = Message.encode(message).finish();
  return nodeRequest('submit', {}, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: encoded });
}

async function waitForMerge(route, params, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try { await nodeRequest(route, params); return true; } catch { await new Promise((resolve) => setTimeout(resolve, 1800)); }
  }
  return false;
}

async function getActiveSigner() {
  if (!state.fid || !state.signerKey) throw new Error('Connect a Farcaster signer before writing.');
  if (state.signer) return state.signer;
  const { NobleEd25519Signer } = await import('./protocol.js');
  return new NobleEd25519Signer(state.signerKey);
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
  empty.hidden = !!state.fid; connected.hidden = !state.fid;
  if (!state.fid) { $('#avatar-initial').textContent = '?'; $('#composer').hidden = true; return; }
  const profile = state.people.get(state.fid) || { fid: state.fid, name: `Farcaster ${state.fid}`, username: `fid-${state.fid}` };
  $('#avatar-initial').textContent = profile.name.slice(0, 1).toUpperCase();
  $('#profile-name').textContent = profile.name;
  $('#profile-handle').textContent = `@${profile.username} · FID ${state.fid}`;
  $('#profile-avatar').textContent = profile.name.slice(0, 1).toUpperCase();
  if (profile.avatar && /^https?:\/\//i.test(profile.avatar)) { const image = document.createElement('img'); image.src = profile.avatar; image.alt = ''; image.loading = 'lazy'; $('#profile-avatar').replaceChildren(image); }
  $('#composer').hidden = false;
  $('#composer-context').textContent = state.signerReady ? 'Scoped gasless app key · local to this browser' : 'App key is awaiting merge confirmation';
  $('#composer-text').disabled = !state.signerReady;
  $('#composer button[type="submit"]').disabled = !state.signerReady;
  document.querySelectorAll('.post-action:not(.pin-action)').forEach((button) => { button.disabled = !state.signerReady; });
}

async function restoreSession() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(KEY_STORAGE) || 'null');
  } catch {
    localStorage.removeItem(KEY_STORAGE);
    return;
  }
  if (!saved || !Number.isSafeInteger(Number(saved.fid)) || !saved.key || !saved.publicKey) return;
  try {
    const signerKey = fromBase64(saved.key);
    if (signerKey.length !== 32) throw new Error('Stored app key has an invalid length.');
    const { NobleEd25519Signer } = await import('./protocol.js');
    state.fid = Number(saved.fid);
    state.signerKey = signerKey;
    state.signer = new NobleEd25519Signer(signerKey);
    state.custodyAddress = saved.custodyAddress || '';
  } catch {
    localStorage.removeItem(KEY_STORAGE);
    return;
  }
  renderIdentity();
  try {
    await fetchProfile(state.fid);
    state.signerReady = await findSigner(state.fid, saved.publicKey);
    renderIdentity();
    if (!state.signerReady) setNotice('This app key is not confirmed on the current node. Posting is paused.');
  } catch (error) {
    state.signerReady = false;
    renderIdentity();
    setNotice(`Could not confirm the saved app key with the app service. It remains stored in this browser. ${error.message}`);
  }
}

async function clearLocalSigner() {
  localStorage.removeItem(KEY_STORAGE);
  state.fid = null; state.signerKey = null; state.signer = null; state.signerReady = false; state.custodyAddress = '';
  renderIdentity();
  setNotice('This browser forgot its app key. Revoke signer access from custody if you no longer need it.');
}

function navigate(view) {
  const target = view === 'node' ? 'node' : 'desk';
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== target; });
  document.querySelectorAll('[data-view]').forEach((link) => link.classList.toggle('active', link.dataset.view === target));
  $('#page-label').textContent = target === 'node' ? 'ABOUT' : 'YOUR FEED';
  const expectedHash = target === 'node' ? '#about' : '#desk';
  if (location.hash !== expectedHash) history.replaceState(null, '', expectedHash);
  if (target === 'node') $('#node-view').scrollIntoView({ block: 'start' });
}

function castBody(text, parent, protocol) {
  const body = { text, type: protocol.CastType.CAST, embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [] };
  if (parent) body.parentCastId = { fid: Number(parent.fid), hash: protocol.hexStringToBytes(parent.hash) };
  return body;
}

$('#fid-form').addEventListener('submit', (event) => { event.preventDefault(); loadFeed($('#fid-input').value, 'following'); });
$('#forget-feed').addEventListener('click', () => {
  try { localStorage.removeItem(FEED_STORAGE); } catch { /* The visible input can still be cleared. */ }
  $('#fid-input').value = '';
  $('#forget-feed').hidden = true;
  $('#identity-copy-hint').textContent = 'Enter your numeric Farcaster ID (FID). Find it in your profile’s account details. No wallet needed to read.';
  state.feedMode = 'following'; state.casts = [];
  $('#feed-title').textContent = 'Your people';
  $('#feed-caption').textContent = 'Enter your Farcaster ID to catch up with the accounts you follow.';
  $('#feed-count').textContent = '0 POSTS'; $('#feed-end').hidden = true; $('#feed-filters').hidden = true;
  renderEmpty('Your saved feed is cleared.', 'Enter a Farcaster ID above whenever you want to catch up.');
  setNotice('Saved FID removed from this device.', 'success');
});
$('#feed-refresh').addEventListener('click', () => loadFeed());
$('#refresh-node').addEventListener('click', checkNode);
$('#refresh-node-large')?.addEventListener('click', checkNode);
document.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); navigate(link.dataset.view); }));
window.addEventListener('hashchange', () => navigate(location.hash === '#node' || location.hash === '#about' ? 'node' : 'desk'));
document.addEventListener('click', async (event) => {
  const deskButton = event.target.closest('[data-desk-fid]');
  if (!deskButton) return;
  const fid = Number(deskButton.dataset.deskFid);
  $('#fid-input').value = String(fid);
  navigate('desk');
  await loadFeed(fid, 'profile');
});
$('#source-fid').addEventListener('input', renderFeed);
$('#source-mode').addEventListener('change', renderFeed);
$('#open-account').addEventListener('click', () => $('#connect-dialog').showModal());
$('#connect-button').addEventListener('click', () => $('#connect-dialog').showModal());
$('#manage-key').addEventListener('click', () => { if (confirm('Forget this browser’s app key? You must reauthorize before posting. To fully remove access, revoke the signer from your custody account.')) clearLocalSigner(); });
$('#wallet-connect').addEventListener('click', () => authorizeSigner('wallet'));
$('#seed-toggle').hidden = !['localhost', '127.0.0.1'].includes(location.hostname);
$('#seed-toggle').addEventListener('click', () => { $('#seed-panel').hidden = !$('#seed-panel').hidden; });
$('#seed-connect').addEventListener('click', () => authorizeSigner('seed'));
$('#connect-dialog').addEventListener('click', (event) => { if (event.target === $('#connect-dialog')) $('#connect-dialog').close(); });
$('#composer-text').addEventListener('input', () => { $('#char-count').textContent = `${[...$('#composer-text').value].length} / 320`; });

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
    $('#composer-text').value = ''; $('#char-count').textContent = '0 / 320'; state.parent = null;
    await loadFeed();
  } catch (error) { setNotice(error.message, 'error'); }
  finally { submit.disabled = !state.signerReady; }
});

document.addEventListener('click', async (event) => {
  const profileButton = event.target.closest('[data-open-profile]');
  if (profileButton) {
    const fid = Number(profileButton.dataset.openProfile);
    $('#fid-input').value = String(fid);
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

if (location.hash === '#node' || location.hash === '#about') navigate('node');
renderDesk();
let lastFeed = '';
try {
  const savedFeed = localStorage.getItem(FEED_STORAGE) || '';
  if (/^[1-9]\d*$/.test(savedFeed) && Number.isSafeInteger(Number(savedFeed))) {
    lastFeed = savedFeed;
    $('#fid-input').value = savedFeed;
    $('#identity-copy-hint').textContent = 'Your last feed is remembered on this device.';
    $('#forget-feed').hidden = false;
  }
} catch { /* Feed reading still works if browser storage is unavailable. */ }
checkNode().then(async () => {
  if (state.nodeInfo && state.deskPins.length) await mapLimit(state.deskPins, 6, fetchProfile);
  renderDesk();
  if (state.nodeInfo && lastFeed) loadFeed(lastFeed);
});
restoreSession();
setInterval(() => { if (!document.hidden) checkNode(); }, 60_000);
