import { expect, test } from 'bun:test';
import { sourceQuotas, imageSourceShares } from '../src/source-balance';

test('batch budgets close accumulated source deficits and preserve the target', () => {
  expect(sourceQuotas(30, { met: 0, nasa: 10, cosmos: 33 })).toEqual({ met: 20, nasa: 10, cosmos: 0 });
  expect(sourceQuotas(30, { met: 34, nasa: 33, cosmos: 33 })).toEqual({ met: 10, nasa: 10, cosmos: 10 });
  expect(sourceQuotas(30, { met: 100, nasa: 0, cosmos: 100 })).toEqual({ met: 0, nasa: 30, cosmos: 0 });
});

test('displayed image shares total 100 and exclude separate video counts', () => {
  expect(imageSourceShares({ met: 0, nasa: 0, cosmos: 0 })).toEqual({ met: 0, nasa: 0, cosmos: 0 });
  expect(imageSourceShares({ met: 7, nasa: 0, cosmos: 3 })).toEqual({ met: 70, nasa: 0, cosmos: 30 });
  const shares = imageSourceShares({ met: 36, nasa: 17, cosmos: 26, archive: 7 } as { met: number; nasa: number; cosmos: number });
  expect(shares).toEqual({ met: 46, nasa: 21, cosmos: 33 });
  expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
});
