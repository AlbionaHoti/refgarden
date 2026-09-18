import type { Reference, SourceKey } from './types';
import { RequestError } from './decision';

export const SOURCE_KEYS: SourceKey[] = ['met', 'cosmos', 'nasa'];
export const REFERENCES_PER_SOURCE = 20;
export const CREATOR_TARGET = 100;
export const DEFAULT_SEARCHES = { met: 'Anna Atkins', cosmos: 'botanical exhibition typography', nasa: 'spacecraft interior' };
export function validateSearches(value: unknown): Record<SourceKey, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('Enter a search phrase for each source.');
  const data = value as Record<string, unknown>;
  const searches = {} as Record<SourceKey, string>;
  for (const key of SOURCE_KEYS) {
    if (typeof data[key] !== 'string' || data[key].trim().length < 2 || data[key].length > 100) throw new RequestError('Each source search needs between 2 and 100 characters.');
    searches[key] = data[key].trim();
  }
  return searches;
}
export const SOURCE_NAMES = { met: 'The Met', cosmos: 'Cosmos', nasa: 'NASA' };
export const SOURCE_METHODS = { met: 'Met Open Access API', cosmos: 'Cosmos public search page', nasa: 'NASA Image and Video Library API' };
export function searchUrl(key: SourceKey, query: string) {
  if (key === 'met') return `https://www.metmuseum.org/art/collection/search?q=${encodeURIComponent(query)}&showOnly=openAccess`;
  if (key === 'cosmos') return `https://www.cosmos.so/search/elements/${encodeURIComponent(query)}`;
  return `https://images.nasa.gov/search?q=${encodeURIComponent(query)}&page=1&media=image&yearStart=1920&yearEnd=${new Date().getFullYear()}`;
}
const clean = (value: unknown, max = 1200) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export function safeImage(value: unknown) {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    const hosts = ['images-assets.nasa.gov', 'images.nasa.gov', 'www.nasa.gov', 'images.metmuseum.org', 'collectionapi.metmuseum.org', 'cdn.cosmos.so'];
    return u.protocol === 'https:' && hosts.includes(u.hostname) ? value : '';
  } catch { return ''; }
}
async function get(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(22_000)]), headers: { Accept: 'application/json, text/html', 'User-Agent': 'JevCurator/0.3 (visual reference explorer)' } });
  if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
  return response;
}

// Extract a JSON object from the public search response without evaluating page scripts.
export function publicSearchResults(html: string): any[] {
  const marker = '"searchElements":';
  const start = html.indexOf(marker);
  if (start < 0) return [];
  let depth = 0, quoted = false, escaped = false;
  const from = start + marker.length;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      const data = JSON.parse(html.slice(from, i + 1));
      return Array.isArray(data.results) ? data.results : [];
    }
  }
  return [];
}

export function cosmosReferences(html: string): Reference[] {
  return publicSearchResults(html).flatMap(row => {
    const e = row?.element;
    const img = safeImage(e?.media?.url);
    if (!e || !Number.isSafeInteger(e.id) || !img || e.contentAccessibility !== 'ACCESSIBLE' || e.media?.__typename !== 'StaticImage' || e.media?.notSafeForWorkStatus !== 'SAFE') return [];
    const caption = clean(e.generatedCaption?.text);
    return [{ id: `cosmos-${e.id}`, title: caption.slice(0, 110) || 'Untitled Cosmos reference', description: caption || 'No descriptive caption was supplied.', credit: `Saved by ${clean(e.owner?.username, 80) || 'a Cosmos member'}. Original attribution: ${clean(e.source?.author?.fullName, 120) || clean(e.source?.author?.username, 120) || 'not supplied'}.`, date: clean(e.createdAt, 30), image: `${img}?format=webp&w=800`, source: `https://www.cosmos.so/e/${e.id}`, collection: 'Contemporary references', sourceName: 'Cosmos', sourceKey: 'cosmos' as const, descriptionOrigin: 'Cosmos generated caption; author and subject claims have not been independently verified.', retrievedAt: new Date().toISOString() }];
  });
}

export async function collectSource(key: SourceKey, query: string, signal: AbortSignal, receive: (ref: Reference) => void, limit = REFERENCES_PER_SOURCE, options: { page?: number; excludeIds?: Set<string>; excludeImages?: Set<string> } = {}) {
  limit = Math.max(1, Math.min(CREATOR_TARGET, Math.floor(limit)));
  const seen = new Set<string>();
  let count = 0;
  const emit = (ref: Reference) => { if (count >= limit || seen.has(ref.image) || options.excludeIds?.has(ref.id) || options.excludeImages?.has(ref.image)) return; seen.add(ref.image); count++; receive(ref); };
  const page = Math.max(1, options.page || 1);
  if (key === 'nasa') {
    const payload = await (await get(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image&page_size=${Math.min(100, limit * 3)}&page=${page}`, signal)).json() as any;
    for (const item of payload.collection?.items || []) {
      const d = item.data?.[0]; const img = safeImage(item.links?.find((x: any) => x.render === 'image')?.href);
      if (!d?.nasa_id || !img) continue;
      emit({ id: `nasa-${d.nasa_id}`, title: clean(d.title, 180), description: clean(d.description), credit: clean(d.photographer || d.secondary_creator || d.center || 'NASA', 180), date: clean(d.date_created, 40), image: img, source: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, collection: 'Space archive', sourceName: 'NASA', sourceKey: key, descriptionOrigin: 'NASA catalog metadata, retrieved during this run.', retrievedAt: new Date().toISOString() });
    }
  } else if (key === 'cosmos') {
    const html = await (await get(searchUrl(key, query), signal)).text();
    for (const ref of cosmosReferences(html)) emit(ref);
  } else {
    const data = await (await get(`https://collectionapi.metmuseum.org/public/collection/v1/search?isPublicDomain=true&hasImages=true&q=${encodeURIComponent(query)}`, signal)).json() as any;
    const ids: number[] = (data.objectIDs || []).filter(Number.isSafeInteger).slice((page - 1) * 100, (page - 1) * 100 + limit * 4);
    let index = 0;
    await Promise.all(Array.from({ length: limit > REFERENCES_PER_SOURCE ? 8 : 4 }, async () => {
      while (index < ids.length && count < limit && !signal.aborted) {
        const id = ids[index++];
        try {
          const d = await (await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, signal)).json() as any;
          const img = safeImage(d.primaryImageSmall || d.primaryImage);
          if (!d.isPublicDomain || !img) continue;
          emit({ id: `met-${id}`, title: clean(d.title, 180), description: clean([d.title, d.artistDisplayName, d.medium, d.objectDate, ...(d.tags || []).map((t: any) => t.term)].filter(Boolean).join('. ')), credit: clean(`${d.artistDisplayName || 'Artist not identified'}. ${d.creditLine || 'The Metropolitan Museum of Art'}`, 300), date: clean(d.objectDate, 80), image: img, source: `https://www.metmuseum.org/art/collection/search/${id}`, collection: clean(d.department || 'Open Access', 80), sourceName: 'The Met', sourceKey: key, descriptionOrigin: 'The Met Open Access catalog metadata, retrieved during this run.', retrievedAt: new Date().toISOString() });
        } catch (error) { if (signal.aborted) throw error; }
      }
    }));
  }
  if (signal.aborted) throw new Error('Search stopped.');
  if (!count) throw new Error('No usable images returned. Try a broader search phrase.');
  return count;
}
