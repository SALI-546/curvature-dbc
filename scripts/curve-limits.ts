/**
 * Empirically probe what the DBC program accepts as a hand-authored curve.
 * Separates SDK-level validation (buildCurveWithCustomSqrtPrices throws)
 * from on-chain program validation (createConfig fails).
 */
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js'
import {
  DynamicBondingCurveClient,
  buildCurveWithCustomSqrtPrices,
  createSqrtPrices,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112')
const BASE_DEC = TokenDecimal.SIX
const QUOTE_DEC = TokenDecimal.NINE

const base = {
  token: {
    tokenType: TokenType.SPLToken,
    tokenBaseDecimal: BASE_DEC,
    tokenQuoteDecimal: QUOTE_DEC,
    tokenAuthorityOption: TokenAuthorityOption.Immutable,
    totalTokenSupply: 1_000_000_000,
    leftover: 10_000_000,
  },
  fee: {
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0,
      },
    },
    dynamicFeeEnabled: false,
    collectFeeMode: CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: 0,
    poolCreationFee: 0,
    enableFirstSwapWithMinFee: false,
  },
  migration: {
    migrationOption: MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.FixedBps100,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
  },
  liquidityDistribution: {
    partnerLiquidityPercentage: 0,
    partnerPermanentLockedLiquidityPercentage: 100,
    creatorLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 0,
  },
  lockedVesting: {
    totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0,
    totalVestingDuration: 0, cliffDurationFromMigrationTime: 0,
  },
  activationType: ActivationType.Timestamp,
}

/** n prices spread geometrically across a FIXED range, so economics stay constant */
const P_MIN = 1e-9
const P_MAX = 1e-6
const ladder = (n: number) =>
  n < 2
    ? [P_MIN]
    : Array.from({ length: n }, (_, i) => P_MIN * Math.pow(P_MAX / P_MIN, i / (n - 1)))

type Case = { name: string; prices: number[]; weights?: number[]; expect: string }

const cases: Case[] = [
  { name: '2 prices  (1 segment)',        prices: ladder(2),  expect: 'baseline' },
  { name: '5 prices  (4 segments)',       prices: ladder(5),  expect: 'ok?' },
  { name: '9 prices  (8 segments)',       prices: ladder(9),  expect: 'ok?' },
  { name: '17 prices (16 segments)',      prices: ladder(17), expect: 'at MAX_CURVE_POINT' },
  { name: '18 prices (17 segments)',      prices: ladder(18), expect: 'over MAX_CURVE_POINT' },
  { name: '20 prices (19 segments)',      prices: ladder(20), expect: 'well over' },
  { name: 'descending prices',            prices: ladder(4).reverse(), expect: 'should reject' },
  { name: 'duplicate prices',             prices: [1e-9, 2e-9, 2e-9, 4e-9], expect: 'should reject' },
  { name: '1 price only',                 prices: [1e-9], expect: 'should reject' },
  { name: 'weight value 100 (>16)',       prices: ladder(3), weights: [100, 1], expect: 'tests "max 16" reading' },
  { name: 'weight value 0',               prices: ladder(3), weights: [0, 1], expect: 'should reject?' },
  { name: 'weights length mismatch',      prices: ladder(4), weights: [1, 1], expect: 'should reject' },
]

const short = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  return m.split('\n')[0].slice(0, 150)
}

async function main() {
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/devnet.json'), 'utf8')))
  )
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const startBal = await connection.getBalance(wallet.publicKey)

  const rows: string[] = []
  for (const c of cases) {
    let built: any
    try {
      const sqrtPrices = createSqrtPrices(c.prices, BASE_DEC, QUOTE_DEC)
      built = buildCurveWithCustomSqrtPrices({
        ...base, sqrtPrices, liquidityWeights: c.weights,
      } as any)
    } catch (e) {
      rows.push(`${c.name.padEnd(28)} | SDK REJECT   | curve — | ${short(e)}`)
      continue
    }

    const pts = built.curve.length
    // now try the chain
    const configKp = Keypair.generate()
    try {
      const tx = await client.partner.createConfig({
        config: configKp.publicKey,
        feeClaimer: wallet.publicKey,
        leftoverReceiver: wallet.publicKey,
        payer: wallet.publicKey,
        quoteMint: NATIVE_MINT,
        ...built,
      })
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet, configKp], {
        commitment: 'confirmed', skipPreflight: false,
      })
      rows.push(`${c.name.padEnd(28)} | CHAIN OK     | curve ${String(pts).padStart(2)} | ${sig.slice(0, 20)}…`)
    } catch (e) {
      rows.push(`${c.name.padEnd(28)} | CHAIN REJECT | curve ${String(pts).padStart(2)} | ${short(e)}`)
    }
  }

  const endBal = await connection.getBalance(wallet.publicKey)
  console.log('\ncase                         | verdict      | pts    | detail')
  console.log('-'.repeat(120))
  rows.forEach((r) => console.log(r))
  console.log('-'.repeat(120))
  console.log('MAX_CURVE_POINT constant =', 16)
  console.log('devnet SOL spent =', ((startBal - endBal) / 1e9).toFixed(6))
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
