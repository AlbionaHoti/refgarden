import type { Reference, SourceKey } from './types';
import { sourceQuotas } from './source-balance';
import { ReferenceIdentity } from './reference-identity';
type ImageReference = Reference & { sourceKey: SourceKey };

/** Release a balanced stream, holding faster collections until slower ones can contribute. */
export function createCreatorPool(target: number, receive: (ref: ImageReference) => void, previous: Record<SourceKey, number> = { met: 0, nasa: 0, cosmos: 0 }) {
  const keys: SourceKey[] = ['met', 'nasa', 'cosmos'];
  const quota = sourceQuotas(target, previous);
  const counts = { met: 0, cosmos: 0, nasa: 0 };
  const accepted = { met: 0, cosmos: 0, nasa: 0 };
  const waiting: Record<SourceKey, ImageReference[]> = { met: [], nasa: [], cosmos: [] };
  const finished = new Set<SourceKey>();
  const identity = new ReferenceIdentity();
  let count = 0;
  const cosmosRoom = () => Math.floor((previous.met + counts.met + previous.nasa + counts.nasa) / 2) - previous.cosmos - counts.cosmos;
  const drain = () => {
    while (count < target) {
      let active = keys.filter(key => counts[key] < quota[key] && (!finished.has(key) || waiting[key].length));
      if (!active.length) return;
      let lowest = Math.min(...active.map(key => previous[key] + counts[key]));
      let group = active.filter(key => previous[key] + counts[key] === lowest);
      // A missing institutional source must not turn its empty share into a Cosmos flood.
      // Let Met/NASA advance until their actual results fund another one-third Cosmos slot.
      if (group.length === 1 && group[0] === 'cosmos' && cosmosRoom() <= 0) {
        active = active.filter(key => key !== 'cosmos');
        if (!active.length) return;
        lowest = Math.min(...active.map(key => previous[key] + counts[key]));
        group = active.filter(key => previous[key] + counts[key] === lowest);
      }
      if (group.some(key => !waiting[key].length)) return;
      for (const key of group) {
        if (key === 'cosmos' && cosmosRoom() <= 0) continue;
        const ref = waiting[key].shift()!; count++; counts[key]++; receive(ref);
      }
    }
  };
  return {
    get count() { return count; },
    limit(key: SourceKey) { return quota[key]; },
    available(key: SourceKey) { return accepted[key]; },
    held(key: SourceKey) { return waiting[key].length; },
    offer(ref: Reference) {
      if (!ref.sourceKey || ref.sourceKey === 'archive' || finished.has(ref.sourceKey) || accepted[ref.sourceKey] >= quota[ref.sourceKey] || count >= target || !identity.add(ref)) return;
      accepted[ref.sourceKey]++; waiting[ref.sourceKey].push({ ...ref, sourceKey: ref.sourceKey }); drain();
    },
    finish(key: SourceKey) { finished.add(key); drain(); },
  };
}
