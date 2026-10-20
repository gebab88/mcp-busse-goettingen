interface CacheEntry<T> {
  value: T;
  expires: number;
}

export class TtlCache<T> {
  private ttlSeconds: number;
  private maxEntries: number;
  private map: Map<string, CacheEntry<T>>;

  constructor(ttlSeconds: number, maxEntries = 100) {
    this.ttlSeconds = ttlSeconds;
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlSeconds * 1000 });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}