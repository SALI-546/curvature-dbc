# Curvature — project brief

A Meteora Dynamic Bonding Curve design studio: sculpt a curve, simulate it to graduation
offline, launch it on chain. Entry for **Best use of Meteora's DBC**, Crypto World's Fair.

## Deadline and stakes
- **Submission closes 12 Oct 2026, 23:59 PT** (13 Oct 07:59 in Benin). The "31 October" on
  the listing is the winner-announcement date, not the deadline.
- $20,000 USDC over 5 prizes. 8 submissions as of 28 Sep. Eligibility: Global, unrestricted.
- Judged on: depth of Meteora integration, technical execution, originality and taste,
  impact potential, and **traction — they explicitly prefer projects live on mainnet**.

## Positioning
The "DBC curve simulator" idea is not original: seven rival repos were created 17–27 Sep
2026 with near-identical pitches. Do not lead with it. Lead with what none of them claims:
stock-quoted launches over the 2366 badged quote mints, numbers measured against the chain
rather than modelled, and a real mainnet launch.

## Facts established by measurement, not reading
Re-derive with `npm run curve:limits` and `npm run sim:validate` before trusting any of it.

| | |
|---|---|
| `createConfig` | 0.00598408 SOL |
| `createPool` | 0.02059164 SOL |
| `MAX_CURVE_POINT` | 16, enforced on-chain only — the SDK builds 17 happily |
| zero `liquidityWeights` entry | rejected on-chain only |
| `createConfigAndPool` | serialises past 1232 bytes at 9 curve points |
| badged quote mints | 2366 on mainnet, **3 on devnet** — stock flows cannot be tested there |
| `api.mainnet-beta.solana.com` | 403s any request carrying a browser `Origin` header |

## Rules that are not negotiable
- **Mainnet is opt-in by exact string.** `NEXT_PUBLIC_CLUSTER === 'mainnet-beta'`, never a
  `??` fallback. Verify the genesis hash before any signature: a label can lie.
- **`poolCreationFee` stays hardcoded at 0.** It is denominated in whole SOL, so a value of
  `1` charges 1 SOL. It must never reach the UI or the URL.
- **`src/sim.ts` and `src/config.ts` must never import `src/launch.ts`.** That is what keeps
  the simulator offline and the SDK services out of the first load.
- **Token metadata is served from this app** (`/t?s=…&n=…`). Configs are `Immutable`, so
  whoever controls that URL owns every launched token's identity forever.
- A shared link is untrusted input. Fees are clamped at decode, the quote mint is decoded to
  a real `PublicKey`, and the mint address is shown in the UI — never just the label.

## Scope
In: sculpt, simulate, read, fork by URL, launch. Out: the paid preset marketplace (roadmap
slide only), DLMM, post-graduation DAMM v2 management.

## Conventions
Commit subjects: bare lowercase sentence, ≤50 chars, no commas, no `+`, subject only —
no body, no trailer of any kind. Code review before every push, not after every commit.
Comments: one module header stating why the module exists and the trap it guards; near-zero
inline. No semicolons, single quotes, 2-space indent. `console.log` in `scripts/` only.
