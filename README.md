# Castonaut

<p align="center">
  <img src="public/og-castonaut.png" alt="Castonaut — a calm, personal station for Farcaster" width="900">
</p>

<p align="center">
  <a href="https://castonaut.vercel.app/"><img alt="Open Castonaut" src="https://img.shields.io/badge/OPEN%20CASTONAUT-Live-66509a?style=for-the-badge"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-ead9b1?style=for-the-badge"></a>
  <img alt="Node.js 22" src="https://img.shields.io/badge/Node.js-22-7e9c72?style=for-the-badge&logo=node.js&logoColor=white">
</p>

**Catch up in time order. Keep your people and posts close.** Castonaut is an independent, open-source Farcaster client with a readable chronological feed and a personal Desk for the people, posts, and topics you want to find again. It borrows the care of classic Mac software—clear windows, familiar controls, and a little orbital character—without getting between you and the conversation.

You can browse the hosted client without setting up a node or entering an API key. Bring an existing Farcaster account when you’re ready to follow, react, or post.

<p align="center">
  <img src="docs/screenshots/desktop.png" alt="Castonaut desktop view with its Finder-like sidebar, sample timeline, and personal Desk preview" width="900">
</p>

<p align="center"><em>The public preview: explore the layout and sample timeline before connecting an account.</em></p>

## A familiar place for your Farcaster life

- **A feed you can follow:** read recent casts in chronological order, switch to Top people, or discover accounts through your follow graph. Posts keep replies, quoted casts, links, and media in context.
- **The Desk:** pin people, save casts, and collect topics into personal stacks. Desk data stays in this browser; it is not published to Farcaster or synced to another device.
- **Native social actions:** write casts and threads, reply, quote, like, recast, and follow from the client. Your actions use your Farcaster app signer and are public protocol activity.
- **Search with clear scope:** filter posts loaded in the current feed, open a person by exact username or FID, or load a channel timeline from the configured Snapchain node. Search does not require a Neynar search key or pretend to be a full-network text index.
- **Play & tools:** open the built-in games and Farcaster tools without turning the main timeline into a busy arcade.
- **A Mac-inspired interface:** light and dark moods, careful typography, compact status details, responsive navigation, and keyboard access for common actions.

<p align="center">
  <img src="docs/screenshots/mobile.png" alt="Castonaut's compact layout with the navigation sidebar, Desk preview, sample feed, and fixed bottom dock" width="560">
</p>

## Start in three steps

1. **Browse.** Open [castonaut.vercel.app](https://castonaut.vercel.app/) and read the public sample feed.
2. **Connect when ready.** Use an existing Farcaster account’s recovery phrase to authorize a separate, limited app signer in this browser. The phrase is processed in the page and cleared after use; only continue on a deployment and device you trust. The app signer can perform social actions but cannot move funds. Review the account and authorization details before approving.
3. **Make it yours.** Follow people, personalize the feed, and keep useful people and posts on your Desk. Castonaut’s hosted node connection works out of the box; running your own node is optional.

“Forget this browser” removes the local signer key. It does not revoke the signer on Farcaster; revoke it separately in account settings when needed. The Desk, saved posts, drafts, filters, and preferences are local to this browser. Export a Desk backup before clearing browser data.

## Run Castonaut locally

Requires Node.js 22.

```sh
git clone https://github.com/wlplease/castonaut.git
cd castonaut
npm ci
npm run dev
```

The Vite preview uses Castonaut’s hosted Snapchain proxy by default. To connect a local server directly to your own node, set `SNAPCHAIN_URL` in a root `.env` file. Keep node credentials server-side; never expose them through a `VITE_` variable. The [three-step quickstart](https://castonaut.vercel.app/tutorial.html#quickstart) covers node setup, readiness checks, costs, and cleanup.

Useful commands:

```sh
npm run build       # production client build
npm test            # project checks
npm run node:status # check your configured node
```

## Run your own node

Castonaut works as a client without a self-hosted node. If you want to operate one, the guide walks through the Snapchain setup and how the client’s signed messages and reads travel through it. Set `SNAPCHAIN_URL` on the server deployment, keep the node caught up, and check readiness before inviting people to use it. The node is public protocol infrastructure; the app’s rate limits are best-effort and are not a substitute for network-level abuse protection.

## Optional integrations

Core feed, profile, follow, post, reaction, and search features do not require users to provide API keys. Operators may configure GIPHY and Redis for shared GIF search, and Vercel Blob for optional photo uploads. These service credentials belong only in server-side environment variables; see [`.env.example`](.env.example). Direct links and Farcaster media embeds remain available without the optional services.

## Project links

- [Open the client](https://castonaut.vercel.app/)
- [Three-step quickstart and operating guide](https://castonaut.vercel.app/tutorial.html#quickstart)
- [Privacy Notice](privacy.html) · [Terms of Use](terms.html) · [Security guide](https://castonaut.vercel.app/tutorial.html#security)
- [Product plan](PRODUCT_PLAN.md) · [Brand guide](BRAND_GUIDE.md)
- [MIT License](LICENSE)

## Before a public launch

The operator contact and governing-jurisdiction details in the Privacy Notice and Terms still need to be completed. Finish those details and verify the live deployment’s node and optional services before inviting the public.

## License

Castonaut is released under the MIT License. See [`LICENSE`](LICENSE).
