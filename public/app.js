(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { fid: null, profile: null, feed: 'farcaster', parent: null, pending: localStorage.getItem('openroom_pending_signer') || '', view: 'home', room: 'farcaster', loading: false, feedRequest: 0 };
  const toast = $('#toast');
  let toastTimer;
  const fallbackPosts = $('#feed-posts').innerHTML;

  function notice(message) {
    toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || (response.status === 404 ? 'Live Farcaster features need the Vercel API deployment.' : `Request failed (${response.status})`));
    return data;
  }
  function initials(name) { return (String(name || '?').trim().match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase(); }
  function ago(date) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
    if (!Number.isFinite(seconds)) return 'recently';
    if (seconds < 60) return 'now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86400)}d`;
  }
  function normalize(cast) {
    const author = cast.author || {};
    return {
      hash: cast.hash || cast.cast_hash || '', text: cast.text || '', timestamp: cast.timestamp || '',
      author: { fid: author.fid || cast.fid, displayName: author.display_name || author.displayName || author.username || 'Farcaster user', username: author.username || '', pfp_url: author.pfp_url || author.pfp?.url || '' },
      likes: cast.reactions?.likes_count ?? cast.likes ?? 0,
      recasts: cast.reactions?.recasts_count ?? cast.recasts ?? 0,
      replies: cast.replies?.count ?? cast.replies ?? 0,
    };
  }
  function makeButton(label, action, hash, extra = {}) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'post-action'; button.dataset.action = action;
    button.dataset.hash = hash; Object.entries(extra).forEach(([k, v]) => { button.dataset[k] = v; }); button.textContent = label; return button;
  }
  function renderPost(raw, parent = $('#feed-posts')) {
    const post = normalize(raw); if (!post.hash) return;
    const article = document.createElement('article'); article.className = 'post'; article.dataset.hash = post.hash; article.dataset.timestamp = post.timestamp; article.dataset.username = post.author.username; article.dataset.displayName = post.author.displayName;
    const top = document.createElement('div'); top.className = 'post-top';
    const avatar = document.createElement('span'); avatar.className = 'avatar a2'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = initials(post.author.displayName);
    const identity = document.createElement('div');
    const name = document.createElement('button'); name.type = 'button'; name.className = 'post-name profile-link'; name.dataset.username = post.author.username; name.textContent = post.author.displayName;
    const handle = document.createElement('span'); handle.className = 'handle'; handle.textContent = post.author.username ? `@${post.author.username}` : '';
    identity.append(name, handle);
    const time = document.createElement('span'); time.className = 'post-time'; time.textContent = ago(post.timestamp);
    top.append(avatar, identity, time);
    const body = document.createElement('p'); body.className = 'post-body'; body.textContent = post.text;
    const actions = document.createElement('div'); actions.className = 'post-actions';
    actions.append(makeButton(`♡ ${post.likes}`, 'like', post.hash), makeButton('↪ Reply', 'reply', post.hash), makeButton(`${post.replies} replies`, 'thread', post.hash), makeButton(`⟳ ${post.recasts}`, 'recast', post.hash), makeButton(savedItems().some(item => item.hash === post.hash) ? '✓ Saved' : '◇ Save', 'save', post.hash));
    article.append(top, body, actions);
    if (post.author.username && /^0x[0-9a-f]{8,64}$/i.test(post.hash)) {
      const external = document.createElement('a'); external.className = 'cast-link'; external.href = `https://farcaster.xyz/${encodeURIComponent(post.author.username)}/${encodeURIComponent(post.hash)}`; external.target = '_blank'; external.rel = 'noopener noreferrer'; external.textContent = 'Open on Farcaster ↗'; article.append(external);
    }
    parent.append(article);
  }
  function renderPosts(posts, target = $('#feed-posts')) {
    target.replaceChildren();
    if (!posts.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'Nothing here yet. Follow a few people or start a conversation.'; target.append(empty); return; }
    posts.forEach(post => renderPost(post, target));
  }
  function currentFeedLabel() {
    if (state.feed === 'following') return 'Following';
    return ({ farcaster: 'The living room', dev: 'Build & tinker', art: 'The weird web' })[state.feed] || 'Farcaster';
  }
  async function loadFeed() {
    const requestId = ++state.feedRequest;
    const status = $('#feed-status'); status.textContent = 'Loading…';
    $('#feed-heading').textContent = state.feed === 'following' ? 'From people you follow' : `${currentFeedLabel()} conversations`;
    $('#feed-subtitle').textContent = state.feed === 'following' ? 'Your Farcaster follows, gathered in one place' : 'Public conversations from Farcaster channels';
    $$('.feed-tab').forEach(tab => { const active = tab.dataset.feed === state.feed; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
    try {
      const params = new URLSearchParams();
      if (state.feed === 'following' && state.fid) params.set('type', 'following'); else params.set('channel', state.feed === 'following' ? 'farcaster' : state.feed);
      const result = await api(`/api/feed?${params}`);
      if (requestId !== state.feedRequest) return;
      renderPosts(result.posts || []); status.textContent = result.channel === 'following' ? 'Following feed' : 'Live public casts';
      if (result.channel === 'following' && !(result.posts || []).length) status.textContent = 'Your feed is quiet';
    } catch (error) {
      if (requestId !== state.feedRequest) return;
      $('#feed-posts').innerHTML = fallbackPosts; status.textContent = 'Illustrative preview'; if (!error.message.includes('Vercel API deployment')) notice(error.message);
    }
  }
  function showHome() {
    state.view = 'home'; ['.hero', '#getting-started', '#rooms', '#room-cards', '#feed-title', '#feed', '#plus', '#plus + .rooms', '#plus + .rooms + .fine'].forEach(selector => { const node = $(selector); if (node) node.hidden = false; });
    ['#people-view', '#profile-view', '#saved-view'].forEach(selector => { $(selector).hidden = true; });
    $$('.nav [data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === 'home'));
  }
  function showUtility(name) {
    state.view = name;
    ['.hero', '#getting-started', '#rooms', '#room-cards', '#feed-title', '#feed', '#plus', '#plus + .rooms', '#plus + .rooms + .fine'].forEach(selector => { const node = $(selector); if (node) node.hidden = true; });
    ['#people-view', '#profile-view', '#saved-view'].forEach(selector => { $(selector).hidden = selector !== `#${name}-view`; });
    $$('.nav [data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === name));
    if (name === 'saved') renderSaved();
  }
  function openConnect() { $('#dialog-backdrop').hidden = false; $('#close-dialog').focus(); $('#start-connect').hidden = !!state.fid; $('#disconnect-account').hidden = !state.fid; $('#approval-link').hidden = !$('#approval-link').href || !!state.fid; $('#connect-status').textContent = state.fid ? `Connected as @${state.profile?.username || state.fid}. Disconnect whenever you like.` : state.pending ? 'An approval is in progress. Use the approval page, then return here.' : 'Approving a signer lets Openroom post, react, recast, and follow for you. You can revoke it in Farcaster settings.'; }
  function closeConnect() { $('#dialog-backdrop').hidden = true; $('#connect-button').focus(); }
  async function setConnected(fid) {
    state.fid = Number(fid); localStorage.removeItem('openroom_pending_signer'); state.pending = '';
    try { const me = await api(`/api/user?fid=${state.fid}`); state.profile = me.profile; } catch { state.profile = { fid: state.fid, username: `fid:${state.fid}`, display_name: `Farcaster ${state.fid}` }; }
    $('#connect-button').textContent = `@${state.profile.username || state.profile.fid} · Account`;
    $('#composer').hidden = false; $('#connect-hint').hidden = true;
    if (state.feed === 'farcaster') state.feed = 'following';
    closeConnect(); await loadFeed();
  }
  async function pollSigner(signerUuid) {
    state.pending = signerUuid; localStorage.setItem('openroom_pending_signer', signerUuid);
    $('#connect-status').textContent = 'Waiting for approval in Farcaster… You can return here after approving.';
    $('#start-connect').disabled = true;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && state.pending) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      try {
        const result = await api(`/api/signer?signer_uuid=${encodeURIComponent(signerUuid)}`);
        if (result.status === 'approved' && result.fid) { $('#start-connect').disabled = false; await setConnected(result.fid); notice('You’re connected. Your Farcaster feed is ready.'); return; }
        if (result.status === 'revoked') throw new Error('The signer was revoked. Start again if you want to connect.');
      } catch (error) { $('#connect-status').textContent = error.message; break; }
    }
    $('#start-connect').disabled = false;
    if (state.pending) $('#connect-status').textContent = 'Still waiting. Reopen the approval link or check again.';
  }
  async function startConnect() {
    $('#start-connect').disabled = true; $('#connect-status').textContent = 'Creating a secure app signer…';
    try {
      const signer = await api('/api/signer', { method: 'POST' });
      const approval = new URL(signer.approval_url);
      if (approval.protocol !== 'https:' || !['farcaster.xyz', 'warpcast.com', 'www.warpcast.com'].includes(approval.hostname)) throw new Error('Unexpected approval destination. Contact support before continuing.');
      $('#approval-link').href = approval.href; $('#approval-link').hidden = false;
      window.open(approval.href, '_blank', 'noopener,noreferrer');
      await pollSigner(signer.signer_uuid);
    } catch (error) { $('#connect-status').textContent = error.message; $('#start-connect').disabled = false; }
  }
  async function restoreSession() {
    try { const result = await api('/api/signer?me=1'); await setConnected(result.fid); }
    catch {
      $('#composer').hidden = true; $('#connect-hint').hidden = false;
      if (state.pending) pollSigner(state.pending);
      else loadFeed();
    }
  }
  async function disconnect() {
    try { await api('/api/signer', { method: 'DELETE' }); }
    catch (error) { notice(error.message); return; }
    state.fid = null; state.profile = null; state.pending = ''; state.parent = null; localStorage.removeItem('openroom_pending_signer');
    $('#connect-button').textContent = 'Connect Farcaster'; $('#composer').hidden = true; $('#connect-hint').hidden = false; $('#composer-text').value = ''; closeConnect(); notice('Disconnected from this device. Revoke the app signer in Farcaster settings too.');
    state.feed = 'farcaster'; await loadFeed();
  }
  function savedItems() { try { return JSON.parse(localStorage.getItem('openroom_saved_posts') || '[]'); } catch { return []; } }
  function renderSaved() {
    const list = savedItems(); const container = $('#saved-posts'); container.replaceChildren();
    if (!list.length) { const msg = document.createElement('p'); msg.className = 'empty-state'; msg.textContent = 'Save a post from the feed and it will be waiting here.'; container.append(msg); return; }
    list.forEach(item => renderPost(item, container));
  }
  async function showProfile(username) {
    if (!username) return;
    showUtility('profile'); const panel = $('#profile-view'); panel.replaceChildren();
    const loading = document.createElement('p'); loading.className = 'empty-state'; loading.textContent = `Opening @${username}…`; panel.append(loading);
    try {
      const result = await api(`/api/user?username=${encodeURIComponent(username)}`); const p = result.profile; panel.replaceChildren();
      const card = document.createElement('div'); card.className = 'profile-card';
      const avatar = document.createElement('div'); avatar.className = 'profile-avatar'; avatar.textContent = initials(p.display_name || p.username);
      const title = document.createElement('h1'); title.textContent = p.display_name || p.username;
      const handle = document.createElement('p'); handle.className = 'profile-handle'; handle.textContent = `@${p.username} · FID ${p.fid}`;
      const bio = document.createElement('p'); bio.className = 'profile-bio'; bio.textContent = p.profile?.bio?.text || p.bio?.text || '';
      const counts = document.createElement('p'); counts.className = 'profile-counts'; counts.textContent = `${p.following?.length ?? p.following_count ?? 0} following   ·   ${p.follower_count ?? p.followers?.count ?? 0} followers`;
      card.append(avatar, title, handle, bio, counts);
      if (state.fid && state.fid !== p.fid) { const follow = document.createElement('button'); follow.className = 'button primary'; follow.textContent = 'Follow'; follow.dataset.action = 'follow'; follow.dataset.fid = p.fid; card.append(follow); }
      panel.append(card); const head = document.createElement('div'); head.className = 'section-head'; head.innerHTML = '<h2>Recent posts</h2>'; panel.append(head);
      const feed = document.createElement('div'); feed.className = 'feed'; (result.casts || []).forEach(c => renderPost(c, feed)); if (!result.casts?.length) feed.textContent = 'No recent posts.'; panel.append(feed);
    } catch (error) { panel.replaceChildren(); const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = error.message; panel.append(p); }
  }
  async function searchPeople(event) {
    event.preventDefault(); const q = $('#people-query').value.trim(); const results = $('#people-results');
    if (q.length < 2) { notice('Type at least two characters.'); return; }
    results.replaceChildren(); const loading = document.createElement('p'); loading.textContent = 'Searching…'; results.append(loading);
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`); results.replaceChildren();
      const users = data.users.map(item => item.user || item);
      if (!users.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No people found.'; results.append(empty); return; }
      users.forEach(user => {
        const row = document.createElement('div'); row.className = 'person-result'; const avatar = document.createElement('span'); avatar.className = 'avatar a2'; avatar.textContent = initials(user.display_name || user.username);
        const copy = document.createElement('div'); const name = document.createElement('button'); name.className = 'post-name profile-link'; name.dataset.username = user.username; name.textContent = user.display_name || user.username; const handle = document.createElement('div'); handle.className = 'handle'; handle.textContent = `@${user.username}`; copy.append(name, handle); row.append(avatar, copy);
        if (state.fid && Number(user.fid) !== state.fid) { const follow = document.createElement('button'); follow.className = 'button'; follow.textContent = 'Follow'; follow.dataset.action = 'follow'; follow.dataset.fid = user.fid; row.append(follow); }
        results.append(row);
      });
    } catch (error) { results.replaceChildren(); const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = error.message; results.append(p); }
  }
  async function openThread(hash) {
    showUtility('profile'); const panel = $('#profile-view'); panel.replaceChildren();
    const title = document.createElement('div'); title.className = 'section-head'; title.innerHTML = '<h2>Conversation</h2>';
    const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'button primary'; reply.textContent = 'Reply to conversation';
    reply.addEventListener('click', () => { state.parent = hash; if (!state.fid) { openConnect(); return; } showHome(); $('#composer-text').placeholder = 'Write a reply…'; $('#composer-text').focus(); $('#composer').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    title.append(reply); panel.append(title);
    const feed = document.createElement('div'); feed.className = 'feed'; panel.append(feed);
    try { const data = await api(`/api/conversation?hash=${encodeURIComponent(hash)}`); (data.casts || []).forEach(c => renderPost(c, feed)); if (!data.casts?.length) feed.textContent = 'No replies yet.'; }
    catch (error) { feed.textContent = error.message; }
    state.parent = hash;
  }
  async function performAction(button) {
    const { action, hash } = button.dataset;
    try {
      if (action === 'save') {
        const card = button.closest('.post'); const saved = savedItems();
        const post = { hash, text: card.querySelector('.post-body')?.textContent || '', timestamp: card.dataset.timestamp, author: { username: card.dataset.username, displayName: card.dataset.displayName } };
        if (!saved.some(item => item.hash === hash)) { saved.unshift(post); localStorage.setItem('openroom_saved_posts', JSON.stringify(saved.slice(0, 200))); button.textContent = '✓ Saved'; notice('Saved on this device.'); }
        else { localStorage.setItem('openroom_saved_posts', JSON.stringify(saved.filter(item => item.hash !== hash))); button.textContent = '◇ Save'; notice('Removed from saved posts.'); }
        return;
      }
      if (action === 'reply') { state.parent = hash; if (!state.fid) { openConnect(); $('#connect-status').textContent = 'Connect your Farcaster account to reply to this post.'; return; } if (state.view !== 'home') showHome(); $('#composer').hidden = false; $('#composer-text').placeholder = 'Write a reply…'; $('#composer-text').focus(); $('#composer').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (action === 'thread') { await openThread(hash); return; }
      if (action === 'like' || action === 'recast') {
        if (!state.fid) { openConnect(); return; }
        await api('/api/reaction', { method: 'POST', body: JSON.stringify({ target: hash, reaction_type: action === 'like' ? 'like' : 'recast' }) });
        button.disabled = true; button.textContent = action === 'like' ? '♥ Liked' : '⟳ Recast'; return;
      }
      if (action === 'follow') {
        if (!state.fid) { openConnect(); return; }
        await api('/api/follow', { method: 'POST', body: JSON.stringify({ fid: Number(button.dataset.fid) }) }); button.textContent = 'Following'; button.disabled = true; return;
      }
    } catch (error) { notice(error.message); }
  }
  $('#open-preview').addEventListener('click', () => { $('#feed-title').scrollIntoView({ behavior: 'smooth' }); });
  $('#start-read').addEventListener('click', () => $('#rooms').scrollIntoView({ behavior: 'smooth' }));
  $('#start-search').addEventListener('click', () => { showUtility('people'); $('#people-query').focus(); });
  $('#start-join').addEventListener('click', openConnect);
  $('#refresh-feed').addEventListener('click', loadFeed);
  $('#connection-info').addEventListener('click', openConnect); $('#connect-button').addEventListener('click', openConnect); $('#connect-inline').addEventListener('click', openConnect); $('#start-connect').addEventListener('click', startConnect);
  $('#close-dialog').addEventListener('click', closeConnect); $('#dialog-ok').addEventListener('click', closeConnect); $('#dialog-backdrop').addEventListener('click', e => { if (e.target === $('#dialog-backdrop')) closeConnect(); });
  $('#disconnect-account').addEventListener('click', disconnect);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#dialog-backdrop').hidden) closeConnect(); });
  $$('.feed-tab').forEach(tab => tab.addEventListener('click', () => { if (tab.dataset.feed === 'following' && !state.fid) { openConnect(); $('#connect-status').textContent = 'Connect your Farcaster account to see the people you follow.'; return; } state.feed = tab.dataset.feed; loadFeed(); }));
  $$('[data-channel]').forEach(button => button.addEventListener('click', () => { state.feed = button.dataset.channel; $$('[data-channel]').forEach(room => room.classList.toggle('active', room === button)); loadFeed(); $('#feed').scrollIntoView({ behavior: 'smooth' }); }));
  $$('.nav [data-nav]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.nav;
    if (key === 'home') { showHome(); loadFeed(); }
    else if (key === 'rooms') { showHome(); $('#rooms').scrollIntoView({ behavior: 'smooth' }); }
    else showUtility(key);
  }));
  $$('.mobile-nav [data-mobile-nav]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.mobileNav;
    if (key === 'top') { showHome(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (key === 'rooms') { showHome(); $('#rooms').scrollIntoView({ behavior: 'smooth' }); }
    else if (key === 'feed-title') { showHome(); $('#feed-title').scrollIntoView({ behavior: 'smooth' }); }
    else if (key === 'people') { showUtility('people'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }));
  $('#people-search').addEventListener('submit', searchPeople);
  $('#composer-text').addEventListener('input', () => { $('#char-count').textContent = `${[...$('#composer-text').value].length} / 320`; });
  $('#composer').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.fid) { openConnect(); return; }
    const button = $('#composer button[type="submit"]'); const text = $('#composer-text').value.trim(); if (!text) return;
    button.disabled = true;
    try { await api('/api/cast', { method: 'POST', body: JSON.stringify({ text, parent: state.parent, channel_id: !state.parent && state.feed !== 'following' ? state.feed : undefined }) }); $('#composer-text').value = ''; $('#char-count').textContent = '0 / 320'; state.parent = null; $('#composer-text').placeholder = 'What’s happening in your corner?'; notice('Cast posted.'); await loadFeed(); }
    catch (error) { notice(error.message); }
    finally { button.disabled = false; }
  });
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]'); if (action) { performAction(action); return; }
    const profile = event.target.closest('[data-username]'); if (profile) showProfile(profile.dataset.username);
  });
  document.querySelectorAll('[data-tier]').forEach(button => button.addEventListener('click', () => {
    const tier = button.dataset.tier;
    if (tier === 'free') { showHome(); $('#feed-title').scrollIntoView({ behavior: 'smooth' }); return; }
    notice('Membership checkout activates when the Base contract is connected.');
  }));
  restoreSession();
})();
