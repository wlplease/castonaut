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

The client can read public state without connecting an account. To write, connect an Optimism wallet for an existing FID with storage. Castonaut creates an Ed25519 app key in the browser and asks the custody wallet to authorize a scoped, gasless `KEY_ADD`. The app key is kept in this browser’s local storage. It can cast, reply, follow, like, and recast. Successful relay is shown as pending until a read confirms the message in Snapchain.

The disposable seed phrase import is available only on `localhost` for protocol testing. Never paste a valuable account phrase into a website. Review the local source and use a throwaway account; revoke its signer when finished.

## Optional: run a personal test node

Most people can skip this. The [builder guide](tutorial.html) explains the architecture, costs, account concepts, security boundaries, and a three-command Google Cloud path. Its local client command is for people testing their own node:

The project has a **$25 monthly alert budget** with 50%, 80%, and 100% thresholds. It tracks gross usage before credits and emails billing admins/users; it is a warning, not a spending cap. The account currently reports $300 of trial credit and 90 days remaining. The test node is about $0.24/hour, so the credit would cover roughly 53 days at that rate. Run the node only during a planned test, keep the account in free-trial status, and run the cleanup command afterward. Google says trial usage is not billed unless you upgrade, and trial resources stop when the credit or 90-day period ends.

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

## Deploy to Vercel

Import the repository with the root directory selected. Vercel runs `npm run build` and serves `dist/`; the `/api/snapchain` function forwards allowlisted reads and binary message submissions to `SNAPCHAIN_URL`. Set `SNAPCHAIN_URL` to the node’s HTTP origin in Vercel’s server-side environment settings, then redeploy. Optional `SNAPCHAIN_HTTP_USER` and `SNAPCHAIN_HTTP_PASS` are sent only by the server function. Never add node credentials to `VITE_*` variables or browser code.

The API allows only specific Snapchain routes and parameter shapes, limits request size, checks same-origin writes, and adds basic per-instance rate limits. Serverless in-memory rate limits are best-effort, not a global abuse-control service. Do not treat a public Vercel endpoint or an open Snapchain HTTP port as private infrastructure. Review provider network controls and monitor usage before inviting broad traffic.

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
