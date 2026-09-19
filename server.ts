import { resolve, extname } from 'node:path';
import catalogData from './src/catalog.json';
import { buildQuestion, parseDecision, validateInput, validateCreatorInput, RequestError } from './src/decision';
import type { Reference } from './src/types';
import { askAstra, ASTRA_MODEL } from './src/supervisor';
import { liveReferences, persistReferences, runResearch } from './src/research';
import { runCreator } from './src/creator';
import { runDiscovery } from './src/discovery';
import { validateStyles } from './src/visual-styles';
import { validateSearches } from './src/sources';
import { connectJev, validateKey } from './src/jev-connection';
import { handleCuration } from './src/hosted-api';
import { validateMedia } from './src/media';

const catalog = catalogData as Reference[];
const root = resolve(import.meta.dir, 'dist');
let inFlight = false;
let lastRequest = 0;
let astraInFlight = false;
let researchInFlight = false;
const port = Number(process.env.PORT || 4318);
let apiKey = process.env.TYPESAFE_AI_API_KEY?.trim();
let keyCheckInFlight = false;
let lastKeyCheck = 0;

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const runLocalCreator: typeof runCreator = (input, key, signal, send, context) => runCreator(input, key, signal, send, context, { add: ref => { liveReferences.set(ref.id, ref); }, persist: persistReferences });

