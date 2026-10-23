import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { runGcloud } from './gcloud.mjs';

const args = process.argv.slice(2);
const index = args.indexOf('--node-url');
const zoneIndex = args.indexOf('--zone');
const projectIndex = args.indexOf('--project');
const zone = zoneIndex >= 0 ? args[zoneIndex + 1] : '';
const project = projectIndex >= 0 ? args[projectIndex + 1] : '';
let nodeUrl = index >= 0 ? args[index + 1] : args.find((arg) => /^https?:\/\//i.test(arg)) || '';
if (!nodeUrl && zone) {
  if (!/^[a-z0-9-]+-[a-z]$/.test(zone)) {
    console.error('Zone must look like us-central1-a.');
    process.exit(2);
  }
  const describeArgs = ['compute', 'instances', 'describe', 'castonaut-snapchain', `--zone=${zone}`, '--format=value(networkInterfaces[0].accessConfigs[0].natIP)'];
  if (project) describeArgs.push(`--project=${project}`);
  try {
    const address = runGcloud(describeArgs, { capture: true }).stdout;
    if (!address) throw new Error('No external IP was returned. Check that the VM is running and has an external IP.');
    nodeUrl = `http://${address}:3381`;
    console.log(`Found your Snapchain node: ${nodeUrl}`);
  } catch (error) {
    console.error(`Could not find your Snapchain VM: ${error.message}`);
    process.exit(1);
  }
}
if (!nodeUrl) {
  console.error('Usage: npm run client -- --zone us-central1-a   (or pass an explicit node URL)');
  process.exit(2);
}
let parsed;
try { parsed = new URL(nodeUrl); } catch { console.error('Enter a valid HTTP or HTTPS node URL.'); process.exit(2); }
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
  console.error('Use the node origin only, such as http://203.0.113.20:3381. Do not include credentials or a path.');
  process.exit(2);
}
if (parsed.hostname !== 'localhost' && isIP(parsed.hostname) !== 4 && !parsed.hostname.includes('.')) {
  console.error('The node host must be localhost, an IPv4 address, or a DNS name.');
  process.exit(2);
}

process.env.SNAPCHAIN_URL = parsed.origin;
if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  console.warn('Privacy note: local client mode sends node requests from this computer. The node can see this computer’s public egress IP. Use the hosted Vercel client when you want node requests to come from the server host instead.');
}
const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], { stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
child.on('error', (error) => { console.error(`Could not start Vite: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 0; });
