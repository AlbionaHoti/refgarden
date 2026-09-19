import { expect, test } from 'bun:test';
import { archiveQueryOptions, archiveReference, archiveSearchUrl, collectArchiveVideos, runMediaBatch } from '../src/archive-videos';
import { validateMedia, safeArchiveVideo } from '../src/media';
import { VideoPreviews } from '../src/video-previews';
import { GalleryCollection } from '../src/gallery-loading';
import { readCursor, saveCursor } from '../src/hosted-session';
import { handleResearch } from '../src/hosted-api';
import type { ResearchEvent } from '../src/types';

const item = (length: unknown = '61.5') => ({ metadata: { title: 'Coffee commercial', description: '<p>A vintage ad</p>', creator: 'Test collection' }, files: [{ name: 'Coffee ad.mp4', format: 'h.264', length, size: '6000000' }] });

test('short clips require an actual small MP4 with a known bounded duration', () => {
  const ref = archiveReference('coffee', item())!;
  expect(ref.video).toEqual({ url: 'https://archive.org/download/coffee/Coffee%20ad.mp4', durationSeconds: 61.5 });
  expect(ref.description).toBe('A vintage ad');
  for (const length of [null, '', 'NaN', '-1', '0', '181', '1255']) expect(archiveReference('coffee', item(length))).toBeUndefined();
  expect(archiveReference('coffee', item(180))).toBeDefined();
  expect(archiveReference('../unsafe', item())).toBeUndefined();
  expect(archiveReference('private', { ...item(), is_dark: true })).toBeUndefined();
  expect(archiveReference('long', { metadata: {}, files: [{ name: 'long.mp4', length: 60, size: 100_000_000 }] })).toBeUndefined();
  expect(archiveReference('traversal', { files: [{ name: '../secret.mp4', length: 60, size: 400 }] })).toBeUndefined();
});

test('video URL validation rejects saved-history spoofing; query text cannot widen the collection', () => {
  const valid = archiveReference('coffee', item())!.video!;
  expect(safeArchiveVideo(valid)).toBe(true);
  for (const url of ['https://evil.example/a.mp4', 'https://archive.org.evil.example/download/a.mp4', 'http://archive.org/download/a.mp4', 'https://user:pass@archive.org/download/a.mp4', 'https://archive.org/download/file.html']) expect(safeArchiveVideo({ ...valid, url })).toBe(false);
  expect(safeArchiveVideo({ ...valid, durationSeconds: Infinity })).toBe(false);
  const q = new URL(archiveSearchUrl('coffee") OR collection:*', 2)).searchParams.get('q')!;
  expect(q).toBe('collection:prelinger AND mediatype:movies AND ("coffee" AND "OR" AND "collection")');
  expect(Object.values(archiveQueryOptions('Find short vintage coffee commercials'))).toContain('coffee commercials');
  expect(validateMedia(undefined)).toBe('images');
  expect(() => validateMedia('anything')).toThrow();
});

test('archive streaming deduplicates, bounds requests, paginates and keeps video counts separate', async () => {
  const { context } = readCursor(undefined);
  const sent: ResearchEvent[] = []; let active = 0, peak = 0;
  const pages: string[] = [];
  const fake = (async (url: string) => {
    if (url.includes('advancedsearch')) {
      pages.push(new URL(url).searchParams.get('page')!);
      return Response.json({ response: { docs: Array.from({ length: 20 }, (_, i) => ({ identifier: `ad-${i}` })) } });
    }
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return Response.json(item());
  }) as typeof fetch;
  await collectArchiveVideos({ brief: 'coffee commercials', selected: [] }, new AbortController().signal, event => sent.push(event), context, undefined, fake);
  const first = sent.filter(event => event.type === 'candidate');
  expect(first).toHaveLength(12); expect(peak).toBeLessThanOrEqual(3);
  const gallery = new GalleryCollection();
  for (const event of first) if (event.type === 'candidate') gallery.add(event.reference);
  expect(gallery.sources).toEqual({ met: 0, cosmos: 0, nasa: 0, archive: 12 });
  const resumed = readCursor(saveCursor(context, 0)).context;
  resumed.round = 1; // Same query must advance its page, not replay page one.
  await collectArchiveVideos({ brief: 'coffee commercials', selected: [] }, new AbortController().signal, event => sent.push(event), resumed, undefined, fake);
  expect(pages).toEqual(['1', '2']);
  expect(sent.filter(event => event.type === 'candidate')).toHaveLength(20);
  expect(resumed.seenIds.size).toBe(20);
});

