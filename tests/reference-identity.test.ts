import { expect, test } from 'bun:test';
import { imageIdentity, referenceKeys, ReferenceIdentity } from '../src/reference-identity';
import { GalleryCollection } from '../src/gallery-loading';
import { collectCreatorSources, type DiscoveryContext } from '../src/creator-collection';
import { readCursor, saveCursor } from '../src/hosted-session';
import type { Reference, ResearchEvent } from '../src/types';

// These two real catalog entries show the repeated print reported in the gallery.
const dance: Reference = {
  id: 'met-717826', title: 'Vintage Dance, from National Dances (N225, Type 1) issued by Kinney Bros.',
  date: '1889', credit: 'Kinney Brothers Tobacco Company. The Jefferson R. Burdick Collection, Gift of Jefferson R. Burdick',
  image: 'https://images.metmuseum.org/CRDImages/dp/web-large/DPB874555.jpg',
  source: 'https://www.metmuseum.org/art/collection/search/717826', sourceKey: 'met', sourceName: 'The Met',
  description: '', collection: '', descriptionOrigin: 'The Met catalog',
};
const secondEdition: Reference = { ...dance, id: 'met-717827', image: 'https://images.metmuseum.org/CRDImages/dp/web-large/DPB874556.jpg', source: 'https://www.metmuseum.org/art/collection/search/717827' };

test('resized copies share identity without removing content-changing URL parameters', () => {
  expect(imageIdentity('https://cdn.cosmos.so/art?w=800&format=webp')).toBe(imageIdentity('https://cdn.cosmos.so/art?format=jpg&w=400#image'));
  expect(imageIdentity(dance.image)).toBe(imageIdentity(dance.image.replace('web-large', 'original')));
  expect(imageIdentity('https://images-assets.nasa.gov/image/a/a~thumb.jpg')).toBe(imageIdentity('https://images-assets.nasa.gov/image/a/a~orig.png'));
  expect(imageIdentity('https://example.com/image?id=1')).not.toBe(imageIdentity('https://example.com/image?id=2'));
  expect(imageIdentity('https://cdn.cosmos.so/art?frame=1&w=800')).not.toBe(imageIdentity('https://cdn.cosmos.so/art?frame=2&w=800'));
});

test('the reported duplicate catalog print occupies one place and one source count', () => {
  const gallery = new GalleryCollection();
  expect(gallery.add(dance)?.slot).toBe(0);
  expect(gallery.add(secondEdition)).toBeUndefined();
  expect(gallery.size).toBe(1);
  expect(gallery.sources.met).toBe(1);
  gallery.clear();
  expect(gallery.add(secondEdition)?.slot).toBe(0);
});

test('generic names, other artists and different dates do not collapse distinct works', () => {
  const identity = new ReferenceIdentity();
  expect(identity.add(dance)).toBe(true);
  expect(identity.add({ ...secondEdition, credit: 'Another artist. A different collection' })).toBe(true);
  expect(identity.add({ ...secondEdition, id: 'met-third', image: 'https://example.com/third', date: '1900' })).toBe(true);
  const generic = new ReferenceIdentity();
  expect(generic.add({ ...dance, title: 'Dress' })).toBe(true);
  expect(generic.add({ ...secondEdition, title: 'Dress' })).toBe(true);
});

test('duplicate aliases stay excluded but different clips may share one poster', () => {
  const identity = new ReferenceIdentity();
  expect(identity.add(dance)).toBe(true);
  expect(identity.add(secondEdition)).toBe(false);
  expect(identity.add({ ...secondEdition, id: 'other', title: 'Different metadata' })).toBe(false);
  const clips = new ReferenceIdentity();
  expect(clips.add({ ...dance, id: 'clip1', video: { url: 'https://archive.org/download/a/a.mp4', durationSeconds: 60 } })).toBe(true);
  expect(clips.add({ ...dance, id: 'clip2', video: { url: 'https://archive.org/download/b/b.mp4', durationSeconds: 60 } })).toBe(true);
});

test('duplicate artwork stays excluded across local rounds and hosted continuation', async () => {
  const context: DiscoveryContext = { round: 1, target: 100, seenIds: new Set(), seenImages: new Set(), queries: { met: new Set(), nasa: new Set(), cosmos: new Set() }, pages: new Map() };
  const events: Omit<ResearchEvent, 'atMs'>[] = [];
  const searches = { met: 'vintage', nasa: 'vintage', cosmos: 'vintage' };
  const collect: Parameters<typeof collectCreatorSources>[5] = async (key, _query, _signal, receive) => {
    if (key === 'met') { receive(dance); receive(secondEdition); }
    return key === 'met' ? 2 : 0;
  };
  const first = await collectCreatorSources(searches, new AbortController().signal, event => events.push(event), context, undefined, collect);
  expect(first.map(ref => ref.id)).toEqual([dance.id]);
  expect(context.seenIds.size).toBe(1);
  expect(referenceKeys(dance).every(key => context.seenKeys?.has(key))).toBe(true);
  const next = readCursor(saveCursor(context, 0)).context;
  const second = await collectCreatorSources(searches, new AbortController().signal, () => {}, next, undefined, collect);
  expect(second).toEqual([]);
  expect(next.seenIds.size).toBe(1);
  expect(() => readCursor({ ...saveCursor(context, 0), seenKeys: [123] })).toThrow();
});
