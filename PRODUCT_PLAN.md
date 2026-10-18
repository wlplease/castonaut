# Independent Farcaster client — product plan

Status: product direction and implementation notes, 15 October 2026. The current web client is in `public/` and `api/`. Live Farcaster use needs Neynar configuration; paid membership needs the Base contract address and ABI.

## Today: urgent first release

Build a beautiful, inclusive web experience that works on desktop and mobile browsers today. It should welcome long-time Farcaster users, people affected by the new app, and people curious about the network. Native app packages come later; the first release must already feel good on a phone.

**Promise:** "Your people, your Farcaster." The page should say plainly that this is an independent client, not an official Farcaster product, and should not promise to reverse a ban.

**Today’s usable path:**

1. A public landing page with a live preview of recent public conversation, a short statement of values, and one clear **Open the client** action.
2. A responsive client with a chronological following feed, thread view, profiles, and text posting/replies if independent signer authorization works. Reading must work without login.
3. A connection/status screen that explains whether a user can read, authorize a signer, and publish. Give a useful explanation if a step fails.
4. A simple invite/feedback form so early users can report problems and help shape the next version. Collect only the data needed to reply.

**Design direction:** warm, lively, and human. Strong typography, generous spacing, clear contrast, excellent mobile touch targets, keyboard access, reduced-motion support, alt text for product imagery, and neutral copy that welcomes people without sorting them into "banned" and "not banned." Show real conversations with consent rather than stock community imagery. Provide light and dark themes if feasible without delaying the working path.

**Today’s launch gate:** one affected and one unaffected consenting account can complete the full sign-in-to-publish path, or the release is clearly labeled read-only while the write path is fixed. Verify on a phone-sized browser and desktop. Check the network panel for direct calls to unapproved third parties and confirm the page never asks for a seed phrase.

**Today’s spending:** keep the site and API on starter tiers, cap requests and media proxy usage, and use a no-cost feedback channel. Do not buy a node or paid API tier today. Free, Plus, and Founder are all part of the launch offer; connect checkout and entitlements when the Base contract is supplied, then verify live publishing before taking payment.

## Current product shape: old school PC social, modern client

The differentiator is a place to hang out: expressive profiles, a buddy list, and topic rooms layered on the Farcaster graph. The immediate utility for people affected by the official app is independent read/post access when the protocol permits it. Do not make a person's ban status a paid feature or claim that payment changes protocol access.

### Simple levels

| Level | Price hypothesis | Includes |
| --- | --- | --- |
| Free | $0 | Read public content; sign in, post, reply, follow, use rooms, basic profile, block/mute, and export app settings |
| Plus | $5/month or $50/year | Profile themes and approved widgets; saved feeds and bookmark folders; favorite-people alerts; richer buddy-list organization; optional supporter badge |
| Founder | $29 one time, capped | **12 months of Plus included**, a founding theme/badge, early feedback access, and optional public credit. Renewal after 12 months is opt-in, with no automatic charge unless the user explicitly subscribes |

Plus needs both identity and daily utility. Themes make it fun; saved feeds, organized bookmarks, and alerts for chosen people give users reasons to keep paying. Start with themes, saved feeds, and bookmark folders; add alerts after notification reliability is proven. Avoid paid reach, paid ranking, exclusive posting, paid moderation outcomes, or paid ban appeals. The free client must be complete enough to keep friendships and conversations alive.

### First public version

1. Chronological following feed, profiles, threads, posting, replies, follows, mute/block.
2. A small set of curated rooms built from Farcaster conversations; each has clear local rules and a host.
3. Profile banner, bio, links, and one tasteful free theme; a few premium themes can follow after people use the product.
4. Buddy list as a private organization tool, not live presence at launch. Presence and DMs add privacy/operational complexity and come later only if users want them.
5. Account diagnostic for affected users: read, signer authorization, submit, propagation. It explains failures without labeling the person publicly.

### Profit test

Keep the first month below the stated infrastructure cap at invite scale. At $5/month, 20 Plus subscribers bring $100 gross/month; this is enough to test willingness to pay, not enough to cover meaningful labor. Founder payments are one-time cash, not recurring revenue, and include a future year of Plus service. Measure free weekly return and Plus conversion separately. Aim for 100 weekly active users and 20 paying subscribers before expanding paid infrastructure or native app work. These are decision thresholds, not forecasts.

