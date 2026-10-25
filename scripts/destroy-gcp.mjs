import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runGcloud } from './gcloud.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const positional = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--project' && args[index - 1] !== '--zone');
const zone = valueAfter('--zone', positional || 'us-central1-a');
const projectOverride = valueAfter('--project', '');
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run destroy -- [ZONE]');
  console.log('Deletes the Castonaut test VM, its dedicated data disk, and its Snapchain firewall rule after confirmation.');
  process.exit(0);
}
if (!/^[a-z0-9-]+-[a-z]$/.test(zone)) {
  console.error('Zone must look like us-central1-a.');
  process.exit(2);
}

try {
  const identity = runGcloud(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], { capture: true }).stdout;
  if (!identity) throw new Error('No active gcloud account. Run gcloud auth login first.');
  const activeProject = projectOverride || runGcloud(['config', 'get-value', 'project'], { capture: true }).stdout;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(activeProject)) throw new Error('Set the active Google Cloud project or pass --project PROJECT_ID.');

  const instance = runGcloud(['compute', 'instances', 'describe', 'castonaut-snapchain', `--project=${activeProject}`, `--zone=${zone}`, '--format=value(status)'], { capture: true, allowFailure: true });
  const disk = runGcloud(['compute', 'disks', 'describe', 'castonaut-snapchain-data', `--project=${activeProject}`, `--zone=${zone}`, '--format=value(name)'], { capture: true, allowFailure: true });
  const firewall = runGcloud(['compute', 'firewall-rules', 'describe', 'castonaut-snapchain', `--project=${activeProject}`, '--format=value(name)'], { capture: true, allowFailure: true });
  const hasInstance = instance.status === 0 && !!instance.stdout;
  const hasDisk = disk.status === 0 && !!disk.stdout;
  const hasFirewall = firewall.status === 0 && !!firewall.stdout;

  if (!hasInstance && !hasDisk && !hasFirewall) {
    console.log(`No Castonaut test-node VM, data disk, or firewall rule found in project ${activeProject}, zone ${zone}.`);
    process.exit(0);
  }

  console.log(`\nActive gcloud account: ${identity}`);
  console.log(`Project: ${activeProject} · zone: ${zone}`);
  console.log(`Resources to delete: ${hasInstance ? `VM castonaut-snapchain (${instance.stdout})` : 'no VM'}; ${hasDisk ? 'data disk castonaut-snapchain-data' : 'no data disk'}; ${hasFirewall ? 'firewall rule castonaut-snapchain' : 'no firewall rule'}.`);
  console.log('Deleting the VM and disk permanently removes this node’s local database and requires a fresh sync if you provision again.');
  const prompt = createInterface({ input, output });
  const answer = await prompt.question('Type DELETE to remove these resources and stop their charges: ');
  prompt.close();
  if (answer.trim() !== 'DELETE') {
    console.log('No resources were deleted.');
    process.exit(0);
  }

  if (hasInstance) runGcloud(['compute', 'instances', 'delete', 'castonaut-snapchain', `--project=${activeProject}`, `--zone=${zone}`, '--quiet']);
  const remainingDisk = runGcloud(['compute', 'disks', 'describe', 'castonaut-snapchain-data', `--project=${activeProject}`, `--zone=${zone}`, '--format=value(name)'], { capture: true, allowFailure: true });
  if (remainingDisk.status === 0 && remainingDisk.stdout) {
    runGcloud(['compute', 'disks', 'delete', 'castonaut-snapchain-data', `--project=${activeProject}`, `--zone=${zone}`, '--quiet']);
  }

  const taggedInstances = runGcloud(['compute', 'instances', 'list', `--project=${activeProject}`, '--filter=tags.items=snapchain-readnode', '--format=value(name,zone)'], { capture: true });
  if (hasFirewall && !taggedInstances.stdout) {
    runGcloud(['compute', 'firewall-rules', 'delete', 'castonaut-snapchain', `--project=${activeProject}`, '--quiet']);
  } else if (hasFirewall) {
    console.log(`Kept firewall rule castonaut-snapchain because other tagged instances still exist: ${taggedInstances.stdout.replace(/\n/g, ', ')}.`);
  }
  console.log('Test node VM and dedicated data disk cleanup complete.');
} catch (error) {
  console.error(`Cleanup stopped: ${error.message}`);
  process.exit(1);
}
