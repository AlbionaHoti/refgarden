import { expect, test } from 'bun:test';
import { createCreatorPool } from '../src/creator-pool';
import { collectCreatorSources } from '../src/creator-collection';
import type { Reference, SourceKey } from '../src/types';

const ref = (sourceKey: SourceKey, index: number): Reference => ({ id: `${sourceKey}-${index}`, sourceKey, image: `https://example.com/${sourceKey}/${index}`, source: 'https://example.com', title: 'Image', sourceName: sourceKey, description: '', credit: '', date: '', collection: '', descriptionOrigin: 'Test' });

test('a fast source keeps its third and cannot take places from a smaller collection', () => {
  const received: Reference[] = [];
  const pool = createCreatorPool(100, value => received.push(value));
  for (let i = 0; i < 100; i++) pool.offer(ref('nasa', i));
  pool.finish('nasa');
  expect(received).toHaveLength(0);
  for (let i = 0; i < 20; i++) pool.offer(ref('cosmos', i));
  pool.finish('cosmos');
  expect(received).toHaveLength(0);
  for (let i = 0; i < 50; i++) pool.offer(ref('met', i));
  pool.finish('met');
  expect(received).toHaveLength(87);
  expect(received.filter(value => value.sourceKey === 'met')).toHaveLength(34);
  expect(received.filter(value => value.sourceKey === 'cosmos')).toHaveLength(20);
  expect(new Set(received.map(value => value.id)).size).toBe(87);
});

test('missing sources leave room and duplicate IDs or images never inflate the result', () => {
  const received: Reference[] = [];
  const pool = createCreatorPool(100, value => received.push(value));
  for (let i = 0; i < 120; i++) pool.offer(ref('nasa', i));
  pool.offer({ ...ref('nasa', 0), image: 'https://example.com/duplicate-id' });
  pool.offer({ ...ref('met', 0), image: ref('nasa', 0).image });
  expect(pool.count).toBe(0);
  pool.finish('nasa'); pool.finish('met'); pool.finish('cosmos');
  expect(pool.count).toBe(33);
  expect(received.every(value => value.sourceKey === 'nasa')).toBe(true);
  expect(new Set(received.map(value => value.image)).size).toBe(33);
});

test('a small search reports the actual number without inventing enough results to reach the target', () => {
  const received: Reference[] = [];
  const pool = createCreatorPool(100, value => received.push(value));
  pool.offer(ref('met', 1)); pool.finish('met'); pool.finish('nasa'); pool.finish('cosmos');
  expect(pool.count).toBe(1);
});

test('the first visible group and every subsequent prefix stay balanced despite bursty source arrival', () => {
  const received: Reference[] = [];
  const counts = { met: 0, nasa: 0, cosmos: 0 };
  const pool = createCreatorPool(100, reference => {
    received.push(reference); counts[reference.sourceKey!]++;
    expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1);
  });
  for (let i = 0; i < 33; i++) pool.offer(ref('cosmos', i));
  for (let i = 0; i < 33; i++) pool.offer(ref('nasa', i));
  // This is also the state if the slower source has not responded after two seconds.
  expect(received).toHaveLength(0);
  pool.offer(ref('met', 0));
  expect(received.map(reference => reference.sourceKey)).toEqual(['met', 'nasa', 'cosmos']);
  for (let i = 1; i < 34; i++) pool.offer(ref('met', i));
  expect(counts).toEqual({ met: 34, nasa: 33, cosmos: 33 });
});

test('a failed source still limits Cosmos to a third of the images actually released', () => {
  const received: SourceKey[] = [];
  const pool = createCreatorPool(30, reference => received.push(reference.sourceKey!));
  for (let i = 0; i < 10; i++) pool.offer(ref('cosmos', i));
  for (let i = 0; i < 10; i++) pool.offer(ref('met', i));
  expect(received).toHaveLength(0);
  pool.finish('nasa');
  expect(received.filter(source => source === 'met')).toHaveLength(10);
  expect(received.filter(source => source === 'cosmos')).toHaveLength(5);
  expect(pool.held('cosmos')).toBe(5);
});

test('later batches catch up the underrepresented source before releasing more from an ahead source', () => {
  const received: SourceKey[] = [];
  const pool = createCreatorPool(30, reference => received.push(reference.sourceKey!), { met: 0, nasa: 10, cosmos: 33 });
  expect(['met', 'nasa', 'cosmos'].map(source => pool.limit(source as SourceKey))).toEqual([20, 10, 0]);
  for (let i = 0; i < 10; i++) pool.offer(ref('nasa', i));
  expect(received).toHaveLength(0);
  for (let i = 0; i < 20; i++) pool.offer(ref('met', i));
  expect(received.slice(0, 10)).toEqual(Array(10).fill('met'));
  expect(received.slice(10)).toEqual(Array.from({ length: 10 }, (): SourceKey[] => ['met', 'nasa']).flat());
});

test('cancelling collection discards queued fast-source results instead of flushing an unbalanced remainder', async () => {
  const abort = new AbortController();
  const received: Reference[] = [];
  const run = collectCreatorSources({ met: 'plants', nasa: 'plants', cosmos: 'plants' }, abort.signal, event => { if (event.type === 'candidate') received.push(event.reference); }, undefined, undefined, async (source, _query, signal, accept) => {
    if (source === 'cosmos') for (let i = 0; i < 10; i++) accept(ref(source, i));
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    return 0;
  });
  abort.abort();
  await expect(run).rejects.toThrow();
  expect(received).toHaveLength(0);
});

