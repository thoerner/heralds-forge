# Herald's Forge

A community-built tool for crafting custom artwork on [Heraldia](https://heraldia.art) NFTs — fully on-chain generative heraldic art by ab83.

Pick a theme, pattern, background, and color seed, preview the result live, and write it on-chain. Your crest, your rules.

> **Not affiliated with ab83 or the Heraldia team.** Herald's Forge interacts directly with the public Heraldia smart contracts on Ethereum mainnet.

## Features

**Crafter** — side-by-side current vs. preview panels with trait selectors and a color seed picker. Apply your design on-chain with `selectArt` or revert with `resetArt`, all from the browser.

**Gallery** — browse every Heraldia token in your wallet with live on-chain artwork rendering.

**Past Looks** — see the history of previous artwork configurations for any token, auto-refreshes after on-chain changes.

**Explore mode** — append `?tokenId=<id>` to the URL to preview any token without connecting a wallet.

**Wallet backgrounds** — each connected wallet gets a unique SVG background pattern derived from its address, adapting to light and dark mode.

**Recently forged crests** — the landing page shows ambient floating crests that were recently forged through the app.

**FAQ** — answers to common questions about the tool and how it works.

## How it works

Heraldia artwork is driven by two hashes:

- **Static hash** — set at mint, defines the emblem shape. Immutable.
- **Dynamic hash** — normally derived from the owner's wallet address. Determines colors, pattern, and background.

Herald's Forge uses the [selectArt](https://etherscan.io/address/0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769#code#F1#L32) function on the ArtSelection contract to override the dynamic hash with a custom `bytes32` value. The app constructs that hash from human-readable trait selections:


| Trait      | Hash byte | Effect                      |
| ---------- | --------- | --------------------------- |
| Theme      | 0         | Sun / Moon                  |
| Pattern    | 1         | Pixel / Dot / Cross / Mix   |
| Background | 2         | One of 21 variants          |
| Colors     | 3–31      | Influence the color palette |


Custom art is tied to your wallet — if you transfer the token, the new owner sees their own default art. If it comes back to you, your custom art reactivates. See [CONTRACTS.md](CONTRACTS.md) for the full contract documentation.

## Project structure

```
web/              React app (Vite + wagmi + RainbowKit)
infra/lambda/     AWS Lambda for the recently forged crests API
generate.mjs      CLI for local artwork generation & hash crafting
CONTRACTS.md      Heraldia contract system documentation
```

## Setup

### Prerequisites

- Node.js 20+
- An [Alchemy](https://www.alchemy.com/) API key (free tier works)
- A WalletConnect project ID (optional, for mobile wallet support)

### Environment

Create `web/.env` for the web app (see `web/.env.example`):

```env
VITE_ALCHEMY_API_KEY=YOUR_KEY
VITE_FORGE_API_URL=YOUR_LAMBDA_FUNCTION_URL
VITE_FORGE_API_KEY=YOUR_FORGE_API_KEY
VITE_WALLET_CONNECT_PROJECT_ID=YOUR_WALLETCONNECT_PROJECT_ID
```

Create `.env` in the repo root if you want to use the CLI tools:

```env
TOKEN_CONTRACT_ADDRESS=0x11A7E42036F8D039b0ce54b5488E3df0dfF6Cf36
RENDERER_CONTRACT_ADDRESS=0xeB9c4Ec06e15c95b5cA9e78171431a5C4cd57064
STORAGE_CONTRACT_ADDRESS=0x0D562A65d3A209738Eba9601A88Bb0A62bc66391
ART_SELECTION_CONTRACT_ADDRESS=0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=0xYOUR_PRIVATE_KEY   # required for apply/reset commands
```

### Install & run

```bash
cd web
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

### Build & deploy

The web app deploys as a static site to S3 + CloudFront:

```bash
cd web
npm run build
aws s3 sync dist s3://YOUR_BUCKET --delete --exclude "api/*"
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

The `--exclude "api/*"` flag preserves the `recent-forges.json` file managed by the Lambda.

### CLI tools

The repo root contains `generate.mjs`, a full-featured CLI for local experimentation and on-chain writes. Requires `PRIVATE_KEY` in `.env` for on-chain commands (`apply`, `reset`).

```bash
npm install   # from repo root
```

#### Viewing & previewing


| Command                                           | Description                                   |
| ------------------------------------------------- | --------------------------------------------- |
| `npm run fetch -- <tokenId>`                      | Fetch and save current on-chain artwork       |
| `npm run preview -- <tokenId> --hash <bytes32>`   | Preview artwork with a specific hash          |
| `npm run preview -- <tokenId> --wallet <address>` | Preview as if a wallet owned the token        |
| `npm run preview -- <tokenId> --random`           | Preview with a random hash                    |
| `npm run history -- <tokenId>`                    | List all past art hashes from on-chain events |
| `npm run history -- <tokenId> --preview`          | Same, but also generate SVG previews          |


#### Crafting & color discovery


| Command                                                                         | Description                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `npm run craft -- <tokenId> --Theme Sun --Pattern Dot --Background "Grid Bold"` | Build a hash from desired traits                |
| `npm run craft -- <tokenId> --seed 42 --Theme Moon`                             | Same, with a deterministic variation seed       |
| `npm run color-list`                                                            | List all known accent colors from probe data    |
| `npm run color-search -- <tokenId> <#hex>`                                      | Brute-force hashes to find a target color       |
| `npm run sweep -- <tokenId> --Background Solid --Pattern Cross`                 | Discover all reachable colors for a trait combo |


#### On-chain writes


| Command                             | Description                                |
| ----------------------------------- | ------------------------------------------ |
| `npm run apply -- <tokenId> <hash>` | Apply custom art on-chain (`selectArt`)    |
| `npm run reset -- <tokenId>`        | Reset to default art on-chain (`resetArt`) |


Both show a gas estimate and require `y` confirmation before submitting.

#### Analysis (advanced)


| Command                      | Description                                     |
| ---------------------------- | ----------------------------------------------- |
| `npm run probe -- <tokenId>` | Systematically vary hash bytes to map traits    |
| `npm run analyze`            | Derive byte-to-trait mapping from probe results |


A default `output/trait-map.json` is included in the repo. Run `probe` then `analyze` only if you want to regenerate it yourself.

## License

MIT