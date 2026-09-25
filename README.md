# Curvature

**A bonding curve is a waveform. Curvature is the instrument you tune it on.**

Meteora's Dynamic Bonding Curve lets you shape a token launch across up to 16 liquidity
points — but the only way to see what a curve actually does is to create it on-chain and
watch. Curvature simulates the whole launch, from first buy to graduation, entirely
offline: no RPC, no wallet, no SOL. Then it launches the curve you designed.

Built for the **Best use of Meteora's Dynamic Bonding Curve** track, Crypto World's Fair.

---

## What it does

- **Sculpt** — drag the price boundaries, set a liquidity weight per segment. All six of
  the SDK's `buildCurve*` constructors collapse into one surface you can manipulate.
- **Simulate** — the full lifecycle runs locally through the SDK's own swap math: price
  path, fee schedule, graduation threshold, total fees paid.
- **Read** — a liquidity strip above the trace shows, per segment, how much of the raise
  is spent in that price range. Widen a weight, watch its band grow.
- **Quote in anything badged** — a DBC quote mint that is not permissionless-supported
  needs a `TokenBadge`, and only Meteora operators can mint one. The stock catalogue is
  already provisioned, so the picker reads the live registry and resolves every badged
  mint to a ticker: 2366 of 2367 on-chain badges, covering xStocks, Ondo and Backpack
  equities. Changing the quote token changes the decimals, and therefore the curve math.
- **Fork** — every curve lives in its URL. `?p=1e-9,5e-9,3e-8&w=1,3` is the whole design:
  readable, editable by hand, diffable.
- **Validate** — the two rules the SDK does not check but the program enforces are caught
  before you ever sign a transaction.

## Why the simulation can be trusted

`src/sim.ts` maps the SDK's `ConfigParameters` onto the on-chain `PoolConfig` shape and
walks a synthetic pool using the program's own `swapQuote`. `scripts/sim-validate.ts`
proves the mapping against a real config created on devnet:

| check | result |
|---|---|
| config fields (curve, fees, thresholds) | exact |
| `swapQuote` over 200 amounts spanning the curve | 0 divergences |
| `migrationSqrtPrice` | same rounding plateau, identical quote reserve |

Run it yourself: `npm run sim:validate` (needs a funded devnet keypair).

## Curve limits, measured not assumed

`scripts/curve-limits.ts` probes what the program actually accepts:

| case | SDK | on-chain |
|---|---|---|
| 1 / 4 / 8 / 16 curve points | builds | accepted |
| 17 / 19 curve points | builds | `Invalid curve` |
| descending or duplicate sqrt prices | rejected | — |
| `liquidityWeights` value 100 | builds | accepted |
| `liquidityWeights` value 0 | builds | `Invalid curve` |

Two of those are enforced only on-chain, so the SDK lets you pay for a transaction that
cannot succeed. Curvature checks them client-side. See [FEEDBACK.md](FEEDBACK.md).

## On-chain cost, measured

Rent is identical on devnet and mainnet:

| action | cost |
|---|---|
| `createConfig` (one-time, reusable) | 0.00598408 SOL |
| `createPool` (per launch) | 0.02059164 SOL |

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

Devnet tooling (needs `~/.config/solana/devnet.json` with a little SOL):

```bash
npm run devnet:proof   # create a real config + pool, print the measured cost
npm run curve:limits   # probe what the program accepts
npm run sim:validate   # prove the offline simulator matches the chain
npm run badges         # refresh the quote-mint catalogue from mainnet
```

## Layout

| path | role |
|---|---|
| `src/sim.ts` | offline simulation and client-side curve validation |
| `src/config.ts` | curve input → `ConfigParameters`, plus presets |
| `src/share.ts` | URL codec for forking a curve |
| `src/badges.ts` | live `TokenBadge` registry (stock-token quote mints) |
| `app/QuotePicker.tsx` | quote-token picker over the badge catalogue |
| `app/page.tsx` | the studio |
| `scripts/` | devnet proofs, reproducible |
| `brand.md` | design brief |
| `FEEDBACK.md` | API feedback for Meteora |

Built on [`@meteora-ag/dynamic-bonding-curve-sdk`](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk)
`1.5.12`, program `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`.
