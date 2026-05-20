# Heraldia Contract System

**Chain:** Ethereum Mainnet  
**Solidity:** 0.8.33 (Prague EVM)  
**Deployer:** `0xBB98C1413e86Ff65a0A63c4eaa69078A2272625F`

## Architecture

```
Token Owner
    │
    ├──► HeraldiaArtSelection.selectArt(tokenId, customHash)
    │         │
    │         ▼
    │    Stores custom bytes32 hash per token
    │
    ▼
Heraldia (ERC-721 "HERALD")
    │
    │  tokenURI(tokenId)
    ▼
HeraldiaRendererV2
    ├──► HeraldiaStorage.getStaticHash(tokenId)       ← original mint hash
    ├──► HeraldiaArtSelection.getActiveHash(tokenId)   ← custom override
    ├──► HeraldiaStorage.getTransferCount(tokenId)     ← transfer counter
    └──► ColorWrapper (external)                       ← SVG generation
    │
    ▼
  JSON metadata + base64 SVG data URI
```

---

## Contract Addresses

| Role | Contract | Address |
|------|----------|---------|
| NFT Token | Heraldia | `0x11A7E42036F8D039b0ce54b5488E3df0dfF6Cf36` |
| Renderer | HeraldiaRendererV2 | `0xeB9c4Ec06e15c95b5cA9e78171431a5C4cd57064` |
| Storage | HeraldiaStorage | `0x0D562A65d3A209738Eba9601A88Bb0A62bc66391` |
| Art Selection | HeraldiaArtSelection | `0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769` |

---

## 1. Heraldia (ERC-721 Token)

**Name:** Heraldia · **Symbol:** HERALD · **Max Supply:** 10,000

The core NFT contract. Implements ERC-721, EIP-2981 (royalties), EIP-4906 (metadata update signals), and the Creator Token Standard for transfer validation.

### Public / View

| Function | Returns | Description |
|----------|---------|-------------|
| `name()` | `string` | "Heraldia" |
| `symbol()` | `string` | "HERALD" |
| `totalSupply()` | `uint256` | Current minted count |
| `maxSupply()` | `uint256` | 10,000 |
| `tokenURI(tokenId)` | `string` | Delegates entirely to the renderer contract |
| `ownerOf(tokenId)` | `address` | Standard ERC-721 |
| `balanceOf(owner)` | `uint256` | Standard ERC-721 |
| `getApproved(tokenId)` | `address` | Standard ERC-721 |
| `isApprovedForAll(owner, operator)` | `bool` | Standard ERC-721 |
| `royaltyInfo(tokenId, salePrice)` | `(address, uint256)` | EIP-2981 royalty info |
| `rendererContract()` | `address` | Currently linked renderer |
| `storageContract()` | `address` | Currently linked storage |
| `storageContractLocked()` | `bool` | Whether storage ref is permanently locked |
| `minterAddresses(addr)` | `bool` | Check if address has minting rights |
| `getTransferValidator()` | `address` | Creator Token transfer validator |
| `autoApproveTransfersFromValidator()` | `bool` | Auto-approve flag |
| `supportsInterface(interfaceId)` | `bool` | ERC-165 |

### Token Owner Functions

| Function | Description |
|----------|-------------|
| `approve(to, tokenId)` | Approve a single token transfer |
| `setApprovalForAll(operator, approved)` | Approve/revoke operator for all tokens |
| `transferFrom(from, to, tokenId)` | Transfer token |
| `safeTransferFrom(from, to, tokenId)` | Safe transfer (checks receiver) |
| `safeTransferFrom(from, to, tokenId, data)` | Safe transfer with data |

### Minter Functions

| Function | Access | Description |
|----------|--------|-------------|
| `mint(to, tokenId)` | Minter only | Mint a token. Reverts if `totalSupply >= maxSupply` |
| `signalMetadataUpdate()` | Owner or Minter | Emits `BatchMetadataUpdate` for marketplace refresh |

### Owner-Only Admin

