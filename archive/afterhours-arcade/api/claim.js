import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createPublicClient, decodeEventLog, http, parseAbiItem, verifyMessage, zeroAddress } from 'viem';
import { base } from 'viem/chains';

const purchaseEvent = parseAbiItem('event QuarterPurchased(address indexed buyer, uint256 quarters, address indexed currency, uint256 amountPaid)');
const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const isAddress = value => /^0x[a-fA-F0-9]{40}$/.test(value || '');
const isHash = value => /^0x[a-fA-F0-9]{64}$/.test(value || '');

function getFirebase() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('Firebase service account is not configured');
    const account = JSON.parse(raw);
    initializeApp({ credential: cert(account) });
  }
  return { auth: getAuth(), db: getFirestore() };
}

function error(res, status, message) { return res.status(status).json({ error: message }); }

export default async function handler(req, res) {
  if (req.method !== 'POST') return error(res, 405, 'Use POST');
  const contract = process.env.ARCADE_CONTRACT?.trim();
  if (!isAddress(contract)) return error(res, 503, 'Arcade contract is not configured');
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return error(res, 400, 'Invalid JSON'); }
  const { hash, signature } = body;
  if (!isHash(hash) || !/^0x[a-fA-F0-9]{130}$/.test(signature || '')) return error(res, 400, 'Invalid transaction proof');

  try {
    const { auth, db } = getFirebase();
    const bearer = req.headers.authorization || '';
    if (!bearer.startsWith('Bearer ')) return error(res, 401, 'Sign in to claim quarters');
    const account = await auth.verifyIdToken(bearer.slice(7));
    const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org') });
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== 'success' || receipt.to?.toLowerCase() !== contract.toLowerCase()) return error(res, 400, 'Not an arcade contract purchase');

    const purchases = receipt.logs.filter(log => log.address.toLowerCase() === contract.toLowerCase()).flatMap(log => {
      try { return [decodeEventLog({ abi: [purchaseEvent], data: log.data, topics: log.topics })]; }
      catch { return []; }
    });
    if (purchases.length !== 1) return error(res, 400, 'Purchase event was not found');
    const { buyer, quarters, currency, amountPaid } = purchases[0].args;
    const validCurrency = currency.toLowerCase() === usdc.toLowerCase() || currency.toLowerCase() === zeroAddress;
    if (!validCurrency || quarters < 1n || quarters > 100n || amountPaid <= 0n) return error(res, 400, 'Invalid purchase event');

    const message = `Afterhours Arcade quarter claim\nFirebase UID: ${account.uid}\nTransaction: ${hash.toLowerCase()}\nChain: 8453`;
    const ownsWallet = await verifyMessage({ address: buyer, message, signature });
    if (!ownsWallet) return error(res, 403, 'Wallet signature does not match the buyer');

    const claimRef = db.collection('arcadeClaims').doc(hash.toLowerCase());
    const balanceRef = db.collection('arcadeBalances').doc(account.uid);
    const credited = await db.runTransaction(async transaction => {
      const [claim, balance] = await Promise.all([transaction.get(claimRef), transaction.get(balanceRef)]);
      if (claim.exists) return claim.data().uid === account.uid ? { quarters: balance.exists ? balance.data().quarters : 0, added: 0 } : null;
      const next = (balance.exists ? balance.data().quarters : 0) + Number(quarters);
      transaction.create(claimRef, { uid: account.uid, buyer: buyer.toLowerCase(), hash: hash.toLowerCase(), quarters: Number(quarters), currency: currency.toLowerCase(), createdAt: new Date() });
      transaction.set(balanceRef, { quarters: next, updatedAt: new Date() }, { merge: true });
      return { quarters: next, added: Number(quarters) };
    });
    if (credited === null) return error(res, 409, 'This purchase was already claimed');
    return res.status(200).json(credited);
  } catch (cause) {
    console.error('Quarter claim failed', cause);
    return error(res, 500, 'Could not verify this purchase yet');
  }
}
