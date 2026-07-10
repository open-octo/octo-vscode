import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BINARY_NAME = process.platform === 'win32' ? 'octo.exe' : 'octo';

function searchDirectories(): string[] {
  const home = os.homedir();
  const dirs = [
    // macOS installer (packaging/macos): per-user pkg, no /usr/local/bin symlink.
    path.join(home, 'Library', 'Application Support', 'octo', 'bin'),
    path.join(home, '.local', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ];
  if (process.platform === 'win32') {
    dirs.push(path.join(home, 'AppData', 'Local', 'octo', 'bin'));
  }
  return dirs;
}

/**
 * Resolves the octo binary. configuredPath wins if it's an absolute path
 * that exists; otherwise searches known install locations before falling
 * back to the bare name so `child_process.spawn` can still resolve it via
 * PATH.
 */
export function resolveOctoBinary(configuredPath?: string): string {
  const trimmed = configuredPath?.trim();
  if (trimmed && path.isAbsolute(trimmed) && fs.existsSync(trimmed)) {
    return trimmed;
  }

  const candidateName = trimmed && !path.isAbsolute(trimmed) ? trimmed : BINARY_NAME;
  for (const dir of searchDirectories()) {
    const candidate = path.join(dir, candidateName);
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Not found here; keep searching.
    }
  }

  return trimmed || BINARY_NAME;
}