Bun.serve({
  hostname: '127.0.0.1', port,
  idleTimeout: 150,
  maxRequestBodySize: 512_000,
  async fetch(req) {
    const url = new URL(req.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return json({ error: 'Open this app on localhost.' }, 403);
    if (url.pathname === '/api/curate') return handleCuration(req);
    if (url.pathname === '/api/status' && req.method === 'GET') {
      return json({ configured: Boolean(apiKey), model: 'jev-latest', astraAvailable: Boolean(Bun.which('codex')), astraModel: ASTRA_MODEL, inputMode: 'Live source metadata', references: catalog.length, browser: 'Playwright / isolated Chromium' });
    }
    if (url.pathname === '/api/connect-jev') {
      if (req.method !== 'POST') return json({ error: 'Use Connect Jev in the local app.' }, 405);
      const origin = req.headers.get('origin');
      if (![url.origin, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin || '')) return json({ error: 'Connect Jev from the local website.' }, 403);
      if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Use the connection form.' }, 415);
      if (researchInFlight || inFlight || astraInFlight || keyCheckInFlight) return json({ error: 'Finish the current run before connecting Jev.' }, 429);
      let key: string;
      try { key = validateKey((await req.json() as any)?.key); } catch (error) { return json({ error: error instanceof RequestError ? error.message : 'The connection form could not be read.' }, 400); }
      if (keyCheckInFlight || Date.now() - lastKeyCheck < 2000) return json({ error: 'Wait a moment before checking another key.' }, 429);
      keyCheckInFlight = true; lastKeyCheck = Date.now();
      try {
        const result = await connectJev(key, resolve(import.meta.dir, '.env'), req.signal);
        apiKey = key;
        return json(result);
      } catch (error) {
        return json({ error: error instanceof RequestError ? error.message : 'The key could not be verified and saved. Check your connection and try again.' }, error instanceof RequestError ? error.status : 502);
      } finally { keyCheckInFlight = false; }
    }
    if (url.pathname === '/api/research') {
      if (req.method !== 'POST') return json({ error: 'Start research from the local app.' }, 405);
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin && origin !== 'http://127.0.0.1:5173' && origin !== 'http://localhost:5173') return json({ error: 'Open this app locally to run research.' }, 403);
      if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send the brief as JSON.' }, 415);
      try {
        const body = await req.json() as any;
        if (!['research', 'sources', 'creator'].includes(body?.mode)) throw new RequestError('Choose creator search or a source preview.');
        if (body.mode === 'creator' && !apiKey) throw new RequestError('Connect Jev to find assets for your brief.', 503);
        const searches = body.mode === 'sources' ? validateSearches(body.searches) : undefined;
        const available = [...new Map([...catalog, ...liveReferences.values()].map(ref => [ref.id, ref])).values()];
        const input = body.mode === 'creator' ? validateCreatorInput(body) : validateInput(body, available);
        const styles = body.mode === 'creator' ? validateStyles(body.styles) : [];
        const media = validateMedia(body.media);
        if (researchInFlight || astraInFlight || inFlight || keyCheckInFlight) return json({ error: 'A run or connection check is already active. Wait for it to finish.' }, 429);
        researchInFlight = true;
        const abort = new AbortController();
        const continuous = body.mode === 'creator' && body.continuous === true;
        const signal = AbortSignal.any([abort.signal, req.signal, ...(continuous ? [] : [AbortSignal.timeout(240_000)])]);
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (event: import('./src/types').ResearchEvent) => {
              if (!signal.aborted) { try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { abort.abort(); } }
            };
            const run = body.mode === 'creator' ? (continuous ? runDiscovery({ ...input, styles, media }, apiKey!, signal, send, runLocalCreator) : runLocalCreator({ ...input, styles, media }, apiKey!, signal, send)) : runResearch({ ...input, mode: body.mode, searches }, available, apiKey, signal, send);
            void run.finally(() => { researchInFlight = false; try { controller.close(); } catch { /* Client already closed. */ } });
          },
          cancel() { abort.abort(); },
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      } catch (error) {
        return json({ error: error instanceof RequestError ? error.message : 'The research request could not be read.' }, error instanceof RequestError ? error.status : 400);
      }
    }
    if (url.pathname === '/api/astra') {
      if (req.method !== 'POST') return json({ error: 'Use the stage to request an Astra review.' }, 405);
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin && origin !== 'http://127.0.0.1:5173' && origin !== 'http://localhost:5173') return json({ error: 'Open this app locally to run a review.' }, 403);
      if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send the brief as JSON.' }, 415);
      let body: any;
      try { body = await req.json(); } catch { return json({ error: 'The brief could not be read.' }, 400); }
      if (astraInFlight || researchInFlight || keyCheckInFlight) return json({ error: 'A review or connection check is active. Wait for it to finish.' }, 429);
      if (!['plan', 'review'].includes(body?.stage)) return json({ error: 'Choose a planning or review stage.' }, 400);
      try {
        const input = validateInput(body, catalog);
        astraInFlight = true;
        return json(await askAstra(input.brief, input.selected, catalog, body.stage, req.signal));
      } catch (error) {
        if (error instanceof RequestError) return json({ error: error.message }, error.status);
        return json({ error: 'The Astra review could not finish. Your board has been kept.' }, 502);
      } finally { astraInFlight = false; }
    }
    if (url.pathname === '/api/decision') {
      if (req.method !== 'POST') return json({ error: 'Use the board to request a decision.' }, 405);
      // A local development API must not accept cross-site requests that spend the key.
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin && origin !== 'http://127.0.0.1:5173' && origin !== 'http://localhost:5173') return json({ error: 'Open this app locally to run a test.' }, 403);
      if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send the brief as JSON.' }, 415);
      if (!apiKey) return json({ error: 'Use Connect Jev to add your TypeSafe API key.' }, 503);
      if (inFlight || researchInFlight || keyCheckInFlight || Date.now() - lastRequest < 80) return json({ error: 'A decision or connection check is running. Wait for it to finish.' }, 429);
      let body: unknown;
      try { body = await req.json(); } catch { return json({ error: 'The brief could not be read. Try again.' }, 400); }
      if (inFlight || Date.now() - lastRequest < 80) return json({ error: 'A decision is already running. Wait for it to finish.' }, 429);
      try {
        const input = validateInput(body, catalog);
        const payload = buildQuestion(input.brief, input.selected, catalog);
        inFlight = true;
        lastRequest = Date.now();
        const start = performance.now();
        const response = await fetch('https://api.typesafe.ai/v1/systemone', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]),
        });
        if (!response.ok) {
          const message = response.status === 401 ? 'The Jev key was rejected. Use Jev connection to replace it.'
            : response.status === 429 || response.status === 529 ? 'Jev is busy or rate limited. Wait a moment, then try again.'
            : 'Jev could not complete this decision. The current board has been kept.';
          throw new RequestError(message, response.status === 401 ? 401 : 502);
        }
        const raw = await response.json();
        const roundTripMs = Math.round(performance.now() - start);
        const allowed = new Set(Object.keys(payload.questions.next_reference.criteria));
        return json(parseDecision(raw, allowed, roundTripMs));
      } catch (e) {
        if (e instanceof RequestError) return json({ error: e.message }, e.status);
        return json({ error: 'The Jev request was interrupted or timed out. Your existing references are still available.' }, 502);
      } finally { inFlight = false; }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'This endpoint does not exist.' }, 404);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    let requested: string;
    try { requested = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status: 400 }); }
    const path = resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
    if (!path.startsWith(root + '/')) return new Response('Not found', { status: 404 });
    const file = Bun.file(path);
    if (!await file.exists()) return new Response('Not found', { status: 404 });
    const mime = extname(path) === '.js' ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : file.type;
    return new Response(req.method === 'HEAD' ? null : file, { headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' } });
  },
});
console.log(`RefGarden: http://127.0.0.1:${port} (${apiKey ? 'Jev configured' : 'preview; key not configured'})`);
