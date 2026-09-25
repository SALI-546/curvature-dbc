/**
 * A curve is just a price ladder plus a weight per segment, so it fits in a URL.
 * Kept human-readable on purpose — ?p=1e-9,5e-9,3e-8&w=1,3&f=300,100 can be read,
 * edited and diffed by hand, which a base64 blob cannot.
 */
import { DEFAULTS, WSOL, type CurveInput } from './config'
import { MAX_CURVE_POINT } from '@meteora-ag/dynamic-bonding-curve-sdk'

/** 10% ceiling, 0.25% floor — a curve outside this band is a trap, not a design. */
export const MAX_FEE_BPS = 1000
export const MIN_FEE_BPS = 25

/** compact exponential, no trailing zeros: 1e-9, 4.237e-9, 1.5e-7 */
const num = (n: number) => {
  const [m, e] = n.toExponential(4).split('e')
  return `${parseFloat(m)}e${Number(e)}`
}

export function encode(input: CurveInput): string {
  const q = new URLSearchParams()
  q.set('p', input.prices.map(num).join(','))
  q.set('w', input.weights.join(','))
  const f = [input.startingFeeBps ?? 300, input.endingFeeBps ?? 100]
  if (f[0] !== 300 || f[1] !== 100) q.set('f', f.join(','))
  if (input.quoteMint && input.quoteMint !== WSOL) {
    q.set('q', input.quoteMint)
    if (input.quoteSymbol) q.set('qs', input.quoteSymbol)
    if (input.quoteDecimals) q.set('qd', String(input.quoteDecimals))
  }
  return q.toString()
}

/** Returns null when the params are absent or do not describe a usable curve. */
export function decode(search: string): CurveInput | null {
  const q = new URLSearchParams(search)
  const rawP = q.get('p')
  const rawW = q.get('w')
  if (!rawP || !rawW) return null

  const prices = rawP.split(',').map(Number)
  const weights = rawW.split(',').map(Number)

  if (prices.length < 2 || prices.length > MAX_CURVE_POINT + 1) return null
  if (weights.length !== prices.length - 1) return null
  if (prices.some((p) => !Number.isFinite(p) || p <= 0)) return null
  if (weights.some((w) => !Number.isFinite(w) || w < 1)) return null
  for (let i = 1; i < prices.length; i++) if (prices[i] <= prices[i - 1]) return null

  const out: CurveInput = { ...DEFAULTS, prices, weights }
  // A link is untrusted input. Unbounded fees passed every validator we had and were
  // displayed nowhere, so ?f=9900,9899 turned a shared curve into a 99% fee trap.
  const f = q.get('f')?.split(',').map(Number)
  if (
    f?.length === 2 &&
    f.every(Number.isFinite) &&
    f[0] >= f[1] &&
    f[0] <= MAX_FEE_BPS &&
    f[1] >= MIN_FEE_BPS
  ) {
    out.startingFeeBps = f[0]
    out.endingFeeBps = f[1]
  }

  const mint = q.get('q')
  const dec = Number(q.get('qd'))
  // base58 only, and the program accepts 6..9 decimals
  if (mint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) && [6, 7, 8, 9].includes(dec)) {
    out.quoteMint = mint
    out.quoteSymbol = q.get('qs')?.slice(0, 12) || 'quote'
    out.quoteDecimals = dec as CurveInput['quoteDecimals']
  }
  return out
}
