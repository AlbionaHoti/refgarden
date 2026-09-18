import { expect, test } from 'bun:test';
import { runDiscovery } from '../src/discovery';
import { buildSearchPlan } from '../src/creator';
import type { ResearchEvent } from '../src/types';

test('discovery continues after its first batch, shares exclusions, and stops on cancellation', async () => {
  const abort = new AbortController();
  const events: ResearchEvent[] = [];
  const targets: number[] = [];
  await runDiscovery({ brief: 'Pink botanical photographs', selected: [] }, 'test', abort.signal, event => events.push(event), async (_input, _key, _signal, send, context) => {
    targets.push(context!.target);
    if (context!.round === 2) expect(context!.seenIds.has('first')).toBe(true);
    context!.seenIds.add('first'); context!.seenImages.add('https://example.com/first');
    send({ type: 'end', atMs: 1, status: 'complete', message: 'Batch complete' });
    if (context!.round === 2) abort.abort();
  }, 0);
  expect(targets).toEqual([100, 30]);
  expect(events.filter(event => event.type === 'end')).toHaveLength(0);
  expect(events.filter(event => event.type === 'start')).toHaveLength(1);
});

test('discovery stops after three empty rounds instead of spinning indefinitely', async () => {
  const events: ResearchEvent[] = [];
  let rounds = 0;
  await runDiscovery({ brief: 'Rare visual subject', selected: [] }, 'test', new AbortController().signal, event => events.push(event), async (_input, _key, _signal, send) => {
    rounds++; send({ type: 'end', atMs: 1, status: 'no-match', message: 'No new images' });
  }, 0);
  expect(rounds).toBe(3);
  expect(events.at(-1)?.type).toBe('end');
});

test('discovery query choices exclude the phrases already searched', () => {
  const initial = buildSearchPlan('Pink botanical photographs');
  const seen = { met: new Set(Object.values(initial.questions.search_met.criteria).slice(0, 2)), cosmos: new Set<string>(), nasa: new Set<string>() };
  const next = buildSearchPlan('Pink botanical photographs', [], seen);
  for (const phrase of seen.met) expect(Object.values(next.questions.search_met.criteria)).not.toContain(phrase);
});