test('collection asks for balanced source limits and preserves results if one source fails', async () => {
  const limits: Partial<Record<SourceKey, number>> = {};
  const results = await collectCreatorSources({ met: 'plants', nasa: 'plants', cosmos: 'plants' }, new AbortController().signal, () => {}, undefined, undefined, async (source, _query, _signal, receive, limit) => {
    limits[source] = limit;
    if (source === 'nasa') throw new Error('Unavailable');
    for (let i = 0; i < 100; i++) receive(ref(source, i));
    return 100;
  });
  expect(limits).toEqual({ met: 34, nasa: 33, cosmos: 33 });
  expect(results.filter(value => value.sourceKey === 'met')).toHaveLength(34);
  expect(results.filter(value => value.sourceKey === 'cosmos')).toHaveLength(17);
  expect(results).toHaveLength(51);
});

test('collection carries the run totals into its next budget and skips a source already ahead', async () => {
  const limits: Partial<Record<SourceKey, number>> = {};
  const context = { round: 2, target: 30, seenIds: new Set([...Array.from({ length: 10 }, (_, i) => `nasa-${i}`), ...Array.from({ length: 33 }, (_, i) => `cosmos-${i}`)]), seenImages: new Set<string>(), queries: { met: new Set<string>(), nasa: new Set<string>(), cosmos: new Set<string>() }, pages: new Map<string, number>() };
  const results = await collectCreatorSources({ met: 'plants', nasa: 'plants', cosmos: 'plants' }, new AbortController().signal, () => {}, context, undefined, async (source, _query, _signal, receive, limit) => {
    limits[source] = limit;
    for (let i = 0; i < limit!; i++) receive(ref(source, i + 100));
    return limit!;
  });
  expect(limits).toEqual({ met: 20, nasa: 10 });
  expect(results.slice(0, 10).every(reference => reference.sourceKey === 'met')).toBe(true);
  expect(results).toHaveLength(30);
  expect(context.seenIds.size).toBe(73);
});

test('the reported 7 Met, 0 NASA, 33 Cosmos case cannot flood any stream prefix', () => {
  for (const order of [['met', 'nasa', 'cosmos'], ['cosmos', 'met', 'nasa'], ['cosmos', 'nasa', 'met'], ['nasa', 'cosmos', 'met'], ['met', 'cosmos', 'nasa'], ['nasa', 'met', 'cosmos']] as SourceKey[][]) {
    const counts = { met: 0, nasa: 0, cosmos: 0 };
    const pool = createCreatorPool(100, ref => {
      counts[ref.sourceKey]++;
      expect(counts.cosmos * 2).toBeLessThanOrEqual(counts.met + counts.nasa);
    });
    for (const source of order) {
      for (let i = 0; i < { met: 7, nasa: 0, cosmos: 33 }[source]; i++) pool.offer(ref(source, i));
      pool.finish(source);
    }
    expect(counts).toEqual({ met: 7, nasa: 0, cosmos: 3 });
    expect(pool.held('cosmos')).toBe(30);
  }
});

test('Cosmos remains limited across rounds and video IDs do not fund extra image shares', async () => {
  const context = { round: 1, target: 100, seenIds: new Set(['archive-video-1', 'archive-video-2']), seenImages: new Set<string>(), queries: { met: new Set<string>(), nasa: new Set<string>(), cosmos: new Set<string>() }, pages: new Map<string, number>() };
  for (let round = 1; round <= 5; round++) {
    context.round = round;
    await collectCreatorSources({ met: 'toy', nasa: 'toy', cosmos: 'toy' }, new AbortController().signal, () => {}, context, undefined, async (source, _query, _signal, receive, limit) => {
      for (let i = 0; i < Math.min(source === 'met' ? 4 : source === 'nasa' ? 0 : 100, limit!); i++) receive(ref(source, round * 100 + i));
      return source === 'nasa' ? 0 : limit!;
    });
    const met = [...context.seenIds].filter(id => id.startsWith('met-')).length;
    const cosmos = [...context.seenIds].filter(id => id.startsWith('cosmos-')).length;
    expect(cosmos * 2).toBeLessThanOrEqual(met);
  }
});

test('shorter institutional searches fill a shortfall, deduplicate overlaps, and keep the same source budget', async () => {
  const context = { round: 1, target: 100, seenIds: new Set<string>(), seenImages: new Set<string>(), queries: { met: new Set<string>(), nasa: new Set<string>(), cosmos: new Set<string>() }, pages: new Map<string, number>() };
  const calls: { source: SourceKey; query: string; limit: number }[] = [];
  const results = await collectCreatorSources({ met: 'rare lunar crater', nasa: 'moon', cosmos: 'moon' }, new AbortController().signal, () => {}, context, undefined, async (source, query, _signal, receive, limit) => {
    calls.push({ source, query, limit: limit! });
    if (query === 'rare lunar crater') { receive(ref(source, 0)); return 1; }
    for (let i = 0; i < 100; i++) receive(ref(source, i));
    return limit!;
  });
  expect(calls.filter(call => call.source === 'met')).toEqual([{ source: 'met', query: 'rare lunar crater', limit: 34 }, { source: 'met', query: 'rare lunar', limit: 33 }]);
  expect(context.queries.met.has('rare lunar')).toBe(true);
  expect(results).toHaveLength(100);
  expect(new Set(results.map(ref => ref.id)).size).toBe(100);
});
