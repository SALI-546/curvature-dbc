'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildParams, DEFAULTS, PRESETS, type CurveInput } from '../src/config'
import { QuotePicker, SOL_QUOTE, type Quote } from './QuotePicker'
import { simulate, validateCurve, type SimResult } from '../src/sim'
import { decode, encode } from '../src/share'
import { LaunchPanel } from './LaunchPanel'
import { CLUSTER, IS_MAINNET } from '../src/cluster'

const W = 1000
const H = 545
const PAD = { l: 66, r: 18, t: 22, b: 42 }
const STRIP_H = 44          // liquidity strip: weight as height, span as width
const STRIP_GAP = 14
const PLOT_T = PAD.t + STRIP_H + STRIP_GAP
const PW = W - PAD.l - PAD.r
const PH = H - PLOT_T - PAD.b

const supTable: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
const sup = (n: number) => String(n).split('').map((c) => supTable[c] ?? c).join('')
const fmtPrice = (p: number) => {
  const e = Math.floor(Math.log10(p))
  const m = p / 10 ** e
  return `${m.toFixed(2)}·10${sup(e)}`
}
const fmtAmount = (raw: string, decimals: number) => (Number(raw) / 10 ** decimals).toFixed(3)

function useCurve(input: CurveInput) {
  return useMemo(() => {
    try {
      const params = buildParams(input)
      const errors = validateCurve(params)
      const sim: SimResult | null = errors.length
        ? null
        : simulate(params, { steps: 120, baseDecimals: input.baseDecimals, quoteDecimals: input.quoteDecimals })
      return { params, errors, sim }
    } catch (e) {
      return { params: null, errors: [(e as Error).message], sim: null }
    }
  }, [input])
}

