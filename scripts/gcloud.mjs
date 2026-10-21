import { spawnSync } from 'node:child_process';

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function runGcloud(args, { capture = false, allowFailure = false, cwd, maxBuffer = 8 * 1024 * 1024, timeout } = {}) {
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
    maxBuffer,
    ...(timeout ? { timeout } : {}),
    windowsHide: true,
  });
  if (result.error) {
    const detail = result.error.code === 'ENOBUFS'
      ? 'Captured Google Cloud output exceeded the local buffer. Reduce command output or raise maxBuffer.'
      : result.error.code === 'ETIMEDOUT'
        ? `Google Cloud command timed out${timeout ? ` after ${timeout} ms` : ''}. Check gcloud connectivity and retry.`
      : `Could not run gcloud: ${result.error.message}. Check that the Google Cloud CLI is installed and authenticated.`;
    throw new Error(detail);
  }
  if (!allowFailure && result.status !== 0) throw new Error((result.stderr || 'gcloud request failed').trim());
  return {
    status: result.status,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
  };
}
