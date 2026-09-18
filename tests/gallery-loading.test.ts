import { expect, test } from 'bun:test';
import { GalleryCollection, ImageLoadQueue } from '../src/gallery-loading';
import type { Reference, SourceKey } from '../src/types';

const ref = (sourceKey: SourceKey, i: number): Reference => ({ id: `${sourceKey}-${i}`, sourceKey, sourceName: { met: 'The Met', nasa: 'NASA', cosmos: 'Cosmos' }[sourceKey], title: 'Reference', image: `https://example.com/${sourceKey}/${i}`, source: 'https://example.com', description: '', credit: '', date: '', collection: '', descriptionOrigin: 'Test' });

test('all references keep distinct stable places after 100, with only the first 100 prioritized', () => {
  const gallery = new GalleryCollection();
  const entries = Array.from({ length: 1200 }, (_, i) => gallery.add(ref((['met', 'nasa', 'cosmos'] as const)[i % 3], i))!);
  expect(entries.filter(entry => entry.priority)).toHaveLength(100);
  expect(new Set(entries.map(entry => entry.slot)).size).toBe(1200);
  expect(entries[0].slot).toBe(0);
  expect(entries[1199].slot).toBe(1199);
  expect(gallery.size).toBe(1200);
  expect(gallery.sources).toEqual({ met: 400, nasa: 400, cosmos: 400 });
});

test('duplicate IDs and image URLs do not consume places or source counts', () => {
  const gallery = new GalleryCollection();
  gallery.add(ref('met', 1));
  expect(gallery.add(ref('met', 1))).toBeUndefined();
  expect(gallery.add({ ...ref('nasa', 1), image: ref('met', 1).image })).toBeUndefined();
  const next = gallery.add({ ...ref('cosmos', 1), sourceKey: undefined });
  expect(next?.slot).toBe(1);
  expect(gallery.sources).toEqual({ met: 1, nasa: 0, cosmos: 1 });
  gallery.clear();
  expect(gallery.size).toBe(0);
  expect(gallery.sources).toEqual({ met: 0, nasa: 0, cosmos: 0 });
  expect(gallery.add(ref('met', 1))?.slot).toBe(0);
});

function loader() {
  const queue = new ImageLoadQueue();
  const starts: string[] = [], cancellations: string[] = [];
  const done = new Map<string, () => void>();
  const add = (id: string, priority = true) => queue.add(priority, complete => {
    starts.push(id); done.set(id, complete);
    return () => { cancellations.push(id); };
  });
  return { queue, starts, cancellations, done, add };
}

test('eight foreground requests run first, followed by only two background requests', () => {
  const { queue, starts, done, add } = loader();
  queue.setPaused(true);
  for (let i = 0; i < 4; i++) add(`b${i}`, false);
  for (let i = 0; i < 100; i++) add(`p${i}`);
  queue.setPaused(false);
  expect(starts).toEqual(Array.from({ length: 8 }, (_, i) => `p${i}`));
  for (let i = 0; i < 99; i++) done.get(`p${i}`)!();
  expect(starts).toHaveLength(100);
  done.get('p99')!();
  expect(starts.slice(100)).toEqual(['b0', 'b1']);
  done.get('b0')!();
  expect(starts.slice(100)).toEqual(['b0', 'b1', 'b2']);
});

test('a cleared search cancels active loads and stale callbacks cannot release the next search', () => {
  const { queue, starts, cancellations, done, add } = loader();
  for (let i = 0; i < 10; i++) add(`old${i}`);
  queue.clear();
  expect(cancellations).toHaveLength(8);
  for (let i = 0; i < 10; i++) add(`new${i}`);
  for (let i = 0; i < 8; i++) done.get(`old${i}`)!();
  expect(starts.filter(id => id.startsWith('old'))).toHaveLength(8);
  expect(starts.filter(id => id.startsWith('new'))).toHaveLength(8);
  done.get('new0')!();
  expect(starts.at(-1)).toBe('new8');
});

test('hidden tabs defer new work and synchronous completions do not stall the queue', () => {
  const { queue, starts, done, add } = loader();
  add('first'); queue.setPaused(true);
  add('waiting'); done.get('first')!();
  expect(starts).toEqual(['first']);
  queue.setPaused(false);
  expect(starts).toEqual(['first', 'waiting']);
  done.get('waiting')!();
  queue.setPaused(true);
  for (let i = 0; i < 500; i++) queue.add(false, complete => { complete(); return () => {}; });
  add('after', false); queue.setPaused(false);
  expect(starts.at(-1)).toBe('after');
});

test('foreground arrivals take priority over waiting background requests', () => {
  const { starts, done, add } = loader();
  for (let i = 0; i < 4; i++) add(`b${i}`, false);
  add('priority');
  expect(starts).toEqual(['b0', 'b1', 'priority']);
  done.get('b0')!(); done.get('b1')!();
  expect(starts).toHaveLength(3);
  done.get('priority')!();
  expect(starts.slice(3)).toEqual(['b2', 'b3']);
});
