# Castonaut product plan

## Product and name

**Castonaut** is the working name for an independent Farcaster social client: a personal field guide to the people and posts you care about. Its celestial-cartography identity makes the network feel explorable. The signature loop is simple: catch up in time order, keep your people close on the Desk, and revisit signals worth saving in the Flight Log or Time Capsule. An optional, one-time “First Flight” guide helps new users pin a person, save a signal, and keep a page; progress is local, with no points, public score, streak, or reward token. The same identity and actions carry over to a phone in a clean, touch-friendly layout.

The name nods to casts without putting Farcaster in the product name. A first-pass web search did not surface an obvious Castonaut social-client match. Treat it as a working name until checking similar marks, app stores, domains, common-law use, and relevant international records; this is not legal clearance. Avoid **Ourcaster** because it sits too close to Farcaster. Keep the identity in lilac, deep plum, parchment, and coral, with a custom “orbiting cursor” motif and 37 as a small community easter egg rather than part of the name.

## Product references

[Jackcast](https://github.com/wlplease/jackcast) is a useful reference for the everyday client details: separate Following, Friends, and custom timelines; local scroll restoration; reply/media filters; profile Posts/Media tabs; drafts and recoverable thread posting. Castonaut now covers these workflows on its own Snapchain-backed path. Keep its distinctive center of gravity in the personal Desk—people, saved signals, and topic shortcuts together—while preserving the node-backed architecture required by the contest. Jackcast’s hosting and API choices are specific to that project and are not copied into Castonaut.

## What exists now

**Current experience details:** Following is intentionally staged to bound initial requests: it starts with the user and a small group, then exposes a “load more” action, and caps the available set at 24 followed accounts. It is not yet a complete all-following timeline. View options can search text, profile names, and links only among posts already loaded in the current view; this is local filtering, not global cast search. Standard cast posts now keep the exact signed message in a device-local pending outbox after a timeout and verify the same hash before resuming, to reduce accidental duplicate posts. The outbox entry contains a signed public message, not the private app key.

The active web app has a Snapchain-backed chronological feed, a personal Desk and Flight Log, Orbit Lens for pinned people, Orbit Pulse for local feed counts, and a Time Capsule that saves up to 30 visible posts per day for 14 days on this device. The Desk also includes the optional First Flight guide: pin a person, save a signal, keep a page. Its progress is derived from local Desk and capsule data and stays on this device. Posts can attach a direct HTTPS GIF or image URL; remote media is off by default. Following, Friends, and Crew keep separate scroll positions. Username/FID lookup opens profiles, which can be shared with profile links; cast links open an in-app conversation view with replies. Feed actions include follow/unfollow, like/unlike, recast/unrecast, reply, one-tap save to Desk, and save to Flight Log. A user-triggered local backup can export or restore Desk data, saved posts, capsules, and selected appearance/feed preferences. Backup files exclude signers, payment details, drafts, and recovery phrases. A Farcaster recovery phrase or linked wallet can verify an existing identity and authorize the scoped browser signer. The client is free to use. There is no payment gate, subscription, or wallet purchase flow; keep the full experience open so new users and contest judges can try it immediately. The contest client does not require third-party AI or media API keys; feed and social actions use the configured Snapchain service and public chain RPCs where needed. No Nostr DM implementation is present; DMs stay out of this release. Desk items and capsules are stored locally in this browser.

It does not yet have global cast search, conversation rooms, synced preferences, native apps, or verified write access for users affected by other client restrictions. Profile lookup is by username/FID rather than fuzzy search. Validate profile routes, replies, reactions, and follow-state toggles against a caught-up node before calling them production-verified. The hosted app needs `SNAPCHAIN_URL` configured; no payment contract is required.

## The user journey

1. **Come aboard:** Explain that the app verifies the account through its custody address. Let users derive it locally with their Farcaster recovery phrase or authorize it with a linked wallet.
2. **Enable posting:** Request only the scoped signer authorization needed for social actions; never persist or transmit a custody phrase. Recommend a dedicated test account and linked-wallet signing; warn that website code can read a phrase while entered. Keep the station locked until Snapchain confirms the key.
3. **Catch up:** Load the connected account’s following feed automatically, in chronological order.
4. **Make it yours:** Click a name to view that person’s posts, pin people in Orbit, and return to those profiles in one tap.
5. **Keep a signal:** Save a post to the Flight Log; it is stored for that account in this browser and is not shared to Farcaster.
6. **Come back:** Restore that account’s confirmed local app key and Orbit on this device. Explain how to remove the local key and revoke the protocol signer separately.

## Build in this order

### Now: reliable launch client

- Smooth first run with an identity check, clearly scoped signer approval, useful empty/loading/error states, and one route into the account’s desk.
- Replace staged Following account batches with a coherent, cursor-based newest-first timeline, or keep the partial model explicit until the node/API can support this efficiently.
- Add a real block/report path with clear operator ownership and response expectations; local mute remains a personal feed filter and is not a safety report or protocol block.
- Verify chronological ordering, profile loading, each write action, signer revocation, and read-after-write confirmation against the configured service.
- Verify the shareable profile/cast routes, replies, and follow/reaction toggles against the caught-up service.
- Make the mobile header/navigation, post actions, feed filters, and wallet dialog comfortable at 320–430 px widths and accessible by keyboard/screen reader.
- Add feedback/report entry points and a short privacy explanation; keep the technical node walkthrough under About.

### Next: the distinctive social desktop

- **The station:** observe whether the current Desk shortcuts and named Crew feed are useful before adding more groups or layouts. Add optional encrypted sync only after the local model proves useful.
- Add global cast search only when a supported index/query path can return accurate results and state its coverage; do not present loaded-view filtering as network search.
- **Rooms:** start with a small number of readable, curated topic rooms built from public conversations. Add clear hosts/rules, mute/block/report, and moderation appeals before room creation is open.
- **Conversation view:** open a post and follow its replies in context; reply without losing the feed position.
- **Desktop workspace:** let users arrange a feed, buddy list, and one room in familiar windows; save a few named layouts. Do not start with a complicated customizable dashboard.
- **Phone:** translate the same places into bottom navigation and a focused single-column flow. Ship the responsive web app first; package iOS/Android after repeat use proves the flow.

### Later, only if people return

Username search, richer discovery, notifications, multi-device Desk sync, native apps, and host tools. DMs, live presence, video upload, offline network feeds, and algorithmic ranking wait: they add privacy, moderation, and operating costs without proving the core social loop. If Nostr DMs are explored later, use a separate opt-in identity key and established message format; never derive it from or request a Farcaster recovery phrase, and explain relay metadata limits.

## Pricing

Castonaut is free to use for now. Keep sign-in, reading, posting, feeds, profiles, and personal Desk features available without payment. Revisit optional support only after the contest and user feedback.

## Banned-account promise and trust

The product welcomes people who cannot use another client, but an alternate UI cannot override protocol or service rules. Test read, signer authorization, submission, and network propagation separately with consenting accounts. Show which step failed and who controls it. Never advertise guaranteed ban recovery or use payment as access to basic posting.

Never persist or transmit custody seed phrases. Use a narrowly scoped app signer, explain how to revoke it, and never claim the service hides every network identifier. Proxy protocol requests through the app service where practical; be clear that hosting, wallet, payment, and external-link providers may see connection metadata.

## What would make this work

Invite 10–20 longtime Farcaster users to try the full flow, with the full free flow before expanding the product. Track successful feed loads, posts confirmed by read-back, Time Capsule replay, Desk use, and 7-day returns. Fix first-run confusion before adding rooms or synced preferences.

Keep early infrastructure on a budget and configure billing alerts before creating any cloud resource. The operator owns the hosted Snapchain endpoint; users should not have to run a node. Vercel Hobby can serve the client and server-side proxy within its free usage limits. Use Google Cloud for a bounded contest node test only; its free-trial credits cover eligible costs without charging the payment method, but still consume the grant. The current 4-vCPU/16-GB VM plus a 2-TB data disk and 30-GB boot disk is estimated around $0.25/hour ($42 for seven days), before networking. Stopping the VM leaves the 2-TB disk billable at about $82/month. A **$25 monthly project budget** tracks gross usage with 50%, 80%, and 100% alerts; it warns but does not stop resources. Stay on free-trial billing, start the node only for the test window, and delete its VM, data disk, and firewall after testing if the account credit should be preserved.
