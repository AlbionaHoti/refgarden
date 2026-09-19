import { RequestError } from './decision';
import { SOURCE_KEYS } from './sources';
import type { DiscoveryContext } from './creator-collection';
import type { DiscoveryCursor, SourceKey } from './types';

export function readCursor(value: unknown): { context: DiscoveryContext; emptyRounds: number } {
  if (value === undefined || value === null) return { context: { round: 1, target: 100, seenIds: new Set(), seenImages: new Set(), queries: { met: new Set(), cosmos: new Set(), nasa: new Set() }, pages: new Map() }, emptyRounds: 0 };
  const fail = () => { throw new RequestError('This search has reached its limit. Start a new exploration; your images are kept.'); };
  const v = value as DiscoveryCursor;
  const strings = (items: unknown, count: number, length: number): items is string[] => Array.isArray(items) && items.length <= count && items.every(x => typeof x === 'string' && x.length > 0 && x.length <= length);
  if (!v || !Number.isInteger(v.round) || v.round < 1 || v.round > 10000 || !Number.isInteger(v.emptyRounds) || v.emptyRounds < 0 || v.emptyRounds > 2
    || !strings(v.seenIds, 10000, 256) || !strings(v.seenImages, 10000, 2048)
    || (v.seenKeys !== undefined && !strings(v.seenKeys, 30000, 2048))
    || !v.queries || !SOURCE_KEYS.every(key => strings(v.queries[key], 1000, 100))
    || !Array.isArray(v.pages) || v.pages.length > 3000 || !v.pages.every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && pair[0].length <= 110 && Number.isInteger(pair[1]) && pair[1] > 0 && pair[1] <= 10000)) return fail();
  return { context: { round: v.round + 1, target: 30, seenIds: new Set(v.seenIds), seenImages: new Set(v.seenImages), seenKeys: new Set(v.seenKeys), queries: Object.fromEntries(SOURCE_KEYS.map(key => [key, new Set(v.queries[key])])) as Record<SourceKey, Set<string>>, pages: new Map(v.pages) }, emptyRounds: v.emptyRounds };
}

export function saveCursor(context: DiscoveryContext, emptyRounds: number): DiscoveryCursor {
  return { round: context.round, emptyRounds, seenIds: [...context.seenIds], seenImages: [...context.seenImages], seenKeys: [...(context.seenKeys || [])], queries: Object.fromEntries(SOURCE_KEYS.map(key => [key, [...context.queries[key]]])) as Record<SourceKey, string[]>, pages: [...context.pages] };
}
