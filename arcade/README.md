# Afterhours Arcade

A standalone browser arcade in this repository. `arcade/` is its own Vite project and does not alter the Farcaster prototype in the repository root.

## What works now

- **Neon Rush:** a complete 75-second original score-attack game with keyboard, mouse, touch, and on-screen cabinet controls, combo scoring, three lives, shields, sound, and replay.
- **Arcade floor:** an interactive room with a playable cabinet, score-wall machine, lobby machine, live previews, arcade shortcuts (`1`, `2`, `3`), optional synthesized ambience, and a physical cabinet game view with on-screen controls.
- **High scores and lobby chat:** live Firestore views with anonymous Firebase Authentication. Without Firebase settings, the game still works locally and saves personal bests in the browser.
- **Crypto quarters:** an optional supporter payment. Base USDC and Base ETH purchases go through `AfterhoursArcade.sol` and emit `QuarterPurchased`; a server function verifies the receipt and wallet signature, then records the purchase once in Firestore. Ethereum mainnet ETH support payments go directly to a configured treasury. Free play remains open. Purchased quarters are tracked but are not spendable game credits yet.

## Local development

```bash
cd arcade
npm install
copy .env.example .env.local
npm run dev
```

The game works without `.env.local`; online scores, chat, and quarters remain inactive until configured.

## Firebase setup

1. Create a Firebase project and web app. Enable **Authentication → Sign-in method → Anonymous** and create a **Cloud Firestore** database.
2. Put the web app values in `arcade/.env.local` using `arcade/.env.example`. These are Firebase web identifiers, not private keys.
3. Paste `arcade/firestore.rules` into Firestore Rules and publish them. The rules allow each anonymous account to update only its own best score and to create limited-size chat messages.
4. In Firebase Authentication settings, add your deployed domain to authorized domains.

The current leaderboard is **casual**. Since game results originate in the browser, a determined user can submit a fake score despite the Firestore limits. Before attaching prizes or paid tournaments, add authoritative server-side replay verification and moderation. Anonymous users can also evade bans by clearing browser data. A public chat needs moderation tools and abuse controls before promotion.

## Base contract and Remix setup

The ready-to-paste contract is [contracts/AfterhoursArcade.sol](contracts/AfterhoursArcade.sol). Its generated ABI is [src/contract-abi.json](src/contract-abi.json). Run `npm run contract:compile` after changing Solidity.

1. In [Remix](https://remix.ethereum.org/), create `AfterhoursArcade.sol`, paste the source, and compile with Solidity **0.8.24 or newer**. The source has no imports.
2. Test `buyWithETH`, pause, and withdrawals in Remix VM first. For Base mainnet, connect Remix's browser wallet provider and confirm the wallet is on Base **chain ID 8453**.
3. Deploy with constructor arguments `treasury_` (your wallet address) and `ethQuarterPriceWei_` (the price of one ETH-funded quarter in wei; use `0` to leave ETH sales disabled). The USDC price is fixed in the contract at **250000 units = 0.25 USDC**. Do not use the Ethereum mainnet for this contract: its hard-coded USDC address is Base-specific.
4. Send the deployed contract address and Remix ABI back here. Set `VITE_ARCADE_CONTRACT` to that address in `arcade/.env.local` and your host environment. The current ABI already matches the contract in this repository; we will compare the returned ABI before the live switch.
5. Test a small purchase on Base with a wallet. USDC purchases require an exact-amount **approval transaction** and then a **purchase transaction**. ETH on Base needs one transaction. The contract owner can withdraw proceeds to `treasury`.

To enable claims, add these **server-only** Vercel environment variables: `ARCADE_CONTRACT` (same deployed address), `BASE_RPC_URL`, and `FIREBASE_SERVICE_ACCOUNT_JSON` (the full Firebase service account JSON). Keep them out of browser code and Git. The `/api/claim` function checks a confirmed Base receipt, the deployed contract's purchase event, a wallet signature bound to the Firebase UID, and transaction uniqueness before it records the purchase. It responds idempotently when the same player retries. The client keeps unclaimed transaction hashes locally and shows a retry action if claiming fails after payment.

The contract keeps a lifetime `quartersPurchased` counter per wallet and emits purchase events. The Firebase ledger records claimed purchases; there is no game-credit spending endpoint yet. The web app does not need a private key. Do not put a seed phrase, deployer key, or Firebase service account in Vite environment variables. Anonymous Firebase identity can be lost when browser data is cleared; link it to a durable sign-in before making purchased quarters spendable.

Ethereum mainnet ETH payments are a separate direct support option: set `VITE_ARCADE_TREASURY` and `VITE_QUARTER_ETH_MAINNET`. ETH is not pegged to $0.25, and mainnet network fees can exceed the amount. Mainnet payments do not emit the Base contract event and cannot be treated as Base credits without a separate verifier.

For actual pay-to-play credits, add a server spend transaction and a durable account flow. Do not spend credits in client JavaScript. A contract handling real money should be independently reviewed before public use.

## Deploy

Import the repository to Vercel with **Root Directory** `arcade`. Set the Vite environment variables there and deploy. The included `arcade/vercel.json` builds `dist`. The same build can be hosted as static files elsewhere. For a future cabinet, run the browser build in kiosk mode with a physical joystick mapped to arrow keys.

If you take payments, review your host plan for commercial use. Vercel Hobby currently restricts commercial activity; use a commercial host plan or another provider with appropriate terms.

## Notes

- Do not use copyrighted arcade ROMs, characters, art, or sounds in the original game.
- This is a starting arcade platform, not yet a secure cash tournament or production-moderated community.
