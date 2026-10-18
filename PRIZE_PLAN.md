# Castonaut Snapchain prize plan

Status (18 October 2026, 14:52 UTC last checked): Castonaut client and guide build successfully. The $25 gross-usage budget and required Google Cloud APIs are configured. The `us-central1-a` VM and 1.75-TiB data disk are active for a bounded test. Snapchain had downloaded 79 of 5,690 snapshot chunks (about 1%) and estimated about 5 hours 10 minutes remaining. `/v1/info` was not responding during the download, so feed and write behavior remain unverified. The VM is scheduled to shut down automatically at 20:52 UTC; the data disk and firewall rule remain afterward, and the disk alone is about $72/month until deleted (charged against eligible trial credit while trial billing is active). Health checks run on the VM over SSH rather than calling the public node API from the operator’s computer. Vercel Hobby includes serverless functions, but the account previously returned HTTP 402 because its team was suspended; verify account status before deployment. No billing plan changes were made. An independent tester and public voucher are still required. The live Farcaster page showed the original post as about 22 hours old on 18 October 2026, but that rounded age is not an exact deadline. The bounty says seven days **exactly** from the original cast timestamp; calculate the UTC cutoff from the post timestamp before submitting.

## Aim

Submit an MIT-licensed, independently repeatable three-command tutorial that provisions compute, runs a Snapchain read node with no third-party API key, and launches a client that reads from that node. A separate human must complete the tutorial on their own compute and publicly vouch for it on Farcaster. Submit the microsite, repository, and voucher URLs in a reply to the original cast.

The prize is competitive. Build a useful open-source project even if it does not win.

## Winning thesis

The entry should make a genuinely hard task understandable and verifiable. Castonaut is the visual demonstration: a responsive, distinctive social client with an old-school personal-computer feeling, but modern accessibility and mobile layout. The contest path must work before extra product features are added.

Differentiators for the entry:

1. A visible step-by-step readiness panel: server provisioned, ports open, snapshot syncing, block delay healthy, client connected, account authorized, message relayed, message confirmed.
2. A real “source lens” that includes or excludes casts by originating client when signer attribution is available. Resolve a cast's signer to the registering app FID where possible; show “unknown client” when attribution is absent. Do not imply the filter can identify every post's source.
3. A safe account pathway: wallet-signed, scoped gasless app key for users. The client accepts no seed phrase or private key; never transmit one to the microsite or hosted app.
4. An honest, visual guide to FIDs, custody, storage rent, app keys, Snapchain messages, read nodes, validators, and confirmation. Every command explains what it changes and how to undo it.
5. Reproducible proof: pinned releases, idempotent setup scripts, clean-server test, phone/desktop tutorial QA, and a human tester's independent completion record.

## Architecture

```text
Browser / PWA -> Castonaut API -> cloud-hosted Snapchain HTTP endpoint
                                    |
                                    -> Snapchain read node -> peers / validators
```

The node's cloud IP is public for peer traffic. The home IP is never used as the node IP. On the hosted site, browsers call the same-origin Castonaut API and Vercel makes Snapchain requests, so the node sees Vercel's server-side egress. In the local three-command tutorial, the local adapter makes those requests and the node can see the tester's public egress IP. The hosting provider and any external media host still see normal network metadata; this is not an anonymity claim. The demo node HTTP API listens on a public port for the tutorial and should be monitored and protected before broad use.

The web client, API, and tutorial share one MIT-licensed repo. The retired Openroom prototype and Neynar-backed API handlers are archived outside Vercel's root `api/` directory; only `api/snapchain.js` is deployed as a function. The active Castonaut client uses the direct-Snapchain adapter and does not need a managed read API key.

## Three-command contract

The final quickstart should present three commands with no hidden manual infrastructure steps:

1. `npm run provision -- us-central1-a`: verify the active Google Cloud project and linked billing, show the resource estimate, and wait for explicit `CREATE` before making the VM, disk, and firewall rule.
2. `npm run node -- us-central1-a`: mount the persistent disk and run Farcaster's official Snapchain bootstrap. The operator accepts the upstream notice and enters an FID or username. The first snapshot takes several hours; check readiness afterward with `npm run node:check -- us-central1-a`. That check curls `/v1/info` from inside the VM over SSH.
3. `npm run client -- http://YOUR-VM-IP:3381`: run Castonaut locally with a same-origin server adapter connected to the read node. Vercel hosting is a separate deployment step that uses server-side `SNAPCHAIN_URL`.

The command syntax is implemented. A clean-server run and a second person's independent completion are still needed before calling the tutorial fully verified. Provider account signup, billing setup, and an existing Farcaster account/storage are prerequisites that must be stated prominently; do not count them as commands or hide them.

## Required acceptance tests

- New cloud node has enough memory, CPU, disk, public IP, and required peer ports; snapshot sync completes and block delay reaches healthy single digits.
- Client reads a live feed from the self-run node with third-party API keys absent.
- Existing account with storage can authorize a scoped gasless app key through its wallet. The client must never request custody keys or seed phrases.
- Client can cast, reply, follow, like/recast, and show/hide casts by source client where source metadata exists.
- A submitted message is queried back or observed as merged; relay acceptance alone is not reported as publication.
- A separate human starts from the public tutorial, provisions their own node, launches the client, completes a read and write, and publicly endorses the result.
- Microsite works on desktop and phone, uses plain language, and has troubleshooting for disk, ports, sync, authorization, storage, and write failures.
- The repo has an MIT license, setup/teardown instructions, cost disclosures, and no committed keys or seed phrases.