## Product promise

A welcoming, fast client for people who liked early Farcaster: familiar identity and follows, chronological conversation, useful discovery, and room for playful apps. It works on desktop web and iOS/Android. The product respects the new official Farcaster direction while giving users another choice of interface and community rules.

Core participation stays free. We will never market the app as a guaranteed way around a ban. We first verify whether an affected account can publish through the protocol using an independent signer and API.

## Decisions to prove before implementation

1. **Protocol access:** Test read, sign, publish, and propagation with consenting affected and unaffected accounts. Record the exact failure point for each. A client-level block and a protocol-level rejection require different responses.
2. **Authentication:** Confirm a sign-in and signer authorization path that works for users who cannot access the official client. No seed phrase entry into our app. Users can revoke the app signer.
3. **Data source:** Compare Neynar and direct Snapchain reads for feed completeness, latency, cost, and operational dependence. Avoid relying on undocumented official client endpoints.
4. **Audience:** Interview at least 10 long-time users, including affected users, on what they miss and what would make them return daily.
5. **Reference code:** Review the MIT-licensed `farcasterxyz/client` snapshot for reusable patterns. It excludes the wallet and points to Farcaster's production API, so adopting it wholesale may create dependence we do not want.

## Experience

### Shared core

- Chronological following feed and thread view.
- Casts, replies, reactions, recasts, follows, profiles, media embeds, and links.
- Search and discovery of people, conversations, channels, and mini apps.
- Personal controls: mute, block, keyword filters, media controls, and report.
- A visible service status page and an export of app-specific settings and lists.
- Clear distinction between protocol data and features hosted by our app.

### Desktop

- Responsive web app first; keyboard navigation, multiple columns, saved views, and good link sharing.
- Installable PWA once offline shell and notifications are reliable. A packaged desktop app is a later decision based on demand.

### Mobile

- Native-feeling iOS and Android app with shared TypeScript models and API client.
- Fast feed, media capture/upload, deep links, push notifications, and secure local session storage.
- Mobile releases follow a working web beta, using the same backend and product rules.

### Signature feature

**Scenes:** user-curated views of Farcaster conversations. Hosts can set a theme, feature people and posts, and publish clear local rules. Scenes are discovery and presentation layers; they do not claim ownership of users' protocol identities or follows. Begin with one scene co-designed with early Farcaster users, then open host tools after the core client is reliable.

## Architecture

- Monorepo: `apps/web`, `apps/mobile`, `packages/ui`, `packages/farcaster`, `packages/types`, `services/api`.
- Web: React/Next.js or comparable framework, chosen after the reference-code review.
- Mobile: React Native/Expo, sharing domain types and API code with web; platform-specific navigation and interactions.
- Backend: small API for normalized feeds, search, notifications, reports, scene configuration, and account preferences.
- Protocol adapter: one interface for reads and writes, with a hosted provider first and a direct Snapchain path tested separately. Do not bind product code to one vendor's response shapes.
- Database: PostgreSQL for app-specific data; cache only what feeds and rate limits require. Protocol identity and casts stay on Farcaster.
- Auth: Farcaster identity proof plus a scoped app signer for writes. Encrypt signer material, protect sessions, support revocation, and audit write paths. Never ask for a custody wallet seed phrase.
- Observability: read/write success rates, feed freshness, provider errors, moderation queue, and infrastructure spend.

## Moderation and trust

- Publish short, concrete client rules before the public beta.
- Users control their own blocks and mutes. Hosts can curate scenes. App-wide restrictions are reserved for spam, threats, illegal material, and direct harm to the service or users.
- Give a reason and an appeal route for app-wide restrictions. Document whether a restriction is ours, a provider failure, or a protocol rejection.
- Do not promise unrestricted reach: app stores, hosting providers, API providers, and the protocol each have policies or constraints.

## Delivery sequence and gates

