# Castonaut

Castonaut is a working name for an independent Farcaster client with a friendly retro-PC feel. Read a public feed without a wallet, keep favorite people on your Desk, and connect an account only when you want to join in. The app team configures the shared feed service; using the client does not require cloud setup, API keys, or a personal node.

## Use Castonaut

Open the hosted app, enter your Farcaster ID, and choose **Show my feed**. Connect an Optimism wallet only when you want to post, reply, follow, or react. The client creates a limited app key in your browser and never asks for a recovery phrase.

## Develop the client

Contributors need Node.js 22. The local preview needs the app team's shared Snapchain endpoint configured server-side.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5175`. Set `SNAPCHAIN_URL` in a root `.env` file or the local server environment before using feeds; the Vite adapter proxies requests so the browser does not contact Snapchain directly. For Vercel, set `SNAPCHAIN_URL` in the project's server-side environment settings and deploy. Never put node credentials in browser variables. Optional proxy credentials belong in `SNAPCHAIN_HTTP_USER` and `SNAPCHAIN_HTTP_PASS`.

The client can read public state without connecting an account. To write, connect an Optimism wallet for an existing FID with storage. Castonaut creates an Ed25519 app key in the browser and asks the custody wallet to authorize a scoped, gasless `KEY_ADD`. The private key is saved as a non-extractable Web Crypto key in this browser’s IndexedDB; the server never receives it. This makes copying the raw key from browser storage harder, but a compromised page, malicious extension, or device could still cause social actions. The key can post, reply, follow, like, and recast for up to 30 days. It cannot move tokens or change account custody. “Forget this browser” deletes the local copy but does not revoke the protocol signer; revoke it separately in Farcaster account settings. Successful relay is shown as pending until a read confirms the message in Snapchain.

Castonaut does not accept or import seed phrases or private keys. Connect only through a wallet you trust. Local-node mode sends requests from the computer running the local client, so that node can see that computer’s public egress IP. Hosted mode sends app requests from Vercel instead.

## Optional: run a personal test node

Most people can skip this. The [builder guide](tutorial.html) explains the architecture, costs, account concepts, security boundaries, and a three-command Google Cloud path. Its local client command is for people testing their own node:

The project has a **$25 monthly alert budget** with 50%, 80%, and 100% thresholds. It tracks gross usage before credits and emails billing admins/users; it is a warning, not a spending cap. The Google Cloud free trial applies eligible usage to its credit; it does not charge the payment method during the trial. Check the current remaining credit in Billing before starting the node. The test VM and its 1.75-TiB disk together are estimated around $0.24/hour while running. **Stopping the VM stops compute charges, but the disk remains billable at roughly $72/month until deleted.** Keep the project on trial, use the node only for a planned test, and delete the resources after the test if preserving credits matters. Google stops trial resources when the trial ends; do not upgrade to paid billing for this contest setup.

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

Provisioning checks the active `gcloud` identity, project, and billing state. It prints an estimate and requires the word `CREATE` before making billable resources. The example configures a 4-vCPU, 16-GB VM and a 1.75-TiB persistent disk, which is above Snapchain's published storage minimum. Actual price and trial coverage depend on account, region, network usage, and current provider rates.

The first historical snapshot can take several hours. After the bootstrap starts, check readiness with `npm run node:check -- us-central1-a`; this runs the health request from inside the VM over SSH, so it does not send a request from your computer to the public node address.

## Deploy to Vercel

Import the repository with the root directory selected. Vercel Hobby includes serverless functions within monthly limits, so it can serve the static app from `dist/` and run the small `/api/snapchain` proxy at no hosting charge for modest contest traffic. The proxy forwards allowlisted reads and binary message submissions to `SNAPCHAIN_URL`. Set `SNAPCHAIN_URL` to the node’s HTTP origin in the project's server-side environment settings, then redeploy. Optional `SNAPCHAIN_HTTP_USER` and `SNAPCHAIN_HTTP_PASS` are only for a separate Basic Auth reverse proxy; they do not secure Snapchain’s regular HTTP API by themselves. Never add node credentials to `VITE_*` variables or browser code. In hosted mode, the browser calls the same-origin Vercel endpoint, so those app requests reach the node from Vercel’s egress IP. The node’s public HTTP port can still be queried directly, and Vercel and the wallet provider see normal request metadata. Hobby is intended for personal, non-commercial use and has usage limits; check the current plan terms before a commercial launch.

The API allows only specific Snapchain routes and parameter shapes, limits request size, checks same-origin writes, and adds best-effort per-instance rate limits. Those limits are not global abuse protection. The node's public HTTP port can be called directly, bypassing the Vercel proxy and its limits; protocol signatures still have to validate, but this is not private or abuse-proof infrastructure. The Vercel-to-node URL is plain HTTP in the current Google setup. Use this setup for a monitored contest pilot; before broad public use, put the node behind a TLS endpoint with enforceable ingress and shared rate limits, then point `SNAPCHAIN_URL` at that endpoint.

## Development

```sh
npm install
npm run build
npm run dev
```

`npm run dev` serves the UI on `127.0.0.1:5175`; the feed needs the shared service URL configured by the app operator. The `npm run client` command supplies the node URL to the local server-side adapter. No third-party read API credentials are needed.

## Protocol and product limits

- An FID identifies a Farcaster account; it is not a secret.
- The custody address controls signer authorization. An existing account needs protocol storage to publish.
- A read node follows the network and serves APIs. It is not a validator.
- A node accepting a message for relay does not prove the network merged it. Castonaut checks the message again through the service.
- Source filtering works only when Snapchain exposes requester attribution for the signer. Unknown sources remain labeled unknown.
- This client cannot reverse a protocol or application ban, guarantee account access, or promise future compatibility with protocol changes.

Read the [Snapchain node docs](https://snapchain.farcaster.xyz/node-types), [message-writing guide](https://snapchain.farcaster.xyz/guides/writing-messages), and [HTTP API reference](https://snapchain.farcaster.xyz/reference/httpapi). Snapchain releases and operational requirements change; verify them before provisioning.

## License

MIT. See [LICENSE](LICENSE).
