export class ReadCache {
  constructor({ maxEntries = 32, maxBytes = 2_000_000, now = Date.now } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 32);
    this.maxBytes = Math.max(1, Number(maxBytes) || 2_000_000);
    this.now = now;
    this.entries = new Map();
    this.bytes = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) { this.delete(key); return undefined; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) return false;
    let size;
    try { size = JSON.stringify(value).length * 2; } catch { return false; }
    if (size > this.maxBytes) return false;
    this.delete(key);
    while (this.entries.size >= this.maxEntries || this.bytes + size > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(key, { value, size, expiresAt: this.now() + ttl });
    this.bytes += size;
    return true;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.bytes = Math.max(0, this.bytes - entry.size);
    return true;
  }

  clear() { this.entries.clear(); this.bytes = 0; }
}
