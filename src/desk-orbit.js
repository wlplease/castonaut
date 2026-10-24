import { activityDays } from './profile-analytics.js';

/** Recent original casts from pinned people, using only the feed already in memory. */
export function recentOrbitCasts(messages, pinnedFids, limit = 4) {
  const pinned = new Set((Array.isArray(pinnedFids) ? pinnedFids : []).map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0));
  const max = Math.max(0, Math.min(8, Number(limit) || 0));
  if (!pinned.size || !Array.isArray(messages) || !max) return [];
  return messages
    .filter((message) => {
      const body = message?.data?.castAddBody;
      return body && !body.parentCastId && pinned.has(Number(message?.data?.fid));
    })
    .sort((a, b) => Number(b.data.timestamp || 0) - Number(a.data.timestamp || 0))
    .slice(0, max);
}

/** Local pulse from loaded, original casts authored by pinned people. */
export function summarizeOrbitActivity(messages, pinnedFids, now = Date.now()) {
  const pinned = new Set((Array.isArray(pinnedFids) ? pinnedFids : []).map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0));
  const originals = (Array.isArray(messages) ? messages : []).filter((message) =>
    message?.data?.castAddBody && !message.data.castAddBody.parentCastId && pinned.has(Number(message.data.fid)));
  const nowSeconds = Math.floor(now / 1000) - 1_609_459_200;
  const thisWeek = originals.filter((message) => {
    const timestamp = Number(message?.data?.timestamp);
    return Number.isFinite(timestamp) && timestamp >= nowSeconds - 7 * 86_400 && timestamp <= nowSeconds;
  });
  return {
    loaded: originals.length,
    thisWeek: thisWeek.length,
    activePeople: new Set(thisWeek.map((message) => Number(message.data.fid))).size,
    dailyPosts: activityDays(originals, now),
  };
}
