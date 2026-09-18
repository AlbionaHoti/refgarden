import type { Reference, SourceKey } from './types';
import { sourceQuotas } from './source-balance';

/** Release a balanced stream, holding faster collections until slower ones can contribute. */
export function createCreatorPool(target: number, receive: (ref: Reference) => void, previous: Record<SourceKey, number> = { met: 0, nasa: 0, cosmos: 0 }) {
  const keys: SourceKey[] = ['met', 'nasa', 'cosmos'];
  const quota = sourceQuotas(target, previous);
  const counts = { met: 0, cosmos: 0, nasa: 0 };
  const accepted = { met: 0, cosmos: 0, nasa: 0 };
  const waiting: Record<SourceKey, Reference[]> = { met: [], nasa: [], cosmos: [] };
  const finished = new Set<SourceKey>();
  const ids = new Set<string>(), images = new Set<string>();
  let count = 0;
  const drain = () => {
    while (count < target) {
      const active = keys.filter(key => counts[key] < quota[key] && (!finished.has(key) || waiting[key].length));
      if (!active.length) return;
      const lowest = Math.min(...active.map(key => previous[key] + counts[key]));
      const group = active.filter(key => previous[key] + counts[key] === lowest);
      if (group.some(key => !waiting[key].length)) return;
      for (const key of group) { const ref = waiting[key].shift()!; count++; counts[key]++; receive(ref); }
    }
  };
  return {
    get count() { return count; },
    limit(key: SourceKey) { return quota[key]; },
    available(key: SourceKey) { return accepted[key]; },
    offer(ref: Reference) {
      if (!ref.sourceKey || finished.has(ref.sourceKey) || accepted[ref.sourceKey] >= quota[ref.sourceKey] || count >= target || ids.has(ref.id) || images.has(ref.image)) return;
      ids.add(ref.id); images.add(ref.image);
      accepted[ref.sourceKey]++; waiting[ref.sourceKey].push(ref); drain();
    },
    finish(key: SourceKey) { finished.add(key); drain(); },
  };
}
