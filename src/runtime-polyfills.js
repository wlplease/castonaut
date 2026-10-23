import { Buffer as BrowserBuffer } from 'buffer';

// @farcaster/core uses Buffer in a few validation helpers that run in browsers.
globalThis.Buffer ??= BrowserBuffer;
