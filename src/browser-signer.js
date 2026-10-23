const ED25519_SIGNATURE_SCHEME = 1;

function hubOk(value) { return { value, isErr: () => false }; }

/** WebCrypto-backed Farcaster Ed25519 signer for this browser's local app key. */
export class BrowserEd25519Signer {
  constructor(privateKey, publicKey) {
    this.privateKey = privateKey;
    this.publicKey = new Uint8Array(publicKey);
    // @farcaster/core's message builders copy signer.scheme into the envelope.
    // Without this, protobuf encodes SIGNATURE_SCHEME_NONE and Snapchain rejects it.
    this.scheme = ED25519_SIGNATURE_SCHEME;
  }

  async getSignerKey() { return hubOk(this.publicKey); }

  async signMessageHash(hash) {
    try { return hubOk(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, this.privateKey, hash))); }
    catch (error) { return { error, isErr: () => true }; }
  }
}
