import { expect, test } from 'bun:test';
import { prepareResearch } from '../src/research-plan';
import { DIRECTIONS } from '../src/presets';
import type { Review } from '../src/types';

const review: Review = { model: 'test', stage: 'plan', durationMs: 5, summary: 'Direction', selectionBrief: 'Select complementary references.', roles: [], missing: [], searches: { met: 'waves', cosmos: 'fluid design', nasa: 'ocean' } };
const deferred = () => {
  let resolve!: (value: Review) => void;
  const promise = new Promise<Review>(done => { resolve = done; });
  return { promise, resolve };
};

test('sample results start before Astra resolves and use the declared sample searches', async () => {
  const plan = deferred(); const searches: unknown[] = [];
  const result = prepareResearch(DIRECTIONS[2].brief, async fixed => {
    expect(fixed).toEqual(DIRECTIONS[2].searches); return plan.promise;
  }, async queries => { searches.push(queries); }, () => { throw new Error('Unexpected fallback'); });
  expect(searches).toEqual([DIRECTIONS[2].searches]);
  plan.resolve(review);
  expect(await result).toBe(review.selectionBrief);
  expect(searches).toHaveLength(1);
});

test('an edited sample waits for fresh queries instead of silently reusing the old ones', async () => {
  const plan = deferred(); const searches: unknown[] = [];
  const result = prepareResearch(`${DIRECTIONS[2].brief} Focus on red.`, async fixed => {
    expect(fixed).toBeUndefined(); return plan.promise;
  }, async queries => { searches.push(queries); }, () => {});
  expect(searches).toHaveLength(0);
  plan.resolve(review); await result;
  expect(searches).toEqual([review.searches]);
});

test('failed sample planning preserves collected images and explicitly reports original-prompt fallback', async () => {
  let collected = false, warned = false;
  const brief = DIRECTIONS[0].brief;
  const result = await prepareResearch(brief, async () => { throw new Error('deadline'); }, async () => { collected = true; }, () => { warned = true; });
  expect({ collected, warned, result }).toEqual({ collected: true, warned: true, result: brief });
});

test('failed custom planning does not launch unrelated searches', async () => {
  let collected = false;
  await expect(prepareResearch('A completely new exhibition', async () => { throw new Error('deadline'); }, async () => { collected = true; }, () => {})).rejects.toThrow('deadline');
  expect(collected).toBe(false);
});
