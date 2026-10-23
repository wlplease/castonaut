function authorFid(message) {
  const fid = Number(message?.data?.fid);
  return Number.isSafeInteger(fid) && fid > 0 ? fid : 0;
}

function timestamp(message) {
  const value = Number(message?.data?.timestamp);
  return Number.isFinite(value) ? value : 0;
}

export function followedFeedSources(ownFid, messages, limit = 25) {
  const own = Number(ownFid);
  const ids = [];
  const seen = new Set([own]);
  for (const message of messages || []) {
    const fid = Number(message?.data?.linkBody?.targetFid);
    if (!Number.isSafeInteger(fid) || fid <= 0 || seen.has(fid)) continue;
    seen.add(fid);
    ids.push(fid);
    if (ids.length >= limit) break;
  }
  return ids;
}

// Keep each author's posts in their own newest-first order, while avoiding a
// long run from one account whenever another author's post is available.
export function paceByAuthor(messages, maxRun = 2) {
  const queues = new Map();
  for (const message of messages) {
    const fid = authorFid(message);
    if (!queues.has(fid)) queues.set(fid, []);
    queues.get(fid).push(message);
  }
  for (const queue of queues.values()) queue.sort((a, b) => timestamp(b) - timestamp(a));

  const result = [];
  let previous = [];
  while (result.length < messages.length) {
    const available = [...queues.entries()].filter(([, queue]) => queue.length);
    const eligible = available.filter(([fid]) => previous.length < maxRun || previous.slice(-maxRun).every((recent) => recent !== fid));
    const candidates = eligible.length ? eligible : available;
    candidates.sort((a, b) => timestamp(b[1][0]) - timestamp(a[1][0]));
    const [fid, queue] = candidates[0];
    result.push(queue.shift());
    previous.push(fid);
    if (previous.length > maxRun) previous = previous.slice(-maxRun);
  }
  return result;
}

// Count how many distinct followed accounts independently follow each person.
export function rankFollowRecommendations(linkGroups, { ownFid, followingFids, limit = 5 } = {}) {
  const excluded = new Set([Number(ownFid), ...[...(followingFids || [])].map(Number)]);
  const evidence = new Map();
  for (const group of linkGroups || []) {
    const sourceFid = Number(group?.sourceFid);
    if (!Number.isSafeInteger(sourceFid) || sourceFid <= 0) continue;
    const seenInSource = new Set();
    for (const message of group.messages || []) {
      const fid = Number(message?.data?.linkBody?.targetFid);
      if (!Number.isSafeInteger(fid) || fid <= 0 || excluded.has(fid) || fid === sourceFid || seenInSource.has(fid)) continue;
      seenInSource.add(fid);
      if (!evidence.has(fid)) evidence.set(fid, new Set());
      evidence.get(fid).add(sourceFid);
    }
  }
  return [...evidence.entries()]
    .map(([fid, sources]) => ({ fid, mutualCount: sources.size }))
    .sort((a, b) => b.mutualCount - a.mutualCount || a.fid - b.fid)
    .slice(0, limit);
}
