import { setTimeout as delay } from 'node:timers/promises';
import { runCreator, type DiscoveryContext } from './creator';
import { CREATOR_TARGET } from './sources';
import type { ResearchEvent } from './types';

export async function runDiscovery(input: Parameters<typeof runCreator>[0], key: string, signal: AbortSignal, send: (event: ResearchEvent) => void, runBatch = runCreator, pauseMs = 1200) {
  const began = performance.now();
  const context: DiscoveryContext = { round: 0, target: CREATOR_TARGET, seenIds: new Set(), seenImages: new Set(), queries: { met: new Set(), cosmos: new Set(), nasa: new Set() }, pages: new Map() };
  const emit = (event: ResearchEvent) => { if (!signal.aborted) send({ ...event, atMs: Math.round(performance.now() - began) }); };
  emit({ type: 'start', atMs: 0, startedAt: new Date().toISOString(), mode: 'creator' });
  let emptyRounds = 0;
  while (!signal.aborted) {
    context.round++; context.target = context.round === 1 ? CREATOR_TARGET : 30;
    let count = 0, failed = false;
    emit({ type: 'discovery', atMs: 0, round: context.round, phase: 'searching', total: context.seenIds.size, added: 0 });
    await runBatch(input, key, signal, event => {
      if (event.type === 'candidate') count++;
      if (event.type === 'error') failed = true;
      if (event.type !== 'start' && event.type !== 'end') emit(event);
    }, context);
    if (signal.aborted || failed) return;
    emptyRounds = count ? 0 : emptyRounds + 1;
    emit({ type: 'discovery', atMs: 0, round: context.round, phase: 'complete', total: context.seenIds.size, added: count });
    if (emptyRounds >= 3) {
      emit({ type: 'end', atMs: 0, status: 'complete', message: 'These searches stopped returning new references. Edit your prompt to explore another direction.' });
      return;
    }
    try { await delay(pauseMs, undefined, { signal }); } catch { return; }
  }
}
