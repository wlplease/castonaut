import { createPublicClient, createWalletClient, custom, http, isAddress, parseAbi, parseUnits } from 'viem';
import { base } from 'viem/chains';

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const PASS_PRICE = parseUnits('3.70', 6);
export const PASS_ABI = parseAbi([
  'function expiresAt(address account) view returns (uint64)',
  'function buyPass()',
]);
const USDC_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const baseReader = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });

export function isConfiguredPassAddress(address) {
  return typeof address === 'string' && isAddress(address);
}

export function findConnectedPassWallet(savedWallet, accounts) {
  if (!isAddress(savedWallet) || !Array.isArray(accounts)) return '';
  return accounts.find((account) => isAddress(account) && account.toLowerCase() === savedWallet.toLowerCase()) || '';
}

export async function readPassExpiry(wallet, contractAddress) {
  if (!isAddress(wallet) || !isConfiguredPassAddress(contractAddress)) return 0;
  const expiry = await baseReader.readContract({ address: contractAddress, abi: PASS_ABI, functionName: 'expiresAt', args: [wallet] });
  return Number(expiry);
}

export function formatPassCountdown(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, Math.floor(Number(expiresAt) - now / 1000));
  if (!remaining) return 'Pass expired';
  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  return days ? `${days}d ${String(hours).padStart(2, '0')}h left` : `${hours}h ${String(minutes).padStart(2, '0')}m left`;
}

async function switchToBase(provider) {
  if (!provider?.request) throw new Error('Open Castonaut in a browser with a compatible wallet to buy a pass.');
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (Number.parseInt(chainId, 16) === BASE_CHAIN_ID) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }] });
  }
}

export async function connectPassWallet(provider) {
  await switchToBase(provider);
  const [wallet] = await provider.request({ method: 'eth_requestAccounts' });
  if (!isAddress(wallet)) throw new Error('The wallet did not return a valid account.');
  return wallet;
}

export async function purchasePass(provider, contractAddress, onStage = () => {}) {
  if (!isConfiguredPassAddress(contractAddress)) throw new Error('The Castonaut Time Pass contract has not been configured.');
  const account = await connectPassWallet(provider);
  const walletClient = createWalletClient({ account, chain: base, transport: custom(provider) });
  const balance = await baseReader.readContract({ address: BASE_USDC_ADDRESS, abi: USDC_ABI, functionName: 'balanceOf', args: [account] });
  if (balance < PASS_PRICE) throw new Error('This wallet needs at least 3.70 USDC on Base, plus a little ETH for network fees.');
  const allowance = await baseReader.readContract({ address: BASE_USDC_ADDRESS, abi: USDC_ABI, functionName: 'allowance', args: [account, contractAddress] });
  if (allowance < PASS_PRICE) {
    onStage('approve');
    const approval = await walletClient.writeContract({ address: BASE_USDC_ADDRESS, abi: USDC_ABI, functionName: 'approve', args: [contractAddress, PASS_PRICE] });
    await baseReader.waitForTransactionReceipt({ hash: approval });
  }
  onStage('purchase');
  const hash = await walletClient.writeContract({ address: contractAddress, abi: PASS_ABI, functionName: 'buyPass' });
  await baseReader.waitForTransactionReceipt({ hash });
  return { wallet: account, hash, expiresAt: await readPassExpiry(account, contractAddress) };
}
