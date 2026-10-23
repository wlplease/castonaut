/**
 * Read a phrase from its field, normalize it, and immediately clear the DOM
 * control before any async work begins. This reduces accidental exposure in
 * screenshots, browser autofill, and later user interactions. The application
 * does not retain the field value after this function returns; JavaScript
 * engines cannot guarantee memory zeroization.
 */
export function takeRecoveryPhrase(field) {
  const phrase = String(field?.value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (field) field.value = '';
  return phrase;
}

export function isSupportedRecoveryPhraseLength(phrase) {
  const count = String(phrase || '').split(' ').filter(Boolean).length;
  return [12, 15, 18, 21, 24].includes(count);
}

/**
 * Farcaster recovery phrases may correspond to one of several standard EVM
 * account slots. Derive the small legacy range used by the previous sign-in
 * flow so users do not have to understand or pick an account index.
 */
export function deriveRecoveryAccountCandidates(phrase, mnemonicToAccount, maxAccountIndex = 4) {
  return Array.from({ length: maxAccountIndex + 1 }, (_, accountIndex) => ({
    accountIndex,
    account: mnemonicToAccount(phrase, { accountIndex }),
  }));
}

export async function findRegisteredRecoveryAccount(candidates, lookupFid) {
  const lookups = await Promise.allSettled(candidates.map(({ account }) => lookupFid(account)));
  const matchedIndex = lookups.findIndex((result) => result.status === 'fulfilled' && BigInt(result.value || 0) > 0n);
  if (matchedIndex >= 0) return { ...candidates[matchedIndex], fid: lookups[matchedIndex].value };
  if (lookups.some((result) => result.status === 'rejected')) {
    throw new Error('Could not reach the Optimism account registry. Check your connection or try a linked wallet.');
  }
  throw new Error('No Farcaster account was found for this phrase. Check the words or use a linked wallet.');
}



