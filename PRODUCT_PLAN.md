# Castonaut product plan

## Product and name

**Castonaut** is the working name for an independent Farcaster social client: a welcoming waystation for catching up and keeping your people close. Its warm, analog space-station interface gives the client a memorable world without turning social use into a game. The core places are **Signals** (a chronological following feed), **Orbit** (people pinned on this device), and **Flight Log** (posts saved privately on this device). The same identity and actions carry over to a phone in a clean, touch-friendly layout. The name combines “cast” with “astronaut,” giving the brand an old-web explorer feel without making the app sound like infrastructure.

The name nods to casts without putting Farcaster in the product name. A first-pass web search did not surface an obvious Castonaut social-client match. Treat it as a working name until checking similar marks, app stores, domains, common-law use, and relevant international records; this is not legal clearance. Avoid **Ourcaster** because it sits too close to Farcaster. Keep the identity in lilac, deep plum, parchment, and coral, with a custom “orbiting cursor” motif and 37 as a small community easter egg rather than part of the name.

## What exists now

The active web app has a Snapchain-backed chronological feed, public profile summaries with bios and recent posts, basic follows/replies/likes/recasts/posts, device-local pinned people, a per-account Flight Log of saved posts, profile nicknames and notes, a local Mission Brief snapshot, a responsive desktop/mobile shell, scoped wallet signer setup, and an optional builder guide. Its entry flow is all-in: a person connects the wallet already linked to their Farcaster account, proves the account through the Optimism ID Registry, and waits for Snapchain to confirm the scoped app key. Only then do that same account’s feed and posting tools open. The interface does not accept a typed username or FID as identity and has no guest feed path. The Mission Brief counts only the posts in the loaded view; it is not network-wide analytics and sends no data to an AI service. Flight Log entries are account-scoped and stored in this browser only.

It does not yet have username search, full profile pages, thread pages, conversation rooms, synced preferences, native apps, Plus billing, or verified write access for users affected by other client restrictions. Do not present planned features as shipped. The hosted app needs the operator’s `SNAPCHAIN_URL` configured for live feed and write requests.

## The user journey

1. **Come aboard:** Explain that the app uses the account the person controls, verified through its linked custody wallet.
2. **Enable posting:** Request only the scoped signer authorization needed for social actions; never persist or transmit a custody phrase. Keep wallet signing as the default and limit the optional local phrase path to disposable test accounts with a clear browser-code warning. Keep the station locked until Snapchain confirms the key.
3. **Catch up:** Load the connected account’s following feed automatically, in chronological order.
4. **Make it yours:** Click a name to view that person’s posts, pin people in Orbit, and return to those profiles in one tap.
5. **Keep a signal:** Save a post to the Flight Log; it is stored for that account in this browser and is not shared to Farcaster.
6. **Come back:** Restore that account’s confirmed local app key and Orbit on this device. Explain how to remove the local key and revoke the protocol signer separately.

## Build in this order

### Now: reliable launch client

- Smooth first run with an identity check, clearly scoped signer approval, useful empty/loading/error states, and one route into the account’s desk.
- Verify chronological ordering, profile loading, each write action, signer revocation, and read-after-write confirmation against the configured service.
- Add a shareable profile/feed URL, follow state, and a focused thread view.
- Make the mobile header/navigation, post actions, feed filters, and wallet dialog comfortable at 320–430 px widths and accessible by keyboard/screen reader.
- Add feedback/report entry points and a short privacy explanation; keep the technical node walkthrough under About.

### Next: the distinctive social desktop

- **The station:** improve Orbit organization and add named groups only after the focused Signals / Orbit / Flight Log loop feels valuable. Add optional encrypted sync only after the local model proves useful.
- **Rooms:** start with a small number of readable, curated topic rooms built from public conversations. Add clear hosts/rules, mute/block/report, and moderation appeals before room creation is open.
- **Conversation view:** open a post and follow its replies in context; reply without losing the feed position.
- **Desktop workspace:** let users arrange a feed, buddy list, and one room in familiar windows; save a few named layouts. Do not start with a complicated customizable dashboard.
- **Phone:** translate the same places into bottom navigation and a focused single-column flow. Ship the responsive web app first; package iOS/Android after repeat use proves the flow.

