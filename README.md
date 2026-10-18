# Openroom

Openroom is a responsive Farcaster web client for desktop and mobile. It includes public and following feeds, posting, replies, reactions, follows, profile lookup, people search, locally saved posts, and Free, Plus, and Founder membership entry points. It uses Farcaster through a server-side Neynar adapter and does not ask for wallet seed phrases.

## Features

- Public channel feeds and a connected user's following feed.
- Farcaster signer approval, session restore, disconnect, posting, replies, likes, recasts, and follows.
- Profile lookup, user search, and conversation threads.
- Saved posts stored locally in the browser.
- Free, Plus, and Founder plan cards. The Founder offer includes 12 months of Plus.
- Responsive desktop and mobile layouts with keyboard accessible controls.

## How someone starts using it

On the deployed site, a visitor can open a public room and read casts immediately. The **People** view searches existing Farcaster profiles. **Connect Farcaster** starts signer approval in Farcaster; after approval, Openroom shows the user's following feed and enables casting, replies, reactions, and follows. The account menu disconnects this browser session. Saved posts remain on that device.

If the API credentials are missing, the home feed is visibly marked as an illustrative preview and live actions explain the missing configuration. A local static file preview cannot complete account connection.

Paid membership checkout is prepared as a product entry point, but requires the Base contract address and ABI before it can accept payments or verify entitlements. Membership must not gate basic Farcaster read or write operations. Plus and Founder can unlock Openroom-specific features once checkout and entitlement checks are connected.

**Hosting plan:** Vercel Hobby is for personal, noncommercial use under Vercel's current terms. Use it for a prototype with no paid sales. Move the paid launch to a commercial hosting plan before enabling Plus or Founder checkout. Neynar API usage and signer approvals may have separate costs.

## Deploy to Vercel

1. Import this repository into Vercel and leave the project root at the repository root. The included `vercel.json` selects the **Other** framework, serves `public/`, skips the build step, and creates Node functions from `api/`.
2. Add `NEYNAR_API_KEY` as a server-side environment variable.
3. Add `SESSION_SECRET` as a random secret of at least 32 characters. Keep both values in Vercel environment settings; never commit them or expose them in browser JavaScript.
4. Deploy, then test the public feed and the signer approval flow on the production domain.

The first deployment should serve `/` from `public/index.html`, `/app.js` from `public/app.js`, and `/api/feed?channel=farcaster` from a Node function. If the API key is missing, the last route intentionally returns `503` with a JSON configuration message. After setting environment variables, redeploy so the functions receive them.

The Neynar managed signer approval permits Openroom to post, react, recast, and follow on the user's behalf. Explain that permission clearly before connecting. Users can revoke the signer from their Farcaster account settings. Disconnecting here clears the Openroom browser session; it does not revoke the Neynar signer.

## Local preview

Opening `public/index.html` directly supports the static preview only. The API routes need a Vercel-compatible serverless runtime and the two environment variables above. For local development, use Vercel's local development runtime after linking your own project, and do not commit a local `.env` file.

## Contract integration

When the Base contract is ready, add a small client-side wallet integration for `Plus` and `Founder`, with contract address and ABI supplied as configuration. Verify membership against the contract on the server or through a trusted read-only RPC before enabling Openroom-specific perks. Founder must receive the documented 12 months of Plus. Show the transaction network, amount, and contract before the wallet confirmation. Do not store private keys or wallet secrets.

## Important product boundary

Openroom is an independent Farcaster client. It cannot reverse a protocol-level or app-level ban, guarantee access to a banned account, or promise that protocol owners will continue supporting a particular API. Signer approval, read access, and write access may differ by account. State those limits plainly and test with consenting accounts before making availability claims.
