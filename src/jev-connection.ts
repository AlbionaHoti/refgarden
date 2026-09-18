import { chmod, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { RequestError, parseDecision } from './decision';

export function validateKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:=+\/~\-]{16,512}$/.test(value.trim())) throw new RequestError('Paste the API key from your TypeSafe console.');
  return value.trim();
}

export function replaceEnvKey(contents: string, key: string) {
  const line = `TYPESAFE_AI_API_KEY="${validateKey(key)}"`;
  const lines = contents.split(/\r?\n/).filter(value => !/^\s*(?:export\s+)?TYPESAFE_AI_API_KEY\s*=/.test(value));
  return `${lines.join('\n').trimEnd()}\n${line}\n`;
}

export async function connectJev(key: string, envPath: string, signal: AbortSignal) {
  const began = performance.now();
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: 'This is a connection check.', questions: { next_reference: { type: 'choice', instructions: 'Choose connected to confirm receipt.', criteria: { connected: 'The request reached Jev.', unavailable: 'The connection is unavailable.' } } } }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) throw new RequestError(response.status === 401 || response.status === 403 ? 'TypeSafe rejected this key. Copy a valid key from your console.' : response.status === 429 ? 'TypeSafe is rate limited. Wait a moment and retry.' : response.status === 402 ? 'TypeSafe requires account credits. Check your console.' : 'TypeSafe could not verify the connection. Try again.', 502);
  const result = parseDecision(await response.json(), new Set(['connected', 'unavailable']), Math.round(performance.now() - began));
  let previous = '';
  try { previous = await readFile(envPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temp = `${envPath}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, replaceEnvKey(previous, key), { mode: 0o600, flag: 'wx' });
    await rename(temp, envPath);
    await chmod(envPath, 0o600);
  } finally { await unlink(temp).catch(() => {}); }
  return { configured: true, verified: true, model: result.model, roundTripMs: result.roundTripMs };
}