| Stage | Deliverable | Gate to continue |
| --- | --- | --- |
| 0. Feasibility | Read/write test with consenting accounts, sign-in design, provider comparison, 10 interviews | Affected users can publish independently, or a revised product promise is agreed |
| 1. Web alpha | Feed, profile, thread, posting, replies, follows, mutes; internal users | Reliable writes, secure signer flow, acceptable feed freshness |
| 2. Web beta | Search, discovery, reporting, status page, first Scene, public onboarding | 50–100 invited users; repeat weekly use and resolved support issues |
| 3. Mobile beta | iOS and Android apps, deep links, media, push | Shared behavior with web; app review and crash targets met |
| 4. Independence | Own Snapchain read node/index where it lowers risk or cost | Operating budget and on-call capacity cover it |

## Money

- Free core reading and posting.
- Optional supporters: visual extras, saved views, and early feature access; no paywall on basic social access.
- Later paid host tools for Scenes, events, and analytics. Validate willingness to pay with hosts before building billing.
- Early operating budget: hosted API plus web/backend/database/monitoring; use a monthly spending cap and alerts. Neynar currently lists a free tier and a $249/month scale tier. A self-hosted Snapchain node is a separate infrastructure commitment: its current documentation lists 16 GB RAM, 4 vCPUs, 1.5 TB storage, and a public IP. Final cost depends on traffic, storage, region, and provider.
- Track monthly cost per active user, supporter conversion, host retention, and support burden. Avoid assuming donations will fund the product.

## First 30 days: lean launch and founding sale

The first month sells a credible founding membership, not access around a ban. Free, Plus, and Founder should be usable at launch once the contract and entitlement checks are connected. Verify independent posting and the offer page before taking payment. Core reading and posting remain free.

| Week | Ship | Decision gate |
| --- | --- | --- |
| 1 | Test affected and unaffected accounts; confirm authentication and publishing; interview founding users; name and visual direction | If affected users cannot publish, revise the promise before taking money |
| 2 | Responsive web alpha: following feed, threads, profiles, text posting, replies, mute/block; private invite list | Founders can use it for real conversations |
| 3 | Invite 25–50 users; repair top reliability issues; add simple status page and feedback link | At least 15 users return in the following week and posting succeeds consistently |
| 4 | Public web beta and founding supporter sale; publish mobile preview and development milestones | At least 20 paid supporters or equivalent committed funding, with real repeat use |

### First-month scope cuts

- One responsive web codebase for desktop and mobile browsers. Native iOS/Android work begins after the web beta proves demand; it remains a product commitment, not a first-month claim.
- Text posts, links, and existing image embeds first. Defer video upload, DMs, custom wallets, tokens, algorithmic feed, full mini-app hosting, and multiple Scenes.
- One hosted API provider with an isolated adapter and a separate direct Snapchain proof. Do not operate a production node in month one.
- One small app database for sessions and preferences. Avoid storing copies of every cast or building a full network index.
- Privacy proxy only for feed media and link previews at launch; external links and mini apps stay click-to-open with a clear boundary.

### Founder offer

- Suggested test price: **$29 one time**, capped at 100 supporters. This is a planning hypothesis to validate with users.
- Includes **12 months of Plus**, an optional founding badge/theme, private feedback channel, early access to new features, and a say in the first Scene. Renewal after the included year is opt-in. It does **not** buy posting access, moderation immunity, guaranteed reach, or lifetime service.
- Publish a demo, known limitations, target mobile milestones, and a straightforward refund policy before checkout. Invite founding users who helped shape the product to participate without pressure.
- Use the Base contract selected by the project owner. Present the exact transaction in the wallet and verify entitlement from the contract before unlocking paid features.

### Cash controls

- Target a **$50–$100 first-month infrastructure budget** at invite scale, excluding the founder's labor, domain purchase, taxes, and payment fees. This is a cap to enforce, not a guaranteed bill.
- Example baseline: Cloudflare Workers Paid starts at $5/month; Supabase Pro starts at $25/month, though a free database may suffice for private alpha; Neynar lists a free developer tier. Set provider budget alerts and rate limits before opening invites.
- If the free API allowance is exceeded or reliability is inadequate, price the next tier before upgrading. Neynar's published scale tier is $249/month; do not incur it just to keep the beta open without a funding decision.
- Monthly review: cash in, cash out, active users, successful posts, 7-day return, support hours, and cost per active user. Stop adding features if reliability or retention is weak.

## Main risks

