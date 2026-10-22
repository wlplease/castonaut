# Castonaut

The app’s visual direction, theme rules, soundtrack asset path, and ready-to-use Suno prompt are in [BRAND_GUIDE.md](BRAND_GUIDE.md).

The user-facing [Privacy Notice](privacy.html) and [Terms of Use](terms.html) describe the current client behavior and its service providers. Before public launch, the operator must fill in a real legal identity, privacy/security contact, and governing jurisdiction in both pages and have the terms reviewed for the launch location.

Castonaut is an independent Farcaster client with a warm, analog waystation feel. Signals is chronological and groups repeated links; Your Desk keeps pinned people, selected signals, and topics close; Flight Log saves posts on this device. **Time Capsule** stores a replayable snapshot of up to 30 visible posts per day, locally. Find people by username or FID, share profile and conversation links, and open replies in context without losing the reading surface. Follow, like, and recast controls toggle against the connected account’s current Snapchain state. Save a signal to the Desk in one tap; use the overflow menu for less frequent actions. The composer includes an optional GIPHY search, a quick emoji palette, and direct HTTPS media links. GIPHY search is user-triggered and requires a public GIPHY API key at build time; remote cast previews stay off until enabled. Export or restore a versioned local backup for your Desk, Flight Log, capsules, and appearance/feed preferences. Backup files never include signers, wallet details, drafts, or recovery phrases. The paid build can offer an optional wallet-linked **Time Pass** for $3.70 native USDC on Base and 30 days of access. The contest/tutorial build has free entry so an independent tester can complete the client walkthrough. Users do not need cloud setup, API keys, or a personal node.

## Use Castonaut

For the contest, use a dedicated Farcaster test account that you control and that already has storage. Choose **Sign in to Farcaster** and prefer that account’s linked-wallet signature for its scoped app key. Never enter a primary account’s recovery phrase in a build you have not reviewed: website code can read the phrase while it is entered. If you use a test account’s phrase, Castonaut derives the selected Ethereum account index (0–4, default 0) in this tab, checks its FID through the Optimism ID Registry, and clears the field before showing the result. Select the same account number used when the custody wallet was created. Review the FID and custody address, then explicitly authorize a limited signer. The phrase and derived custody key stay in memory in this tab and are never saved or sent to Castonaut’s server. App-key authorization is gasless and does not require an Optimism transaction. In contest mode, the confirmed app key opens the feed without payment. Paid builds may instead require the optional Base Time Pass: $3.70 in native USDC for 30 days, no automatic renewal, plus a little Base ETH for gas. The pass follows the payment wallet, not the Farcaster FID. Castonaut saves only the separate limited social app key and, in paid mode, the public payment-wallet address in this browser. Private browsing, clearing site data, or changing browsers may require signing in again. Pin people, a signal, or a topic from a post’s **•••** menu; save posts to Flight Log, or add a device-only nickname and note. **Orbit Lens** filters a feed to people pinned on your Desk. **Orbit Pulse** counts activity and recurring topics only among posts already loaded. **Time Capsule** stores a daily snapshot of up to 30 visible posts locally. These local features send no profile notes or capsules to the server. Anyone with access to this browser profile may see its local data.

After the station opens, post, reply, follow, like, or recast with the connected account. The custody account signs a gasless, scoped app-key authorization on Optimism. It is a message signature, not a transaction, and it does not grant token transfers. The phrase is a powerful account secret: only enter it on a site whose code and operator you trust. A linked wallet can sign the same authorization without exposing the phrase to the webpage.

If a normal post times out before Snapchain confirms it, Castonaut saves that exact signed post in the account’s local composer draft. **Resume saved post** first checks whether the same hash is already in Snapchain, then relays the same signed message only if it is still missing. This avoids asking the signer to create a second post for an uncertain first attempt. The outbox is local to this browser and excluded from backup files; it contains the signed public post, not the private app key. Treat browser profile data as private, and do not discard an unconfirmed post unless you accept the possibility that it already reached the network.

## Time Pass contract

