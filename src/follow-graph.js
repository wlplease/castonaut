import { followedFeedSources } from './feed-ranking.js';

// Read the connected account's complete follow graph in bounded Snapchain
// pages. A repeated cursor is treated as an incomplete response to avoid loops.
export async function loadFollowGraph(fetchPage, { ownFid, maxPages = 20, maxFollows = 2000, pageToken: initialPageToken = '' } = {}) {
  const messages = [];
  const seenTokens = new Set(initialPageToken ? [String(initialPageToken)] : []);
  let pageToken = String(initialPageToken || '');
  let complete = false;
  let nextPageToken = '';

  for (let page = 0; page < maxPages && messages.length < maxFollows; page += 1) {
    const response = await fetchPage({ pageSize: 100, reverse: true, ...(pageToken ? { pageToken } : {}) });
    const pageMessages = Array.isArray(response?.messages) ? response.messages
      : Array.isArray(response?.items) ? response.items : [];
    messages.push(...pageMessages);

    const nextToken = String(response?.nextPageToken || response?.next_page_token || '');
    if (!nextToken) { complete = true; break; }
    if (seenTokens.has(nextToken)) { nextPageToken = ''; break; }
    seenTokens.add(nextToken);
    pageToken = nextToken;
    nextPageToken = nextToken;
  }

  return {
    fids: followedFeedSources(ownFid, messages, maxFollows),
    complete,
    nextPageToken: complete ? '' : nextPageToken,
    scanned: messages.length,
  };
}