| Function | Description |
|----------|-------------|
| `setMinterAddresses(address[], bool[])` | Batch grant/revoke minter permissions |
| `setRendererContract(renderer)` | Point to a new renderer |
| `setStorageContract(storage)` | Change storage (reverts if locked) |
| `lockStorageContract()` | **Irreversible** — permanently lock the storage reference |
| `setRoyaltyInfo(receiver, feeNumerator)` | Set default EIP-2981 royalty |
| `setTransferValidator(validator)` | Set Creator Token transfer validator |
| `setAutomaticApprovalOfTransfersFromValidator(bool)` | Toggle auto-approve |

### Events

| Event | Description |
|-------|-------------|
| `Transfer(from, to, tokenId)` | Standard ERC-721 transfer |
| `Approval(owner, approved, tokenId)` | Standard ERC-721 approval |
| `ApprovalForAll(owner, operator, approved)` | Standard ERC-721 operator approval |
| `MetadataUpdate(tokenId)` | EIP-4906 single token metadata change |
| `BatchMetadataUpdate(fromTokenId, toTokenId)` | EIP-4906 batch metadata change |
| `MinterAddressSet(minter, allowed)` | Minter permission change |
| `DefaultRoyaltySet(receiver, feeNumerator)` | Royalty config change |
| `TransferValidatorUpdated(oldValidator, newValidator)` | Validator change |

### Errors

| Error | Meaning |
|-------|---------|
| `ExceedsMaxSupply` | Mint would exceed 10,000 |
| `NotMinter` | Caller is not an authorized minter |
| `ShouldNotMintToBurnAddress` | Cannot mint to address(0) |
| `StorageLocked` | Storage contract reference is permanently locked |
| `URIQueryForNonExistentToken` | tokenURI called for unminted token |

### Transfer Behavior

On every transfer, the contract calls `incrementTransferCount(tokenId)` on the storage contract via the transfer validator hook. This means the "Transfers" trait in the artwork updates automatically.

Additionally, if no custom art is set via ArtSelection, the artwork itself changes on transfer because the renderer hashes `keccak256(owner, tokenId)` — the owner address is part of the seed.

---

## 2. HeraldiaStorage

**Address:** `0x0D562A65d3A209738Eba9601A88Bb0A62bc66391`

Stores two pieces of per-token data:
- **Static hash** (`bytes32`): set once at mint, immutable thereafter. This is the original generative seed.
- **Transfer count** (`uint256`): incremented on each transfer.

### Functions

| Function | Access | Returns | Description |
|----------|--------|---------|-------------|
| `getStaticHash(tokenId)` | Public | `bytes32` | Original mint hash. Reverts with `TokenDataNotSet` if unset |
| `getTransferCount(tokenId)` | Public | `uint256` | Number of times the token has been transferred |
| `isTokenDataSet(tokenId)` | Public | `bool` | Whether static hash has been stored |
| `authorizedWriters(addr)` | Public | `bool` | Check if address has write permission |
| `setTokenData(tokenId, staticHash)` | Authorized writers | — | Store the mint hash. **One-time only** per token |
| `incrementTransferCount(tokenId)` | Owner or authorized writers | — | Bump transfer counter by 1 |
| `setAuthorizedWriter(writer, allowed)` | Contract owner | — | Grant/revoke write access |

### Events

| Event | Description |
|-------|-------------|
| `TokenDataStored(tokenId, staticHash)` | Emitted when a token's static hash is set |
| `AuthorizedWriterSet(writer, allowed)` | Emitted when writer permissions change |

### Errors

| Error | Meaning |
|-------|---------|
| `AlreadySet(tokenId)` | Token data has already been stored (immutable) |
| `NotAuthorized` | Caller is not owner or authorized writer |
| `TokenDataNotSet(tokenId)` | No static hash stored for this token |

---

## 3. HeraldiaRendererV2

**Address:** `0xeB9c4Ec06e15c95b5cA9e78171431a5C4cd57064`

The on-chain rendering engine. Computes JSON metadata and SVG artwork entirely on-chain from hash bytes.

### Functions

