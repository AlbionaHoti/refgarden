import { expect, test } from 'bun:test';
import { sourceQuotas } from '../src/source-balance';

test('batch budgets close accumulated source deficits and preserve the target', () => {
  expect(sourceQuotas(30, { met: 0, nasa: 10, cosmos: 33 })).toEqual({ met: 20, nasa: 10, cosmos: 0 });
  expect(sourceQuotas(30, { met: 34, nasa: 33, cosmos: 33 })).toEqual({ met: 10, nasa: 10, cosmos: 10 });
  expect(sourceQuotas(30, { met: 100, nasa: 0, cosmos: 100 })).toEqual({ met: 0, nasa: 30, cosmos: 0 });
});
