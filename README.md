# Castonaut

**Live client:** [castonaut.vercel.app](https://castonaut.vercel.app/) · **Source:** [github.com/wlplease/castonaut](https://github.com/wlplease/castonaut)

A Farcaster feed in time order, with a personal Desk for people and posts you want to find again. Running your own Snapchain read node is optional for using the hosted client.

## What you can do

- Read Following, Friends, or a device-only Crew feed.
- Pin people, posts, and topics to your Desk; save posts for later.
- Find public profiles, open conversations, and filter posts by replies, media, links, and source.
- Write casts and threads, attach image or GIF links, and use an optional GIPHY search.
- Save a local page of the current feed to revisit later.

The Desk, saved posts, drafts, filters, and feed preferences stay in this browser. They are not synced between devices. Export a backup from the Desk before clearing site data.

## Get started

Open the [client](https://castonaut.vercel.app/). Reading the sample preview does not require an account. To post, follow, or personalize the Desk, sign in with an existing Farcaster account that has storage.

A linked wallet is the safest sign-in path because the recovery phrase stays out of the page. Phrase sign-in is available for an existing account: the page code can read the phrase while you enter it, so use it only on a site and device you trust. Castonaut checks the first five standard account slots automatically, finds the one linked to your Farcaster ID, clears the input, then asks you to authorize a limited app key. There is no account-index dropdown. The phrase is not saved or sent to Castonaut’s server. The app key stays in this browser; “Forget this browser” deletes the local key, while revoking the protocol signer must be done separately in Farcaster account settings.

## Run locally

Requires Node.js 22. For a UI preview:

```sh
npm ci
npm run dev
```

Local preview uses Castonaut’s hosted Snapchain proxy by default, so the node sees Vercel’s server instead of your home IP. To point local development directly at your own node, set server-only `SNAPCHAIN_URL` in a root `.env`; then requests come from your computer and the node can see its public IP. Never use a `VITE_` prefix for a node URL or credential. See the [quickstart](https://castonaut.vercel.app/tutorial.html#quickstart) for the Google Cloud node setup, commands, costs, readiness checks, and cleanup steps.

```sh
npm test
npm run build
```

## Optional services

- **GIF search:** set `VITE_GIPHY_API_KEY` at build time. GIPHY requires browser-side requests, so this key is public in the built app. Use a dedicated key with provider-side limits. Direct HTTPS media links work without it.
- **Catch-up digest:** set the server-only `GEMINI_API_KEY`. The user starts each summary; only up to 20 visible post texts are sent to the provider. The feature cannot post or take account actions.
- **30-day pass:** the optional paid build uses a one-time **$3.70 USDC on Base** pass with no auto-renewal. Checkout remains disabled until the contract is deployed, reviewed, and configured with `VITE_PASS_CONTRACT_ADDRESS`. Never enable payment before the operator and support details in the legal pages are complete.

## Deployment notes

Vercel serves the static app and its small server-side Snapchain proxy. Set `SNAPCHAIN_URL` as a server environment variable. For a free contest build, set `VITE_CONTEST_ACCESS=true`; this keeps client access open while the pass contract is unavailable. Verify the node is synced and reachable before inviting people to test. The node is public and can be contacted directly; the proxy’s per-instance rate limits are best-effort, not abuse-proof protection.

The [setup guide](https://castonaut.vercel.app/tutorial.html) covers node operation, the message path, account security, source filters, and a repeatable test checklist. The [Privacy Notice](privacy.html) and [Terms of Use](terms.html) describe data handling and service providers. Complete the operator contact and jurisdiction fields before public launch.

## License

MIT. See [LICENSE](LICENSE).
