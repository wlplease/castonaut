/** Load a small chronological sample across followed accounts, expanding only
 * when the earlier accounts are quiet. Requests stay bounded by each batch. */
export async function loadFollowedTimeline(sourceFids, fetchCasts, {
  minPosts = 30,
  maxSources = 24,
  batchSize = 6,
} = {}) {
  const sources = [...new Set(sourceFids.map(Number).filter((fid) => Number.isSafeInteger(fid) && fid > 0))];
  const messages = [];
  const failedFids = [];
  let sourceOffset = 0;
  const limit = Math.min(sources.length, Math.max(0, maxSources));

  while (sourceOffset < limit && messages.length < minPosts) {
    const batch = sources.slice(sourceOffset, Math.min(limit, sourceOffset + batchSize));
    sourceOffset += batch.length;
    const results = await Promise.all(batch.map(async (fid) => {
      try { return await fetchCasts(fid); }
      catch { failedFids.push(fid); return []; }
    }));
    messages.push(...results.flat());
  }

  return { messages, sourceOffset, failedFids };
}
