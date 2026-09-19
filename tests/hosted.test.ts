import { expect, test } from 'bun:test';
import { handleResearch, handleStatus, handleConnection, handleCuration } from '../src/hosted-api';
import { readCursor, saveCursor } from '../src/hosted-session';
import { curateWithAstra, parseCuration } from '../src/astra-api';
import { runSourceSearch, sourceSearches } from '../src/public-research';
import { collectCreatorSources } from '../src/creator-collection';
import type { Reference, ResearchEvent } from '../src/types';

// Synthetic values used only by the mocked requests below.
const keyA = 'test-only-aaaaaaaaaaaaaaaa', keyB = 'test-only-bbbbbbbbbbbbbbbb';
const body = { mode: 'creator', brief: 'A quiet lunar archive', selected: ['met-expired-pin'], styles: [] };
const request = (data: unknown, key = '', origin = 'https://example.com') => new Request('https://example.com/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(key ? { 'X-Jev-Key': key } : {}) }, body: JSON.stringify(data) });
const events = async (response: Response) => (await response.text()).trim().split('\n').map(line => JSON.parse(line)) as ResearchEvent[];
const ref: Reference = { id: 'nasa-1', title: 'Moon', description: 'Lunar surface', sourceName: 'NASA', sourceKey: 'nasa', source: 'https://images.nasa.gov/details/1', image: 'https://images-assets.nasa.gov/1.jpg', credit: 'NASA', date: '', collection: '', descriptionOrigin: 'NASA metadata' };

test('hosted status never advertises a shared key; invalid or cross-origin searches spend no calls', async () => {
  expect(await handleStatus().json()).toMatchObject({ hosted: true, configured: false });
  let calls = 0;
  const run = async () => { calls++; };
  const oldRequest = request(body, keyA);
  expect((await handleResearch(oldRequest, run)).status).toBe(410);
  expect(oldRequest.bodyUsed).toBe(false);
  expect((await handleResearch(request({ ...body, key: keyA }), run)).status).toBe(400);
  expect((await handleResearch(request(body, '', 'https://other.example'), run)).status).toBe(403);
  expect((await handleResearch(request({ ...body, selected: ['duplicate', 'duplicate'] }), run)).status).toBe(400);
  expect((await handleResearch(request({ ...body, cursor: { round: 1 } }), run)).status).toBe(400);
  expect(calls).toBe(0);
});

test('hosted batches carry exclusions and pagination across fresh requests with no shared visitor state', async () => {
  const received: { round: number; target: number; seen: boolean }[] = [];
  const run = async (_input: any, _signal: AbortSignal, send: (event: ResearchEvent) => void, context: any) => {
    received.push({ round: context.round, target: context.target, seen: context.seenIds.has(ref.id) });
    if (context.round === 2) {
      expect(context.seenImages.has(ref.image)).toBe(true);
      expect(context.queries.nasa.has('moon')).toBe(true);
      expect(context.pages.get('nasa:moon')).toBe(1);
    } else {
      context.seenIds.add(ref.id); context.seenImages.add(ref.image); context.queries.nasa.add('moon'); context.pages.set('nasa:moon', 1);
      send({ type: 'candidate', atMs: 1, source: 'nasa', reference: ref });
    }
  };
  const first = await events(await handleResearch(request(body), run));
  const continuation = first.find(event => event.type === 'continuation');
  expect(continuation?.type).toBe('continuation');
  if (continuation?.type !== 'continuation') throw new Error('missing cursor');
  await events(await handleResearch(request({ ...body, cursor: continuation.cursor }), run));
  const separate = await events(await handleResearch(request(body), run));
  expect(received).toEqual([{ round: 1, target: 100, seen: false }, { round: 2, target: 30, seen: true }, { round: 1, target: 100, seen: false }]);
  expect(JSON.stringify([...first, ...separate])).not.toContain(keyA);
  expect(JSON.stringify([...first, ...separate])).not.toContain(keyB);
});

test('hosted search stops after three empty batches and cancels a disconnected request', async () => {
  const initial = readCursor(undefined);
  initial.context.round = 3;
  const last = await events(await handleResearch(request({ ...body, cursor: saveCursor(initial.context, 2) }), async () => {}));
  expect(last.at(-1)?.type).toBe('end');
  let signal: AbortSignal | undefined;
  const response = await handleResearch(request(body), async (_input, current) => {
    signal = current;
    await new Promise<void>(resolve => current.addEventListener('abort', () => resolve(), { once: true }));
  });
  await response.body!.cancel();
  expect(signal!.aborted).toBe(true);
});

test('Astra accepts only candidate IDs and keeps raw provider failures private', async () => {
  const completed = (result: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
  expect(parseCuration(completed({ ids: ['nasa-1'], summary: 'A lunar surface study.' }), new Set(['nasa-1']), 20).ids).toEqual(['nasa-1']);
  for (const ids of [['invented'], ['nasa-1', 'nasa-1']]) expect(() => parseCuration(completed({ ids, summary: 'Test' }), new Set(['nasa-1']), 20)).toThrow();
  let payload: any;
  const result = await curateWithAstra(body.brief, [ref], keyA, new AbortController().signal, (async (url: any, init: any) => {
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.headers.Authorization).toBe(`Bearer ${keyA}`);
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    payload = JSON.parse(init.body);
    return Response.json(completed({ ids: ['nasa-1'], summary: 'A lunar surface study.' }));
  }));
  expect(payload.store).toBe(false);
  expect(payload.model).toBe('gpt-6-astra');
  expect(JSON.stringify(payload)).not.toContain(keyA);
  expect(result.ids).toEqual(['nasa-1']);
  await expect(curateWithAstra(body.brief, [ref], keyA, new AbortController().signal, async () => new Response('private provider details', { status: 401 }))).rejects.toThrow('OpenAI rejected');
});

test('both retired model proxies reject old requests without reading their body', async () => {
  for (const handler of [handleConnection, handleCuration]) {
    const oldRequest = request({ key: keyA, ...body, references: [ref] }, keyB);
    const response = await handler(oldRequest);
    expect(response.status).toBe(410);
    expect(oldRequest.bodyUsed).toBe(false);
    expect(await response.text()).not.toContain(keyA);
  }
});

test('public source search streams results, advances queries, and emits no model decisions', async () => {
  const { context } = readCursor(undefined);
  const searched: string[] = [];
  const sent: ResearchEvent[] = [];
  const collect: typeof collectCreatorSources = (searches, signal, emit, discovery) => collectCreatorSources(searches, signal, emit, discovery, undefined, async (source, query, _signal, accept) => {
    searched.push(query);
    accept({ ...ref, id: source, sourceKey: source, image: `https://images-assets.nasa.gov/${source}.jpg` });
    return 1;
  });
  const firstQueries = sourceSearches(body.brief, [], context);
  await runSourceSearch(body, new AbortController().signal, event => sent.push(event), context, collect);
  expect(searched).toEqual(expect.arrayContaining(Object.values(firstQueries)));
  expect(searched.length).toBeLessThanOrEqual(7); // One Cosmos request, at most three for each institution.
  expect(sent.filter(event => event.type === 'candidate')).toHaveLength(3);
  expect(sent.some(event => event.type === 'search-plan' || event.type === 'shortlist' || event.type === 'decision')).toBe(false);
  context.round++;
  expect(sourceSearches(body.brief, [], context).nasa).not.toBe(firstQueries.nasa);
  expect(sent.find(event => event.type === 'retrieval-complete')).toMatchObject({ count: 3 });
});

test('hosted function bundle contains no model client or credential environment lookup', async () => {
  const built = await Bun.build({ entrypoints: ['./api/research.ts'], target: 'bun' });
  expect(built.success).toBe(true);
  const output = await built.outputs[0].text();
  for (const forbidden of ['api.typesafe.ai', 'api.openai.com', 'requestJevPayload', 'curateWithAstra', 'process.env']) expect(output).not.toContain(forbidden);
});
