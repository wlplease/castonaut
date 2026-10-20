import { spawn } from 'node:child_process';
import { isIP } from 'node:net';

const args = process.argv.slice(2);
const index = args.indexOf('--node-url');
const nodeUrl = index >= 0 ? args[index + 1] : args.find((arg) => /^https?:\/\//i.test(arg)) || '';
if (!nodeUrl) {
  console.error('Usage: npm run client -- http://<your-node-ip>:3381');
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
process.env.VITE_CONTEST_ACCESS = 'true';
if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  console.warn('Privacy note: local client mode sends node requests from this computer. The node can see this computer’s public egress IP. Use the hosted Vercel client when you want node requests to come from the server host instead.');
}
const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], { stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
child.on('error', (error) => { console.error(`Could not start Vite: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 0; });
