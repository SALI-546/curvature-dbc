/**
 * What stands between a curve and real money.
 *
 * Neither validateCurve nor the SDK's validateConfigParameters is an economic check:
 * measured graduation thresholds from 0.00053 to 3.03e16 quote units all pass both. A
 * curve can be perfectly legal on-chain and still be nonsense, or a trap planted in a
 * shared link. This module is the gate that says so before anything is signed.
 */
import type { ConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { MAX_FEE_BPS, MIN_FEE_BPS } from './share'
import { WSOL, type CurveInput } from './config'
import type { SimResult } from './sim'

export interface Check {
  /** blocking issues make Launch impossible; warnings are shown but do not gate */
  level: 'block' | 'warn'
  message: string
}

/** Below this a curve graduates on the first buy; above it, realistically never. */
const ABSURD_LOW = 0.01
const ABSURD_HIGH = 1e7
const SOL_SANE = { low: 1, high: 1000 }

export interface PreflightInput {
  input: CurveInput
  params: ConfigParameters | null
  sim: SimResult | null
  /** structural errors from validateCurve */
  errors: string[]
  /** decimals the chain reports for the quote mint, once known */
  onChainQuoteDecimals?: number
  /** set once the chain has been asked and the answer was not a usable mint */
  quoteMintProblem?: 'absent' | 'not-a-mint'
}

export function preflight({
  input,
  params,
  sim,
  errors,
  onChainQuoteDecimals,
  quoteMintProblem,
}: PreflightInput): Check[] {
  const checks: Check[] = []
  const block = (message: string) => checks.push({ level: 'block', message })
  const warn = (message: string) => checks.push({ level: 'warn', message })

  for (const e of errors) block(e)
  if (!params) {
    block('curve does not build')
    return checks
  }

  // A curve that never completes cannot be launched. This alone rejects the 99%-fee
  // link and every impossible threshold, because neither reaches graduation in the sim.
  if (!sim) block('simulation did not run')
  else if (!sim.graduated) block('curve never reaches graduation — it cannot complete')

  const dec = input.quoteDecimals ?? 9
  const threshold = Number(params.migrationQuoteThreshold.toString()) / 10 ** dec
  const sym = input.quoteSymbol ?? 'quote'

  if (!Number.isFinite(threshold) || threshold <= 0) block('graduation threshold is not a usable number')
  else if (threshold < ABSURD_LOW) block(`graduation threshold ${threshold} ${sym} is dust — it would complete on the first buy`)
  else if (threshold > ABSURD_HIGH) block(`graduation threshold ${threshold.toExponential(2)} ${sym} can never realistically be reached`)
  else if ((input.quoteMint ?? WSOL) === WSOL) {
    if (threshold < SOL_SANE.low) warn(`graduating at ${threshold.toFixed(3)} SOL is very low — a single buy may complete the curve`)
    if (threshold > SOL_SANE.high) warn(`graduating at ${threshold.toFixed(0)} SOL demands a large raise`)
  }

  const start = input.startingFeeBps ?? 300
  const end = input.endingFeeBps ?? 100
  if (start > MAX_FEE_BPS) block(`starting fee ${(start / 100).toFixed(2)}% is above the ${MAX_FEE_BPS / 100}% ceiling`)
  if (end < MIN_FEE_BPS) block(`ending fee ${(end / 100).toFixed(2)}% is below the ${MIN_FEE_BPS / 100}% floor`)
  if (start < end) block('starting fee is below the ending fee — the schedule runs backwards')
  if (start >= 500) warn(`starting fee is ${(start / 100).toFixed(2)}% — buyers pay that on every early trade`)

  // The badged stock mints only exist on mainnet, so picking one on devnet used to fail
  // deep inside buildCreatePoolTx — after the form was filled and the button clicked.
  if (quoteMintProblem === 'absent') {
    block(`quote mint ${input.quoteMint ?? WSOL} does not exist on this cluster`)
  } else if (quoteMintProblem === 'not-a-mint') {
    block(`${input.quoteMint ?? WSOL} exists on this cluster but is not a token mint`)
  }

  // ConfigParameters carries no quote-decimals field: the value enters only through
  // createSqrtPrices. A mismatch mis-prices the whole curve by 10^delta and the chain
  // raises nothing at all, so it has to be caught here.
  if (onChainQuoteDecimals !== undefined && onChainQuoteDecimals !== dec) {
    block(
      `quote mint reports ${onChainQuoteDecimals} decimals on chain but this curve was priced for ${dec} — every price is off by 10^${onChainQuoteDecimals - dec}`
    )
  }

  return checks
}

export const isLaunchable = (checks: Check[]) => !checks.some((c) => c.level === 'block')