The contest/tutorial build is free to enter. `npm run client -- --zone us-central1-a` looks up your VM's public IP in the active Google Cloud project and starts the local client. For a hosted contest build, set `VITE_CONTEST_ACCESS=true` in the build environment so testers do not need to pay. A normal preview also stays free until a valid, deployed Time Pass contract address is configured; a missing checkout setup never blocks someone from trying Castonaut. The optional paid build uses a **3.70 native USDC Time Pass on Base for 30 days**, paid once with no auto-renewal. The expiry belongs to the payer's wallet, is visible on-chain, and early renewal adds 30 days. This is a wallet entitlement, not a Farcaster FID entitlement. Visitors need a compatible wallet, 3.70 USDC on Base, and a little Base ETH for gas. The current flow requests an exact 3.70 USDC approval, then a separate purchase transaction. It never asks for a recovery phrase or unlimited token approval.

The source is [contracts/CastonautTimePass.sol](contracts/CastonautTimePass.sol). In Remix, use Solidity 0.8.24, compile this file, select **Base Mainnet**, deploy with the revenue wallet address as the constructor argument, and verify the source on BaseScan. The contract is deliberately small and has no admin or upgrade controls; it has not had an independent audit. Do not invite users to pay until you have reviewed and verified the deployed source, filled in the operator/support identity in the legal pages, and configured the address below.

For a paid build, set `VITE_PASS_CONTRACT_ADDRESS` to the deployed address and leave `VITE_CONTEST_ACCESS` unset or `false`, then redeploy. The address is public, not a secret. The client checks `expiresAt(wallet)` on Base and only opens the feed while that wallet's pass is active. Without a configured contract, the preview remains free and the app labels the pass as planned; for a free contest build, set `VITE_CONTEST_ACCESS=true`. Contest access is a client access mode, not an access-control boundary for the public Snapchain protocol. The Base public RPC sees pass-status queries and wallet addresses; payment details are public chain data. The native USDC address is published by [Circle](https://www.circle.com/multi-chain-usdc/base).

`Time Capsule` keeps the current filtered feed window on this device, up to 30 visible posts per day and 14 days of snapshots. The composer can search GIPHY after an explicit query, choose a GIF, or attach a direct HTTPS media URL. Castonaut does not upload media. GIF search needs the public `VITE_GIPHY_API_KEY` build-time setting because GIPHY requires search requests from the client; the key is visible in the app bundle and is not a secret. Without a key, direct URL attachment and every other feature remain available. Search thumbnails load from GIPHY only after a search, while attached cast previews remain off until the user enables remote media in View options. See the [Privacy Notice](privacy.html) for provider details.

## Develop the client

Contributors need Node.js 22. The local preview needs the app team's shared Snapchain endpoint configured server-side.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5175`. Set `SNAPCHAIN_URL` in a root `.env` file or the local server environment before using feeds; the Vite adapter proxies requests so the browser does not contact Snapchain directly. For Vercel, set `SNAPCHAIN_URL` in the project's server-side environment settings and deploy. Never put node credentials in browser variables. Optional proxy credentials belong in `SNAPCHAIN_HTTP_USER` and `SNAPCHAIN_HTTP_PASS`.

The app’s social desk stays closed until the account proves control of an existing FID and Snapchain confirms the app key. Castonaut creates an Ed25519 app key in the browser and requests a scoped, gasless `KEY_ADD`; either the recovery phrase-derived custody signer or a linked wallet can authorize it. Phrase entry is available in hosted builds. The client derives the selected Ethereum account index (0–4, default 0) in the tab, clears the field before the network lookup, and does not save or send the phrase or custody private key. The separate app key is saved as non-extractable Web Crypto key material in this browser’s IndexedDB; the server never receives it. Website code, a malicious extension, or a compromised device could still read a phrase while it is entered or cause social actions, so users should enter it only when they trust the exact site and its source. The app key can post, delete its posts, follow/unfollow, like/unlike, and recast/unrecast. Its 30-day sliding expiry can refresh with use, so an active key may stay valid; revoke it from the account's signer controls to disable it sooner. It cannot move tokens or change account custody. **Forget this browser** deletes the local app key and returns to the sign-in gate, but does not revoke the protocol signer. Successful relay is shown as pending until a read confirms the message in Snapchain.

Recovery phrase and linked-wallet sign-in are available in hosted builds. Phrase entry is convenient but exposes the phrase to the page code while in use; a linked wallet avoids that exposure. Review the source and site before using phrase sign-in, and review each wallet prompt when using a wallet. Local-node mode sends requests from the computer running the local client, so that node can see that computer’s public egress IP. Hosted mode sends app requests from Vercel instead. Remote avatars and cast images are off by default. If someone enables them in Feed filters, the browser fetches HTTPS images directly from the Farcaster-recorded hosts; those hosts can see the viewer’s IP, and Castonaut sends no referrer.