1. **Protocol change:** New owners may change protocol or distribution policies. Mitigation: keep the adapter isolated, monitor proposals/releases, and be precise about what portability means.
2. **Access mismatch:** An app-level ban may also prevent signing or publishing in practice. Mitigation: test before launch claims; offer a clear account/status diagnostic.
3. **Empty network effect:** A technically sound client can still feel quiet. Mitigation: recruit founding hosts and their existing conversations before broad launch.
4. **Security:** Signers and media uploads make a social client a real target. Mitigation: minimal privileges, revocation, encryption, rate limits, dependency review, and a security review before public writes.
5. **Vendor dependence:** Hosted APIs accelerate launch but can become a single point of failure. Mitigation: interface abstraction, direct Snapchain proof, and documented fallback behavior.

## Privacy and resilience design

### IP exposure model

The app cannot promise anonymity. Its edge provider will see connection IPs; mobile operating systems, app stores, payment processors, and a user's wallet/RPC may see network metadata. Our goal is narrower and testable: ordinary use should not send a user's IP directly to Farcaster infrastructure, Neynar, or third-party media hosts.

- Route feed reads, profile reads, search, and cast submission through our backend. Browser and mobile clients call only our API for protocol operations. The backend uses provider credentials and publishes signed messages; it must not accept custody seed phrases.
- Serve remote images and link previews through an image/proxy service with content-type checks, size limits, cache, and abuse controls. Disable direct remote embeds by default; offer a click-to-load option with a clear privacy notice. Strip tracking query parameters from displayed links where safe.
- Do not embed third-party analytics, fonts, scripts, or pixels. Serve assets from our domain. Do not expose IPs in public logs, error pages, metrics, support screenshots, or moderation screens.
- Use a reputable edge/reverse proxy, encrypt traffic end to end, limit raw access logs, and set a short retention period. Separate security logs from product analytics and document who can access them.
- Treat outbound link clicks, external mini apps, wallet connection, and payments as explicit transitions: those destinations can see the user's IP. Make that boundary visible in the UI.
- Run a network capture on web, iOS, and Android before release to verify the ordinary feed/posting flows contact only approved hosts. Repeat after major SDK or media changes.
- Do not run a Snapchain node from a home or personal connection. A node needs a public IP for peer traffic; host it in a dedicated account/network isolated from the app and personal devices. Its public server IP is expected to be visible to peers, while user IPs should not be forwarded to it.

### Protocol and provider resilience

- Keep protocol message construction, read APIs, and write submission behind separate adapters. Pin and test against current protocol versions; monitor releases and proposals.
- Maintain a read-only fallback when writes fail, and show whether the failure is signer authorization, storage, provider, or protocol rejection. Never imply a second client overrides a protocol-level rule.
- Compare two independent data paths in the alpha. Start with hosted access for speed, but run a direct Snapchain proof early. A production node is a later operational decision and is not a guarantee against network governance changes.
- Preserve app-specific data in portable exports: scene membership, settings, host lists, and moderation decisions. Let users remove their account data from our service. Farcaster protocol history follows its own retention and deletion rules.

### Security release gates

- No custody seed phrase collection. Use narrowly scoped app signers, revocation instructions, encrypted storage, and secret rotation.
- Protect write endpoints against replay, CSRF where applicable, rate abuse, and account enumeration. Restrict media uploads by type and size, scan them, and isolate processing.
- Complete a focused external security review before public posting; test backup restore, incident response, and emergency disable of writes.

### Community launch gate

- Recruit founding hosts and their existing circles before opening signups. Launch with a curated following feed and one active Scene; measure real conversations and week-four return, not only account creation.
- Make supporter payment optional. Paid host tools launch only after hosts demonstrate repeat use and state a willingness to pay.

## Sources checked

- Farcaster client snapshot: https://github.com/farcasterxyz/client
- Protocol: https://github.com/farcasterxyz/protocol
- Snapchain: https://github.com/farcasterxyz/snapchain
- Neynar developer pricing: https://neynar.com/developer
- Cloudflare Workers pricing: https://www.cloudflare.com/plans/developer-platform/
- Supabase pricing: https://supabase.com/pricing
- Stripe US pricing: https://stripe.com/pricing
