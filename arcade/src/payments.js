import { createPublicClient, createWalletClient, custom, formatEther, http, parseEther, parseUnits } from 'viem';
import { base, mainnet } from 'viem/chains';
import arcadeAbi from './contract-abi.json';

const contract = import.meta.env.VITE_ARCADE_CONTRACT?.trim();
const treasury = import.meta.env.VITE_ARCADE_TREASURY?.trim();
const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const validAddress = value => /^0x[a-fA-F0-9]{40}$/.test(value || '');
const usdcAbi = [
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

export const baseContractReady = validAddress(contract);
export const paymentsReady = baseContractReady || validAddress(treasury);
const baseRpc = import.meta.env.VITE_BASE_RPC_URL || 'https://mainnet.base.org';

export async function getBaseQuarterPrice() {
  if (!baseContractReady) return null;
  const publicClient = createPublicClient({ chain: base, transport: http(baseRpc) });
  const [price, paused] = await Promise.all([
    publicClient.readContract({ address: contract, abi: arcadeAbi, functionName: 'ethQuarterPriceWei' }),
    publicClient.readContract({ address: contract, abi: arcadeAbi, functionName: 'paused' }),
  ]);
  return { price: formatEther(price), paused };
}

export async function payQuarter(currency, onStep = () => {}) {
  if (!window.ethereum) throw new Error('Install a compatible wallet to pay with crypto.');
  const onBase = currency !== 'ETH_MAINNET';
  if (onBase && !baseContractReady) throw new Error('The Base quarter contract is not configured yet.');
  if (!onBase && !validAddress(treasury)) throw new Error('The Ethereum payment wallet is not configured yet.');

  const chain = onBase ? base : mainnet;
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const publicClient = createPublicClient({ chain, transport: http(onBase ? baseRpc : undefined) });
  onStep('Connecting wallet…');
  const [account] = await wallet.requestAddresses();
  await wallet.switchChain({ id: chain.id });

  let hash;
  if (currency === 'USDC') {
    const amount = parseUnits('0.25', 6);
    const allowance = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'allowance', args: [account, contract] });
    if (allowance < amount) {
      onStep('Approve exactly 0.25 USDC…');
      const approvalHash = await wallet.writeContract({ account, address: usdc, abi: usdcAbi, functionName: 'approve', args: [contract, amount] });
      const approval = await publicClient.waitForTransactionReceipt({ hash: approvalHash, confirmations: 1 });
      if (approval.status !== 'success') throw new Error('USDC approval did not complete.');
    }
    onStep('Confirm one quarter…');
    hash = await wallet.writeContract({ account, address: contract, abi: arcadeAbi, functionName: 'buyWithUSDC', args: [1n] });
  } else if (currency === 'BASE_ETH') {
    const [price, paused] = await Promise.all([
      publicClient.readContract({ address: contract, abi: arcadeAbi, functionName: 'ethQuarterPriceWei' }),
      publicClient.readContract({ address: contract, abi: arcadeAbi, functionName: 'paused' }),
    ]);
    if (paused) throw new Error('Quarter sales are paused.');
    if (price === 0n) throw new Error('Base ETH quarters are not priced yet. Try USDC.');
    onStep('Confirm one quarter…');
    hash = await wallet.writeContract({ account, address: contract, abi: arcadeAbi, functionName: 'buyWithETH', args: [1n], value: price });
  } else {
    const amount = import.meta.env.VITE_QUARTER_ETH_MAINNET;
    if (!amount || Number(amount) <= 0) throw new Error('Ethereum ETH price is not set yet.');
    onStep('Confirm Ethereum support payment…');
    hash = await wallet.sendTransaction({ account, to: treasury, value: parseEther(amount) });
  }

  onStep(`Waiting for ${chain.name} confirmation…`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== 'success') throw new Error('The transaction did not complete.');
  return { hash, account, currency };
}

export async function signQuarterClaim(hash, uid, account) {
  if (!window.ethereum) throw new Error('Reconnect the purchasing wallet to claim this quarter.');
  const wallet = createWalletClient({ chain: base, transport: custom(window.ethereum) });
  await wallet.switchChain({ id: base.id });
  const message = `Afterhours Arcade quarter claim\nFirebase UID: ${uid}\nTransaction: ${hash.toLowerCase()}\nChain: 8453`;
  return wallet.signMessage({ account, message });
}
