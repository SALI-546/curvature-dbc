# Feedback for Meteora — DBC program & TypeScript SDK

Collected while building for the "Best use of Meteora's DBC" track (Crypto World's Fair).
Everything below was measured on devnet against `@meteora-ag/dynamic-bonding-curve-sdk@1.5.12`
and program `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`. Reproduce with
`scripts/curve-limits.ts`.

## 1. Two curve constraints are enforced only on-chain, not by the SDK

`buildCurveWithCustomSqrtPrices` validates sqrt-price ordering and the
`liquidityWeights` length client-side, but silently accepts two configurations that the
program then rejects with a generic `Invalid curve`:

| Input | SDK | On-chain |
|---|---|---|
| 17 or 19 curve points (over `MAX_CURVE_POINT` = 16) | builds fine | `Invalid curve` |
| a `liquidityWeights` entry equal to `0` | builds fine | `Invalid curve` |

Since ordering and length *are* checked client-side, these two look like oversights rather
than deliberate design. Catching them in `buildCurveWithCustomSqrtPrices` would turn a
paid, failed transaction into an immediate local error.

A second, smaller point: both failures surface as the same `Invalid curve` message, so
there is no way to tell from the error which rule was broken.

## 2. Ambiguous wording in the DBC docs

> "The maximum number of liquidityWeights[i] is 16"

This reads as a cap on each weight's *value*. Measured behaviour: a weight of `100` is
accepted on-chain without issue. The real constraint is on the array *length* (≤ 16,
matching `MAX_CURVE_POINT`). Suggested rewording: "the `liquidityWeights` array may contain
at most 16 entries".

## 3. Verified behaviour (for reference)

| Case | Result |
|---|---|
| 1 / 4 / 8 / 16 curve points | accepted |
| 17 / 19 curve points | `Invalid curve` |
| descending sqrt prices | SDK: `sqrtPrices must be in ascending order` |
| duplicate adjacent sqrt prices | SDK: same error — ordering is strictly increasing |
| single sqrt price | SDK: `sqrtPrices array must have at least 2 elements` |
| `liquidityWeights` value `100` | accepted |
| `liquidityWeights` value `0` | `Invalid curve` |
| `liquidityWeights` length mismatch | SDK: `length must equal sqrtPrices.length - 1` |

## 4. Measured on-chain cost (devnet; rent is identical on mainnet)

| Action | Cost |
|---|---|
| `createConfig` (one-time, reusable across launches) | 0.00598408 SOL |
| `createPool` (per launch) | 0.02059164 SOL |
| First full launch | 0.02657572 SOL |

This was not documented anywhere we could find, and it is the first question any team asks
before committing to mainnet. Publishing it would help.

## 5. `migrationSqrtPrice` cannot be computed client-side

The program derives `migrationSqrtPrice` when a config is created. It is not part of the
`ConfigParameters` returned by any `buildCurve*` helper, and no exported helper inverts it,
so a tool that wants to preview a curve before paying for it has no supported way to obtain
the value — it has to create the config on-chain first just to read the field back.

We worked around it by bisecting `getQuoteReserveFromNextSqrtPrice` against
`migrationQuoteThreshold`. Worth noting that the function has a rounding plateau: our derived
price and the on-chain one differ by ~3.5e-11 relative, yet both accumulate *exactly* the
threshold quote reserve, so they are functionally interchangeable. A
`getMigrationSqrtPrice(configParameters)` export would remove the guesswork.

## 6. The on-chain `curve` array has 20 slots but only 16 are usable

`PoolConfig.curve` is a 20-element array (the swap math even carries a comment about
"existing pools with 20 points"), while `MAX_CURVE_POINT` is 16 and the program rejects a
17-point curve. An integrator reading the account layout would reasonably assume 20 are
available. Worth stating the 16 limit next to the struct.
