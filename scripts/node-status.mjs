import { runGcloud } from './gcloud.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const positional = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--project' && args[index - 1] !== '--zone');
const zone = valueAfter('--zone', positional || 'us-central1-a');
const project = valueAfter('--project', '');
const intervalSeconds = Math.max(15, Number(valueAfter('--interval', '60')) || 60);
const instance = 'castonaut-snapchain';
const container = 'snapchain-snapchain-1';
let stopped = false;
let previousChunk = null;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopped = true; });
}

function gcloud(args, activeProject, options = {}) {
  const projectArg = activeProject ? [`--project=${activeProject}`] : [];
  try {
    return runGcloud([...args, ...projectArg], {
      capture: true,
      allowFailure: true,
      cwd: process.cwd(),
    });
  } catch (error) {
    return { status: -1, stdout: '', stderr: error.message };
  }
}

function getChunk(logs) {
  const matches = [...logs.matchAll(/Unzipping snapshot chunk [^\n]*chunk_(\d+)\.bin/g)];
  return matches.length ? Number(matches.at(-1)[1]) : null;
}

function summarizeLogs(logs) {
  const lines = logs.split(/\r?\n/).filter(Boolean);
  const chunk = getChunk(logs);
  if (chunk !== null) {
    const movement = previousChunk === null ? 'seen in recent logs' : chunk > previousChunk ? `advanced by ${chunk - previousChunk}` : chunk === previousChunk ? 'has not advanced in this poll' : 'counter moved backward';
    console.log(`Snapshot restore: chunk ${chunk} (${movement}).`);
    previousChunk = chunk;
  } else if (lines.length) {
    console.log(`Recent container log: ${lines.at(-1).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 240)}`);
  } else {
    console.log('No container log entries in the last 5 minutes.');
  }

  const errors = lines.filter((line) => /\b(ERROR|FATAL|panic|failed)\b/i.test(line)).slice(-3);
  for (const line of errors) console.log(`Log warning: ${line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300)}`);
}

async function poll(activeProject) {
  const time = new Date().toLocaleString();
  console.log(`\n[${time}] Checking ${instance} in ${zone} (read-only)`);

  const vm = gcloud(['compute', 'instances', 'describe', instance, `--zone=${zone}`, '--format=value(status)'], activeProject);
  if (vm.status !== 0 || !vm.stdout.trim()) {
    console.log(`VM status: unavailable (${(vm.stderr || vm.error?.message || 'gcloud failed').trim().slice(0, 240)})`);
    return;
  }

  const vmStatus = vm.stdout.trim();
  console.log(`VM status: ${vmStatus}`);
  if (vmStatus !== 'RUNNING') {
    console.log('Snapchain checks skipped because the VM is not running. This monitor will not start it.');
    return;
  }

  const health = gcloud([
    'compute', 'ssh', instance, `--zone=${zone}`,
    '--command=curl -fsS --max-time 10 http://127.0.0.1:3381/v1/info',
  ], activeProject, { timeout: 20_000 });

  if (health.status === 0) {
    try {
      const info = JSON.parse(health.stdout);
      const delays = (info.shardInfos || []).map((shard) => Number(shard.blockDelay)).filter(Number.isFinite);
      const maxDelay = delays.length ? Math.max(...delays) : null;
      console.log(`Snapchain API: responding${info.version ? ` (version ${info.version})` : ''}`);
      console.log(`Active shards: ${delays.length || 'unknown'}`);
      console.log(`Maximum block delay: ${maxDelay === null ? 'unknown' : `${Math.floor(maxDelay)} seconds`}`);
      console.log(`Readiness: ${maxDelay !== null && maxDelay <= 10 ? 'READY (sync delay <= 10 seconds)' : 'NOT READY (still syncing or shard status unavailable)'}`);
    } catch {
      console.log(`Snapchain API responded, but its status JSON could not be parsed: ${health.stdout.slice(0, 300)}`);
    }
  } else {
    console.log('Snapchain API: not responding inside the VM yet.');
  }

  const logs = gcloud([
    'compute', 'ssh', instance, `--zone=${zone}`,
    `--command=sudo docker logs --since 5m ${container}`,
  ], activeProject, { timeout: 20_000 });
  if (logs.status === 0) summarizeLogs(logs.stdout);
  else console.log(`Recent container logs unavailable: ${(logs.stderr || logs.error?.message || 'SSH failed').trim().slice(0, 240)}`);
}

async function main() {
  const activeProject = project || gcloud(['config', 'get-value', 'project'], '').stdout.trim();
  if (!activeProject || activeProject === '(unset)') throw new Error('No active Google Cloud project. Set one with gcloud config set project PROJECT_ID or pass --project PROJECT_ID.');
  console.log(`Castonaut node monitor — polling every ${intervalSeconds}s. Press Ctrl+C to stop.`);
  console.log('This monitor only reads VM status, Snapchain health, and recent logs; it does not start/stop resources.');

  while (!stopped) {
    await poll(activeProject);
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
  console.log('\nMonitor stopped.');
}

main().catch((error) => { console.error(`Node monitor stopped: ${error.message}`); process.exit(1); });
