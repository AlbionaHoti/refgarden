import { expect, test } from 'bun:test';
import { requestJev } from '../src/jev-client';
import { buildQuestion, NO_MATCH } from '../src/decision';

const payload = buildQuestion('A botanical exhibition', [], []);
const success = () => Response.json({ model: 'test', answers: { next_reference: { type: 'choice', choice: NO_MATCH, confidence: 1, probabilities: { [NO_MATCH]: 1 } } }, usage: { input_tokens: 1, output_tokens: 1 } });

test('retries a transient provider error once and records the retry separately from successful latency', async () => {
  let calls = 0; const notices: string[] = [];
  const result = await requestJev(payload, 'test-only', new AbortController().signal, message => notices.push(message), async () => ++calls === 1 ? new Response('', { status: 503 }) : success());
  expect(calls).toBe(2); expect(notices[0]).toContain('503');
  expect(result.attempts).toBe(2);
  expect(result.totalMs - result.roundTripMs).toBeGreaterThanOrEqual(550);
});

test('does not retry a rejected key or leak the provider response body', async () => {
  let calls = 0;
  await expect(requestJev(payload, 'test-only', new AbortController().signal, () => {}, async () => { calls++; return new Response('private provider diagnostic', { status: 401 }); })).rejects.toThrow('Jev rejected the key');
  expect(calls).toBe(1);
});

test('cancelling during backoff prevents another billable request', async () => {
  let calls = 0; const abort = new AbortController();
  await expect(requestJev(payload, 'test-only', abort.signal, () => abort.abort(), async () => { calls++; return new Response('', { status: 503 }); })).rejects.toThrow();
  expect(calls).toBe(1);
});

test('a persistent provider error reports its HTTP status after the bounded retry', async () => {
  let calls = 0;
  await expect(requestJev(payload, 'test-only', new AbortController().signal, () => {}, async () => { calls++; return new Response('', { status: 502 }); })).rejects.toThrow('HTTP 502');
  expect(calls).toBe(2);
});
