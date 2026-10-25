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

Public feed/profile reads also use a bounded device cache (up to 32 responses, 1 MB each) in IndexedDB, with short route-specific expiry. It excludes signer records and keys; accepted writes clear it. Hosted read responses can use a brief Vercel edge cache so repeated public queries do less work on the Snapchain VM. Browser responses remain `no-store`; use Refresh when you need a fresh read.

## Get started

Open the [client](https://castonaut.vercel.app/). Reading the sample preview does not require an account. To post, follow, or personalize the Desk, sign in with an existing Farcaster account that has storage.

The client supports two sign-in paths. The existing browser-key path checks your recovery phrase in the tab, clears the field, then asks you to authorize a limited key kept in this browser. The optional Neynar managed-signer path lets you approve Castonaut in a Farcaster client without entering your phrase here; once enabled, it routes social writes through Castonaut’s server and Neynar. Both paths use revocable social signers, and neither grants access to funds or account custody. “Forget this browser” signs out or deletes the local key; revoke the Farcaster signer separately in account settings.

### Optional Neynar managed sign-in

This path is off until the operator configures it. Create a Neynar API key and set these values as **server-only** environment variables in Vercel (or in `.env.local` for local development):

```text
NEYNAR_API_KEY=...
CASTONAUT_APP_FID=...
CASTONAUT_APP_PRIVATE_KEY=0x...
CASTONAUT_SESSION_SECRET=...
```

`CASTONAUT_APP_FID` and `CASTONAUT_APP_PRIVATE_KEY` must belong to the Castonaut developer Farcaster account. The private key signs managed-signer authorization requests; it must never be exposed to browser code or committed. Generate a unique session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Never use a `VITE_` prefix for any of these values. After setting the values, restart local Vite or redeploy through the operator’s normal release process. The connect dialog checks server configuration and only shows managed sign-in when the endpoint is ready.

Managed sessions expire after seven days. In production, the session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, and host-only; changing `CASTONAUT_SESSION_SECRET` logs out existing managed sessions. The API checks the approved signer before every write and accepts only the Castonaut actions listed above. Keep the hosting account and its environment-variable access limited to trusted operators. The built-in request limits are per server process; for high traffic, add a shared edge or Redis rate limiter to protect the Neynar API key across serverless instances.

Neynar’s managed signer approval authorizes social actions in the Farcaster app. The Castonaut server keeps only an HTTP-only signed session and signer identifier; it never receives the user’s recovery phrase or the signer’s private key. Managed writes use Neynar’s APIs for casts, replies, follows, likes, and recasts. Reads and confirmation indicators still come from the configured Snapchain node, so a delayed node can take time to display a newly accepted write. See [Neynar’s managed signer guide](https://docs.neynar.com/docs/integrate-managed-signers).

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
