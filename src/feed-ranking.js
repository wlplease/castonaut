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

// Rank recent accounts by activity, while keeping the reader's own Top people
// picks at the front of the source set.
export function rankActiveFeedSources(groups, { ownFid, pinnedFids = [], limit = 48, activeSince = 0 } = {}) {
  const own = Number(ownFid);
  const pinned = [...new Set((pinnedFids || []).map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0 && fid !== own))];
  const activity = new Map();
  for (const group of groups || []) {
    const groupFid = Number(group?.fid);
    for (const message of group?.messages || []) {
      const fid = authorFid(message) || groupFid;
      const createdAt = timestamp(message);
      if (!Number.isSafeInteger(fid) || fid <= 0 || fid === own || createdAt < activeSince) continue;
      const current = activity.get(fid) || { fid, posts: 0, latest: 0 };
      current.posts += 1;
      current.latest = Math.max(current.latest, createdAt);
      activity.set(fid, current);
    }
  }
  const active = [...activity.values()]
    .sort((a, b) => b.posts - a.posts || b.latest - a.latest || a.fid - b.fid)
    .map((person) => person.fid)
    .filter((fid) => !pinned.includes(fid));
  return [...pinned, ...active].slice(0, Math.max(pinned.length, Math.floor(Number(limit) || 48)));
}

// Interleave authors in a blended timeline and keep prolific accounts from
// filling the first screen.
export function mixAuthorTimeline(messages, { maxPerAuthor = 2 } = {}) {
  const counts = new Map();
  const limit = Math.max(1, Math.floor(Number(maxPerAuthor) || 2));
  const balanced = [];
  for (const message of messages || []) {
    const fid = authorFid(message);
    const count = counts.get(fid) || 0;
    if (count >= limit) continue;
    counts.set(fid, count + 1);
    balanced.push(message);
  }
  // The input order is already chronological (or ranked by engagement). Keep
  // that order intact; the per-author cap provides the mix without distorting it.
  return balanced;
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