| Function | Access | Returns | Description |
|----------|--------|---------|-------------|
| `tokenURI(tokenId)` | Public | `string` | Full `data:application/json;base64,...` metadata URI |
| `heraldiaContract()` | Public | `address` | Linked ERC-721 contract |
| `storageContract()` | Public | `address` | Linked storage contract |
| `artSelection()` | Public | `address` | Linked art selection contract |
| `colorWrapper()` | Public | `address` | External SVG generation contract |
| `setHeraldiaContract(addr)` | Owner | — | Update token contract reference |
| `setStorageContract(addr)` | Owner | — | Update storage reference |
| `setArtSelection(addr)` | Owner | — | Update art selection reference |
| `setColorWrapper(addr)` | Owner | — | Update color wrapper reference |

### tokenURI Rendering Pipeline

1. Calls `ownerOf(tokenId)` on Heraldia to get current owner
2. Calls `getStaticHash(tokenId)` on Storage for the original mint hash
3. Calls `getActiveHash(tokenId)` on ArtSelection to check for custom art
4. **Determines the active hash:**
   - If custom art is active → uses the custom `bytes32` hash directly
   - If no custom art → computes `keccak256(abi.encodePacked(owner, tokenId))`
5. Extracts traits from hash bytes (see table below)
6. Calls `colorWrapper` with all parameters to generate the SVG
7. Assembles JSON metadata and base64-encodes everything as a data URI

### Hash → Trait Mapping

| Hash Byte(s) | Trait | Extraction |
|-------------|-------|------------|
| Byte 0, lower nibble (& 0x03) | Theme count / banner dimensions | 0→10/20, 1→20/20, 2→40/10, else→80/10 |
| Byte 1, mod 3 | Background style index | Modulo into background options |
| Byte 0, bit check | Has Border | Boolean flag |
| Byte 1, upper bits | Emblem type | Index into emblem list |
| Byte 2, mod 0x15 | Pattern index | 0–19 into pattern table |
| Derived from byte 2 | Emblem Style | Index into style table |
| Transfer count | Transfers display | Bucketed range string |

### Trait Value Tables

**Theme (3 values)**
| Index | Name |
|-------|------|
| 0 | Classic |
| 1 | Dual |
| 2 | Dynamic |

**Pattern (20 values)**
| Index | Name | Index | Name |
|-------|------|-------|------|
| 0 | Plain | 10 | Slant Subtle |
| 1 | Flat Bold | 11 | Upright Bold |
| 2 | Flat Medium | 12 | Upright Medium |
| 3 | Flat Subtle | 13 | Upright Subtle |
| 4 | Grid Bold | 14 | Vertical Bold |
| 5 | Grid Medium | 15 | Vertical Medium |
| 6 | Grid Subtle | 16 | Vertical Subtle |
| 7 | Slant Bold | 17 | Dot Bold |
| 8 | Slant Medium | 18 | Dot Medium |
| 9 | Dot Regular | 19 | Dot Subtle |

**Emblem (4 values)**
| Index | Name |
|-------|------|
| 0 | Primitive |
| 1 | Simple |
| 2 | Elaborate |
| 3 | Complex |

**Emblem Style (6 values)**
| Index | Name |
|-------|------|
| 0 | Floating |
| 1 | One Edge |
| 2 | Two Edges Narrow |
| 3 | Two Edges Wide |
| 4 | Three Edges |
| 5 | Four Edges |

**Emblem Shape (3 values)**
| Index | Name |
|-------|------|
| 0 | Pixel |
| 1 | Cross |
| 2 | Dot |

**Transfers (14 buckets)**

`0`, `1-2`, `3-4`, `5-9`, `10-19`, `20-39`, `40-63`, `64-127`, `128-255`, `256-511`, `512-1023`, `1024-2048`, `2049-4096`, `4097+`

### JSON Metadata Structure

```json
{
  "name": "Heraldia #<tokenId>",
  "description": "Heraldia dynamic generative art by ab83. Computed on-chain. Lives forever.",
  "image": "data:image/svg+xml;base64,<base64-encoded SVG>",
  "attributes": [
    { "trait_type": "Theme", "value": "Classic" },
    { "trait_type": "Background", "value": "..." },
    { "trait_type": "Emblem", "value": "Simple" },
    { "trait_type": "Emblem Style", "value": "Floating" },
    { "trait_type": "Pattern", "value": "Grid Bold" },
    { "trait_type": "Transfers", "value": "3-4" },
    { "trait_type": "Back to the Future", "value": "..." }
  ]
}
```