Production builds include Vercel Web Analytics, but the client sends no page-view events until a visitor explicitly opts in under About → Local by default. The integration removes query strings and URL fragments before sending page views and sends no custom events. It does not send recovery phrases, feed text, FIDs, wallet addresses, or device-local notes to analytics. The choice is stored locally on that device. Local development builds do not inject analytics. See the [Privacy Notice](privacy.html) for the data paths, provider disclosures, image controls, and local retention details.

The app includes an optional, user-triggered Gemini catch-up for up to 20 visible posts. It sends only the selected post text through `/api/digest`; the browser never receives the Gemini API key, and the model cannot access tools or perform account actions. This is a convenience feature, not a private or confidential summarizer. Configure the server-only `GEMINI_API_KEY` on Vercel to enable it; set `GEMINI_MODEL` only when you need a different supported model. Without a key, feed, posting, and all other client features continue to work. GIPHY Search is different: its official API requires direct client requests, so its provider key must be embedded as `VITE_GIPHY_API_KEY`. Treat it as public, configure usage limits in GIPHY, and never reuse a secret credential for this variable. GIPHY beta keys are currently limited to 100 API calls per hour. Review the [Privacy Notice](privacy.html) before enabling provider features.

## Optional: run a personal test node

Most people can skip this. The [builder guide](tutorial.html) explains the architecture, costs, account concepts, security boundaries, and a three-command Google Cloud path. Its local client command is for people testing their own node:

The project has a **$25 monthly alert budget** with 50%, 80%, and 100% thresholds. It tracks gross usage before credits and emails billing admins/users; it is a warning, not a spending cap. The Google Cloud free trial applies eligible usage to its credit; it does not charge the payment method during the trial. Check the current remaining credit in Billing before starting the node. The test VM and its 2-TB data disk are estimated around $0.25/hour, about $42 for seven days, before network and IP charges. **Stopping the VM stops compute charges, but the disk remains billable at roughly $82/month until deleted.** Keep the project on trial, use the node only for a planned test, and delete the resources after the test if preserving credits matters. Google stops trial resources when the trial ends; do not upgrade to paid billing for this contest setup.

```sh
npm run provision -- us-central1-a
npm run node -- us-central1-a
npm run client -- --zone us-central1-a
```

When the test is over, remove the VM, its dedicated data disk, and the contest firewall rule:

```sh
npm run destroy -- us-central1-a
```

The cleanup script prints the active account/project and the resources, then waits for `DELETE`. Removing the node also removes its local database; a later test must sync again.

Provisioning checks the active `gcloud` identity, project, and billing state. It prints an estimate and requires the word `CREATE` before making billable resources. The example configures a 4-vCPU, 16-GB VM and a 2-TB persistent disk, matching Snapchain's current run-node guide. Actual price and trial coverage depend on account, region, network usage, and current provider rates.

The first historical snapshot can take several hours. Check readiness with `npm run node:check -- us-central1-a`. The command checks `/v1/info` inside the VM, checks the public HTTP endpoint from your computer, reports the maximum active-shard delay, and exits unsuccessfully until every check is ready. A running process or responding API is not a synced node. Readiness requires a maximum shard delay of 10 seconds or less and a reachable public endpoint. Run `npm run node:status:once -- us-central1-a` for a single read-only status snapshot, including each shard's height/delay, peer mesh, mounted data-disk usage, and container CPU/memory/I/O; run `npm run node:status` to keep polling every 60 seconds. Docker's `BLOCK I/O` value is cumulative container I/O, not disk space used; use the reported `Data disk` line for storage occupancy. This check only proves read-node availability; run the account read/write verification separately before asking anyone to test the public client.

Keep a bounded test window while the node catches up. The current machine has a 2-TB persistent disk, so it keeps charging while the VM is stopped. Check the free-trial balance and end date in Cloud Billing before each extension; the $25 project budget sends alerts and cannot enforce a $200 cap. Do not upgrade billing to continue the sync. If the approved credit is nearly exhausted, stop the VM and decide whether to delete the disk too; deleting it removes the saved database and a later run must sync again.

## Deploy to Vercel

