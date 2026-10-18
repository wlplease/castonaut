import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'contracts/AfterhoursArcade.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'AfterhoursArcade.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const result = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = result.errors?.filter(issue => issue.severity === 'error') || [];
if (errors.length) {
  for (const issue of errors) console.error(issue.formattedMessage);
  process.exit(1);
}
const contract = result.contracts['AfterhoursArcade.sol'].AfterhoursArcade;
fs.writeFileSync(path.join(root, 'src/contract-abi.json'), JSON.stringify(contract.abi, null, 2) + '\n');
console.log(`AfterhoursArcade compiled with solc ${solc.version()}; ${contract.abi.length} ABI items; ${contract.evm.bytecode.object.length / 2} bytecode bytes.`);
