import { expect, test } from 'bun:test';
import { parseReview } from '../src/supervisor';

test('accepts a bounded review and preserves measured execution time', () => {
  const review = parseReview({ summary: 'Balance botany and machinery.', selectionBrief: 'Include a botanical cyanotype, a spacecraft detail and typography.', roles: ['Botany', 'Habitat', 'Typography'], missing: ['Typography'] }, 1234, 'review');
  expect(review.durationMs).toBe(1234);
  expect(review.stage).toBe('review');
});

test('rejects empty or unbounded direction before forwarding it to Jev', () => {
  const raw = { summary: 'Review.', selectionBrief: 'Include a botanical reference.', roles: ['Botany'], missing: [] };
  expect(() => parseReview({ ...raw, selectionBrief: '' }, 1000, 'plan')).toThrow();
  expect(() => parseReview({ ...raw, selectionBrief: 'x'.repeat(2001) }, 1000, 'plan')).toThrow();
  expect(() => parseReview({ ...raw, roles: Array(7).fill('Duplicate') }, 1000, 'plan')).toThrow();
});
