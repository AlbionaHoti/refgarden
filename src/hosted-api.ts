import { RequestError, validateCreatorInput } from './decision';
import { runSourceSearch } from './public-research';
import { validateStyles } from './visual-styles';
import { readCursor, saveCursor } from './hosted-session';
import type { ResearchEvent } from './types';
import { validateMedia } from './media';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const failure = (error: unknown) => json({ error: error instanceof RequestError ? error.message : 'The request could not finish. Your images are kept; try again.' }, error instanceof RequestError ? error.status : 502);

async function readRequest(request: Request) {
  if (request.method !== 'POST') throw new RequestError('Use the form on this website.', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new RequestError('Open this website to start a search.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError('Send the form as JSON.', 415);
  if (Number(request.headers.get('content-length')) > 3_000_000) throw new RequestError('Start a new exploration; this search history is full.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('The form is empty.');
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.length;
    if (bytes > 3_000_000) { await reader.cancel(); throw new RequestError('Start a new exploration; this search history is full.', 413); }
    text += decoder.decode(value, { stream: true });
  }
  try { const body = JSON.parse(text + decoder.decode()); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new RequestError('The form could not be read. Try again.'); }
}

export function handleStatus() { return json({ hosted: true, configured: false, searchAvailable: true, jevAvailable: false, model: null, astraAvailable: true, credentialTransport: 'direct-to-provider' }); }

export async function handleConnection(_request: Request) {
  return json({ error: 'This website no longer accepts Jev API keys. Refresh to explore public images without a key. Jev remains available in the local app.' }, 410);
}

export async function handleResearch(request: Request, runBatch = runSourceSearch) {
  try {
    if (['x-jev-key', 'x-openai-key', 'authorization'].some(name => request.headers.has(name))) throw new RequestError('Refresh this page. Source searches do not accept API keys.', 410);
    const body = await readRequest(request);
    if (Object.keys(body).some(name => !['mode', 'continuous', 'brief', 'styles', 'media', 'selected', 'cursor'].includes(name))) throw new RequestError('Send only your prompt, styles and search history. API keys are not accepted.');
    const input = validateCreatorInput(body);
    const styles = validateStyles(body.styles);
    const media = validateMedia(body.media);
    if (body.mode !== 'creator') throw new RequestError('Use Explore to find images. The detailed local mode is available on your Mac.');
    const { context, emptyRounds } = readCursor(body.cursor);
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(110_000)]);
    const encoder = new TextEncoder(); const began = performance.now();
    const stream = new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>) {
        const send = (event: ResearchEvent) => { if (!signal.aborted) { try { controller.enqueue(encoder.encode(JSON.stringify({ ...event, atMs: Math.round(performance.now() - began) }) + '\n')); } catch { abort.abort(); } } };
        void (async () => {
          let count = 0, failed = false;
          if (context.round === 1) send({ type: 'start', atMs: 0, startedAt: new Date().toISOString(), mode: 'creator' });
          send({ type: 'discovery', atMs: 0, round: context.round, phase: 'searching', total: context.seenIds.size, added: 0 });
          await runBatch({ ...input, styles, media }, signal, event => {
            if (event.type === 'candidate') count++;
            if (event.type === 'error') failed = true;
            if (event.type !== 'start' && event.type !== 'end') send(event);
          }, context);
          if (signal.aborted || failed) return;
          const empty = count ? 0 : emptyRounds + 1;
          send({ type: 'discovery', atMs: 0, round: context.round, phase: 'complete', total: context.seenIds.size, added: count });
          if (empty >= 3) send({ type: 'end', atMs: 0, status: 'complete', message: 'These searches stopped returning new references. Edit your prompt to explore another direction.' });
          else send({ type: 'continuation', atMs: 0, cursor: saveCursor(context, empty) });
        })().catch(() => send({ type: 'error', atMs: 0, message: 'This search was interrupted. Your images are kept. Try Explore again.' })).finally(() => { try { controller.close(); } catch {} });
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' } });
  } catch (error) { return failure(error); }
}

export async function handleCuration(_request: Request) {
  return json({ error: 'Refresh this page. OpenAI reviews now connect directly from your browser; this endpoint no longer processes OpenAI API keys.' }, 410);
}