Import the repository with the root directory selected. For the free contest client set `VITE_CONTEST_ACCESS=true` as a Vercel build environment variable. Set `SNAPCHAIN_URL` to the node’s HTTP origin as a server-side environment variable, then deploy and verify `/api/snapchain?route=info` plus a current-feed read. Do not deploy a contest build against a node that fails `npm run node:check -- us-central1-a`. To enable the optional Gemini digest, add `GEMINI_API_KEY` as an encrypted server-side Vercel environment variable (never use `VITE_`), then redeploy; `GEMINI_MODEL` is optional. To enable GIF search, set `VITE_GIPHY_API_KEY` to a dedicated GIPHY web API key in the build environment. GIPHY requires client-side search; this key is public in the built JavaScript and must not be a secret or reused elsewhere. Never add node credentials or secret provider credentials to `VITE_*` variables or browser code. The node’s public HTTP port can still be queried directly, and Vercel and the wallet provider see normal request metadata. Vercel Hobby has plan and use limits; check the current plan terms before a public or commercial launch.

The API allows only specific Snapchain routes and parameter shapes, limits request and response sizes, rejects cross-origin writes and upstream redirects, and adds best-effort per-instance rate limits. Signer-status checks, used during sign-in, have a tighter limit of 12 requests per minute per client address. These in-memory limits are not shared across function instances or deployments. Those limits are not global abuse protection. The node's public HTTP port can be called directly, bypassing the Vercel proxy and its limits; protocol signatures still have to validate, but this is not private or abuse-proof infrastructure. The Vercel-to-node URL is plain HTTP in the current Google setup. Use this setup for a monitored contest pilot; before broad public use, put the node behind a TLS endpoint with enforceable ingress and shared rate limits, then point `SNAPCHAIN_URL` at that endpoint.

## Development

```sh
npm ci
npm run build
npm run dev
```

`npm run dev` serves the UI on Vite's printed local URL. The `npm run client -- --zone us-central1-a` command looks up `castonaut-snapchain` in the active Google Cloud project and supplies its public node URL to the local server-side adapter. No IP copy/paste or third-party read API credential is needed.

## Install on a phone or desktop

Castonaut includes a web app manifest and matching browser, iPhone/iPad, Android, and installable app icons. After deploying to an HTTPS URL, users can install it from their browser: on iPhone or iPad, open Castonaut in Safari and choose **Share → Add to Home Screen**; on Android, open it in Chrome and choose **Install app** or **Add to Home screen**. On desktop, use the browser's install icon or menu when available. The app still needs an internet connection to load Farcaster data; installation does not make the network feed available offline. The social preview image is `public/og-castonaut.png`; once the production domain is known, use its full HTTPS URL for the `og:image` and `twitter:image` metadata if a sharing platform does not resolve the root-relative image path.

## Protocol and product limits

- An FID identifies a Farcaster account; it is not a secret.
- The custody address controls signer authorization. An existing account needs protocol storage to publish.
- A read node follows the network and serves APIs. It can accept signed messages and relay them to validators; it does not itself validate or propose blocks.
- A successful relay response does not prove the network merged the message. Castonaut checks the message again through the service before reporting confirmation.
- Source filtering works only when Snapchain exposes requester attribution for the signer. Unknown sources remain labeled unknown.
- This client cannot reverse a protocol or application ban, guarantee account access, or promise future compatibility with protocol changes.

Read the [Snapchain node docs](https://snapchain.farcaster.xyz/node-types), [message-writing guide](https://snapchain.farcaster.xyz/guides/writing-messages), [HTTP API reference](https://snapchain.farcaster.xyz/reference/httpapi/httpapi), and [username-proof API](https://snapchain.farcaster.xyz/reference/httpapi/usernameproof). Snapchain releases and operational requirements change; verify them before provisioning.

## License

MIT. See [LICENSE](LICENSE).
# Optional station voices

Castonaut can include three short, pre-generated welcome clips. Create a local `.env` from `.env.example`, then add your ElevenLabs API key and three voice IDs from your account (`ELEVENLABS_VOICE_MAE`, `ELEVENLABS_VOICE_QUINN`, and `ELEVENLABS_VOICE_JULES`). Run `npm run audio:generate`; it writes static MP3 files under `public/audio/`. The app plays those files directly, so the key never reaches a browser or deployment. If the clips have not been generated yet, the welcome player uses the browser's built-in speech synthesis.

The three clips use the same short welcome script. Choose voices you have permission to use. Rotate any API key that has been shared outside your private account, and keep `.env` out of Git.
