import { RequestError } from './decision';
import { MAX_VIDEO_SECONDS } from './media';
import type { CreatorInput, Reference, ResearchEvent } from './types';
import type { DiscoveryContext } from './creator-collection';

type Emit = (event: ResearchEvent) => void;
type ChooseQuery = (options: Record<string, string>) => Promise<string>;
const origin = 'https://archive.org';
const plain = (value: unknown) => (Array.isArray(value) ? value.join('; ') : typeof value === 'string' ? value : '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Terms are data, never Archive search syntax supplied by a prompt. */
export function archiveQueryOptions(brief: string): Record<string, string> {
  const stop = new Set('a an the and or for of in on with me i want find show give some short form video videos clip clips footage reference references inspiration vintage retro archival archive from internet under minutes seconds'.split(' '));
  const words = [...new Set((brief.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => !stop.has(word)))].slice(0, 8);
  const terms = words.length ? words : ['commercial'];
  const candidates = [terms.slice(0, 4).join(' '), ...terms];
  return Object.fromEntries([...new Set(candidates)].map((phrase, index) => [`query_${index}`, phrase]));
}

export function archiveSearchUrl(query: string, page: number): string {
  const terms = query.match(/[\p{L}\p{N}]+/gu) || [];
  // Prelinger includes advertising, animation and educational shorts. Restrict the corpus
  // before checking each actual MP4 duration; a title containing "short" is insufficient.
  const expression = `collection:prelinger AND mediatype:movies AND (${terms.map(word => `"${word}"`).join(' AND ')})`;
  const url = new URL('/advancedsearch.php', origin);
  url.search = new URLSearchParams({ q: expression, output: 'json', rows: '36', page: String(page) }).toString();
  for (const field of ['identifier', 'title', 'runtime']) url.searchParams.append('fl[]', field);
  return url.href;
}

export function archiveReference(identifier: string, data: any): Reference | undefined {
  if (!/^[\w.-]{1,200}$/.test(identifier) || data?.is_dark || data?.metadata?.access_restricted === 'true' || !Array.isArray(data?.files)) return;
  const files = data.files.filter((file: any) => typeof file.name === 'string' && file.name.endsWith('.mp4') && !file.private && !/(^|\/)\.\.(\/|$)/.test(file.name) && Number(file.length) > 0 && Number(file.length) <= MAX_VIDEO_SECONDS && Number(file.size) > 0 && Number(file.size) <= 80_000_000);
  files.sort((a: any, b: any) => Number(a.size) - Number(b.size));
  const file = files[0];
  if (!file) return;
  const metadata = data.metadata || {};
  return {
    id: `archive-${identifier}`, title: plain(metadata.title) || identifier,
    description: plain(metadata.description).slice(0, 1600) || 'A short film from the Prelinger Archives.',
    credit: plain(metadata.creator) || 'Prelinger Archives / Internet Archive', date: plain(metadata.date),
    image: `${origin}/services/img/${encodeURIComponent(identifier)}`,
    source: `${origin}/details/${encodeURIComponent(identifier)}`, collection: 'Prelinger Archives',
    sourceName: 'Internet Archive', sourceKey: 'archive', descriptionOrigin: 'Archive item metadata; no video or audio analysis',
    video: { url: `${origin}/download/${encodeURIComponent(identifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`, durationSeconds: Number(file.length) },
    retrievedAt: new Date().toISOString(),
  };
}

export async function collectArchiveVideos(input: CreatorInput, signal: AbortSignal, send: Emit, context: DiscoveryContext, choose?: ChooseQuery, fetcher: typeof fetch = fetch): Promise<void> {
  const began = performance.now();
  const emit = (event: ResearchEvent) => { if (!signal.aborted) send({ ...event, atMs: Math.round(performance.now() - began) }); };
  const options = archiveQueryOptions(input.brief);
  const phrases = Object.values(options);
  const query = choose ? await choose(options) : phrases[(context.round - 1) % phrases.length];
  if (!phrases.includes(query)) throw new RequestError('The video search phrase was invalid. Try again.');
  const pageKey = `archive:${query}`;
  const page = (context.pages.get(pageKey) || 0) + 1;
  const cancel = new AbortController();
  const requestSignal = AbortSignal.any([signal, cancel.signal, AbortSignal.timeout(20_000)]);
  const source = { key: 'archive' as const, query, url: `${origin}/search?query=${encodeURIComponent(query)}&and[]=collection:prelinger`, status: 'searching' as 'searching' | 'ready' | 'error', found: 0, elapsedMs: 0, error: undefined as string | undefined };
  const update = () => emit({ type: 'source', atMs: 0, source: { ...source, elapsedMs: Math.round(performance.now() - began) } });
  const get = async (url: string) => {
    const response = await fetcher(url, { signal: requestSignal, headers: { 'User-Agent': 'RefGarden/0.4 (short-video reference search)', Accept: 'application/json' } });
    if (!response.ok) {
      const error = new RequestError(response.status === 429 ? 'Internet Archive is busy. Discovery has stopped; try again later.' : 'Internet Archive could not return these clips. Try again shortly.', response.status === 429 ? 429 : 502);
      if (response.status === 429) cancel.abort(error);
      throw error;
    }
    return response.json();
  };
  update();
  try {
    const data = await get(archiveSearchUrl(query, page));
    if (!Array.isArray(data?.response?.docs)) throw new RequestError('Internet Archive returned an unreadable search result.', 502);
    context.pages.set(pageKey, page);
    const docs = data.response.docs.filter((doc: any) => typeof doc.identifier === 'string' && /^[\w.-]{1,200}$/.test(doc.identifier) && !context.seenIds.has(`archive-${doc.identifier}`));
    let position = 0;
    await Promise.allSettled(Array.from({ length: 3 }, async () => {
      while (position < docs.length && source.found < 12 && !requestSignal.aborted) {
        const doc = docs[position++];
        try {
          const ref = archiveReference(doc.identifier, await get(`${origin}/metadata/${encodeURIComponent(doc.identifier)}`));
          if (requestSignal.aborted || !ref || source.found >= 12 || context.seenIds.has(ref.id) || context.seenImages.has(ref.image)) continue;
          context.seenIds.add(ref.id); context.seenImages.add(ref.image); source.found++;
          emit({ type: 'candidate', atMs: 0, source: 'archive', reference: ref }); update();
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof RequestError && /busy/.test(error.message)) throw error;
          // One unavailable item does not discard other verified clips.
        }
      }
    }));
    signal.throwIfAborted();
    requestSignal.throwIfAborted();
    source.status = 'ready';
    if (!source.found) emit({ type: 'notice', atMs: 0, message: 'No verified clips under three minutes in this batch. Try “coffee commercials” or “animated advertisements”.' });
  } catch (error) {
    signal.throwIfAborted(); source.status = 'error';
    source.error = error instanceof RequestError ? error.message : 'Internet Archive took too long. Any clips already found are kept.';
    emit({ type: error instanceof RequestError && error.status === 429 ? 'error' : 'notice', atMs: 0, message: source.error });
  }
  update();
}