---

## 4. HeraldiaArtSelection

**Address:** `0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769`

Allows token owners to override their token's artwork by setting any `bytes32` hash. The renderer uses this hash instead of the default owner-derived hash when generating art.

### Functions

| Function | Access | Returns | Description |
|----------|--------|---------|-------------|
| **`selectArt(tokenId, customHash)`** | **Token owner** | — | Set a custom `bytes32` hash for art generation |
| `adminSelectArt(tokenId, customHash)` | Contract owner | — | Admin override for any token |
| `resetArt(tokenId)` | Token owner | — | Remove custom art, revert to default |
| `getActiveHash(tokenId)` | Public | `(bool, bytes32)` | Returns `(isActive, customHash)`. Validates current ownership |
| `hasCustomArt(tokenId)` | Public | `bool` | Whether a custom hash is currently active |
| `heraldiaContract()` | Public | `address` | Linked ERC-721 contract |
| `setHeraldiaContract(addr)` | Contract owner | — | Update linked token contract |

### selectArt Detailed Logic

1. Calls `ownerOf(tokenId)` on the Heraldia contract
2. Verifies `msg.sender == ownerOf(tokenId)` — reverts with `NotTokenOwner` otherwise
3. Verifies `customHash != bytes32(0)` — reverts with `InvalidHash` otherwise
4. Stores: `{ bytes32 customHash, address selectedBy, bool isActive = true }`
5. Emits `ArtSelected(tokenId, msg.sender, customHash)`

### Events

| Event | Description |
|-------|-------------|
| `ArtSelected(tokenId, selectedBy, customHash)` | Custom art hash was set |
| `ArtReset(tokenId)` | Custom art was cleared |

### Errors

| Error | Meaning |
|-------|---------|
| `NotTokenOwner` | Caller does not own the specified token |
| `InvalidHash` | Hash is `bytes32(0)` (zero) |

### Usage

```bash
# Generate a random hash
RANDOM_HASH=$(cast keccak "$(date +%s%N)_any_random_seed")

# Set custom art for your token
cast send 0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769 \
  "selectArt(uint256,bytes32)" \
  <TOKEN_ID> \
  $RANDOM_HASH \
  --private-key $PRIVATE_KEY \
  --rpc-url https://eth.llamarpc.com

# Check active hash
cast call 0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769 \
  "getActiveHash(uint256)(bool,bytes32)" \
  <TOKEN_ID> \
  --rpc-url https://eth.llamarpc.com

# Reset to default art
cast send 0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769 \
  "resetArt(uint256)" \
  <TOKEN_ID> \
  --private-key $PRIVATE_KEY \
  --rpc-url https://eth.llamarpc.com
```

Gas cost is minimal (~$0.01–0.05 per call based on recent transactions).

---

## Shared: Rescue Functions

All four contracts include identical rescue functionality (from Solady's `Rescuable`):

| Function | Description |
|----------|-------------|
| `rescueETH(to, amount)` | Withdraw trapped ETH |
| `rescueERC20(token, to, amount)` | Withdraw trapped ERC-20 |
| `rescueERC721(token, to, id)` | Withdraw trapped ERC-721 |
| `rescueERC1155(token, to, id, amount, data)` | Withdraw trapped ERC-1155 |
| `rescueERC6909(token, to, id, amount)` | Withdraw trapped ERC-6909 |
| `lockRescue(locksToSet)` | Permanently disable specific rescue capabilities |
| `rescueLocked()` | View current lock bitmask |

---

## Dynamic Art Behavior Summary

| Scenario | Hash Used by Renderer | Art Changes? |
|----------|----------------------|--------------|
| No custom art set | `keccak256(owner, tokenId)` | Yes — changes on transfer (new owner = new hash) |
| Custom art set via `selectArt` | The exact `bytes32` you provided | No — stays fixed regardless of transfers |
| Custom art reset via `resetArt` | Reverts to `keccak256(owner, tokenId)` | Back to dynamic behavior |
| Token transferred with custom art | Custom hash remains active | Art stays the same |
