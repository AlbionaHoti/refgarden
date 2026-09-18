import { expect, test } from 'bun:test';
import { buildSearchPlan, parseSearchPlan, buildShortlist, parseShortlist, searchOptions } from '../src/creator';
import { NO_MATCH, validateInput, validateCreatorInput } from '../src/decision';
import { CREATOR_BRIEFS, DIRECTIONS, findDirection } from '../src/presets';
import { styledBrief, validateStyles } from '../src/visual-styles';
import type { Reference, SourceKey } from '../src/types';

const reference = (id: string, sourceKey: SourceKey): Reference => ({ id, sourceKey, title: id, description: 'Source metadata', sourceName: sourceKey, source: 'https://example.com', image: 'https://example.com/image', credit: '', date: '', collection: '', descriptionOrigin: 'Test' });
const answer = (choice: string) => ({ type: 'choice', choice, probabilities: { [choice]: 1 }, confidence: 1 });
const response = (answers: Record<string, unknown>) => ({ model: 'test', usage: { input_tokens: 1, output_tokens: 1 }, answers });

test('creator samples keep authored searches but edited prompts must use Jev search choices', () => {
  for (const direction of DIRECTIONS) {
    expect(findDirection(CREATOR_BRIEFS[direction.id])?.searches).toEqual(direction.searches);
    expect(findDirection(direction.brief)?.id).toBe(direction.id);
    expect(findDirection(`${CREATOR_BRIEFS[direction.id]} Focus on blue.`)).toBeUndefined();
  }
});

test('custom query candidates include the requested subject and remain bounded plain text', () => {
  const options = Object.values(searchOptions('Find visuals for a reel about solar eclipse photography and silver moon posters', 'nasa'));
  expect(options).toContain('solar eclipse');
  expect(options).toContain('moon');
  expect(options.length).toBeLessThanOrEqual(42);
  expect(options.every(value => value.length <= 100)).toBe(true);
  expect(() => searchOptions('I need some assets', 'met')).toThrow('Add a subject');
});

test('one custom-plan response yields three validated queries and rejects invented query IDs', () => {
  const payload = buildSearchPlan('Find solar eclipse photographs');
  const raw = response(Object.fromEntries(Object.keys(payload.questions).map(id => [id, answer('query_0')])));
  expect(Object.keys(parseSearchPlan(raw, payload, 500).searches)).toEqual(['met', 'cosmos', 'nasa']);
  raw.answers.search_met = answer('invented');
  expect(() => parseSearchPlan(raw, payload, 500)).toThrow();
});

test('one shortlist request makes independent source choices, excludes pins and permits no match', () => {
  const pool = [reference('met-1', 'met'), reference('cosmos-1', 'cosmos'), reference('nasa-1', 'nasa'), reference('nasa-pinned', 'nasa')];
  const payload = buildShortlist('Find creator assets', ['nasa-pinned'], pool);
  expect(Object.keys(payload.questions)).toEqual(['pick_met', 'pick_cosmos', 'pick_nasa']);
  expect(payload.questions.pick_nasa.criteria).not.toHaveProperty('nasa-pinned');
  const raw = response({ pick_met: answer('met-1'), pick_cosmos: answer(NO_MATCH), pick_nasa: answer('nasa-1') });
  expect(parseShortlist(raw, payload, 500).ids).toEqual(['met-1', 'nasa-1']);
  raw.answers.pick_met = answer('nasa-1');
  expect(() => parseShortlist(raw, payload, 500)).toThrow();
});

test('a fully pinned board can still run creator asset search without changing legacy selection constraints', () => {
  const pool = Array.from({ length: 6 }, (_, i) => reference(`met-${i}`, 'met'));
  const input = { brief: 'Find more ocean assets', selected: pool.map(ref => ref.id) };
  expect(validateCreatorInput(input).selected).toHaveLength(6);
  expect(() => validateInput(input, pool)).toThrow();
});

test('saved pins survive metadata eviction without becoming model candidates', () => {
  const original = reference('met-285421', 'met');
  const cache = [original, ...Array.from({ length: 500 }, (_, i) => reference(`met-${i}`, 'met'))].slice(-500);
  expect(cache.some(ref => ref.id === original.id)).toBe(false);
  const input = { brief: 'Find more ocean assets', selected: [original.id] };
  const creator = validateCreatorInput(input);
  expect(creator.selected).toEqual([original.id]);
  expect(input.selected).toEqual([original.id]);
  expect(() => validateInput(input, cache)).toThrow('no longer available');

  const shortlist = buildShortlist(creator.brief, creator.selected, cache.slice(0, 2));
  expect(shortlist.questions.pick_met.criteria).not.toHaveProperty(original.id);
  expect(shortlist.state.candidates.some(ref => ref.id === original.id)).toBe(false);
  const rediscovered = buildShortlist(creator.brief, creator.selected, [original, cache[0]]);
  expect(rediscovered.questions.pick_met.criteria).not.toHaveProperty(original.id);
  expect(rediscovered.questions.pick_met.criteria).toHaveProperty(cache[0].id);
});

test('creator search rejects malformed pins, duplicates, excess pins and invalid briefs', () => {
  const input = { brief: 'Find ocean photographs', selected: [] };
  for (const selected of [null, 'met-1', [1], [{}], [''], [' met-1'], ['met-1\n'], ['x'.repeat(257)], ['met-1', 'met-1'], Array.from({ length: 7 }, (_, i) => `met-${i}`)]) {
    expect(() => validateCreatorInput({ ...input, selected })).toThrow();
  }
  for (const brief of ['', 'short', 'x'.repeat(2001), null]) {
    expect(() => validateCreatorInput({ ...input, brief })).toThrow();
  }
  expect(validateCreatorInput({ ...input, brief: '  Find ocean photographs  ' }).brief).toBe(input.brief);
});

test('visual directions keep the original brief and affect both source searches and selection context', () => {
  const brief = 'Find eclipse photographs and silver celestial posters';
  const styles = ['typography', 'chrome'];
  expect(styledBrief(brief, [])).toBe(brief);
  const plan = buildSearchPlan(brief, styles);
  expect(plan.state.creatorBrief.startsWith(brief)).toBe(true);
  expect(plan.state.creatorBrief).toContain('Typography:');
  expect(plan.state.creatorBrief).toContain('Chrome:');
  expect(plan.state.creatorBrief).not.toContain('Botanical:');
  expect(Object.values(plan.questions.search_cosmos.criteria)).toContain('eclipse experimental typography');
  expect(Object.values(plan.questions.search_nasa.criteria)).toContain('eclipse spacecraft hardware');
  const shortlist = buildShortlist(styledBrief(brief, styles), [], [reference('nasa-1', 'nasa')]);
  expect(shortlist.state.creatorBrief).toBe(plan.state.creatorBrief);
});

test('style input rejects unsupported values while allowing older clients to omit styles', () => {
  expect(validateStyles(undefined)).toEqual([]);
  expect(validateStyles(['chrome', 'chrome', 'typography'])).toEqual(['chrome', 'typography']);
  for (const invalid of [null, 'chrome', {}, ['unknown'], [1], Array(9).fill('chrome')]) {
    expect(() => validateStyles(invalid)).toThrow('Choose styles');
  }
});
