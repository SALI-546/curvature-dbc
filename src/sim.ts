/**
 * Offline DBC curve simulation.
 *
 * Everything here is pure: no RPC, no wallet, no SOL. It turns the ConfigParameters
 * produced by the SDK's buildCurve* helpers into the on-chain PoolConfig shape that the
 * swap math expects, then walks a synthetic pool from launch to graduation.
 */
import BN from 'bn.js'
import {
  MAX_CURVE_POINT,
  MAX_SQRT_PRICE,
  getQuoteReserveFromNextSqrtPrice,
  swapQuote,
  type ConfigParameters,
  type PoolConfig,
  type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk'

/** Client-side guards for the two rules the SDK does NOT check but the program enforces. */
export function validateCurve(params: ConfigParameters): string[] {
  const errors: string[] = []
  const pts = params.curve.filter((p) => !p.sqrtPrice.isZero() && !p.liquidity.isZero())
  if (pts.length > MAX_CURVE_POINT)
    errors.push(`${pts.length} curve points exceeds MAX_CURVE_POINT (${MAX_CURVE_POINT})`)
  params.curve.forEach((p, i) => {
    if (!p.sqrtPrice.isZero() && p.liquidity.isZero())
      errors.push(`curve[${i}] has a non-zero price but zero liquidity`)
  })
  for (let i = 1; i < pts.length; i++)
    if (pts[i].sqrtPrice.lte(pts[i - 1].sqrtPrice))
      errors.push(`curve[${i}] sqrtPrice is not strictly greater than curve[${i - 1}]`)
  return errors
}

/**
 * The price at which the curve completes.
 *
 * The program does not take this as an input — it derives the sqrt price at which the
 * accumulated quote reserve reaches migrationQuoteThreshold. getQuoteReserveFromNextSqrtPrice
 * is monotonic in sqrtPrice, so we invert it by bisection and land on the same value.
 */
export function deriveMigrationSqrtPrice(params: ConfigParameters): BN {
  const real = params.curve.filter(
    (p) => !p.sqrtPrice.isZero() && !p.liquidity.isZero() && p.sqrtPrice.lt(MAX_SQRT_PRICE)
  )
  if (!real.length) throw new Error('curve has no point below MAX_SQRT_PRICE')

  const probe = { ...params, curve: params.curve } as unknown as PoolConfig
  const target = params.migrationQuoteThreshold
  let lo = params.sqrtStartPrice
  let hi = real[real.length - 1].sqrtPrice
  if (getQuoteReserveFromNextSqrtPrice(hi, probe).lte(target)) return hi

  // smallest sqrtPrice whose accumulated quote reserve still meets the threshold
  while (lo.lt(hi)) {
    const mid = lo.add(hi).divn(2)
    if (mid.eq(lo)) break
    if (getQuoteReserveFromNextSqrtPrice(mid, probe).gte(target)) hi = mid
    else lo = mid
  }
  return hi
}

/** Map ConfigParameters onto the subset of PoolConfig that the swap math reads. */
export function synthesizeConfig(params: ConfigParameters): PoolConfig {
  return {
    ...params,
    migrationSqrtPrice: deriveMigrationSqrtPrice(params),
    poolFees: {
      baseFee: { ...params.poolFees.baseFee },
      dynamicFee: params.poolFees.dynamicFee
        ? { ...params.poolFees.dynamicFee, initialized: 1 }
        : { initialized: 0 },
    },
  } as unknown as PoolConfig
}

/** A pool in the state createPool leaves it in, before any swap. */
export function freshPool(params: ConfigParameters, activationPoint: BN): VirtualPool {
  return {
    poolState: {
      sqrtPrice: params.sqrtStartPrice,
      quoteReserve: new BN(0),
      baseReserve: new BN(0),
      activationPoint,
      hasSwap: 0,
      volatilityTracker: {
        lastUpdateTimestamp: new BN(0),
        sqrtPriceReference: new BN(0),
        volatilityAccumulator: new BN(0),
        volatilityReference: new BN(0),
        padding: new Array(8).fill(0),
      },
    },
  } as unknown as VirtualPool
}

export interface SimStep {
  quoteIn: BN        // cumulative quote spent
  baseOut: BN        // cumulative base received
  sqrtPrice: BN      // pool sqrt price after the step
  price: number      // human price, quote per base
  feePaid: BN        // cumulative trading fee
  progress: number   // 0..1 toward the migration threshold
}

export interface SimResult {
  steps: SimStep[]
  graduated: boolean
  totalQuote: BN
  totalBase: BN
  totalFee: BN
}

const sqrtPriceToPrice = (sqrtPrice: BN, baseDec: number, quoteDec: number) => {
  // price = (sqrtPrice / 2^64)^2, adjusted for decimals
  const s = Number(sqrtPrice.toString()) / 2 ** 64
  return s * s * 10 ** (baseDec - quoteDec)
}

/**
 * Walk the curve from launch to graduation by repeatedly buying `steps` equal slices of
 * the migration quote threshold. Returns the full price path.
 */
export function simulate(
  params: ConfigParameters,
  opts: { steps?: number; baseDecimals?: number; quoteDecimals?: number } = {}
): SimResult {
  const { steps = 60, baseDecimals = 6, quoteDecimals = 9 } = opts
  const config = synthesizeConfig(params)
  const activationPoint = new BN(Math.floor(Date.now() / 1000))
  const pool = freshPool(params, activationPoint)

  const threshold = params.migrationQuoteThreshold
  // Price moves fastest at the start of the curve, so uniform quote slices under-sample
  // exactly where the shape matters. Bias the schedule toward the beginning.
  const SKEW = 1.8
  const SCALE = 1_000_000
  const sliceAt = (i: number) => {
    // past the planned schedule the fees still have to be covered, so fall back to a
    // regular slice instead of the vanishing tail of the skewed one
    if (i >= steps) return BN.max(new BN(1), threshold.divn(steps))
    const a = Math.pow(i / steps, SKEW)
    const b = Math.pow((i + 1) / steps, SKEW)
    const frac = Math.max(1, Math.round((b - a) * SCALE))
    return BN.max(new BN(1), threshold.muln(frac).divn(SCALE))
  }
  const out: SimStep[] = [
    {
      quoteIn: new BN(0),
      baseOut: new BN(0),
      sqrtPrice: params.sqrtStartPrice,
      price: sqrtPriceToPrice(params.sqrtStartPrice, baseDecimals, quoteDecimals),
      feePaid: new BN(0),
      progress: 0,
    },
  ]
  let cumQuote = new BN(0)
  let cumBase = new BN(0)
  let cumFee = new BN(0)
  let graduated = false

  // fees are taken out of the input, so reaching the threshold needs more than `steps`
  // slices; keep going until the reserve actually crosses it.
  for (let i = 0; i < steps * 4; i++) {
    const slice = sliceAt(i)
    let q
    try {
      q = swapQuote(pool, config, false, slice, 0, false, activationPoint, false)
    } catch {
      graduated = true
      break
    }
    cumQuote = cumQuote.add(q.actualInputAmount)
    cumBase = cumBase.add(q.outputAmount)
    cumFee = cumFee.add(q.tradingFee)
    pool.poolState.sqrtPrice = q.nextSqrtPrice
    // in QuoteToken collect mode the reserve grows by the input net of the trading fee
    pool.poolState.quoteReserve = pool.poolState.quoteReserve.add(
      q.actualInputAmount.sub(q.tradingFee)
    )
    pool.poolState.hasSwap = 1
    out.push({
      quoteIn: cumQuote,
      baseOut: cumBase,
      sqrtPrice: q.nextSqrtPrice,
      price: sqrtPriceToPrice(q.nextSqrtPrice, baseDecimals, quoteDecimals),
      feePaid: cumFee,
      progress: Number(pool.poolState.quoteReserve.toString()) / Number(threshold.toString()),
    })
    if (pool.poolState.quoteReserve.gte(threshold)) {
      graduated = true
      break
    }
  }

  // The last slice rarely fits exactly, so the walk stops a little short. The curve does
  // reach graduation — close the trace on the migration price so the plot says so.
  const last = out[out.length - 1]
  if (graduated && last && last.progress < 1) {
    const migSqrtPrice = deriveMigrationSqrtPrice(params)
    out.push({
      quoteIn: cumQuote,
      baseOut: cumBase,
      sqrtPrice: migSqrtPrice,
      price: sqrtPriceToPrice(migSqrtPrice, baseDecimals, quoteDecimals),
      feePaid: cumFee,
      progress: 1,
    })
  }

  return { steps: out, graduated, totalQuote: cumQuote, totalBase: cumBase, totalFee: cumFee }
}
