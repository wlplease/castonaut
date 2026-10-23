# Castonaut

**Live client:** [castonaut.vercel.app](https://castonaut.vercel.app/) · **Source:** [github.com/wlplease/castonaut](https://github.com/wlplease/castonaut)

A Farcaster feed in time order, with a personal Desk for people and posts you want to find again. Running your own Snapchain read node is optional for using the hosted client.

## What you can do

- Read Following, Friends, or a device-only Crew feed.
- Pin people, posts, and topics to your Desk; save posts for later.
- Find public profiles, open conversations, and filter posts by replies, media, links, and source.
- Write short or long casts up to Farcaster’s 1,024-byte protocol limit, start threads, attach media, or use shared GIPHY search (the operator configures it once; users need no key).
- Save a local page of the current feed to revisit later.

The Desk, saved posts, drafts, filters, and feed preferences stay in this browser. They are not synced between devices. Export a backup from the Desk before clearing site data.

## Get started

Open the [client](https://castonaut.vercel.app/). Reading the sample preview does not require an account. To post, follow, or personalize the Desk, sign in with an existing Farcaster account that has storage.

A linked wallet is the safest sign-in path because the recovery phrase stays out of the page. Phrase sign-in is available for an existing account: the page code can read the phrase while you enter it, so use it only on a site and device you trust. Castonaut checks the first five standard account slots automatically, finds the one linked to your Farcaster ID, clears the input, then asks you to authorize a limited app key. There is no account-index dropdown. The phrase is not saved or sent to Castonaut’s server. The app key stays in this browser; “Forget this browser” deletes the local key, while revoking the protocol signer must be done separately in Farcaster account settings. The approval screen names Castonaut and lists its permissions. Farcaster’s own signer label may remain generic until Castonaut has a registered app FID and custody-signed app-request metadata.

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

- **Contest build:** the core client does not require third-party data API keys. Optional GIF search uses an operator-configured GIPHY key and shared Redis cooldown behind a server-side route; users never enter or receive keys. Feed, profile, follow, post, reaction, and direct media-link features do not depend on GIF search.

## Deployment notes

Vercel serves the static app and its small server-side Snapchain proxy. Set `SNAPCHAIN_URL` as a server environment variable. Castonaut is currently free to use; no payment contract or purchase configuration is required. Verify the node is synced and reachable before inviting people to test. The node is public and can be contacted directly; the proxy’s per-instance rate limits are best-effort, not abuse-proof protection.

GIF search reads the existing Vercel `GIPHY_APP` secret (with `GIPHY_API_KEY` as a compatibility alias) plus `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Users never provide or receive these values. Both credentials stay server-side. The server validates each search, uses an atomic Redis cooldown to allow one search per minute across the deployment, and returns only a small set of GIF fields. It fails closed if Redis is missing or unavailable. Direct media URLs continue to work without these settings.

The [setup guide](https://castonaut.vercel.app/tutorial.html) covers node operation, the message path, account security, source filters, and a repeatable test checklist. The [Privacy Notice](privacy.html) and [Terms of Use](terms.html) describe data handling and service providers. Complete the operator contact and jurisdiction fields before public launch.

## License

MIT. See [LICENSE](LICENSE).