/** Images retain their three-source balance; the optional archive lane streams independently. */
export async function runMediaBatch(input: CreatorInput, signal: AbortSignal, send: Emit, context: DiscoveryContext | undefined, images: (send: Emit) => Promise<void>, choose?: ChooseQuery) {
  if (!input.media || input.media === 'images') return images(send);
  const discovery = context || { round: 1, target: 100, seenIds: new Set<string>(), seenImages: new Set<string>(), queries: { met: new Set<string>(), nasa: new Set<string>(), cosmos: new Set<string>() }, pages: new Map<string, number>() };
  const began = performance.now(); let count = 0;
  const forward = (event: ResearchEvent) => {
    if (signal.aborted) return;
    if (event.type === 'candidate') count++;
    if (!['start', 'end', 'retrieval-complete'].includes(event.type)) send({ ...event, atMs: Math.round(performance.now() - began) });
  };
  const tasks = [collectArchiveVideos(input, signal, forward, discovery, choose)];
  if (input.media === 'both') tasks.push(images(forward));
  await Promise.all(tasks);
  if (signal.aborted) return;
  send({ type: 'retrieval-complete', atMs: Math.round(performance.now() - began), count });
  send({ type: 'end', atMs: Math.round(performance.now() - began), status: count ? 'complete' : 'no-match', message: `${count} references found. Open a card to see its original source.` });
}
