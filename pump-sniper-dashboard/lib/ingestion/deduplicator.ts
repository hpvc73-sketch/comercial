export class EventDeduplicator {
  private seen = new Map<string, number>();

  constructor(private ttlMs = 60_000) {}

  isDuplicate(key: string, now = Date.now()): boolean {
    const cutoff = now - this.ttlMs;
    for (const [entryKey, ts] of this.seen.entries()) {
      if (ts < cutoff) this.seen.delete(entryKey);
    }

    if (this.seen.has(key)) return true;
    this.seen.set(key, now);
    return false;
  }
}
