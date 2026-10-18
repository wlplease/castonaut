import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
const positional = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--project' && args[index - 1] !== '--zone');
const zone = valueAfter('--zone', positional || 'us-central1-a');
const project = valueAfter('--project', '');
const instance = 'castonaut-snapchain';
const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

function gcloudCall(gcloudArgs, inherit = false) {
  const result = spawnSync(gcloud, gcloudArgs, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw new Error(`Could not run gcloud: ${result.error.message}`);
  if (!inherit && result.status !== 0) throw new Error((result.stderr || 'gcloud request failed').trim());
  return result;
}

async function main() {
  const activeProject = project || gcloudCall(['config', 'get-value', 'project']).stdout.trim();
  const details = JSON.parse(gcloudCall(['compute', 'instances', 'describe', instance, `--project=${activeProject}`, `--zone=${zone}`, '--format=json']).stdout);
  if (details.status !== 'RUNNING') throw new Error(`VM status is ${details.status}. Wait for startup to complete, then retry.`);
  const ip = details.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
  if (!ip) throw new Error('The VM has no public IP. Check its network interface in Cloud Console.');

  const remote = [
    'set -e',
    'for attempt in $(seq 1 60); do mountpoint -q /mnt/disks/snapchain-data && break; sleep 5; done',
    'mountpoint -q /mnt/disks/snapchain-data || { echo "Data disk is not mounted yet" >&2; exit 1; }',
    'ln -sfn /mnt/disks/snapchain-data "$HOME/snapchain"',
    'cd "$HOME/snapchain"',
    'curl -fsSL https://raw.githubusercontent.com/farcasterxyz/snapchain/refs/heads/main/scripts/snapchain-bootstrap.sh | bash',
  ].join(' && ');

  console.log('Opening an SSH session. Snapchain’s installer will ask you to confirm its operator notice; read it and answer yourself.');
  console.log('The installer follows logs after starting the node. Press Ctrl+C once to return to the local setup script.\n');
  const ssh = gcloudCall(['compute', 'ssh', instance, `--project=${activeProject}`, `--zone=${zone}`, `--ssh-flag=-t`, `--command=${remote}`], true);
  if (ssh.status !== 0 && ssh.status !== 130) throw new Error(`SSH setup exited with code ${ssh.status}. Check the remote installer output and rerun this command.`);

  const endpoint = `http://${ip}:3381/v1/info`;
  console.log(`\nWaiting for the read node at ${endpoint}`);
  for (let attempt = 1; attempt <= 180; attempt++) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const info = await response.json();
        const delays = (info.shardInfos || []).filter((shard) => Number(shard.shardId) > 0).map((shard) => Number(shard.blockDelay)).filter(Number.isFinite);
        const maxDelay = delays.length ? Math.max(...delays) : null;
        console.log(`Snapchain ${info.version || ''} is responding. Latest message-shard delay: ${maxDelay === null ? 'unknown' : `${maxDelay}s`}.`);
        console.log(`Use this node URL for the client: http://${ip}:3381`);
        console.log('The read node is ready to answer requests; the initial snapshot may still be syncing.');
        return;
      }
    } catch { /* Retry while systemd, Docker, and the snapshot loader start. */ }
    if (attempt % 6 === 0) console.log(`Still waiting (${attempt * 5}s)…`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('Timed out waiting for /v1/info. Check the startup script, firewall, and Snapchain logs with gcloud compute ssh.');
}

main().catch((error) => { console.error(`Node setup stopped: ${error.message}`); process.exit(1); });