## Lowest-cost budget (location flexible)

The user previously reported a $300 trial grant; verify the current remaining balance and end date in Billing before a test. Google's Free Trial ends when the credit is used or 90 days pass; resources stop at trial end unless the billing account is upgraded. A continuous node at the current estimate would use about $510 over 90 days, so a $300 grant would cover roughly 53 days at that rate, not a full 90-day always-on service. Keep the account in trial status for the contest test, and do not upgrade billing as part of setup.

The current GCP setup uses an `e2-standard-4` (4 vCPUs, 16 GiB RAM), a 1.75-TiB standard persistent data disk (1792 GiB), and a 30-GiB balanced boot disk. The data disk exceeds Snapchain's published 1.5-TB free-storage minimum. At published Iowa prices, the resources total about **$0.24/hour, $17 for 72 hours, or $40 for seven days**, before network and external IP charges. The smaller data disk saves about $10/month over the 2-TiB version but leaves less growth headroom; watch disk use and resize before running a long-lived node. Disk storage remains billable while a VM is stopped.

A $25 monthly project budget is now configured with 50%, 80%, and 100% thresholds and excludes credits from its spend calculation, so it tracks gross usage against the trial credit. It sends warning emails to billing-account administrators and users by default. It is alerts-only and does not stop use. Keep the billing account in free-trial status and delete the VM, disk, and firewall rule after each contest test; do not upgrade to paid billing for this test.

Before any provision command: confirm the active project and free-trial status; verify the project budget alert; run the VM only for a scheduled 48–72-hour verification window; verify Snapchain sync, direct client reads/writes, and the external tester path; then run the cleanup command to delete the VM, data disk, and firewall rule. Keep Vercel on its free plan for the client and same-origin API proxy. The home IP stays out of the node path; a cloud node has its own public IP, while Vercel and wallet providers may still observe normal client connection metadata.

The same trial-credit route works for the independent tester only if they are individually eligible for Google's new-customer trial and can create their own project/node. Do not create extra accounts to multiply credits. If they are ineligible, use their existing provider credits or budget a short paid run.

Fallback paid options, based on public prices checked 18 October 2026. These are calculations, not checkout quotes. Verify availability, terms, tax, and storage performance before purchase. Do not commit to recurring paid hosting until the client is working, the trial is nearly complete, and actual usage justifies always-on infrastructure.

| Option | Compute | Added storage for about 2 TB total | Estimated recurring | Commitment |
| --- | --- | --- | --- | --- |
| EU VPS Lite 3 | 8 vCore, 16 GB RAM, 320 GB SSD | about 1.7 TB | about €35/month at US 0% VAT selection | 2-month minimum shown; about €70 total |
| US location, VPS 2000 | 8 vCore, 16 GB RAM, 256 GB SSD | about 1.75 TB | about €60/month at US 0% VAT selection | 1-month option shown |

Netcup lists block storage at €0.012/GB/month plus applicable VAT. EU hosting is fine for the bounty even though the project owner is in the US; it adds latency and the cheapest Lite plan has reduced bandwidth. A second independent tester must supply their own qualifying compute or use their own eligible trial/credit; sharing our node does not demonstrate the tutorial's node-creation step.

Other first-week costs: $0 for an MIT GitHub repository and a free static microsite. Do not enable paid memberships during the bounty run. Zero cash spend requires a genuinely eligible cloud credit account or an independent host who already has qualifying capacity. Oracle Always Free's 200 GB total block storage is far below the node requirement. Do not create extra trial accounts to bypass provider eligibility rules.

## Sequence

1. Locate the original cast URL and exact timestamp. Compute the submission cutoff in UTC. Find a human tester immediately.
2. The bounded Google Cloud test is running. Monitor the initial snapshot and stop/delete the VM after the read/write verification window; run the cleanup command to remove its data disk and firewall rule too.
3. Test Snapchain bootstrap, snapshot sync, and API reads on the actual VM. Verify firewall exposure and write a teardown guide.
4. The contest client path is implemented with direct Snapchain reads/writes, source lens, scoped key flow, and merge confirmation. Verify wallet authorization on a real node with an account whose owner approves the test.
5. After the public repository is available, have a separate person follow the public guide on their own compute and account; revise it based on where they get stuck.
6. Obtain their public Farcaster voucher and submit the microsite, MIT repo, and voucher URLs before the exact cutoff.

## Sources

- Bounty announcement and follow-up clarifications: user-provided pasted text; original cast URL and timestamp still need verification.
- Snapchain node requirements: https://github.com/farcasterxyz/snapchain
- Snapchain node roles and write confirmation: https://snapchain.farcaster.xyz/node-types
- Gasless signers and scoped keys: https://snapchain.farcaster.xyz/guides/writing-messages
- Netcup VPS Lite pricing/commitment: https://www.netcup.com/en/server/vps-lite
- Netcup regular VPS and US location: https://www.netcup.com/en/server/vps/vps-2000-g12.5-iv-24m-eu
- Netcup block storage: https://www.netcup.com/en/server/local-block-storage
- Oracle Always Free storage cap: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Google Cloud trial terms and credit: https://cloud.google.com/signup-faqs
- Google Cloud e2 pricing: https://cloud.google.com/products/compute/pricing/general-purpose
- Google Cloud persistent disk pricing: https://cloud.google.com/compute/disks-image-pricing
- Protocol rationale for signer app FID attribution: https://github.com/farcasterxyz/protocol/discussions/266
