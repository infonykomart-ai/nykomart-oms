// 2026-11-24 — Bounded concurrency for the ten-language generation run.
//
// Ten independent AI calls fired at once hit provider rate limits and make the
// slowest call decide the batch; ten sequential calls waste the whole wait.
// A small worker pool (default 4) keeps every provider response in flight while
// respecting the limit, and one failing language never cancels the others.
//
// Results are returned in input order, each one either the value or the error,
// so the caller can report partial success honestly.

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * The worker is invoked lazily: a slot is filled only when a previous task has
 * settled, so `limit` is a real ceiling (not just a batch size).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<Settled<R>>> {
  const results: Array<Settled<R>> = new Array(items.length);
  if (items.length === 0) return results;

  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;

  async function runLane(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: width }, () => runLane()));
  return results;
}
