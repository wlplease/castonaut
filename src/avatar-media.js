export function isVideoAvatarUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && /\.(?:mp4|webm)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
