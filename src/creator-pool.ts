import type { Reference, SourceKey } from './types';

/** Reserve room for each collection, then reuse unused places as sources finish. */
export function createCreatorPool(target: number, receive: (ref: Reference) => void) {
  const keys: SourceKey[] = ['met', 'cosmos', 'nasa'];
  const quota = Object.fromEntries(keys.map((key, i) => [key, Math.floor(target / 3) + (i < target % 3 ? 1 : 0)])) as Record<SourceKey, number>;
  const counts = { met: 0, cosmos: 0, nasa: 0 };
  const pending: Reference[] = [];
  const finished = new Set<SourceKey>();
  const ids = new Set<string>(), images = new Set<string>();
  let count = 0;
  const emit = (ref: Reference) => { count++; counts[ref.sourceKey!]++; receive(ref); };
  const drain = () => {
    const reserved = keys.reduce((sum, key) => sum + (finished.has(key) ? 0 : Math.max(0, quota[key] - counts[key])), 0);
    while (pending.length && count < target - reserved) emit(pending.shift()!);
  };
  return {
    get count() { return count; },
    offer(ref: Reference) {
      if (!ref.sourceKey || count >= target || ids.has(ref.id) || images.has(ref.image)) return;
      ids.add(ref.id); images.add(ref.image);
      if (counts[ref.sourceKey] < quota[ref.sourceKey]) emit(ref);
      else pending.push(ref);
      drain();
    },
    finish(key: SourceKey) { finished.add(key); drain(); },
  };
}
