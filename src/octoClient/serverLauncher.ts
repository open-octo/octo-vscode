import { spawn } from 'node:child_process';

import { resolveOctoBinary } from './binaryLocator';

const HEALTH_POLL_INTERVAL_MS = 300;
const HEALTH_POLL_TIMEOUT_MS = 15_000;

export interface LaunchOptions {
  host: string;
  port: number;
  accessKey?: string;
  binaryPath?: string;
  cwd?: string;
}

export async function probeHealth(baseUrl: string, accessKey?: string): Promise<boolean> {
  try {
    const suffix = accessKey ? `?access_key=${encodeURIComponent(accessKey)}` : '';
    const res = await fetch(`${baseUrl}/api/health${suffix}`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(baseUrl: string, accessKey: string | undefined, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth(baseUrl, accessKey)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

export type EnsureServerResult =
  | { outcome: 'attached' }
  | { outcome: 'spawned' }
  | { outcome: 'failed'; reason: string };

/**
 * Attaches to an octo serve already listening at host:port, or spawns
 * `octo serve -d` (a plain daemon, matching what a user would run by hand —
 * no bespoke flags beyond the configured addr/key) and waits for it to
 * become healthy. Never kills a server it merely attached to.
 */
export async function ensureServerRunning(options: LaunchOptions): Promise<EnsureServerResult> {
  const baseUrl = `http://${options.host}:${options.port}`;

  if (await probeHealth(baseUrl, options.accessKey)) {
    return { outcome: 'attached' };
  }

  const binary = resolveOctoBinary(options.binaryPath);
  const args = ['serve', '-d', '--addr', `${options.host}:${options.port}`];
  if (options.accessKey) {
    args.push('--access-key', options.accessKey);
  }

  const spawned = await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const proc = spawn(binary, args, {
      cwd: options.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    proc.on('error', () => settle(false));
    proc.unref();

    // -d forks into the background quickly; give it a moment before polling.
    setTimeout(() => {
      waitForHealth(baseUrl, options.accessKey, HEALTH_POLL_TIMEOUT_MS).then(settle);
    }, 300);
  });

  if (spawned) {
    return { outcome: 'spawned' };
  }
  return { outcome: 'failed', reason: `octo serve did not become healthy at ${baseUrl} within ${HEALTH_POLL_TIMEOUT_MS}ms` };
}
