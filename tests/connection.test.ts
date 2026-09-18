import { expect, test } from 'bun:test';
import { replaceEnvKey, validateKey, connectJev } from '../src/jev-connection';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSearches } from '../src/sources';

test('replaces only the Jev environment entry and prevents dotenv injection', () => {
  const fixture = 'test_example_key_12345';
  expect(replaceEnvKey('PORT=4318\nTYPESAFE_AI_API_KEY=\n# keep this\n', fixture)).toBe('PORT=4318\n# keep this\nTYPESAFE_AI_API_KEY="test_example_key_12345"\n');
  expect(replaceEnvKey('export TYPESAFE_AI_API_KEY=old\nOTHER=value\nTYPESAFE_AI_API_KEY=duplicate', fixture)).toBe('OTHER=value\nTYPESAFE_AI_API_KEY="test_example_key_12345"\n');
  for (const key of ['', 'short', 'test_example_key\nPORT=8', 'test_example_$(whoami)', 'test_example_"bad']) expect(() => validateKey(key)).toThrow();
});
test('custom source queries are bounded text with all three sources required', () => {
  expect(validateSearches({ met: ' Anna Atkins ', cosmos: 'botany', nasa: 'nebula' }).met).toBe('Anna Atkins');
  for (const input of [null, {}, { met: 'Anna Atkins', cosmos: 'x', nasa: 'nebula' }, { met: 'Anna Atkins', cosmos: 'botany', nasa: 'x'.repeat(101) }]) expect(() => validateSearches(input)).toThrow();
});

test('only a valid provider response replaces the key, with private permissions and no returned secret', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-connect-test-'));
  const envPath = join(dir, '.env');
  const originalFetch = globalThis.fetch;
  const fixtureKey = 'test_example_key_12345';
  try {
    await writeFile(envPath, 'PORT=4318\nTYPESAFE_AI_API_KEY=previous\n');
    globalThis.fetch = (async () => new Response('Rejected', { status: 401 })) as unknown as typeof fetch;
    await expect(connectJev(fixtureKey, envPath, new AbortController().signal)).rejects.toThrow('TypeSafe rejected this key');
    expect(await readFile(envPath, 'utf8')).toContain('TYPESAFE_AI_API_KEY=previous');
    globalThis.fetch = (async () => Response.json({ model: 'jev-latest', answers: { next_reference: { type: 'choice', choice: 'connected', probabilities: { connected: 1 }, confidence: 1 } }, usage: { input_tokens: 10, output_tokens: 3 } })) as unknown as typeof fetch;
    const result = await connectJev(fixtureKey, envPath, new AbortController().signal);
    expect(result.verified).toBe(true);
    expect(JSON.stringify(result)).not.toContain(fixtureKey);
    expect(await readFile(envPath, 'utf8')).toContain('PORT=4318');
    expect(await readFile(envPath, 'utf8')).toContain(`TYPESAFE_AI_API_KEY="${fixtureKey}"`);
    expect((await stat(envPath)).mode & 0o777).toBe(0o600);
  } finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); }
});
