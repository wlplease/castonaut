# Castonaut

Castonaut is a working name for an independent Farcaster client with a warm, analog waystation feel. Signals shows the following feed in time order, Orbit keeps pinned people close, and Flight Log saves posts privately in this browser. Sign in with the wallet already linked to your Farcaster account; the app verifies that identity, confirms a limited browser key, and opens the same account’s feed and posting tools together. There is no username-based or guest feed path. The app team configures the shared feed service; users do not need cloud setup, API keys, or a personal node.

## Use Castonaut

Open the hosted app and choose **Connect account & launch**. Connect the wallet already linked to your Farcaster account. Castonaut reads the account’s FID from the Optimism ID Registry, then asks that custody wallet to authorize the app’s limited signer. After Snapchain confirms the signer, the account’s following feed and posting tools open together. Pin people in Orbit, save posts to Flight Log, or add a device-only nickname and note. **Mission Brief** counts only the posts loaded in the current view. These local features make no AI request and send no profile notes to the server. Flight Log entries are stored per FID in this browser; anyone with access to the browser profile may see them.

After the station opens, post, reply, follow, like, or recast with the connected account. The wallet signs a gasless, scoped app-key authorization on Optimism. It is a message signature, not a transaction, and it does not grant token transfers. Wallet connection is the recommended sign-in. An advanced local phrase-import path exists for disposable test accounts only; never use it with an account holding funds. The phrase is not saved or sent by Castonaut, but the website code handles it in the browser, so only use a build whose source you trust.

## Develop the client

Contributors need Node.js 22. The local preview needs the app team's shared Snapchain endpoint configured server-side.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5175`. Set `SNAPCHAIN_URL` in a root `.env` file or the local server environment before using feeds; the Vite adapter proxies requests so the browser does not contact Snapchain directly. For Vercel, set `SNAPCHAIN_URL` in the project's server-side environment settings and deploy. Never put node credentials in browser variables. Optional proxy credentials belong in `SNAPCHAIN_HTTP_USER` and `SNAPCHAIN_HTTP_PASS`.

The app’s social desk stays closed until the account proves control of an existing FID and Snapchain confirms the app key. Castonaut creates an Ed25519 app key in the browser and requests a scoped, gasless `KEY_ADD`; the recommended wallet path asks the linked custody wallet to authorize it. The advanced phrase path derives that custody signer in this tab for a test account, then clears the input. Neither the phrase nor custody private key is sent to the server or saved by Castonaut. The separate app key is saved as non-extractable Web Crypto key material in this browser’s IndexedDB; the server never receives it. A compromised page, malicious extension, or device could still read a phrase while it is entered or cause social actions, so do not use a valuable account with phrase import. The app key can post, delete its posts, follow/unfollow, like/unlike, and recast/unrecast. Its 30-day sliding expiry can refresh with use, so an active key may stay valid; revoke it from the account's signer controls to disable it sooner. It cannot move tokens or change account custody. **Forget this browser** deletes the local app key and returns to the sign-in gate, but does not revoke the protocol signer. Successful relay is shown as pending until a read confirms the message in Snapchain.

Wallet sign-in is recommended. The optional phrase importer is only for disposable test accounts: while entered, the website code can read the phrase even though Castonaut does not save it or include it in a request. Never enter a valuable account’s phrase into any website. Connect only through a wallet you trust and review each wallet prompt. Local-node mode sends requests from the computer running the local client, so that node can see that computer’s public egress IP. Hosted mode sends app requests from Vercel instead. Remote avatars and cast images are off by default. If someone enables them in Feed filters, the browser fetches HTTPS images directly from the Farcaster-recorded hosts; those hosts can see the viewer’s IP, and Castonaut sends no referrer.

Plus is a post-contest idea, not a current checkout: a one-time prepaid 30-day pass around $1 could unlock extra Desk layouts, saved views, and themes. It should never auto-renew or gate basic reading and social actions. On-device AI summaries may be worth testing as an optional Plus feature later, but only after an explicit model download and device compatibility check; the regular client will not need a model.

