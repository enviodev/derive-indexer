# Derive DRV LayerZero OFT Indexer

HyperIndex demo for **Derive DRV** — the omnichain ERC-20 token deployed as a LayerZero OFT proxy on Ethereum, Optimism, Base, and Arbitrum One.

This indexer covers the verified HyperSync surface from the research spec: every DRV proxy address on the four demo chains, plus all four live events (`Transfer`, `Approval`, `OFTSent`, `OFTReceived`). Derive V2 trading settlement on Derive Chain (957) is **out of scope** until HyperSync supports that network.

## What is indexed

| Chain | Chain ID | DRV OFT proxy | Start block |
|-------|---------:|---------------|------------:|
| Ethereum | 1 | `0xb1d1eae60eea9525032a6dcb4c1ce336a1de71be` | 21,224,782 |
| Optimism | 10 | `0x33800de7e817a70a694f31476313a7c572bba100` | 129,103,813 |
| Base | 8453 | `0x9d0e8f5b25384c7310cb8c6ae32c8fbeb645d083` | 24,927,613 |
| Arbitrum One | 42161 | `0x77b7787a09818502305c95d68a2571f090abb135` | 283,211,657 |

### Events

- **Transfer** / **Approval** — standard ERC-20 flows on each proxy
- **OFTSent** / **OFTReceived** — LayerZero bridge messages, joined globally by `guid`

### Entities

- `TokenTransfer`, `TokenApproval`, `Allowance` — raw ERC-20 event history and latest allowances
- `TokenAccount` — per-holder balances and cumulative mint/burn/OFT flow counters
- `TokenChain` — per-chain supply reconstruction (`totalMinted - totalBurned`) and event totals
- `OFTMessage` — cross-chain message lifecycle (`SENT` → `RECEIVED`, or `ORPHAN_RECEIVE`)
- `DailyChainStat` — UTC daily rollups per chain
- `ProtocolGlobal` — singleton headline counters across all chains

## Era breaks

Research found **no ABI or indexed-layout era break** on any DRV proxy through the research head. All four implementations expose the same event signatures; a single handler set serves every chain.

## OFT lifecycle

`OFTMessage` rows are keyed by LayerZero `guid`:

1. **OFTSent** on the source chain opens (or updates) a row with status `SENT`.
2. **OFTReceived** on the destination chain joins on the same `guid` and moves the row to `RECEIVED` when a send leg already exists.
3. A receive without a prior indexed send is stored as `ORPHAN_RECEIVE` (for example, if the send chain is outside the sync window).
4. Terminal `RECEIVED` status is never downgraded by duplicate or late events.

LayerZero endpoint IDs for the four demo chains are mapped to EVM chain IDs in the handlers (`30101` → Ethereum, `30111` → Optimism, `30184` → Base, `30110` → Arbitrum). Other endpoint IDs are stored without a chain label.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/)
- Envio API token (for HyperSync-backed tests and sync)

## Setup

```bash
cp .env.example .env
# Edit .env and set ENVIO_API_TOKEN
pnpm install
pnpm codegen
```

## Run locally

```bash
pnpm dev
```

GraphQL playground defaults to `http://localhost:8080`.

## Test

```bash
pnpm test
```

Pinned real-data tests hit HyperSync at the first-seen blocks from the research spec (one block per chain/event family). Simulated tests cover supply arithmetic, holder balances, and OFT lifecycle transitions without network access.

Typecheck:

```bash
./node_modules/.bin/tsc --noEmit
```

## Design notes

- **Event-only indexing** — no RPC `Effect` calls; peer mapping and `totalSupply()` spot-checks are validation-time concerns (see spec validation anchors).
- **Multichain IDs** — entity keys are prefixed with `chainId` (or use the global `guid` for `OFTMessage`) to prevent cross-chain collisions.
- **Storage** — Postgres only (no ClickHouse).

## License

MIT
