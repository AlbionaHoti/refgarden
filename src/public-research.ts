import { RequestError } from './decision';
import { collectCreatorSources, type DiscoveryContext } from './creator-collection';
import { findDirection } from './presets';
import { searchOptions } from './search-options';
import { SOURCE_KEYS } from './sources';
import type { ResearchEvent, SourceKey, CreatorInput } from './types';
import { runMediaBatch } from './archive-videos';

export function sourceSearches(brief: string, styles: string[], context: DiscoveryContext) {
  const sample = context.round === 1 && !styles.length ? findDirection(brief) : undefined;
  if (sample) return sample.searches;
  return Object.fromEntries(SOURCE_KEYS.map(key => {
    const options = Object.values(searchOptions(brief, key, styles));
    const phrase = options.find(option => !context.queries[key].has(option)) || options[(context.round - 1) % options.length];
    return [key, phrase];
  })) as Record<SourceKey, string>;
}

/** The hosted path searches public collections and never calls a model provider. */
export async function runSourceSearch(input: CreatorInput, signal: AbortSignal, send: (event: ResearchEvent) => void, context: DiscoveryContext, collect = collectCreatorSources) {
  return runMediaBatch(input, signal, send, context, forward => runImageSearch(input, signal, forward, context, collect));
}

async function runImageSearch(input: CreatorInput, signal: AbortSignal, send: (event: ResearchEvent) => void, context: DiscoveryContext, collect = collectCreatorSources) {
  const began = performance.now();
  const emit: Parameters<typeof collectCreatorSources>[2] = event => {
    if (!signal.aborted) send({ ...event, atMs: Math.round(performance.now() - began) } as ResearchEvent);
  };
  try {
    const searches = sourceSearches(input.brief, input.styles || [], context);
    const pool = await collect(searches, signal, emit, context);
    signal.throwIfAborted();
    emit({ type: 'retrieval-complete', count: pool.length });
    emit({ type: 'end', status: pool.length ? 'complete' : 'no-match', message: `${pool.length} assets from public collections. No Jev request was made.` });
  } catch (error) {
    if (!signal.aborted) emit({ type: 'error', message: error instanceof RequestError ? error.message : 'The source search could not finish. Images already found are kept.' });
  }
}
