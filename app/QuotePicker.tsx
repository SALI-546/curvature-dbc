'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { WSOL } from '../src/config'

export interface Quote {
  mint: string
  symbol: string
  name: string
  decimals: number
  icon?: string
}

export const SOL_QUOTE: Quote = { mint: WSOL, symbol: 'SOL', name: 'Wrapped SOL', decimals: 9 }

/** The program takes 6..9 decimals, so anything else cannot be a quote token here. */
const usable = (q: Quote) => [6, 7, 8, 9].includes(q.decimals)

export function QuotePicker({
  value,
  onSelect,
}: {
  value: { symbol: string; mint: string }
  onSelect: (q: Quote) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [quotes, setQuotes] = useState<Quote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onChain, setOnChain] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // 400 kB of tickers has no business in the bundle — fetch it the first time it is needed
  useEffect(() => {
    if (!open || quotes) return
    let cancelled = false
    fetch('/badges.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return
        setOnChain(Number(d.onChain) || null)
        setQuotes([SOL_QUOTE, ...(d.quotes as Quote[]).filter(usable)])
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [open, quotes])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const results = useMemo(() => {
    if (!quotes) return []
    const q = query.trim().toLowerCase()
    if (!q) return quotes.slice(0, 80)
    return quotes
      .filter((x) => x.symbol.toLowerCase().includes(q) || x.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ax = a.symbol.toLowerCase() === q ? 0 : a.symbol.toLowerCase().startsWith(q) ? 1 : 2
        const bx = b.symbol.toLowerCase() === q ? 0 : b.symbol.toLowerCase().startsWith(q) ? 1 : 2
        return ax - bx || a.symbol.localeCompare(b.symbol)
      })
      .slice(0, 80)
  }, [quotes, query])

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="panel px-3 py-1.5 text-[11px] label transition-colors duration-150 hover:text-[var(--trace)] hover:border-[var(--trace-dim)]"
        style={open ? { color: 'var(--trace)', borderColor: 'var(--trace-dim)' } : undefined}
      >
        quote: <span style={{ color: 'var(--ink)' }}>{value.symbol}</span>
      </button>

      {open && (
        <div className="panel absolute z-20 mt-1 left-0 w-[min(340px,calc(100vw-2rem))] p-0" style={{ background: 'var(--panel)' }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search ticker or name…"
            className="w-full bg-transparent px-3 py-2 text-[11px] outline-none border-b"
            style={{ borderColor: 'var(--grid)', color: 'var(--ink)' }}
          />
          <div className="max-h-[320px] overflow-y-auto">
            {error && <div className="px-3 py-3 text-[11px]" style={{ color: 'var(--warn)' }}>catalogue unavailable — {error}</div>}
            {!quotes && !error && <div className="px-3 py-3 text-[11px] label">loading catalogue…</div>}
            {results.map((q) => {
              const on = q.mint === value.mint
              return (
                <button
                  key={q.mint}
                  onClick={() => { onSelect(q); setOpen(false); setQuery('') }}
                  className="w-full text-left px-3 py-1.5 flex items-baseline gap-2 hover:bg-white/5"
                  style={on ? { color: 'var(--trace)' } : undefined}
                >
                  <span className="text-[11px] w-16 shrink-0">{q.symbol}</span>
                  <span className="label text-[10px] truncate">{q.name}</span>
                  <span className="label text-[10px] ml-auto shrink-0">{q.decimals}d</span>
                </button>
              )
            })}
            {quotes && !results.length && <div className="px-3 py-3 text-[11px] label">no match</div>}
          </div>
          {quotes && (
            <div className="px-3 py-1.5 border-t label text-[10px]" style={{ borderColor: 'var(--grid)' }}>
              {quotes.length - 1} badged quote mints{onChain ? ` of ${onChain} on chain` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
