# Herald's Forge

Unofficial community tool for [Heraldia](https://heraldia.art) — fully on-chain generative heraldic art by ab83.

Herald's Forge lets you craft custom artwork for your Heraldia tokens by choosing a theme, pattern, background, and color seed, previewing the result live, and writing it on-chain via `selectArt`.

> **Not affiliated with ab83 or the Heraldia team.** This tool interacts directly with the public Heraldia smart contracts on Ethereum mainnet.

## What's inside

```
├── web/              React app (Vite + wagmi + RainbowKit)
├── generate.mjs      CLI for local artwork generation & hash crafting
├── CONTRACTS.md       Contract system documentation
└── output/           Probe results, trait maps (gitignored)
```

### Web app (`web/`)

A wallet-connected interface with three views:

1. **Landing** — explains what the tool does, invites wallet connection
2. **Gallery** — shows all Heraldia tokens owned by the connected wallet (uses Alchemy NFT API for token discovery, on-chain renderer for current artwork)
3. **Crafter** — side-by-side current vs. preview panels, trait selectors, color seed, and on-chain `selectArt` / `resetArt` transactions

### CLI (`generate.mjs`)

Node.js scripts for local experimentation:

| Command | Description |
|---------|-------------|
| `npm run fetch -- <tokenId>` | Fetch and save on-chain artwork for a token |
| `npm run preview -- <tokenId> <hash>` | Preview artwork with a custom hash (uses `stateOverride`) |
| `npm run random -- <tokenId>` | Generate artwork with a random hash |
| `npm run probe -- <tokenId>` | Systematically vary hash bytes to map traits |
| `npm run analyze` | Derive byte-to-trait mapping from probe results |
| `npm run craft -- <tokenId> --Theme Sun --Pattern Dot --Background "Grid Bold"` | Build a hash from desired traits |

## Setup

### Prerequisites

- Node.js 20+
- An [Alchemy](https://www.alchemy.com/) API key (free tier works)
- A WalletConnect project ID (optional, for mobile wallet support)

### Environment

Create `.env` in the repo root (used by the CLI):

```env
TOKEN_CONTRACT_ADDRESS=0x11A7E42036F8D039b0ce54b5488E3df0dfF6Cf36
RENDERER_CONTRACT_ADDRESS=0xeB9c4Ec06e15c95b5cA9e78171431a5C4cd57064
STORAGE_CONTRACT_ADDRESS=0x0D562A65d3A209738Eba9601A88Bb0A62bc66391
ART_SELECTION_CONTRACT_ADDRESS=0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769
COLOR_WRAPPER_CONTRACT_ADDRESS=0xA6061e340DF02846230FF59072b5B17774211965
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

Create `web/.env` (used by the web app):

```env
VITE_ALCHEMY_API_KEY=YOUR_KEY
```

### Install & run

```bash
# CLI tools
npm install

# Web app
cd web
npm install
npm run dev
```

The web app runs at `http://localhost:5173`.

## How it works

Heraldia uses a dual-hash mechanism:

- **Static hash** — set at mint, defines the emblem shape. Immutable.
- **Dynamic hash** — derived from the owner's wallet address. Determines colors, pattern, and background.

The `selectArt` function on the ArtSelection contract lets token owners override the dynamic hash with a custom `bytes32` value. Herald's Forge constructs that hash from human-readable trait selections:

| Trait | Hash byte | Operation |
|-------|-----------|-----------|
| Theme | 0 | `byte % 2` → Sun / Moon |
| Pattern | 1 | `byte % 4` → Pixel / Dot / Cross / Mix |
| Background | 2 | `byte % 21` → 21 variants |
| Colors | 3–31 | Remaining bytes influence the color palette |

## Contracts

| Contract | Address |
|----------|---------|
| Heraldia (ERC-721) | [`0x11A7...Cf36`](https://etherscan.io/address/0x11A7E42036F8D039b0ce54b5488E3df0dfF6Cf36) |
| Renderer | [`0xeB9c...7064`](https://etherscan.io/address/0xeB9c4Ec06e15c95b5cA9e78171431a5C4cd57064) |
| Storage | [`0x0D56...6391`](https://etherscan.io/address/0x0D562A65d3A209738Eba9601A88Bb0A62bc66391) |
| Art Selection | [`0x3Af9...8769`](https://etherscan.io/address/0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769) |
| Color Wrapper | [`0xA606...1965`](https://etherscan.io/address/0xA6061e340DF02846230FF59072b5B17774211965) |

See [CONTRACTS.md](CONTRACTS.md) for full documentation.

## License

MIT
