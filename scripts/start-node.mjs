import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runGcloud } from './gcloud.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
const positional = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--project' && args[index - 1] !== '--zone');
const zone = valueAfter('--zone', positional || 'us-central1-a');
const project = valueAfter('--project', '');
const instance = 'castonaut-snapchain';
async function main() {
  const activeProject = project || runGcloud(['config', 'get-value', 'project'], { capture: true, cwd: root }).stdout;
  const details = JSON.parse(runGcloud(['compute', 'instances', 'describe', instance, `--project=${activeProject}`, `--zone=${zone}`, '--format=json'], { capture: true, cwd: root }).stdout);
  if (details.status !== 'RUNNING') throw new Error(`VM status is ${details.status}. Wait for startup to complete, then retry.`);
  const ip = details.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
  if (!ip) throw new Error('The VM has no public IP. Check its network interface in Cloud Console.');

  const remoteScript = `${instance}:~/castonaut-node-bootstrap.sh`;
  runGcloud(['compute', 'scp', resolve(root, 'scripts/node-bootstrap-remote.sh'), remoteScript, `--project=${activeProject}`, `--zone=${zone}`], { cwd: root });

  console.log('Opening an SSH session. Snapchain’s installer will ask you to confirm its operator notice and node settings.');
  console.log('The installer follows logs after starting the node. Press Ctrl+C once to return to the local setup script.\n');
  const ssh = runGcloud(['compute', 'ssh', instance, `--project=${activeProject}`, `--zone=${zone}`, '--ssh-flag=-t', '--command=bash ~/castonaut-node-bootstrap.sh'], { allowFailure: true, cwd: root });
  if (ssh.status !== 0 && ssh.status !== 130 && ssh.status !== 1) throw new Error(`SSH setup exited with code ${ssh.status}. Check the remote installer output and rerun this command.`);
  if (ssh.status !== 0) console.log('SSH closed after the installer log session. Checking the node API now.');

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
