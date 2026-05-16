import { test as base } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type WorkerFixtures = { backends: void };

function spawnBackend(wsPort: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'cargo',
      ['run', '--bin', 'chat', '--', 'serve', '--ws-port', String(wsPort)],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, RUST_LOG: 'warn,relay_test=info' },
      }
    );

    const timeout = setTimeout(
      () => reject(new Error(`Backend on :${wsPort} did not start within 60s`)),
      60_000
    );

    // The backend logs "serve mode: peer ready" to stdout when the WS server is up.
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('serve mode')) {
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.on('error', err => { clearTimeout(timeout); reject(err); });
    proc.on('exit', code => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) reject(new Error(`Backend on :${wsPort} exited with code ${code}`));
    });
  });
}

export const test = base.extend<object, WorkerFixtures>({
  // Worker-scoped: one pair of backends per Playwright worker, reused across tests.
  backends: [
    async ({}, use) => {
      let peerA: ChildProcess | undefined;
      let peerB: ChildProcess | undefined;
      try {
        [peerA, peerB] = await Promise.all([
          spawnBackend(9001),
          spawnBackend(9002),
        ]);
      } catch (err) {
        peerA?.kill();
        peerB?.kill();
        throw err;
      }
      await use();
      peerA.kill('SIGTERM');
      peerB.kill('SIGTERM');
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
