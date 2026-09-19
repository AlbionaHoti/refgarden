import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { askAstra } from './supervisor';
import { BOARD_SIZE, NO_MATCH, RequestError, buildQuestion } from './decision';
import { prepareResearch } from './research-plan';
import { requestJev } from './jev-client';
import { collectSource, DEFAULT_SEARCHES, SOURCE_KEYS, searchUrl } from './sources';
import { SourceBrowser } from './source-browser';
import type { Reference, ResearchEvent, SourceProgress, SourceKey } from './types';

type Unstamped<T> = T extends { atMs: number } ? Omit<T, 'atMs'> : never;
type Event = Unstamped<ResearchEvent>;
export const liveReferences = new Map<string, Reference>();
const cacheDir = join(import.meta.dir, '..', '.local');
const cacheFile = Bun.file(join(cacheDir, 'references.json'));
try {
  const saved = await cacheFile.json();
  if (Array.isArray(saved)) for (const ref of saved.slice(-500)) if (ref?.id && ref?.sourceKey && ref?.image) liveReferences.set(ref.id, ref);
} catch { /* A new installation has no previous research. */ }

export async function persistReferences() {
  await mkdir(cacheDir, { recursive: true });
  while (liveReferences.size > 500) liveReferences.delete(liveReferences.keys().next().value!);
  await Bun.write(cacheFile, JSON.stringify([...liveReferences.values()]));
}

export async function runResearch(input: { brief: string; selected: string[]; mode: 'research' | 'sources'; searches?: Record<SourceKey, string> }, catalog: Reference[], apiKey: string | undefined, signal: AbortSignal, send: (event: ResearchEvent) => void) {
  const start = performance.now();
  const emit = (event: Event) => { if (!signal.aborted) send({ ...event, atMs: Math.round(performance.now() - start) } as ResearchEvent); };
  const browser = new SourceBrowser(emit);
  const close = () => { void browser.close(); };
  signal.addEventListener('abort', close, { once: true });
  const selected = [...input.selected];
  const pool: Reference[] = catalog.filter(ref => selected.includes(ref.id));
  const known = new Set(pool.map(ref => ref.id));
  const arrived = new Set<string>();
  emit({ type: 'start', startedAt: new Date().toISOString(), mode: input.mode });
  const pageTasks: Promise<void>[] = [];
  const browserStart = browser.start().then(() => true).catch(() => {
    for (const source of SOURCE_KEYS) emit({ type: 'browser', source, status: 'Browser could not start. Run bunx playwright install chromium.', url: searchUrl(source, DEFAULT_SEARCHES[source]) });
    return false;
  });
  const collect = async (queries: Record<SourceKey, string>) => {
    signal.throwIfAborted();
    emit({ type: 'stage', stage: input.mode === 'research' ? 'astra' : 'sources', message: input.mode === 'research' ? 'Searching three sources. Astra is directing Jev’s selection.' : 'Searching The Met, Cosmos and NASA in parallel' });
    await Promise.all(SOURCE_KEYS.map(async key => {
      const began = performance.now();
      const source: SourceProgress = { key, query: queries[key], url: searchUrl(key, queries[key]), status: 'searching', found: 0, elapsedMs: 0 };
      const update = () => { source.elapsedMs = Math.round(performance.now() - began); emit({ type: 'source', source: { ...source } }); };
      update();
      // Network retrieval starts immediately, independently of Chromium startup.
      pageTasks.push(browserStart.then(hasBrowser => hasBrowser ? browser.open(key, source.url) : undefined));
      try {
        await collectSource(key, queries[key], signal, reference => {
          if (signal.aborted) return;
          source.found++;
          arrived.add(reference.id);
          source.firstResultMs ??= Math.round(performance.now() - began);
          if (!known.has(reference.id)) { pool.push(reference); known.add(reference.id); }
          liveReferences.set(reference.id, reference);
          emit({ type: 'candidate', source: key, reference });
          update();
        });
        source.status = 'ready';
      } catch (error) {
        source.status = 'error';
        source.error = signal.aborted ? 'Search stopped.' : error instanceof Error && !['AbortError', 'TimeoutError'].includes(error.name) ? error.message : 'This source took too long. Try again.';
      }
      update();
    }));
    signal.throwIfAborted();
    emit({ type: 'retrieval-complete', count: arrived.size });
  };
  try {
    let direction = input.brief;
    if (input.mode === 'research') {
      emit({ type: 'stage', stage: 'astra', message: 'Astra is preparing the selection brief. Sample searches start immediately.' });
      direction = await prepareResearch(input.brief, async searches => {
        const review = await askAstra(input.brief, selected, pool, 'plan', signal, searches);
        emit({ type: 'review', review });
        return review;
      }, collect, () => {
        signal.throwIfAborted();
        emit({ type: 'notice', message: 'Astra’s direction was unavailable. Jev will use your original prompt and the sample search results.' });
      });
    } else await collect(input.searches || DEFAULT_SEARCHES);
    signal.throwIfAborted();
    await persistReferences();
    let outcome: 'complete' | 'sources-only' | 'awaiting-jev' | 'no-match' = input.mode === 'sources' ? 'sources-only' : !apiKey ? 'awaiting-jev' : 'complete';
    if (input.mode === 'research' && apiKey) {
      let choices = 0;
      while (selected.length < BOARD_SIZE && !signal.aborted) {
        if (choices === 3) {
          emit({ type: 'stage', stage: 'astra', message: 'Astra is reviewing source coverage and repetition' });
          try {
            const review = await askAstra(input.brief, selected, pool, 'review', signal);
            direction = review.selectionBrief;
            emit({ type: 'review', review });
          } catch {
            signal.throwIfAborted();
            emit({ type: 'notice', message: 'Astra’s review was unavailable. Jev is continuing with the current direction.' });
          }
        }
        emit({ type: 'stage', stage: 'jev', message: `Jev is choosing reference ${selected.length + 1} of six` });
        const payload = buildQuestion(direction, selected, pool);
        const decision = await requestJev(payload, apiKey, signal, message => emit({ type: 'notice', message }));
        emit({ type: 'decision', decision });
        choices++;
        if (decision.id === NO_MATCH) { outcome = 'no-match'; break; }
        selected.push(decision.id);
        const reference = pool.find(ref => ref.id === decision.id)!;
        if (reference.sourceKey && reference.sourceKey !== 'archive') pageTasks.push(browser.inspect(reference.sourceKey, reference.source));
      }
    }
    // Page navigation is separate from retrieval and decision timing, but inside the full clock.
    await Promise.allSettled(pageTasks);
    signal.throwIfAborted();
    await browser.finish();
    const fresh = arrived.size;
    emit({ type: 'end', status: outcome, message: !fresh ? 'No references arrived. Inspect each source message and try a broader brief.' : outcome === 'awaiting-jev' ? `${fresh} live references collected. Connect Jev to select the board.` : outcome === 'sources-only' ? `${fresh} references found across three sources. Open an image to explore its original.` : outcome === 'no-match' ? 'Jev found no further suitable reference. Review the collected images.' : 'Your board is ready. Pin what works and change the direction.' });
  } catch (error) {
    if (!signal.aborted) emit({ type: 'error', message: error instanceof RequestError ? error.message : 'The research run could not finish. Collected references are kept; try again.' });
  } finally {
    signal.removeEventListener('abort', close);
    // A failed launch must not retain the shared run lock indefinitely.
    let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([browserStart, new Promise(resolve => { cleanupTimeout = setTimeout(resolve, 2000); })]); }
    finally { if (cleanupTimeout) clearTimeout(cleanupTimeout); }
    await browser.close();
  }
}
