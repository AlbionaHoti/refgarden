import { spawn } from 'node:child_process';
import { RequestError } from './decision';

/** Own the entire CLI process group so timeout/cancel also closes inherited pipes. */
export function runLocalCommand(command: string, args: string[], options: { cwd: string; env: Record<string, string>; input: string; signal: AbortSignal; timeoutMs: number }) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    if (options.signal.aborted) { reject(new RequestError('Astra review was cancelled.', 499)); return; }
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const kill = () => {
      if (!child.pid) return;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch { /* Already exited. */ } }
    };
    const finish = (error?: Error, exitCode: number | null = null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); options.signal.removeEventListener('abort', abort);
      if (error) { kill(); reject(error); } else resolve({ exitCode, stdout, stderr });
    };
    const abort = () => finish(new RequestError('Astra review was cancelled.', 499));
    const timer = setTimeout(() => finish(new RequestError(`Astra took longer than ${Math.round(options.timeoutMs / 1000)} seconds. Try a shorter brief.`, 504)), options.timeoutMs);
    options.signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-2_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2_000_000); });
    child.once('error', error => finish(error));
    child.once('close', exitCode => finish(undefined, exitCode));
    child.stdin.on('error', () => { /* The close/error handler reports a terminated CLI. */ });
    child.stdin.end(options.input);
    if (options.signal.aborted) abort();
  });
}
