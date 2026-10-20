import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runGcloud } from './gcloud.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
const positional = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--project' && args[index - 1] !== '--zone');
const zone = valueAfter('--zone', positional || 'us-central1-a');
const project = valueAfter('--project', '');
const checkOnly = args.includes('--check');
const instance = 'castonaut-snapchain';

function formatDelay(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds)));
  if (!Number.isFinite(value)) return 'unknown';
  if (value >= 31_557_600) {
    const years = Math.floor(value / 31_557_600);
    const months = Math.floor((value % 31_557_600) / 2_629_746);
    return [years && `${years} year${years === 1 ? '' : 's'}`, months && `${months} month${months === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  }
  if (value >= 86_400) return `${Math.floor(value / 86_400)} days`;
  if (value >= 3_600) return `${Math.floor(value / 3_600)} hours`;
  if (value >= 60) return `${Math.floor(value / 60)} minutes`;
  return `${value} seconds`;
}

function checkFromVm(activeProject) {
  return runGcloud(['compute', 'ssh', instance, `--project=${activeProject}`, `--zone=${zone}`, '--command=curl -fsS --max-time 10 http://127.0.0.1:3381/v1/info'], { capture: true, allowFailure: true, cwd: root });
}

async function checkPublicEndpoint(ip) {
  try {
    const response = await fetch(`http://${ip}:3381/v1/info`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const info = await response.json();
    return { ok: true, info };
  } catch (error) {
    return { ok: false, detail: error.name === 'TimeoutError' ? 'request timed out' : error.message };
  }
}

function nodeStatus(info) {
  const shards = (info.shardInfos || []).filter((shard) => Number.isFinite(Number(shard.blockDelay)));
  const maxDelay = shards.length ? Math.max(...shards.map((shard) => Number(shard.blockDelay))) : null;
  return { maxDelay, ready: maxDelay !== null && maxDelay <= 10, shardCount: shards.length };
}

function printNodeReport(info, publicEndpoint) {
  const { maxDelay, ready, shardCount } = nodeStatus(info);
  console.log(`Snapchain ${info.version || 'unknown'}: ${ready ? 'READY' : 'SYNCING / NOT READY'}`);
  console.log(`Active shards reported: ${shardCount || 'unknown'}`);
  console.log(`Maximum shard delay: ${maxDelay === null ? 'unknown' : formatDelay(maxDelay)}`);
  console.log(`Public endpoint from this computer: ${publicEndpoint.ok ? 'reachable' : `not verified (${publicEndpoint.detail})`}`);
  return { ready, maxDelay };
}

async function main() {
  const activeProject = project || runGcloud(['config', 'get-value', 'project'], { capture: true, cwd: root }).stdout;
  const details = JSON.parse(runGcloud(['compute', 'instances', 'describe', instance, `--project=${activeProject}`, `--zone=${zone}`, '--format=json'], { capture: true, cwd: root }).stdout);
  if (details.status !== 'RUNNING') throw new Error(`VM status is ${details.status}. Wait for startup to complete, then retry.`);
  const ip = details.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
  if (!ip) throw new Error('The VM has no public IP. Check its network interface in Cloud Console.');

  if (checkOnly) {
    const health = checkFromVm(activeProject);
    if (health.status !== 0) throw new Error(`Snapchain is not answering on the VM yet. Check progress with gcloud compute ssh ${instance} --zone ${zone} --command="sudo docker logs --tail 30 snapchain-snapchain-1" and retry with npm run node:check -- ${zone} later.`);
    const info = JSON.parse(health.stdout);
    const publicEndpoint = await checkPublicEndpoint(ip);
    const { ready } = printNodeReport(info, publicEndpoint);
    if (!publicEndpoint.ok) console.log('Check the cloud firewall, Snapchain HTTP bind address, and current VM IP before exposing this endpoint to a hosted client.');
    console.log(`Vercel server-side URL for the hosted client: http://${ip}:3381`);
    if (!ready || !publicEndpoint.ok) process.exitCode = 1;
    return;
  }

  const remoteScript = `${instance}:~/castonaut-node-bootstrap.sh`;
  runGcloud(['compute', 'scp', resolve(root, 'scripts/node-bootstrap-remote.sh'), remoteScript, `--project=${activeProject}`, `--zone=${zone}`], { cwd: root });

  console.log('Opening an SSH session. Snapchain’s installer will ask you to confirm its operator notice and node settings.');
  console.log('The installer follows logs after starting the node. Press Ctrl+C once to return to the local setup script.\n');
  const ssh = runGcloud(['compute', 'ssh', instance, `--project=${activeProject}`, `--zone=${zone}`, '--ssh-flag=-t', '--command=bash ~/castonaut-node-bootstrap.sh'], { allowFailure: true, cwd: root });
  if (ssh.status !== 0 && ssh.status !== 130 && ssh.status !== 1) throw new Error(`SSH setup exited with code ${ssh.status}. Check the remote installer output and rerun this command.`);
  if (ssh.status !== 0) console.log('SSH closed after the installer log session. Checking the node from inside the VM.');

  const health = checkFromVm(activeProject);
  if (health.status !== 0) {
    console.log('\nSnapchain is starting its first snapshot; this can take several hours. The VM will keep syncing after this command exits.');
    console.log(`Check readiness later without sending a request from this computer: npm run node:check -- ${zone}`);
    return;
  }
  const info = JSON.parse(health.stdout);
  const publicEndpoint = await checkPublicEndpoint(ip);
  const { ready } = printNodeReport(info, publicEndpoint);
  console.log(`Set the server-side Vercel variable SNAPCHAIN_URL to http://${ip}:3381`);
  if (!ready) console.log('Leave the VM running only while the approved trial budget allows; recheck later with npm run node:check -- ' + zone + '.');
  if (!publicEndpoint.ok) console.log('Public access is not verified. Check the cloud firewall and Snapchain HTTP bind address before configuring a hosted client.');
}

main().catch((error) => { console.error(`Node setup stopped: ${error.message}`); process.exit(1); });
