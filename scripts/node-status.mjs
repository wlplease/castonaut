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
const once = args.includes('--once');
let stopped = false;
let previousChunk = null;
let previousDiskSample = null;
const previousHeights = new Map();

function formatDelay(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds)));
  if (!Number.isFinite(value)) return 'unknown';
  if (value >= 31_557_600) {
    const years = Math.floor(value / 31_557_600);
    const months = Math.floor((value % 31_557_600) / 2_629_746);
    return [years && `${years}y`, months && `${months}mo`].filter(Boolean).join(' ');
  }
  if (value >= 86_400) return `${Math.floor(value / 86_400)}d`;
  if (value >= 3_600) return `${Math.floor(value / 3_600)}h`;
  if (value >= 60) return `${Math.floor(value / 60)}m`;
  return `${value}s`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit += 1; }
  return `${scaled.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function summarizeResources(output) {
  const [diskLine, statsLine] = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (diskLine) {
    const [size, used, available, percent] = diskLine.split(/\s+/);
    const total = Number(size);
    const usedBytes = Number(used);
    const freeBytes = Number(available);
    if ([total, usedBytes, freeBytes].every(Number.isFinite)) {
      console.log(`Data disk: ${formatBytes(usedBytes)} / ${formatBytes(total)} used (${percent || 'unknown'}) · ${formatBytes(freeBytes)} free`);
      const usage = Number.parseInt(percent, 10);
      if (Number.isFinite(usage) && usage >= 92) console.log('Disk warning: critically low free space; stop the test before the data disk fills.');
      else if (Number.isFinite(usage) && usage >= 85) console.log('Disk warning: usage is high; review growth before extending the test.');
      const now = Date.now();
      if (previousDiskSample) {
        const elapsedMinutes = (now - previousDiskSample.time) / 60_000;
        const consumed = previousDiskSample.available - freeBytes;
        if (elapsedMinutes >= 0.25 && consumed > 0) {
          console.log(`Observed disk growth since prior poll: ${formatBytes(consumed)} over ${elapsedMinutes.toFixed(1)} min (bursty; not a capacity forecast).`);
        }
      }
      previousDiskSample = { available: freeBytes, time: now };
    } else console.log(`Data disk usage unavailable: ${diskLine.slice(0, 180)}`);
  } else console.log('Data disk usage unavailable.');

  if (statsLine) {
    const [cpu, memory, network, blockIo, pids] = statsLine.split('|');
    if (cpu && memory) console.log(`Container: CPU ${cpu} · memory ${memory} · network I/O ${network || 'unknown'} · block I/O ${blockIo || 'unknown'} · PIDs ${pids || 'unknown'}`);
  } else console.log('Container resource stats unavailable.');
}

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
      ...options,
    });
  } catch (error) {
    return { status: -1, stdout: '', stderr: error.message };
  }
}

function getChunk(logs) {
  const matches = [...logs.matchAll(/Unzipping snapshot chunk [^\n]*chunk_(\d+)\.bin/g)];
  return matches.length ? Number(matches.at(-1)[1]) : null;
}

function getSnapshotDownload(logs) {
  const active = [...logs.matchAll(/Downloading zipped snapshot chunk (chunk_\d+\.bin) for shard (\d+) \((\d+)\/(\d+) chunks in shard\)/g)].at(-1);
  const completed = [...logs.matchAll(/Completed download of (chunk_\d+\.bin) \((\d+) bytes\)\. Progress: (\d+)\/(\d+) chunks \((\d+)%\)(?: \(ETA: ([^)]+)\))?/g)].at(-1);
  if (!active && !completed) return null;
  return { active, completed };
}

function summarizeLogs(logs) {
  const cleanLogs = logs.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = cleanLogs.split(/\r?\n/).filter(Boolean);
  const chunk = getChunk(cleanLogs);
  const snapshotDownload = getSnapshotDownload(cleanLogs);
  if (chunk !== null) {
    const movement = previousChunk === null ? 'seen in recent logs' : chunk > previousChunk ? `advanced by ${chunk - previousChunk}` : chunk === previousChunk ? 'has not advanced in this poll' : 'counter moved backward';
    console.log(`Snapshot restore: chunk ${chunk} (${movement}).`);
    previousChunk = chunk;
  } else if (snapshotDownload) {
    const { active, completed } = snapshotDownload;
    const shard = active ? `shard ${active[2]} · chunk ${active[3]}/${active[4]}` : 'chunk download';
    const overall = completed ? `${Number(completed[3]).toLocaleString()}/${Number(completed[4]).toLocaleString()} overall (${completed[5]}%)` : 'overall progress pending';
    const eta = completed?.[6] ? ` · ETA ${completed[6]}` : '';
    console.log(`Snapshot download: ${shard} · ${overall}${eta}.`);
  } else if (lines.length) {
    console.log(`Recent container log: ${lines.at(-1).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 240)}`);
  } else {
    console.log('No container log entries in the last 10 minutes.');
  }

  const heights = new Map();
  for (const line of lines) {
    const match = line.match(/Processed decided (?:shard chunk|block) height=\[(\d+)\]\s*(\d+)/);
    if (match) heights.set(Number(match[1]), Number(match[2]));
  }
  for (const [shard, height] of heights) {
    const previous = previousHeights.get(shard);
    const movement = previous === undefined ? '' : height >= previous ? ` (+${height - previous} since last check)` : ' (height moved backward)';
    console.log(`Recent shard ${shard} height: ${height}${movement}`);
    previousHeights.set(shard, height);
  }

  const warnings = lines.filter((line) => /\b(WARN|ERROR|FATAL|panic|failed)\b|No peer to request sync from/i.test(line)).slice(-3);
  for (const line of warnings) console.log(`Log warning: ${line.slice(0, 300)}`);
}

async function poll(activeProject) {
  const time = new Date().toLocaleString();
  console.log(`\n[${time}] Checking ${instance} in ${zone} (read-only)`);

  const vm = gcloud(['compute', 'instances', 'describe', instance, `--zone=${zone}`, '--format=value(status)'], activeProject, { timeout: 20_000 });
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
      const shards = info.shardInfos || [];
      const delays = shards.map((shard) => Number(shard.blockDelay)).filter(Number.isFinite);
      const maxDelay = delays.length ? Math.max(...delays) : null;
      console.log(`Snapchain API: responding${info.version ? ` (version ${info.version})` : ''}`);
      console.log(`Active shards: ${delays.length || 'unknown'}`);
      console.log(`Maximum block delay: ${maxDelay === null ? 'unknown' : `${Math.floor(maxDelay)} seconds`}`);
      console.log(`Readiness: ${maxDelay !== null && maxDelay <= 10 ? 'READY (sync delay <= 10 seconds)' : 'NOT READY (still syncing or shard status unavailable)'}`);
      for (const shard of shards) {
        const delay = Number(shard.blockDelay);
        const height = Number(shard.maxHeight);
        const messages = Number(shard.numMessages);
        console.log(`  Shard ${shard.shardId}: height ${Number.isFinite(height) ? height.toLocaleString() : 'unknown'} · delay ${formatDelay(delay)} · messages ${Number.isFinite(messages) ? messages.toLocaleString() : 'unknown'}`);
      }
    } catch {
      console.log(`Snapchain API responded, but its status JSON could not be parsed: ${health.stdout.slice(0, 300)}`);
    }
  } else {
    console.log('Snapchain API: not responding inside the VM yet.');
  }

  const mesh = gcloud([
    'compute', 'ssh', instance, `--zone=${zone}`,
    '--command=curl -fsS --max-time 10 "http://127.0.0.1:3381/v1/mesh?format=ascii"',
  ], activeProject, { timeout: 20_000 });
  if (mesh.status === 0) {
    const firstLines = mesh.stdout.split(/\r?\n/).slice(0, 2).join(' ');
    const role = firstLines.match(/\b(non-validator|validator)\b/)?.[1];
    const peerCount = firstLines.match(/PEERS \((\d+) shown, (\d+) validators\)/);
    const consensus = firstLines.match(/consensus-mesh (\d+)\/(\d+)/);
    console.log(`Peer mesh: ${role || 'role unknown'}${peerCount ? ` · ${peerCount[2]} connected validators` : ''}${consensus ? ` · consensus links ${consensus[1]}/${consensus[2]}` : ''}`);
  } else {
    console.log(`Peer mesh detail unavailable: ${(mesh.stderr || 'Snapchain mesh endpoint did not respond').trim().slice(0, 180)}`);
  }

  const resources = gcloud([
    'compute', 'ssh', instance, `--zone=${zone}`,
    `--command=df -B1 --output=size,used,avail,pcent /mnt/disks/snapchain-data | tail -n 1; sudo docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}' ${container}`,
  ], activeProject, { timeout: 20_000 });
  if (resources.status === 0) summarizeResources(resources.stdout);
  else console.log(`Resource stats unavailable: ${(resources.stderr || resources.error?.message || 'SSH failed').trim().slice(0, 240)}`);

  const logs = gcloud([
    'compute', 'ssh', instance, `--zone=${zone}`,
    `--command=sudo docker logs --since 10m --tail 100 ${container}`,
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
    if (once || stopped) break;
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
  console.log('\nMonitor stopped.');
}

main().catch((error) => { console.error(`Node monitor stopped: ${error.message}`); process.exit(1); });
