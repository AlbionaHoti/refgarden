import { collectSource, CREATOR_TARGET, SOURCE_KEYS, searchUrl } from './sources';
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
    const collector = createCreatorPool(target, ref => {
      signal.throwIfAborted();
      discovery?.seenIds.add(ref.id); discovery?.seenImages.add(ref.image);
      pool.push(ref); storage?.add(ref);
      const entry = progress.get(ref.sourceKey!)!;
      entry.source.found++; entry.source.firstResultMs ??= Math.round(performance.now() - entry.start);
      emit({ type: 'candidate', source: ref.sourceKey!, reference: ref }); entry.update();
      if (pool.length >= target) collectionAbort.abort();
    });
    await Promise.all(SOURCE_KEYS.map(async key => {
      const start = performance.now();
      const source: SourceProgress = { key, query: searches![key], url: searchUrl(key, searches![key]), status: 'searching', found: 0, elapsedMs: 0 };
      const update = () => { source.elapsedMs = Math.round(performance.now() - start); emit({ type: 'source', source: { ...source } }); };
      progress.set(key, { source, start, update });
      const pageKey = `${key}:${searches![key]}`;
      const page = (discovery?.pages.get(pageKey) || 0) + 1;
      discovery?.pages.set(pageKey, page); discovery?.queries[key].add(searches![key]);
      update();
      try {
        await collect(key, searches![key], collectionSignal, ref => collector.offer(ref), CREATOR_TARGET, { page, excludeIds: discovery?.seenIds, excludeImages: discovery?.seenImages });
        source.status = 'ready';
      } catch {
        signal.throwIfAborted(); source.status = collectionAbort.signal.aborted ? 'ready' : 'error';
        if (source.status === 'error') source.error = source.found ? 'Kept the assets that arrived before this source timed out.' : 'This source returned no images in time. Try a broader search.';
      }
      collector.finish(key);
      update();
    }));
    signal.throwIfAborted();
  return pool;
}
