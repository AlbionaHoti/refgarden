import { expect, test } from 'bun:test';
import { runLocalCommand } from '../src/local-process';

const base = { cwd: import.meta.dir, env: { PATH: process.env.PATH || '' }, input: '', signal: new AbortController().signal, timeoutMs: 2000 };
test('local CLI captures output and exit without waiting for an open stream forever', async () => {
  const result = await runLocalCommand(process.execPath, ['-e', 'console.log("ready"); console.error("diagnostic")'], base);
  expect(result.exitCode).toBe(0); expect(result.stdout).toContain('ready'); expect(result.stderr).toContain('diagnostic');
});
test('a hung local CLI is bounded by its deadline', async () => {
  const start = performance.now();
  await expect(runLocalCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...base, timeoutMs: 80 })).rejects.toThrow('Astra took longer');
  expect(performance.now() - start).toBeLessThan(2000);
});
test('cancelling a local CLI rejects promptly', async () => {
  const controller = new AbortController();
  const pending = runLocalCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...base, signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await expect(pending).rejects.toThrow('cancelled');
});