export default function Page() {
  const [input, setInput] = useState<CurveInput>(DEFAULTS)
  const [baseline, setBaseline] = useState<CurveInput>(DEFAULTS)
  const [dragging, setDragging] = useState<number | null>(null)
  const [hoverSeg, setHoverSeg] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const hydrated = useRef(false)

  // a shared link is the whole curve; adopt it as the baseline so it does not read as edited
  useEffect(() => {
    const fromUrl = decode(window.location.search)
    if (fromUrl) { setInput(fromUrl); setBaseline(fromUrl) }
    hydrated.current = true
  }, [])

  // keep the address bar in step with the curve, without touching history
  useEffect(() => {
    if (!hydrated.current) return
    window.history.replaceState(null, '', `${window.location.pathname}?${encode(input)}`)
  }, [input])

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?${encode(input)}`
    try { await navigator.clipboard.writeText(url) } catch { return }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const { params, errors, sim } = useCurve(input)
  const ghost = useCurve(baseline)
  const dirty = JSON.stringify(input) !== JSON.stringify(baseline)

  const pLo = Math.min(input.prices[0], baseline.prices[0]) * 0.92
  const pHi = Math.max(input.prices[input.prices.length - 1], baseline.prices[baseline.prices.length - 1]) * 1.12
  const lLo = Math.log10(pLo)
  const lHi = Math.log10(pHi)

  const yOf = (price: number) => PLOT_T + PH * (1 - (Math.log10(price) - lLo) / (lHi - lLo))
  const priceOf = (y: number) => 10 ** (lLo + ((PLOT_T + PH - y) / PH) * (lHi - lLo))
  const xOf = (progress: number) => PAD.l + PW * Math.min(1, Math.max(0, progress))

  const pathOf = (s: SimResult | null) =>
    !s?.steps.length ? '' : s.steps.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.progress).toFixed(1)},${yOf(p.price).toFixed(1)}`).join(' ')

  const trace = useMemo(() => pathOf(sim), [sim, lLo, lHi])
  const ghostTrace = useMemo(() => (dirty ? pathOf(ghost.sim) : ''), [ghost.sim, dirty, lLo, lHi])

  /** progress at which each price boundary is crossed — this is what makes weights visible */
  const crossings = useMemo(() => {
    if (!sim?.steps.length) return input.prices.map((_, i) => i / (input.prices.length - 1))
    return input.prices.map((p, i) => {
      if (i === 0) return 0
      if (i === input.prices.length - 1) return 1
      const hit = sim.steps.find((s) => s.price >= p)
      return hit ? hit.progress : 1
    })
  }, [sim, input.prices])

  const decades = useMemo(() => {
    const out: number[] = []
    for (let e = Math.ceil(lLo); e <= Math.floor(lHi); e++) out.push(10 ** e)
    return out
  }, [lLo, lHi])

  const maxWeight = Math.max(...input.weights, 1)

  const onMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging === null || !svgRef.current) return
      const r = svgRef.current.getBoundingClientRect()
      const y = ((e.clientY - r.top) / r.height) * H
      const next = priceOf(Math.max(PLOT_T, Math.min(PLOT_T + PH, y)))
      setInput((cur) => {
        const prices = [...cur.prices]
        const lo = dragging > 0 ? prices[dragging - 1] * 1.03 : 1e-12
        const hi = dragging < prices.length - 1 ? prices[dragging + 1] * 0.97 : Infinity
        prices[dragging] = Math.max(lo, Math.min(hi, next))
        return { ...cur, prices }
      })
    },
    [dragging, lLo, lHi]
  )

  const loadPreset = (k: string) =>
    setInput((cur) => {
      // a preset changes the shape, not the token you are raising in
      const next = { ...PRESETS[k], quoteMint: cur.quoteMint, quoteSymbol: cur.quoteSymbol, quoteDecimals: cur.quoteDecimals }
      setBaseline(next)
      return next
    })

  const selectQuote = (q: Quote) =>
    setInput((cur) => ({ ...cur, quoteMint: q.mint, quoteSymbol: q.symbol, quoteDecimals: q.decimals as CurveInput['quoteDecimals'] }))
  const setWeight = (i: number, v: number) =>
    setInput((cur) => { const weights = [...cur.weights]; weights[i] = v; return { ...cur, weights } })

  const addPoint = () =>
    setInput((cur) => {
      if (cur.prices.length >= 17) return cur
      const i = cur.prices.length - 1
      const mid = Math.sqrt(cur.prices[i - 1] * cur.prices[i])
      return { ...cur, prices: [...cur.prices.slice(0, i), mid, cur.prices[i]], weights: [...cur.weights, cur.weights.at(-1)!] }
    })
  const removePoint = () =>
    setInput((cur) =>
      cur.prices.length <= 2 ? cur
        : { ...cur, prices: cur.prices.filter((_, i) => i !== cur.prices.length - 2), weights: cur.weights.slice(0, -1) })

  const segments = input.prices.length - 1
  const qDec = input.quoteDecimals ?? 9
  const qSym = (input.quoteSymbol ?? 'SOL').toLowerCase()
  const btn = 'panel px-3 py-1.5 text-[11px] label transition-colors duration-150 hover:text-[var(--trace)] hover:border-[var(--trace-dim)]'

  return (
    <main className="min-h-screen p-5 max-w-[1340px] mx-auto flex flex-col gap-3">
      <header className="flex items-baseline justify-between border-b rule pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-[0.3em] uppercase">Curvature</h1>
          {IS_MAINNET ? (
            <span className="text-[10px] px-2 py-0.5" style={{ background: 'var(--warn)', color: '#07090b', letterSpacing: '0.08em' }}>
              MAINNET
            </span>
          ) : (
            <span className="label text-[10px] px-2 py-0.5 border rule">{CLUSTER}</span>
          )}
        </div>
        <p className="label text-[11px]">meteora dbc · tune a bonding curve</p>
      </header>

      <div className="flex gap-2 flex-wrap items-center">
        {Object.keys(PRESETS).map((k) => (
          <button key={k} onClick={() => loadPreset(k)} className={btn}>{k}</button>
        ))}
        {dirty && (
          <button onClick={() => setInput(baseline)} className={btn} style={{ color: 'var(--warn)' }}>
            reset
          </button>
        )}
        <QuotePicker
          value={{ symbol: input.quoteSymbol ?? SOL_QUOTE.symbol, mint: input.quoteMint ?? SOL_QUOTE.mint }}
          onSelect={selectQuote}
        />
        <button onClick={copyLink} className={btn} style={copied ? { color: 'var(--trace)', borderColor: 'var(--trace-dim)' } : undefined}>
          {copied ? 'link copied' : 'copy link'}
        </button>
        <div className="flex-1" />
        <span className="label text-[10px] mr-1">{segments}/16 segments</span>
        <button onClick={removePoint} className={btn}>− point</button>
        <button onClick={addPoint} className={btn}>+ point</button>
      </div>

      <div className="panel">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full select-none block"
          onMouseMove={onMove}
          onMouseUp={() => setDragging(null)}
          onMouseLeave={() => { setDragging(null); setHoverSeg(null) }}
          style={{ cursor: dragging !== null ? 'ns-resize' : 'default' }}
        >
          {/* liquidity strip — width is the share of the raise, height is the weight */}
          <text x={PAD.l - 8} y={PAD.t + STRIP_H / 2 + 3.5} textAnchor="end" fontSize={9} fill="var(--ink-dim)" className="label">liq</text>
          <rect x={PAD.l} y={PAD.t} width={PW} height={STRIP_H} fill="none" stroke="var(--grid)" strokeWidth={1} />
          {input.weights.map((w, i) => {
            const x0 = xOf(crossings[i])
            const x1 = xOf(crossings[i + 1])
            const bw = Math.max(0, x1 - x0)
            const h = Math.max(2, (w / maxWeight) * STRIP_H)
            const active = hoverSeg === i
            return (
              <g key={`strip${i}`} onMouseEnter={() => setHoverSeg(i)} onMouseLeave={() => setHoverSeg(null)}>
                <rect x={x0} y={PAD.t + STRIP_H - h} width={bw} height={h}
                  fill="var(--trace)" opacity={active ? 0.85 : 0.42} />
                <rect x={x0} y={PAD.t} width={bw} height={STRIP_H} fill="transparent" />
                {bw > 22 && (
                  <text x={x0 + bw / 2} y={PAD.t + STRIP_H - h - 4} textAnchor="middle" fontSize={9}
                    fill={active ? 'var(--trace)' : 'var(--ink-dim)'}>w{w}</text>
                )}
                {/* divider dropped into the plot connects strip to trace */}
                {i > 0 && (
                  <line x1={x0} x2={x0} y1={PAD.t + STRIP_H} y2={PLOT_T + PH}
                    stroke={active ? 'var(--trace-dim)' : 'var(--grid)'} strokeWidth={active ? 1 : 0.75} />
                )}
              </g>
            )
          })}

          {/* graticule */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={`v${f}`} x1={xOf(f)} x2={xOf(f)} y1={PLOT_T} y2={PLOT_T + PH}
              stroke="var(--grid)" strokeWidth={0.5} strokeDasharray="1 5" />
          ))}
          {decades.map((d) => (
            <g key={d}>
              <line x1={PAD.l} x2={PAD.l + PW} y1={yOf(d)} y2={yOf(d)}
                stroke="var(--grid)" strokeWidth={0.5} strokeDasharray="1 5" />
              <text x={PAD.l - 8} y={yOf(d) + 3.5} textAnchor="end" fontSize={10} fill="var(--ink-dim)">
                10{sup(Math.round(Math.log10(d)))}
              </text>
            </g>
          ))}
          <rect x={PAD.l} y={PLOT_T} width={PW} height={PH} fill="none" stroke="var(--grid)" strokeWidth={1} />

          {[0, 25, 50, 75, 100].map((p) => (
            <text key={p} x={xOf(p / 100)} y={H - 18} textAnchor="middle" fontSize={10} fill="var(--ink-dim)">{p}%</text>
          ))}
          <text x={PAD.l} y={H - 5} fontSize={9} fill="var(--ink-dim)" className="label">progress to graduation →</text>
          <text x={18} y={PLOT_T + PH / 2} textAnchor="middle" fontSize={9} fill="var(--ink-dim)" className="label"
            transform={`rotate(-90 18 ${PLOT_T + PH / 2})`}>price</text>

          {/* ghost = the preset you started from */}
          {ghostTrace && <path d={ghostTrace} fill="none" stroke="var(--trace-dim)" strokeWidth={1.5} strokeDasharray="4 4" />}
          {trace && <path d={trace} fill="none" stroke="var(--trace)" strokeWidth={2.25} />}

          {/* graduation marker, pulled inside the frame so it is readable */}
          <line x1={xOf(1)} x2={xOf(1)} y1={PAD.t} y2={PLOT_T + PH} stroke="var(--warn)" strokeWidth={1} strokeDasharray="3 3" />
          <text x={xOf(1) - 6} y={PLOT_T + PH - 8} textAnchor="end" fontSize={10} fill="var(--warn)">graduation</text>

          {/* draggable price boundaries */}
          {input.prices.map((price, i) => {
            const y = yOf(price)
            const x = xOf(crossings[i])
            const on = dragging === i
            return (
              <g key={`h${i}`} onMouseDown={() => setDragging(i)} style={{ cursor: 'ns-resize' }}>
                <line x1={PAD.l} x2={PAD.l + PW} y1={y} y2={y} stroke={on ? 'var(--trace)' : 'var(--trace-dim)'}
                  strokeWidth={on ? 1.25 : 0.6} />
                <rect x={x - 6} y={y - 6} width={12} height={12} fill="var(--bg)" stroke="var(--trace)" strokeWidth={on ? 2.5 : 1.75} />
                {on && (
                  <text x={x + 14} y={y - 10} fontSize={11} fill="var(--trace)">{fmtPrice(price)}</text>
                )}
                <rect x={PAD.l} y={y - 10} width={PW} height={20} fill="transparent" />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          ['graduation', params ? `${fmtAmount(params.migrationQuoteThreshold.toString(), qDec)} ${qSym}` : '—'],
          [`final price (${qSym}/token)`, sim?.steps.length ? fmtPrice(sim.steps.at(-1)!.price) : '—'],
          ['fee paid', sim ? `${fmtAmount(sim.totalFee.toString(), qDec)} ${qSym}` : '—'],
          ['curve points', `${segments} / 16`],
        ].map(([k, v]) => (
          <div key={k} className="panel px-3 py-2">
            <div className="label text-[10px]">{k}</div>
            <div className="text-[15px] mt-0.5">{v}</div>
          </div>
        ))}
      </div>

      <div className="panel p-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="label text-[10px]">liquidity weight per segment</span>
          <span className="label text-[10px]">wider band = more of the raise spent in that price range</span>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
          {input.weights.map((w, i) => (
            <div key={i} className="flex items-center gap-3" onMouseEnter={() => setHoverSeg(i)} onMouseLeave={() => setHoverSeg(null)}>
              <span className="label text-[10px] w-11" style={{ color: hoverSeg === i ? 'var(--trace)' : undefined }}>seg {i + 1}</span>
              <input type="range" className="knob flex-1" min={1} max={24} step={1} value={w}
                onChange={(e) => setWeight(i, Number(e.target.value))} />
              <span className="text-[11px] w-7 text-right">{w}</span>
            </div>
          ))}
        </div>
      </div>

      <LaunchPanel input={input} params={params} sim={sim} errors={errors} />

      {errors.length > 0 && (
        <div className="panel p-3" style={{ borderColor: 'var(--warn)' }}>
          {errors.map((e, i) => (
            <div key={i} className="text-[11px]" style={{ color: 'var(--warn)' }}>{e}</div>
          ))}
        </div>
      )}
    </main>
  )
}
