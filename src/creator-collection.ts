import { collectSource, CREATOR_TARGET, SOURCE_KEYS, SOURCE_NAMES, searchUrl } from './sources';
import { createCreatorPool } from './creator-pool';
import type { Reference, ResearchEvent, SourceKey, SourceProgress } from './types';

type Unstamped<T> = T extends { atMs: number } ? Omit<T, 'atMs'> : never;
export type SourceEmitter = (event: Unstamped<ResearchEvent>) => void;
export type DiscoveryContext = { round: number; target: number; seenIds: Set<string>; seenImages: Set<string>; queries: Record<SourceKey, Set<string>>; pages: Map<string, number> };

/** Public source fetching only. No model clients or credentials belong in this module. */
export async function collectCreatorSources(searches: Record<SourceKey, string>, signal: AbortSignal, emit: SourceEmitter, discovery?: DiscoveryContext, storage?: { add: (ref: Reference) => void }, collect = collectSource) {
  const pool: Reference[] = [];
    emit({ type: 'stage', stage: 'sources', message: 'Finding fresh assets across The Met, Cosmos and NASA.' });
    const collectionAbort = new AbortController();
    const collectionSignal = AbortSignal.any([signal, collectionAbort.signal, AbortSignal.timeout(12_000)]);
    const progress = new Map<SourceKey, { source: SourceProgress; start: number; update: () => void }>();
    const target = discovery?.target || CREATOR_TARGET;
    const previous = { met: 0, nasa: 0, cosmos: 0 };
    for (const id of discovery?.seenIds || []) {
      const source = SOURCE_KEYS.find(key => id.startsWith(`${key}-`));
      if (source) previous[source]++;
    }
    const collector = createCreatorPool(target, ref => {
      signal.throwIfAborted();
      discovery?.seenIds.add(ref.id); discovery?.seenImages.add(ref.image);
      pool.push(ref); storage?.add(ref);
      const entry = progress.get(ref.sourceKey!)!;
      entry.source.found++; entry.source.firstResultMs ??= Math.round(performance.now() - entry.start);
      emit({ type: 'candidate', source: ref.sourceKey!, reference: ref }); entry.update();
      if (pool.length >= target) collectionAbort.abort();
    }, previous);
    await Promise.all(SOURCE_KEYS.map(async key => {
      const start = performance.now();
      const source: SourceProgress = { key, query: searches![key], url: searchUrl(key, searches![key]), status: 'searching', found: 0, elapsedMs: 0 };
      const update = () => { source.elapsedMs = Math.round(performance.now() - start); emit({ type: 'source', source: { ...source } }); };
      progress.set(key, { source, start, update });
      const limit = collector.limit(key);
      if (!limit) { source.status = 'ready'; collector.finish(key); update(); return; }
      const pageKey = `${key}:${searches![key]}`;
      const page = (discovery?.pages.get(pageKey) || 0) + 1;
      discovery?.pages.set(pageKey, page); discovery?.queries[key].add(searches![key]);
      update();
      try {
        await collect(key, searches![key], collectionSignal, ref => { collector.offer(ref); }, limit, { page, excludeIds: discovery?.seenIds, excludeImages: discovery?.seenImages });
        source.status = 'ready';
      } catch {
        signal.throwIfAborted(); source.status = collectionAbort.signal.aborted ? 'ready' : 'error';
        if (source.status === 'error') source.error = collector.available(key) ? 'Kept the assets that arrived before this source timed out.' : 'This source returned no images in time. Try a broader search.';
      }
      signal.throwIfAborted();
      if (collector.available(key) < limit) emit({ type: 'notice', message: `${SOURCE_NAMES[key]} returned ${collector.available(key)} of ${limit} requested references. Continuing with the sources that have matches.` });
      collector.finish(key);
      update();
    }));
    signal.throwIfAborted();
  return pool;
}
