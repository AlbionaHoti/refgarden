import { describe, expect, test } from 'bun:test';
import catalog from '../src/catalog.json';
import { buildQuestion, parseDecision, validateInput, NO_MATCH } from '../src/decision';

describe('selection boundaries', () => {
  test('pinned and selected references are never offered again, across every catalog item', () => {
    for (const reference of catalog) {
      const question = buildQuestion('A quiet lunar archive', [reference.id], catalog);
      expect(question.questions.next_reference.criteria).not.toHaveProperty(reference.id);
      expect(question.state.candidates.some(x => x.id === reference.id)).toBe(false);
      expect(question.state.board[0].id).toBe(reference.id);
      expect(question.questions.next_reference.criteria).toHaveProperty(NO_MATCH);
    }
  });

  test('rejects fabricated IDs, duplicates, full boards and oversized prompts before spending a call', () => {
    for (const selected of [['invented'], [catalog[0].id, catalog[0].id], catalog.slice(0, 6).map(x => x.id)]) {
      expect(() => validateInput({ brief: 'A quiet lunar archive', selected }, catalog)).toThrow();
    }
    expect(() => validateInput({ brief: 'x'.repeat(2001), selected: [] }, catalog)).toThrow();
    expect(validateInput({ brief: '  A quiet lunar archive  ', selected: [catalog[0].id] }, catalog).brief).toBe('A quiet lunar archive');
  });

  test('rejects out-of-pool model decisions and malformed probability distributions', () => {
    const id = catalog[1].id;
    const allowed = new Set([id, NO_MATCH]);
    const sample = { model: 'jev-latest', answers: { next_reference: { type: 'choice', choice: id, probabilities: { [id]: .8, [NO_MATCH]: .2 }, confidence: .6 } }, usage: { input_tokens: 120, output_tokens: 20 } };
    expect(parseDecision(sample, allowed, 125).id).toBe(id);
    const outside = structuredClone(sample); outside.answers.next_reference.choice = catalog[0].id;
    expect(() => parseDecision(outside, allowed, 125)).toThrow();
    const badProbability = structuredClone(sample); badProbability.answers.next_reference.probabilities[id] = 3;
    expect(() => parseDecision(badProbability, allowed, 125)).toThrow();
    const badTotal = structuredClone(sample); badTotal.answers.next_reference.probabilities[id] = .1;
    expect(() => parseDecision(badTotal, allowed, 125)).toThrow();
  });

  test('keeps no-match as a valid outcome instead of forcing an irrelevant reference', () => {
    const raw = { model: 'jev-latest', answers: { next_reference: { type: 'choice', choice: NO_MATCH, probabilities: { [NO_MATCH]: 1 }, confidence: 1 } }, usage: { input_tokens: 200, output_tokens: 10 } };
    expect(parseDecision(raw, new Set([catalog[0].id, NO_MATCH]), 190).id).toBe(NO_MATCH);
  });
});