test('Stop aborts pending video requests without leaking new cards into the gallery', async () => {
  const abort = new AbortController(), events: ResearchEvent[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    if (url.includes('advancedsearch')) return Response.json({ response: { docs: [{ identifier: 'waiting' }] } });
    abort.abort();
    expect(init.signal?.aborted).toBe(true);
    return Response.json(item());
  }) as typeof fetch;
  await expect(collectArchiveVideos({ brief: 'coffee commercials', selected: [] }, abort.signal, event => events.push(event), readCursor(undefined).context, undefined, fake)).rejects.toThrow();
  expect(events.some(event => event.type === 'candidate')).toBe(false);
});

test('an archive rate limit cancels sibling requests and ends automatic discovery', async () => {
  const sent: ResearchEvent[] = []; let siblingsAborted = 0;
  const fake = (async (url: string, init: RequestInit) => {
    if (url.includes('advancedsearch')) return Response.json({ response: { docs: ['limited', 'sibling', 'another'].map(identifier => ({ identifier })) } });
    if (url.endsWith('/limited')) return new Response('Rate limited', { status: 429 });
    await new Promise<void>(resolve => init.signal!.addEventListener('abort', () => { siblingsAborted++; resolve(); }, { once: true }));
    return Response.json(item());
  }) as typeof fetch;
  await collectArchiveVideos({ brief: 'coffee commercials', selected: [] }, new AbortController().signal, event => sent.push(event), readCursor(undefined).context, undefined, fake);
  expect(siblingsAborted).toBe(2);
  expect(sent.filter(event => event.type === 'candidate')).toHaveLength(0);
  expect(sent.find(event => event.type === 'error')).toMatchObject({ message: 'Internet Archive is busy. Discovery has stopped; try again later.' });
});

test('image-only mode makes no archive requests and hosted validation forwards video selection without credentials', async () => {
  let images = 0;
  await runMediaBatch({ brief: 'moonlight', selected: [] }, new AbortController().signal, () => {}, undefined, async () => { images++; });
  expect(images).toBe(1);
  let media: unknown;
  const request = (value: string) => new Request('https://example.com/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'creator', brief: 'coffee commercials', selected: [], media: value }) });
  await (await handleResearch(request('both'), async input => { media = input.media; })).text();
  expect(media).toBe('both');
  expect((await handleResearch(request('arbitrary'))).status).toBe(400);
});

test('visible previews autoplay within a decoder budget, rotate fairly and release on hide or clear', () => {
  const pool = new VideoPreviews(2), active = new Set<string>(), started = new Set<string>();
  let peak = 0;
  for (const id of ['a', 'b', 'c', 'd']) pool.show(id, { start: () => { active.add(id); started.add(id); peak = Math.max(peak, active.size); }, stop: () => { active.delete(id); } });
  expect([...active]).toEqual(['a', 'b']);
  pool.rotate(); expect([...active]).toEqual(['c', 'd']); expect(started.size).toBe(4);
  pool.hide('c'); expect(active.size).toBe(2);
  pool.setPaused(true); expect(active.size).toBe(0);
  pool.rotate(); expect(active.size).toBe(0);
  pool.setPaused(false); expect(active.size).toBe(2);
  pool.clear(); expect(active.size).toBe(0); expect(peak).toBe(2);
});