### Later, only if people return

Search by username, richer discovery, media controls, notifications, PWA/offline shell, synced Desk, native apps, and host tools. DMs, live presence, video upload, and algorithmic ranking wait: they add privacy, moderation, and operating costs without proving the core social loop.

## Free and paid

Keep the connected account’s reading, posting, replies, follows, and reactions free. A second client can offer a different interface; a paid tier must buy useful optional organization and customization, never the ability to participate or bypass a restriction.

- **Free during the contest and after:** reading for connected accounts, posting, replies, follows, likes/recasts, the source filter, one Desk, profiles, and core conversation views. Do not gate protocol participation or contest features.
- **Plus after the contest (test price: $1 USDC for 30 days):** extra Desk layouts/groups, saved views and bookmarks, and extra themes. It is prepaid once per term; it never renews automatically. A user can buy another term explicitly, and a top-up before expiry should extend from the existing expiry date. Keep the $1 offer labeled planned until a contract and entitlement flow are ready.
- **Founder (test price: $29 USDC once, limited quantity):** 12 months of Plus and a founder theme. It is prepaid, not lifetime access. Keep quantities and the term visible before a user signs.

Use Base USDC for a one-time prepaid entitlement: 1 USDC for 30 days of Plus, with an optional $29 USDC Founder purchase for 12 months. Show the exact amount, term, non-renewing behavior, and a “no refunds except where required by law” notice before the wallet opens. Explain that confirmed on-chain transactions are generally irreversible; provide a clear contact path for duplicate or mistaken purchases. Check the Base network and token balance before signing; tell users they need ETH for transaction fees unless gas sponsorship is added later. Never ask for a recovery phrase or an unlimited token approval. Verify the deployed contract and entitlement on-chain before showing Plus as active. Do not sell reach, ranking, moderation outcomes, ban appeals, or guaranteed protocol access. Do not integrate checkout until the contest run is complete and the contract address and ABI are supplied and reviewed.

An on-device AI recap is a later experiment, not a default dependency. Keep Feed Pulse instant and model-free. Offer an AI model only after an explicit opt-in download, make its size and hardware needs visible, process the selected posts in the browser, and provide a clear delete/reset control. Do not transmit feed content to an AI provider. If the local model is too slow or unsupported on a phone, the client still works normally without it.

## Banned-account promise and trust

The product welcomes people who cannot use another client, but an alternate UI cannot override protocol or service rules. Test read, signer authorization, submission, and network propagation separately with consenting accounts. Show which step failed and who controls it. Never advertise guaranteed ban recovery or use payment as access to basic posting.

Never persist or transmit custody seed phrases. Use a narrowly scoped app signer, explain how to revoke it, and never claim the service hides every network identifier. Proxy protocol requests through the app service where practical; be clear that hosting, wallet, payment, and external-link providers may see connection metadata.

## What would make this work

Invite 10–20 longtime Farcaster users to use the core flow for a week. Watch whether they can find their feed, open and pin a friend, and return without help. Track successful feed loads, posts confirmed by read-back, Desk use, and 7-day returns. Fix the first repeated confusion before adding more surfaces. Expand rooms after there are hosts and active conversations; test Plus only after people use the Desk repeatedly.

Keep early infrastructure on a budget and configure billing alerts before creating any cloud resource. The operator owns the hosted Snapchain endpoint; users should not have to run a node. Vercel Hobby can serve the client and server-side proxy within its free usage limits. Use Google Cloud for a bounded contest node test only; its free-trial credits cover eligible costs without charging the payment method, but still consume the grant. The current 4-vCPU/16-GB VM plus a 2-TB data disk and 30-GB boot disk is estimated around $0.25/hour ($42 for seven days), before networking. Stopping the VM leaves the 2-TB disk billable at about $82/month. A **$25 monthly project budget** tracks gross usage with 50%, 80%, and 100% alerts; it warns but does not stop resources. Stay on free-trial billing, start the node only for the test window, and delete its VM, data disk, and firewall after testing if the account credit should be preserved.
