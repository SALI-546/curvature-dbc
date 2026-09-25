/**
 * Turns the two things a user actually manipulates — a ladder of prices and the liquidity
 * weight of each segment between them — into the SDK's ConfigParameters.
 */
import {
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
  type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk'

export interface CurveInput {
  /** ascending price ladder, length 2..17 (n-1 segments, max 16) */
  prices: number[]
  /** liquidity weight per segment, length prices.length - 1 */
  weights: number[]
  startingFeeBps?: number
  endingFeeBps?: number
  totalSupply?: number
  baseDecimals?: TokenDecimal
  quoteDecimals?: TokenDecimal
}

export const DEFAULTS: CurveInput = {
  prices: [1e-9, 5e-9, 3e-8, 2e-7, 1e-6],
  weights: [1, 3, 6, 2],
  startingFeeBps: 300,
  endingFeeBps: 100,
  totalSupply: 1_000_000_000,
  baseDecimals: TokenDecimal.SIX,
  quoteDecimals: TokenDecimal.NINE,
}

export function buildParams(input: CurveInput): ConfigParameters {
  const {
    prices,
    weights,
    startingFeeBps = 300,
    endingFeeBps = 100,
    totalSupply = 1_000_000_000,
    baseDecimals = TokenDecimal.SIX,
    quoteDecimals = TokenDecimal.NINE,
  } = input

  return buildCurveWithCustomSqrtPrices({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: baseDecimals,
      tokenQuoteDecimal: quoteDecimals,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: totalSupply,
      leftover: Math.floor(totalSupply / 100),
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps,
          endingFeeBps,
          numberOfPeriod: 10,
          totalDuration: 3600,
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
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    sqrtPrices: createSqrtPrices(prices, baseDecimals, quoteDecimals),
    liquidityWeights: weights,
  } as never)
}

/** Preset shapes, the vocabulary the studio ships with. */
export const PRESETS: Record<string, CurveInput> = {
  flat: { ...DEFAULTS, prices: [1e-9, 1e-8, 1e-7, 1e-6], weights: [1, 1, 1] },
  exponential: { ...DEFAULTS, prices: [1e-9, 3e-9, 2e-8, 2e-7, 1e-6], weights: [8, 4, 2, 1] },
  long: { ...DEFAULTS, prices: [1e-9, 2e-9, 4e-9, 1e-8, 5e-8, 5e-7, 1e-6], weights: [1, 1, 2, 4, 8, 12] },
  cliff: { ...DEFAULTS, prices: [1e-9, 1.2e-9, 1.5e-9, 1e-6], weights: [1, 1, 20] },
}
