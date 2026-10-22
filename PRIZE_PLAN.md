# Castonaut Snapchain prize plan

Status (22 October 2026, 01:42 UTC): The Google VM `castonaut-snapchain` in `us-central1-a` is RUNNING (`e2-standard-4`). The prior local Snapchain database and stale snapshot cache were intentionally cleared after shard 0's snapshot chunk returned 404. The VM was then restarted with the existing Compose project name (`snapchain`); the accidental `snapchain-data` project was stopped after its StatsD port collision. A fresh 21 October public snapshot has been fetched for all three shards. At 21:42 EDT, download progress was 376/5,695 chunks (6%); the current shard-1 chunk was 377/2,673 and the estimate was 4h33, with 1.8 TiB free. CPU was 52.7% and memory 402 MiB. Snapchain API and mesh are not responding yet during restore. **Not ready; do not reset or restart it.** Wait for snapshot completion, then check all shard heights/delays and public reachability before configuring Vercel. Billing-trial balance/expiry remains unverified. The user authorized at most $200 of free-trial credit and no paid-billing upgrade.

The public GitHub repository is [wlplease/tvs](https://github.com/wlplease/tvs) (MIT), and the public site is [tvs-omega.vercel.app](https://tvs-omega.vercel.app). The homepage, tutorial, privacy page, and terms page all returned HTTP 200 on 21 October 2026. The deployed `/api/snapchain?route=info` returns HTTP 503 with `Snapchain is not configured`: the Vercel `SNAPCHAIN_URL` environment variable is missing. Do not point it at the current node until all shards are ready. The local monitor reports snapshot progress and recent logs. Local verification on 22 October: all 23 tests pass, the production build succeeds, and `git diff --check` passes. Build warnings include the upstream Farcaster protocol bundle exceeding 500 kB and direct `eval` in `@farcaster/core`. The current workspace has eight modified, uncommitted files; its HEAD still matches `origin/main` (`57b0af2`), so those local improvements are not in the public repository/deployment yet. No independent tester/voucher or contest reply is recorded. Do not push, deploy, or post externally without the user's explicit action-time confirmation. The exact contest cutoff still needs verification from the original cast timestamp.

## Aim

Submit an MIT-licensed, independently repeatable three-command tutorial that provisions compute, runs a Snapchain read node with no third-party API key, and launches a client that reads from that node. A separate human must complete the tutorial on their own compute and publicly vouch for it on Farcaster. Submit the microsite, repository, and voucher URLs in a reply to the original cast.

Balaji clarified in the original conversation that current read nodes can accept signed messages and relay them to validators, and gasless app keys require no Optimism transaction. The tutorial and client use that current flow. Users can authorize with the Farcaster recovery phrase, which is derived locally in the browser, or use a linked wallet. The phrase field is cleared synchronously before any network request, and its temporary variable is overwritten immediately after local derivation. Only the derived public custody address is sent to the Optimism ID Registry; the app does not persist or intentionally transmit the phrase. The interface warns that page code can read it while entered, and JavaScript cannot guarantee memory zeroization.

The prize is competitive. Build a useful open-source project even if it does not win.

## Winning thesis

The entry should make a genuinely hard task understandable and verifiable. Castonaut is the visual demonstration: a responsive, distinctive social client with an old-school personal-computer feeling, but modern accessibility and mobile layout. The contest path must work before extra product features are added.

Differentiators for the entry:

1. A visible step-by-step readiness panel: server provisioned, ports open, snapshot syncing, block delay healthy, client connected, account authorized, message relayed, message confirmed.
2. A real “source lens” that includes or excludes casts by originating client when signer attribution is available. Resolve a cast's signer to the registering app FID where possible; show “unknown client” when attribution is absent. Do not imply the filter can identify every post's source.
3. A safe account pathway: accept the Farcaster recovery phrase or a linked wallet to authorize a scoped, gasless app key. Never store or transmit a custody phrase; explain that the website code can read it while entered, and let users choose a linked wallet if they prefer not to expose it to the page.
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
3. `npm run client -- --zone us-central1-a`: look up the VM's external IP in the active Google Cloud project and run Castonaut locally with a same-origin server adapter connected to the read node. Vercel hosting is a separate deployment step that uses server-side `SNAPCHAIN_URL`.

The command syntax is implemented. A clean-server run and a second person's independent completion are still needed before calling the tutorial fully verified. Provider account signup, billing setup, and an existing Farcaster account/storage are prerequisites that must be stated prominently; do not count them as commands or hide them.

## Required acceptance tests

- New cloud node has enough memory, CPU, disk, public IP, and required peer ports; snapshot sync completes and block delay reaches healthy single digits.
- Client reads a live feed from the self-run node with third-party API keys absent.
- Existing account with storage can authorize a scoped gasless app key through the Farcaster recovery phrase or linked wallet. Phrase sign-in is available in hosted builds, derives the custody signer in the browser, clears the field synchronously, overwrites its temporary phrase variable after derivation, and does not persist or intentionally send the phrase. Users are clearly told that website code can read it while entered.
- Client can cast, reply, follow, like/recast, and show/hide casts by source client where source metadata exists.
- A submitted message is queried back or observed as merged; relay acceptance alone is not reported as publication.
- A separate human starts from the public tutorial, provisions their own node, launches the client, completes a read and write, and publicly endorses the result.
- Microsite works on desktop and phone, uses plain language, and has troubleshooting for disk, ports, sync, authorization, storage, and write failures.
- The repo has an MIT license, setup/teardown instructions, cost disclosures, and no committed keys or seed phrases.

## Fastest path to a strong entry

The announcement rewards an independently repeatable node-and-client tutorial, not raw client signups. The highest-value growth proof is therefore a real second builder who creates their own node, reads and writes through Castonaut, and publishes an honest voucher. More independent testers help, but one complete run is the eligibility floor.

1. While the owner node syncs, line up two potential builders so a single schedule conflict does not lose the only test slot. Ask each to confirm they can use their own compute project/host and a dedicated Farcaster account with storage. Do not ask them to share recovery phrases.
2. Offer a short live troubleshooting session, but have the tester run the tutorial and commands on their own machine and node. Keep their feedback and voucher independent; do not script or write the endorsement for them.
3. Be clear before they start: the current Google path needs 4 vCPU, 16 GB RAM, a 2-TB disk, and several hours for first sync. Eligible trial credits may help, but the project budget is only an alert. They must check their own billing and clean up their resources afterward.
4. Ask them to verify the complete loop: synced node, sign-in with linked-wallet authorization where possible, read feed, publish a test cast, follow, react, source include/exclude, and read-after-write confirmation. Record any failure and fix the tutorial before asking for a voucher.
5. Publish the reviewed repo/site only after local checks and live node readiness pass. Then submit the site, MIT repo, and the tester's public voucher link as the reply to the contest post, before its exact seven-day cutoff.

Suggested outreach draft (send only after choosing the right people):

> I’m looking for one or two Farcaster builders to independently test Castonaut’s Snapchain node + client tutorial for Balaji’s client bounty. It takes your own compute project and an existing test FID with storage; a fresh node can take several hours to sync. I can help troubleshoot live, but you’d run the node and client yourself. If it works for you, an honest public voucher would help; no recovery phrase needed if you use linked-wallet signer authorization. Interested?

Do not add a token, paid gate, or shared hosted node to this contest path. Those add friction and fail to demonstrate the independent node setup the announcement asks for. After the bounty, measure repeat use and ask testers what they want before building a wider node-operator community feature.

## Lowest-cost budget (location flexible)

The user authorized use of up to $200 in free-trial credit. Verify the current remaining balance and trial end date in Billing before extending the run. Current API inspection confirms the project is linked to an open billing account, but does not expose whether it is a free-trial or paid account or the remaining free credit. The Google Cloud console requires a matching browser account, which was not available in the connected session. A continuous node at the current estimate would use about $510 over 90 days. The project’s $25 budget is an alert, not a hard cap. Do not extend the VM run until trial status and remaining credit are verified; never upgrade billing.

The current GCP test uses an `e2-standard-4` (4 vCPUs, 16 GiB RAM), a 2-TB standard persistent data disk, and a 30-GiB balanced boot disk. The 2-TB configuration is estimated at about **$0.25/hour, $18 for 72 hours, or $42 for seven days**, before network and external IP charges. Disk storage remains billable while a VM is stopped. These are estimates; the current free-trial balance and expiration have not been verified.

A $25 monthly project budget is configured with 50%, 80%, and 100% thresholds and excludes credits from its spend calculation, so it tracks gross usage. It sends warning emails to billing-account administrators and users by default. It is alerts-only and does not stop use. Keep the billing account in free-trial status and delete the VM, disk, and firewall rule after each contest test; do not upgrade to paid billing for this test.

Before extending the current VM run, confirm the active project and free-trial balance/expiration; verify the project budget alert; agree on a bounded verification window; and stop/delete the VM, data disk, and firewall rule after the test. For the current VM, `npm run node:check -- us-central1-a` checks the in-VM API and public endpoint, reports maximum active-shard delay, and exits nonzero until that delay is 10 seconds or lower. The fresh snapshot restore is underway and `/v1/info` has not responded yet. Keep Vercel on its free plan for the client and same-origin API proxy. The home IP stays out of the node path; a cloud node has its own public IP, while Vercel and wallet providers may still observe normal client connection metadata.

The same trial-credit route works for the independent tester only if they are individually eligible for Google's new-customer trial and can create their own project/node. Do not create extra accounts to multiply credits. If they are ineligible, use their existing provider credits or budget a short paid run. Ask the tester to use a dedicated Farcaster test account and prefer linked-wallet authorization; they should not paste a primary account's recovery phrase into an unreviewed site.

Fallback paid options, based on public prices checked 18 October 2026. These are calculations, not checkout quotes. Verify availability, terms, tax, and storage performance before purchase. Do not commit to recurring paid hosting until the client is working, the trial is nearly complete, and actual usage justifies always-on infrastructure.

| Option | Compute | Added storage for about 2 TB total | Estimated recurring | Commitment |
| --- | --- | --- | --- | --- |
| EU VPS Lite 3 | 8 vCore, 16 GB RAM, 320 GB SSD | about 1.7 TB | about €35/month at US 0% VAT selection | 2-month minimum shown; about €70 total |
| US location, VPS 2000 | 8 vCore, 16 GB RAM, 256 GB SSD | about 1.75 TB | about €60/month at US 0% VAT selection | 1-month option shown |

Netcup lists block storage at €0.012/GB/month plus applicable VAT. EU hosting is fine for the bounty even though the project owner is in the US; it adds latency and the cheapest Lite plan has reduced bandwidth. A second independent tester must supply their own qualifying compute or use their own eligible trial/credit; sharing our node does not demonstrate the tutorial's node-creation step.

Other first-week costs: $0 for an MIT GitHub repository and a free static microsite. Contest and preview builds are free to use; the $3.70 / 30-day Base Time Pass is optional to the contest, and its paid gate only activates after checkout is deployed and configured. Zero cash node spend requires a genuinely eligible cloud credit account or an independent host who already has qualifying capacity. Oracle Always Free's 200 GB total block storage is far below the node requirement. Do not create extra trial accounts to bypass provider eligibility rules.

## Sequence

1. Confirm the original cast timestamp and exact submission cutoff in UTC. Find a human tester immediately.
2. The VM is restoring the fresh 21 October snapshots after the old shard-0 snapshot URL returned 404. At 21:42 EDT it had downloaded 376/5,695 chunks (6%), with 1.8 TiB free and a provisional 4h33 ETA. The API is not responding during restore. Monitor chunk progress and disk headroom; leave the node running. After completion, check every shard's delay and public endpoint before continuing.
3. Public entry points are live, but the public source/deployment does not include the eight current local changes. Review the diff, commit and publish it, then verify the deployed build before asking the tester to follow it.
4. The contest client path is implemented with direct Snapchain reads/writes, source lens, scoped key flow, and merge confirmation. Verify wallet authorization on a real node with an account whose owner approves the test.
5. After the reviewed local changes are published, have a separate person follow the public guide on their own compute and account; revise it based on where they get stuck. The already-live site currently serves the old `origin/main` build.
6. Obtain the tester's public Farcaster voucher and submit the microsite, MIT repo, and voucher URLs before the exact cutoff. Posting the contest reply is an external publication and needs the owner's explicit action-time confirmation.

## Sources

- Bounty announcement: https://farcaster.xyz/balajis.eth/0x50184b62
- Balaji's clarification that read nodes can relay writes and gasless signer keys need no Optimism transaction: https://farcaster.xyz/balajis.eth/0x0a05d5c8
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
