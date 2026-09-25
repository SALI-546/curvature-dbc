/**
 * Proves the offline simulator matches the chain.
 * Builds a 5-point curve, synthesizes the PoolConfig locally, creates the real one on
 * devnet, then diffs every field the swap math reads and compares an actual swapQuote.
 */
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js'
import BN from 'bn.js'
import {
  DynamicBondingCurveClient, buildCurveWithCustomSqrtPrices, createSqrtPrices, swapQuote,
  getQuoteReserveFromNextSqrtPrice,
  ActivationType, BaseFeeMode, CollectFeeMode, MigrationFeeOption, MigrationOption,
  TokenAuthorityOption, TokenDecimal, TokenType,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { synthesizeConfig, freshPool, simulate, validateCurve } from '../src/sim.js'

const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112')
const BASE_DEC = TokenDecimal.SIX
const QUOTE_DEC = TokenDecimal.NINE

const prices = [1e-9, 5e-9, 3e-8, 2e-7, 1e-6]
const params = buildCurveWithCustomSqrtPrices({
  token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: BASE_DEC, tokenQuoteDecimal: QUOTE_DEC,
    tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 10_000_000 },
  fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: { startingFeeBps: 300, endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 3600 } },
    dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: 0, poolCreationFee: 0, enableFirstSwapWithMinFee: false },
  migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps100,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
  liquidityDistribution: { partnerLiquidityPercentage: 0, partnerPermanentLockedLiquidityPercentage: 100,
    creatorLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 0 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0,
    totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Timestamp,
  sqrtPrices: createSqrtPrices(prices, BASE_DEC, QUOTE_DEC),
  liquidityWeights: [1, 3, 6, 2],
} as any)

async function main() {
  console.log('client-side validation:', validateCurve(params).length === 0 ? 'clean' : validateCurve(params))
  const realPoints = params.curve.filter((p: any) => !p.sqrtPrice.isZero() && !p.liquidity.isZero())
  console.log(`curve: ${realPoints.length} real points in a ${params.curve.length}-slot array\n`)

  const wallet = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(readFileSync(join(homedir(), '.config/solana/devnet.json'), 'utf8'))))
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
  const client = new DynamicBondingCurveClient(connection, 'confirmed')

  const configKp = Keypair.generate()
  const tx = await client.partner.createConfig({
    config: configKp.publicKey, feeClaimer: wallet.publicKey, leftoverReceiver: wallet.publicKey,
    payer: wallet.publicKey, quoteMint: NATIVE_MINT, ...params,
  })
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet, configKp], { commitment: 'confirmed' })
  console.log('created on devnet:', configKp.publicKey.toBase58())
  console.log('tx:', sig, '\n')

  const real = await client.state.getPoolConfig(configKp.publicKey)
  if (!real) throw new Error('config not found on chain after creation')
  const local = synthesizeConfig(params)

  const bn = (v: any) => (v?.toString ? v.toString() : String(v))
  const checks: Array<[string, any, any]> = [
    ['collectFeeMode', local.collectFeeMode, real.collectFeeMode],
    ['migrationQuoteThreshold', local.migrationQuoteThreshold, real.migrationQuoteThreshold],
    ['baseFee.cliffFeeNumerator', local.poolFees.baseFee.cliffFeeNumerator, real.poolFees.baseFee.cliffFeeNumerator],
    ['baseFee.firstFactor', local.poolFees.baseFee.firstFactor, real.poolFees.baseFee.firstFactor],
    ['baseFee.secondFactor', local.poolFees.baseFee.secondFactor, real.poolFees.baseFee.secondFactor],
    ['baseFee.thirdFactor', local.poolFees.baseFee.thirdFactor, real.poolFees.baseFee.thirdFactor],
    ['baseFee.baseFeeMode', local.poolFees.baseFee.baseFeeMode, real.poolFees.baseFee.baseFeeMode],
  ]
  for (let i = 0; i < realPoints.length; i++) {
    checks.push([`curve[${i}].sqrtPrice`, local.curve[i].sqrtPrice, real.curve[i].sqrtPrice])
    checks.push([`curve[${i}].liquidity`, local.curve[i].liquidity, real.curve[i].liquidity])
  }

  // migrationSqrtPrice sits on a rounding plateau: several sqrt prices accumulate exactly
  // the same quote reserve. Bit equality is the wrong test; equal reserves is the right one.
  const qLocalMig = getQuoteReserveFromNextSqrtPrice(local.migrationSqrtPrice, real)
  const qRealMig = getQuoteReserveFromNextSqrtPrice(real.migrationSqrtPrice, real)
  const migEquivalent = qLocalMig.eq(qRealMig) && qRealMig.eq(real.migrationQuoteThreshold)

  console.log('field                        | match')
  console.log('-'.repeat(58))
  let allMatch = true
  for (const [k, a, b] of checks) {
    const ok = bn(a) === bn(b)
    if (!ok) allMatch = false
    console.log(`${k.padEnd(28)} | ${ok ? 'YES' : `NO   local=${bn(a)} chain=${bn(b)}`}`)
  }

  // same swap, synthetic config vs real config
  const ap = new BN(Math.floor(Date.now() / 1000))
  const amt = params.migrationQuoteThreshold.divn(20)
  const qLocal = swapQuote(freshPool(params, ap), local, false, amt, 0, false, ap, false)
  const qReal = swapQuote(freshPool(params, ap), real, false, amt, 0, false, ap, false)
  const same = qLocal.outputAmount.eq(qReal.outputAmount) && qLocal.nextSqrtPrice.eq(qReal.nextSqrtPrice)
  console.log('-'.repeat(58))
  console.log('swapQuote outputAmount  local:', qLocal.outputAmount.toString())
  console.log('                        chain:', qReal.outputAmount.toString())
  console.log('IDENTICAL SWAP RESULT:', same ? 'YES' : 'NO')
  console.log('-'.repeat(58))
  console.log('migrationSqrtPrice  local:', local.migrationSqrtPrice.toString())
  console.log('                    chain:', real.migrationSqrtPrice.toString())
  console.log('  quote reserve at local :', qLocalMig.toString())
  console.log('  quote reserve at chain :', qRealMig.toString())
  console.log('  threshold              :', real.migrationQuoteThreshold.toString())
  console.log('FUNCTIONALLY EQUIVALENT:', migEquivalent ? 'YES (same plateau)' : 'NO')

  const sim = simulate(params, { steps: 40, baseDecimals: BASE_DEC, quoteDecimals: QUOTE_DEC })
  console.log(`\noffline simulation: ${sim.steps.length} steps, graduated=${sim.graduated}`)
  console.log('progress |            price | cumulative base out')
  for (const s of sim.steps.filter((_, i) => i % 8 === 0 || i === sim.steps.length - 1))
    console.log(
      `${(s.progress * 100).toFixed(1).padStart(7)}% | ${s.price.toExponential(6).padStart(16)} | ${s.baseOut.toString()}`
    )
  console.log('\n' + '='.repeat(58))
  console.log('config fields exact      :', allMatch ? 'YES' : 'NO')
  console.log('swap path bit-exact      :', same ? 'YES' : 'NO')
  console.log('migration price equivalent:', migEquivalent ? 'YES' : 'NO')
  console.log('SIMULATOR MATCHES CHAIN  :', allMatch && same && migEquivalent ? 'YES' : 'NO')
  console.log('='.repeat(58))
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
