import { setTimeout as delay } from 'node:timers/promises';
import { RequestError, buildQuestion, parseDecision } from './decision';

type Payload = ReturnType<typeof buildQuestion>;
type Request = (url: string, init: RequestInit) => Promise<Response>;

export async function requestJev(payload: Payload, apiKey: string, signal: AbortSignal, retry: (message: string) => void, request: Request = fetch) {
  return requestJevPayload(payload, apiKey, signal, retry, (raw, ms) => parseDecision(raw, new Set(Object.keys(payload.questions.next_reference.criteria)), ms), request);
}

export async function requestJevPayload<T>(payload: unknown, apiKey: string, signal: AbortSignal, retry: (message: string) => void, parse: (raw: unknown, ms: number) => T, request: Request = fetch) {
  const began = performance.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const attemptBegan = performance.now();
    let response: Response;
    try {
      response = await request('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
    } catch {
      signal.throwIfAborted();
      if (attempt === 0) {
        retry('Jev’s connection was interrupted. Retrying once; your images are kept.');
        await delay(600, undefined, { signal });
        continue;
      }
      throw new RequestError('Jev’s connection failed twice. Your images are kept. Try again shortly.', 502);
    }
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      if (attempt === 0 && (status === 429 || status >= 500)) {
        retry(`Jev returned HTTP ${status}. Retrying once; your images are kept.`);
        await delay(600, undefined, { signal });
        continue;
      }
      throw new RequestError(status === 401 ? 'Jev rejected the key. Use Jev connection to replace it.'
        : status === 429 ? 'Jev is rate limited. Your images are kept. Try again shortly.'
        : `Jev returned HTTP ${status}. Selection stopped; your collected images are kept.`, 502);
    }
    const raw = await response.json();
    return { ...parse(raw, Math.round(performance.now() - attemptBegan)), attempts: attempt + 1, totalMs: Math.round(performance.now() - began) };
  }
  throw new RequestError('Jev could not finish. Your images are kept.', 502);
}