## Optional: run a personal test node

Most people can skip this. The [builder guide](tutorial.html) explains the architecture, costs, account concepts, security boundaries, and a three-command Google Cloud path. Its local client command is for people testing their own node:

The project has a **$25 monthly alert budget** with 50%, 80%, and 100% thresholds. It tracks gross usage before credits and emails billing admins/users; it is a warning, not a spending cap. The Google Cloud free trial applies eligible usage to its credit; it does not charge the payment method during the trial. Check the current remaining credit in Billing before starting the node. The test VM and its 2-TB data disk are estimated around $0.25/hour, about $42 for seven days, before network and IP charges. **Stopping the VM stops compute charges, but the disk remains billable at roughly $82/month until deleted.** Keep the project on trial, use the node only for a planned test, and delete the resources after the test if preserving credits matters. Google stops trial resources when the trial ends; do not upgrade to paid billing for this contest setup.

```sh
npm run provision -- us-central1-a
npm run node -- us-central1-a
npm run client -- http://YOUR-VM-IP:3381
```

When the test is over, remove the VM, its dedicated data disk, and the contest firewall rule:

```sh
npm run destroy -- us-central1-a
```

The cleanup script prints the active account/project and the resources, then waits for `DELETE`. Removing the node also removes its local database; a later test must sync again.

Provisioning checks the active `gcloud` identity, project, and billing state. It prints an estimate and requires the word `CREATE` before making billable resources. The example configures a 4-vCPU, 16-GB VM and a 2-TB persistent disk, matching Snapchain's current run-node guide. Actual price and trial coverage depend on account, region, network usage, and current provider rates.

The first historical snapshot can take several hours. After the bootstrap starts, check readiness with `npm run node:check -- us-central1-a`; this runs the health request from inside the VM over SSH, so it does not send a request from your computer to the public node address.

## Deploy to Vercel

Import the repository with the root directory selected. Vercel Hobby includes serverless functions within monthly limits, so it can serve the static app from `dist/` and run the small `/api/snapchain` proxy at no hosting charge for modest contest traffic. The proxy forwards allowlisted reads and binary message submissions to `SNAPCHAIN_URL`. Set `SNAPCHAIN_URL` to the node’s HTTP origin in the project's server-side environment settings, then redeploy. Optional `SNAPCHAIN_HTTP_USER` and `SNAPCHAIN_HTTP_PASS` are only for a separate Basic Auth reverse proxy; the app refuses to send those credentials over HTTP, and they do not secure Snapchain’s regular HTTP API by themselves. Never add node credentials to `VITE_*` variables or browser code. In hosted mode, the browser calls the same-origin Vercel endpoint, so those app requests reach the node from Vercel’s egress IP. The node’s public HTTP port can still be queried directly, and Vercel and the wallet provider see normal request metadata. Hobby is intended for personal, non-commercial use and has usage limits; check the current plan terms before a commercial launch.

The API allows only specific Snapchain routes and parameter shapes, limits request and response sizes, rejects cross-origin writes and upstream redirects, and adds best-effort per-instance rate limits. Those limits are not global abuse protection. The node's public HTTP port can be called directly, bypassing the Vercel proxy and its limits; protocol signatures still have to validate, but this is not private or abuse-proof infrastructure. The Vercel-to-node URL is plain HTTP in the current Google setup. Use this setup for a monitored contest pilot; before broad public use, put the node behind a TLS endpoint with enforceable ingress and shared rate limits, then point `SNAPCHAIN_URL` at that endpoint.

## Development

```sh
npm ci
npm run build
npm run dev
```

`npm run dev` serves the UI on `127.0.0.1:5175`; the feed needs the shared service URL configured by the app operator. The `npm run client` command supplies the node URL to the local server-side adapter. No third-party read API credentials are needed.

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
