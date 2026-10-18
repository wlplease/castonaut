import { spawnSync } from 'node:child_process';

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function runGcloud(args, { capture = false, allowFailure = false, cwd } = {}) {
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell.exe' : 'gcloud';
  const commandArgs = windows
    ? ['-NoLogo', '-NoProfile', '-Command', `& gcloud ${args.map(quotePowerShell).join(' ')}`]
    : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new Error(`Could not run gcloud: ${result.error.message}. Install the Google Cloud CLI and authenticate first.`);
  if (!allowFailure && result.status !== 0) throw new Error((result.stderr || 'gcloud request failed').trim());
  return {
    status: result.status,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
  };
}
