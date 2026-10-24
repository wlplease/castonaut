const FARCASTER_EPOCH_SECONDS = 1_609_459_200;
const DAY_SECONDS = 86_400;

function isReply(message) {
  return Boolean(message?.data?.castAddBody?.parentCastId);
}

function hasMedia(message) {
  const body = message?.data?.castAddBody || {};
  return Boolean(body.embeds?.length || body.embedsDeprecated?.length);
}

/** Seven-day original-post bins, based only on the messages supplied by the caller. */
export function activityDays(messages, now = Date.now(), dayCount = 7) {
  const safeDayCount = Math.max(1, Math.min(14, Math.floor(Number(dayCount) || 7)));
  const nowSeconds = Math.floor(now / 1000) - FARCASTER_EPOCH_SECONDS;
  const today = Math.floor((nowSeconds + FARCASTER_EPOCH_SECONDS) / DAY_SECONDS);
  const counts = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const body = message?.data?.castAddBody;
    const timestamp = Number(message?.data?.timestamp);
    if (!body || body.parentCastId || !Number.isFinite(timestamp) || timestamp > nowSeconds) continue;
    const day = Math.floor((timestamp + FARCASTER_EPOCH_SECONDS) / DAY_SECONDS);
    if (day < today - safeDayCount + 1 || day > today) continue;
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return Array.from({ length: safeDayCount }, (_, index) => {
    const day = today - safeDayCount + 1 + index;
    const date = new Date(day * DAY_SECONDS * 1000);
    return {
      date: date.toISOString().slice(0, 10),
      label: day === today ? 'Today' : new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date),
      count: counts.get(day) || 0,
    };
  });
}

/** Small, local-only activity summary from casts already loaded for a profile. */
export function summarizeProfileActivity(messages, now = Date.now()) {
  const casts = (Array.isArray(messages) ? messages : []).filter((message) => message?.data?.castAddBody);
  const nowSeconds = Math.floor(now / 1000) - FARCASTER_EPOCH_SECONDS;
  const recentThreshold = nowSeconds - 7 * DAY_SECONDS;
  const monthThreshold = nowSeconds - 30 * DAY_SECONDS;
  const recent = casts.filter((message) => {
    const timestamp = Number(message.data.timestamp);
    return timestamp >= recentThreshold && timestamp <= nowSeconds;
  });
  const activeDays = new Set(casts
    .map((message) => Number(message.data.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= monthThreshold && timestamp <= nowSeconds)
    .map((timestamp) => Math.floor((timestamp + FARCASTER_EPOCH_SECONDS) / DAY_SECONDS)));
  const posts = casts.filter((message) => !isReply(message));
  const replies = casts.length - posts.length;
  return {
    loaded: casts.length,
    posts: posts.length,
    replies,
    media: casts.filter((message) => hasMedia(message)).length,
    recent: recent.length,
    activeDays: activeDays.size,
    dailyPosts: activityDays(posts, now),
    averageLength: posts.length
      ? Math.round(posts.reduce((sum, message) => sum + [...String(message.data.castAddBody.text || '')].length, 0) / posts.length)
      : 0,
  };
}
