export const FARCASTER_EPOCH_SECONDS = 1_609_459_200;
export const PROFILE_RECENT_DAYS = 7;

export function profileRecentStartTimestamp(nowMs = Date.now(), days = PROFILE_RECENT_DAYS) {
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const windowSeconds = Math.max(0, Math.floor(Number(days) * 86_400));
  return Math.max(0, nowSeconds - FARCASTER_EPOCH_SECONDS - windowSeconds);
}
