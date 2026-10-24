export const FARCASTER_EPOCH_SECONDS = 1_609_459_200;
export const PROFILE_RECENT_DAYS = 30;
export const PROFILE_INITIAL_PAGE_LIMIT = 5;
export const PROFILE_PAGE_SIZE = 100;

export function profileRecentStartTimestamp(nowMs = Date.now(), days = PROFILE_RECENT_DAYS) {
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const windowSeconds = Math.max(0, Math.floor(Number(days) * 86_400));
  return Math.max(0, nowSeconds - FARCASTER_EPOCH_SECONDS - windowSeconds);
}

/** Load a bounded set of newest-first pages so busy profiles aren't represented by only a few days. */
export async function fetchProfilePages(fetchPage, { fid, startTimestamp, maxPages = PROFILE_INITIAL_PAGE_LIMIT } = {}) {
  if (typeof fetchPage !== 'function') throw new TypeError('A profile page loader is required.');
  const pageLimit = Math.max(1, Math.min(20, Math.floor(Number(maxPages) || PROFILE_INITIAL_PAGE_LIMIT)));
  const messages = [];
  const requestedTokens = new Set();
  const seenPageTokens = new Set();
  let pageToken = '';
  let nextPageToken = '';
  for (let page = 0; page < pageLimit; page++) {
    if (pageToken) {
      if (requestedTokens.has(pageToken)) break;
      requestedTokens.add(pageToken);
    }
    const response = await fetchPage({
      fid,
      pageSize: PROFILE_PAGE_SIZE,
      reverse: true,
      startTimestamp,
      ...(pageToken ? { pageToken } : {}),
    });
    const pageMessages = Array.isArray(response?.messages) ? response.messages : Array.isArray(response?.items) ? response.items : [];
    messages.push(...pageMessages.filter((message) => message?.data?.castAddBody));
    const next = String(response?.nextPageToken || '');
    if (!next || requestedTokens.has(next)) {
      nextPageToken = '';
      break;
    }
    seenPageTokens.add(next);
    nextPageToken = next;
    pageToken = next;
  }
  return { messages, nextPageToken, seenPageTokens };
}
