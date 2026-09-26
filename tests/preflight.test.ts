/**
 * preflight is the only thing between a designed curve and real SOL, so it is the one
 * module worth a real suite rather than a proof script.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import BN from 'bn.js'
import type { ConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { buildParams, DEFAULTS, PRESETS, WSOL, type CurveInput } from '../src/config.js'
import { simulate, validateCurve } from '../src/sim.js'
import { preflight, isLaunchable } from '../src/preflight.js'

type Extra = Partial<{ onChainQuoteDecimals: number; quoteMintProblem: 'absent' | 'not-a-mint' }>

function gate(input: CurveInput, extra: Extra = {}) {
  let params = null
  let errors: string[] = []
  let sim = null
  try {
    params = buildParams(input)
    errors = validateCurve(params)
    sim = errors.length
      ? null
      : simulate(params, {
          steps: 120,
          baseDecimals: input.baseDecimals,
          quoteDecimals: input.quoteDecimals,
        })
  } catch (e) {
    errors = [(e as Error).message]
  }
  const checks = preflight({ input, params, sim, errors, ...extra })
  return {
    launchable: isLaunchable(checks),
    blocks: checks.filter((c) => c.level === 'block').map((c) => c.message),
    warnings: checks.filter((c) => c.level === 'warn').map((c) => c.message),
  }
}

const blocksMatching = (r: ReturnType<typeof gate>, re: RegExp) => r.blocks.some((m) => re.test(m))

test('every shipped preset is launchable', () => {
  for (const [name, preset] of Object.entries({ default: DEFAULTS, ...PRESETS })) {
    const r = gate(preset)
    assert.equal(r.launchable, true, `${name} should be launchable, blocked by: ${r.blocks.join('; ')}`)
  }
})

test('a 99 percent fee is refused and never reaches graduation', () => {
  const r = gate({ ...DEFAULTS, startingFeeBps: 9900, endingFeeBps: 9899 })
  assert.equal(r.launchable, false)
  assert.ok(blocksMatching(r, /above the 10% ceiling/))
  assert.ok(blocksMatching(r, /never reaches graduation/))
})

test('a fee schedule running backwards is refused', () => {
  const r = gate({ ...DEFAULTS, startingFeeBps: 100, endingFeeBps: 300 })
  assert.equal(r.launchable, false)
})

test('a fee below the floor is refused before anything is signed', () => {
  // the SDK rejects endingBaseFeeBps < 25 while building, so the curve never even
  // materialises — our own floor check is defence in depth behind it
  const r = gate({ ...DEFAULTS, startingFeeBps: 300, endingFeeBps: 10 })
  assert.equal(r.launchable, false)
  assert.ok(blocksMatching(r, /25 bps|does not build/))
})

test('a fee exactly at the ceiling is allowed', () => {
  assert.equal(gate({ ...DEFAULTS, startingFeeBps: 1000, endingFeeBps: 100 }).launchable, true)
})

test('decimals disagreeing with the chain block the launch', () => {
  const input = { ...DEFAULTS, quoteDecimals: 8 as CurveInput['quoteDecimals'] }
  const r = gate(input, { onChainQuoteDecimals: 6 })
  assert.equal(r.launchable, false)
  assert.ok(blocksMatching(r, /off by 10\^-2/))
})

test('decimals agreeing with the chain do not block', () => {
  const input = { ...DEFAULTS, quoteDecimals: 9 as CurveInput['quoteDecimals'] }
  assert.equal(gate(input, { onChainQuoteDecimals: 9 }).launchable, true)
})

test('a quote mint absent from the cluster blocks the launch', () => {
  const r = gate(DEFAULTS, { quoteMintProblem: 'absent' })
  assert.equal(r.launchable, false)
  assert.ok(blocksMatching(r, /does not exist on this cluster/))
})

// The economic band is our rule alone — the SDK and the program both accept every value
// in it — so it is tested in isolation rather than through a curve that happens to land there.
function syntheticGate(thresholdRaw: string, decimals = 9, extra: Partial<CurveInput> = {}) {
  const params = { migrationQuoteThreshold: new BN(thresholdRaw) } as unknown as ConfigParameters
  const input: CurveInput = { ...DEFAULTS, quoteDecimals: decimals as CurveInput['quoteDecimals'], ...extra }
  const checks = preflight({
    input,
    params,
    sim: { steps: [], graduated: true, totalQuote: new BN(0), totalBase: new BN(0), totalFee: new BN(0) },
    errors: [],
  })
  return {
    launchable: isLaunchable(checks),
    blocks: checks.filter((c) => c.level === 'block').map((c) => c.message),
    warnings: checks.filter((c) => c.level === 'warn').map((c) => c.message),
  }
}

test('a dust graduation threshold is refused', () => {
  const r = syntheticGate('1000000') // 0.001 SOL, under the 0.01 floor
  assert.equal(r.launchable, false)
  assert.ok(r.blocks.some((m) => /dust/.test(m)))
})

test('an unreachable graduation threshold is refused', () => {
  const r = syntheticGate('100000000000000000000') // 1e11 SOL
  assert.equal(r.launchable, false)
  assert.ok(r.blocks.some((m) => /never realistically be reached/.test(m)))
})

test('a low but plausible threshold warns without blocking', () => {
  const r = syntheticGate('500000000') // 0.5 SOL
  assert.equal(r.launchable, true)
  assert.ok(r.warnings.some((m) => /very low/.test(m)))
})

test('a threshold inside the sane band is silent', () => {
  const r = syntheticGate('20000000000') // 20 SOL
  assert.equal(r.launchable, true)
  assert.equal(r.warnings.length, 0)
})

test('the band follows the quote decimals, not the raw amount', () => {
  // 20 units of an 8-decimal quote token, not 200
  const r = syntheticGate('2000000000', 8)
  assert.equal(r.launchable, true)
})

test('structural curve errors propagate as blocks', () => {
  const r = gate({ ...DEFAULTS, prices: [1e-6, 1e-9], weights: [1] })
  assert.equal(r.launchable, false)
  assert.ok(r.blocks.length > 0)
})

test('a SOL graduation far above the sane band warns without blocking', () => {
  const r = syntheticGate('2000000000000') // 2000 SOL, over the 1000 ceiling
  assert.equal(r.launchable, true)
  assert.ok(r.warnings.some((m) => /demands a large raise/.test(m)))
})

test('a mint that exists but is not a token mint is refused', () => {
  const params = buildParams(DEFAULTS)
  const checks = preflight({ input: DEFAULTS, params, sim: null, errors: [], quoteMintProblem: 'not-a-mint' })
  assert.ok(checks.some((c) => c.level === 'block' && /is not a token mint/.test(c.message)))
})

test('the gate never passes without a simulation', () => {
  const params = buildParams(DEFAULTS)
  const checks = preflight({ input: DEFAULTS, params, sim: null, errors: [] })
  assert.equal(isLaunchable(checks), false)
})

test('the gate never passes without built params', () => {
  const checks = preflight({ input: DEFAULTS, params: null, sim: null, errors: [] })
  assert.equal(isLaunchable(checks), false)
})

test('WSOL is the default quote mint', () => {
  assert.equal(DEFAULTS.quoteMint, WSOL)
})
