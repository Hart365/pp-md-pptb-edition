/**
 * @file lruCache.ts
 * @description Minimal least-recently-used cache built on Map insertion order. Used to bound
 * memory held by rendered Mermaid SVGs across long documentation sessions.
 */

/** A size-bounded cache that evicts the least recently used entry when full. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  /** @param maxEntries - Maximum entries retained; must be at least 1. */
  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('LruCache maxEntries must be a positive integer.');
    }
  }

  /** Number of cached entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Returns the cached value and marks it as most recently used. */
  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Stores a value, evicting the least recently used entry when the cache is full. */
  set(key: K, value: V): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as K;
      this.entries.delete(oldestKey);
    }
  }

  /** Removes all entries. */
  clear(): void {
    this.entries.clear();
  }
}
