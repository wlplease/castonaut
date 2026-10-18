import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runGcloud } from './gcloud.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
const positional = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--project' && args[index - 1] !== '--zone');
const zone = valueAfter('--zone', positional || 'us-central1-a');
const project = valueAfter('--project', '');
if (!/^[a-z0-9-]+-[a-z]$/.test(zone)) { console.error('Zone must look like us-central1-a.'); process.exit(2); }

try {
  const identity = runGcloud(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], { capture: true, cwd: root }).stdout;
  if (!identity) throw new Error('No active gcloud account. Run gcloud auth login first.');
  const activeProject = project || runGcloud(['config', 'get-value', 'project'], { capture: true, cwd: root }).stdout;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(activeProject)) throw new Error('Set a Google Cloud project with billing before provisioning.');
  const billingJson = runGcloud(['billing', 'projects', 'describe', activeProject, '--format=json'], { capture: true, cwd: root }).stdout;
  const billing = JSON.parse(billingJson);
  if (!billing.billingEnabled) throw new Error(`Billing is not enabled on project ${activeProject}. Link the open trial billing account first.`);

  const existing = runGcloud(['compute', 'instances', 'describe', 'castonaut-snapchain', `--project=${activeProject}`, `--zone=${zone}`, '--format=value(status)'], { capture: true, allowFailure: true, cwd: root });
  if (existing.status === 0 && existing.stdout) throw new Error(`castonaut-snapchain already exists (${existing.stdout}). Run npm run node to finish setup, or delete it from the Cloud Console when you are done.`);

  console.log('\nThis creates a 4-vCPU / 16-GB VM, a 1.75-TiB persistent data disk, and a public Snapchain peer/API endpoint.');
  console.log('Estimate: roughly $0.24 per hour, about $40 for 7 days, before network and IP charges. Actual rates and trial coverage vary by region and account.');
  console.log('The disk is set to auto-delete when you delete the VM. The VM keeps running until you stop or delete it.\n');
  const prompt = createInterface({ input, output });
  const answer = await prompt.question('Type CREATE to provision these billable resources: ');
  prompt.close();
  if (answer.trim() !== 'CREATE') { console.log('No resources were created.'); process.exit(0); }

  const firewall = runGcloud(['compute', 'firewall-rules', 'describe', 'castonaut-snapchain', `--project=${activeProject}`, '--format=value(name)'], { capture: true, allowFailure: true, cwd: root });
  if (firewall.status !== 0) {
    runGcloud([
      'compute', 'firewall-rules', 'create', 'castonaut-snapchain', `--project=${activeProject}`,
      '--direction=INGRESS', '--action=ALLOW', '--rules=tcp:3381-3383,udp:3381-3383',
      '--source-ranges=0.0.0.0/0', '--target-tags=snapchain-readnode',
      '--description=Snapchain-read-node-HTTP-gRPC-and-gossip-ports',
    ], { cwd: root });
  }
  runGcloud([
    'compute', 'instances', 'create', 'castonaut-snapchain', `--project=${activeProject}`, `--zone=${zone}`,
    '--machine-type=e2-standard-4', '--image-family=ubuntu-2204-lts', '--image-project=ubuntu-os-cloud',
    '--boot-disk-size=30GB', '--boot-disk-type=pd-balanced', '--create-disk=name=castonaut-snapchain-data,device-name=castonaut-snapchain-data,size=1792GB,type=pd-standard,auto-delete=yes,boot=no',
    '--tags=snapchain-readnode', `--metadata-from-file=startup-script=${resolve(root, 'scripts/gcp-startup.sh')}`,
  ], { cwd: root });
  const details = JSON.parse(runGcloud(['compute', 'instances', 'describe', 'castonaut-snapchain', `--project=${activeProject}`, `--zone=${zone}`, '--format=json'], { capture: true, cwd: root }).stdout);
  const address = details.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
  console.log(`\nVM created in ${zone}. Public IP: ${address || 'not assigned yet'}`);
  console.log('Wait 2–4 minutes for startup, then run: npm run node -- --zone ' + zone);
  console.log('When the contest run ends, run npm run destroy -- ' + zone + ' to delete the VM, data disk, and firewall rule.');
} catch (error) {
  console.error(`Provisioning stopped: ${error.message}`);
  process.exit(1);
}
