# Castonaut product plan

## Product and name

**Castonaut** is the working name for an independent Farcaster social client: a place for people to catch up and keep their circles close. The product uses a warm, personal 1990s PC interface: a chronological feed, lively profiles, a buddy list, conversation rooms, and a customizable **Desk** where people pin friends and conversations they want close. The same identity and core actions carry over to a phone in a clean touch layout. The name combines “cast” with “astronaut,” giving the brand an old-web explorer feel without making the app sound like infrastructure.

The name nods to casts without putting Farcaster in the product name. A first-pass web search did not surface an obvious Castonaut social-client match. Treat it as a working name until checking similar marks, app stores, domains, common-law use, and relevant international records; this is not legal clearance. Avoid **Ourcaster** because it sits too close to Farcaster. Keep the identity in lilac, deep plum, parchment, and coral, with a custom “orbiting cursor” motif and 37 as a small community easter egg rather than part of the name.

## What exists now

The active web app has a Snapchain-backed feed, public profile data, basic follows/replies/likes/recasts/posts, device-local pinned people, a responsive desktop/mobile shell, scoped wallet signer setup, an optional builder guide, and a control to forget a locally saved FID. A person can enter a numeric FID, read without a wallet, open another person’s recent posts, pin them to the Desk, and connect only to participate.

It does not yet have username search, full profile pages, thread pages, conversation rooms, saved posts, synced preferences, native apps, Plus billing, or verified write access for users affected by other client restrictions. Do not present planned features as shipped. The hosted app needs the operator’s `SNAPCHAIN_URL` configured for live feed and write requests.

## The user journey

1. **Arrive:** Explain in one sentence that this is a Farcaster client. Show “read first” and keep wallet connection secondary.
2. **Find yourself:** Accept a username or profile link eventually; FID entry is the current fallback and should explain what a FID is and where to find it.
3. **Catch up:** Show the newest posts from followed accounts in chronological order. Keep service health in the background; report an actionable problem when a feed request fails.
4. **Make it yours:** Click a name to view that person’s posts, pin people to the Desk, and return to those profiles in one tap.
5. **Join in:** Ask for a scoped wallet signer only when a person posts, replies, follows, or reacts. Explain permissions and revocation in plain language.
6. **Come back:** Restore the last feed and Desk on the same device, with a clear way to forget the saved FID; later add user-controlled sync across devices.

## Build in this order

### Now: reliable launch client

- Smooth first run with FID help, remembered feed, an easy way to forget that FID, useful empty/loading/error states, and a one-screen route to the Desk.
- Verify chronological ordering, profile loading, each write action, signer revocation, and read-after-write confirmation against the configured service.
- Add a shareable profile/feed URL and a real profile card with display name, username, avatar, bio, follow state, and recent posts.
- Make the mobile header/navigation, post actions, feed filters, and wallet dialog comfortable at 320–430 px widths and accessible by keyboard/screen reader.
- Add feedback/report entry points and a short privacy explanation; keep the technical node walkthrough under About.

### Next: the distinctive social desktop

- **The Desk:** drag or pin friends, saved conversations, and favorite rooms; organize small named groups; keep current device-local data portable. Add optional encrypted sync only after the local model feels valuable.
- **Rooms:** start with a small number of readable, curated topic rooms built from public conversations. Add clear hosts/rules, mute/block/report, and moderation appeals before room creation is open.
- **Conversation view:** open a post and follow its replies in context; reply without losing the feed position.
- **Desktop workspace:** let users arrange a feed, buddy list, and one room in familiar windows; save a few named layouts. Do not start with a complicated customizable dashboard.
- **Phone:** translate the same places into bottom navigation and a focused single-column flow. Ship the responsive web app first; package iOS/Android after repeat use proves the flow.

### Later, only if people return

Search by username, richer discovery, media controls, notifications, PWA/offline shell, synced Desk, native apps, and host tools. DMs, live presence, video upload, and algorithmic ranking wait: they add privacy, moderation, and operating costs without proving the core social loop.

## Free and paid

Keep reading, posting, replies, follows, and reactions free. A second client can offer a different interface; a paid tier must buy useful optional organization and customization, never the ability to participate or bypass a restriction.

- **Free during the contest and after:** public reading, posting, replies, follows, likes/recasts, the source filter, one Desk, profiles, and core conversation views. Do not gate protocol participation or contest features.
- **Plus after the contest (test price: $1 USDC for 30 days):** extra Desk layouts/groups, saved views and bookmarks, and extra themes. It is prepaid once per term; it never renews automatically. A user can buy another term explicitly, and a top-up before expiry should extend from the existing expiry date.
- **Founder (test price: $29 USDC once, limited quantity):** 12 months of Plus and a founder theme. It is prepaid, not lifetime access. Keep quantities and the term visible before a user signs.

Use Base USDC for a one-time prepaid entitlement: 1 USDC for 30 days of Plus, with an optional $29 USDC Founder purchase for 12 months. Show the exact amount, term, non-renewing behavior, and a “no refunds except where required by law” notice before the wallet opens. Explain that confirmed on-chain transactions are generally irreversible; provide a clear contact path for duplicate or mistaken purchases. Check the Base network and token balance before signing; tell users they need ETH for transaction fees unless gas sponsorship is added later. Never ask for a recovery phrase or an unlimited token approval. Verify the deployed contract and entitlement on-chain before showing Plus as active. Do not sell reach, ranking, moderation outcomes, ban appeals, or guaranteed protocol access. Do not integrate checkout until the contest run is complete and the contract address and ABI are supplied and reviewed.

## Banned-account promise and trust

The product welcomes people who cannot use another client, but an alternate UI cannot override protocol or service rules. Test read, signer authorization, submission, and network propagation separately with consenting accounts. Show which step failed and who controls it. Never advertise guaranteed ban recovery or use payment as access to basic posting.

Keep custody seed phrases out of the hosted app. Use a narrowly scoped app signer, explain how to revoke it, and never claim the service hides every network identifier. Proxy protocol requests through the app service where practical; be clear that hosting, wallet, payment, and external-link providers may see connection metadata.

## What would make this work

Invite 10–20 longtime Farcaster users to use the core flow for a week. Watch whether they can find their feed, open and pin a friend, and return without help. Track successful feed loads, posts confirmed by read-back, Desk use, and 7-day returns. Fix the first repeated confusion before adding more surfaces. Expand rooms after there are hosts and active conversations; test Plus only after people use the Desk repeatedly.

Keep early infrastructure on a budget and configure billing alerts before creating any cloud resource. The operator owns the hosted Snapchain endpoint; users should not have to run a node. Use Vercel's free deployment for the client and server-side proxy, and bring up a Google Cloud node only for a bounded contest test. The current 4-vCPU/16-GB VM plus a 1.75-TiB data disk and 30-GB boot disk estimate is about $0.24/hour ($40 for seven days), before networking; a continuous 90-day run would exceed the $300 trial credit. A **$25 monthly project budget** now tracks gross usage with 50%, 80%, and 100% alerts. Stay on the free-trial billing account during tests, and do not upgrade to paid billing until the recurring node cost is an intentional decision. The budget sends warnings; it does not stop spend.
