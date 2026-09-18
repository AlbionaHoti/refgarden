import { expect, test } from 'bun:test';
import { createCreatorPool } from '../src/creator-pool';
import type { Reference, SourceKey } from '../src/types';

const ref = (sourceKey: SourceKey, index: number): Reference => ({ id: `${sourceKey}-${index}`, sourceKey, image: `https://example.com/${sourceKey}/${index}`, source: 'https://example.com', title: 'Image', sourceName: sourceKey, description: '', credit: '', date: '', collection: '', descriptionOrigin: 'Test' });

test('a fast source cannot crowd out the others, and unused places fill to exactly 100', () => {
  const received: Reference[] = [];
  const pool = createCreatorPool(100, value => received.push(value));
  for (let i = 0; i < 100; i++) pool.offer(ref('nasa', i));
  pool.finish('nasa');
  expect(received).toHaveLength(33);
  for (let i = 0; i < 20; i++) pool.offer(ref('cosmos', i));
  pool.finish('cosmos');
  expect(received).toHaveLength(66);
  for (let i = 0; i < 50; i++) pool.offer(ref('met', i));
  pool.finish('met');
  expect(received).toHaveLength(100);
  expect(received.filter(value => value.sourceKey === 'met')).toHaveLength(34);
  expect(received.filter(value => value.sourceKey === 'cosmos')).toHaveLength(20);
  expect(new Set(received.map(value => value.id)).size).toBe(100);
});

test('failed sources release their reservation and duplicate IDs or images never inflate the result', () => {
  const received: Reference[] = [];
  const pool = createCreatorPool(100, value => received.push(value));
  for (let i = 0; i < 120; i++) pool.offer(ref('nasa', i));
  pool.offer({ ...ref('nasa', 0), image: 'https://example.com/duplicate-id' });
  pool.offer({ ...ref('met', 0), image: ref('nasa', 0).image });
  pool.finish('nasa'); pool.finish('met'); pool.finish('cosmos');
  expect(pool.count).toBe(100);
  expect(received.every(value => value.sourceKey === 'nasa')).toBe(true);
  expect(new Set(received.map(value => value.image)).size).toBe(100);
});

test('a small search reports the actual number without inventing enough results to reach the target', () => {
  const received: Reference[] = [];
  const pool = createCreatorPool(100, value => received.push(value));
  pool.offer(ref('met', 1)); pool.finish('met'); pool.finish('cosmos'); pool.finish('nasa');
  expect(pool.count).toBe(1);
});
