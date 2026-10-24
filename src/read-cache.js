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

// Cache public Snapchain reads on the user's device so a reload does not
// immediately fetch the same feed/profile pages again. Never use this for
// signer records, credentials, or write requests.
export class DeviceReadCache {
  constructor({
    indexedDB = globalThis.indexedDB,
    database = 'castonaut-public-reads',
    store = 'responses',
    maxEntries = 32,
    maxEntryBytes = 1_000_000,
    now = Date.now,
  } = {}) {
    this.indexedDB = indexedDB;
    this.database = database;
    this.store = store;
    this.maxEntries = Math.max(1, Number(maxEntries) || 32);
    this.maxEntryBytes = Math.max(1, Number(maxEntryBytes) || 1_000_000);
    this.now = now;
    this.disabled = !indexedDB;
    this.opening = null;
  }

  open() {
    if (this.disabled) return Promise.resolve(null);
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve) => {
      let settled = false;
      const finish = (db) => {
        if (settled) { db?.close(); return; }
        settled = true;
        clearTimeout(timer);
        if (!db) this.disabled = true;
        resolve(db);
      };
      const timer = setTimeout(() => finish(null), 2500);
      try {
        const request = this.indexedDB.open(this.database, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(this.store)) {
            const entries = db.createObjectStore(this.store, { keyPath: 'key' });
            entries.createIndex('lastUsedAt', 'lastUsedAt');
          }
        };
        request.onsuccess = () => finish(request.result);
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
      } catch { finish(null); }
    });
    return this.opening;
  }

  async get(key) {
    const db = await this.open();
    if (!db) return undefined;
    return new Promise((resolve) => {
      let result;
      let transaction;
      try {
        transaction = db.transaction(this.store, 'readwrite');
        const entries = transaction.objectStore(this.store);
        const request = entries.get(String(key));
        request.onsuccess = () => {
          const entry = request.result;
          if (!entry) return;
          if (entry.expiresAt <= this.now()) { entries.delete(entry.key); return; }
          entry.lastUsedAt = this.now();
          entries.put(entry);
          result = entry.value;
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  }

  async set(key, value, ttlMs) {
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) return false;
    let bytes;
    try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return false; }
    if (!bytes || bytes > this.maxEntryBytes) return false;
    const db = await this.open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(this.store, 'readwrite');
        const entries = transaction.objectStore(this.store);
        let saved = false;
        const keyValue = String(key);
        entries.get(keyValue).onsuccess = (event) => {
          const exists = Boolean(event.target.result);
          entries.count().onsuccess = (countEvent) => {
            const count = Number(countEvent.target.result) || 0;
            const put = () => {
              entries.put({ key: keyValue, value, bytes, expiresAt: this.now() + ttl, lastUsedAt: this.now() });
              saved = true;
            };
            if (!exists && count >= this.maxEntries) {
              const cursor = entries.index('lastUsedAt').openCursor();
              cursor.onsuccess = () => { cursor.result?.delete(); put(); };
            } else put();
          };
        };
        transaction.oncomplete = () => resolve(saved);
        transaction.onerror = transaction.onabort = () => resolve(false);
      } catch { resolve(false); }
    });
  }

  async clear() {
    const db = await this.open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(this.store, 'readwrite');
        transaction.objectStore(this.store).clear();
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = transaction.onabort = () => resolve(false);
      } catch { resolve(false); }
    });
  }
}
