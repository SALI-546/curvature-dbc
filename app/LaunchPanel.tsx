'use client'

import { useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { ConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { useWallet } from './useWallet'
import { CLUSTER, IS_MAINNET, EXPLORER } from '../src/cluster'
import { preflight, isLaunchable, type Check } from '../src/preflight'
import { WSOL, type CurveInput } from '../src/config'
import type { SimResult } from '../src/sim'
import type { LaunchProgress, LaunchResult } from '../src/launch'

const PHASE_LABEL: Record<string, string> = {
  checking: 'verifying chain and quote mint',
  'awaiting-config-signature': 'approve step 1 of 2 — config',
  'confirming-config': 'confirming config',
  'awaiting-pool-signature': 'approve step 2 of 2 — pool',
  'confirming-pool': 'confirming pool',
  done: 'done',
}

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`

export function LaunchPanel({
  input,
  params,
  sim,
  errors,
}: {
  input: CurveInput
  params: ConfigParameters | null
  sim: SimResult | null
  errors: string[]
}) {
  const w = useWallet()
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [confirm, setConfirm] = useState('')
  const [progress, setProgress] = useState<LaunchProgress | null>(null)
  const [result, setResult] = useState<LaunchResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const checks = useMemo(() => preflight({ input, params, sim, errors }), [input, params, sim, errors])
  const blocks = checks.filter((c) => c.level === 'block')
  const warns = checks.filter((c) => c.level === 'warn')

  const sym = symbol.trim().toUpperCase()
  const identityOk = sym.length >= 2 && sym.length <= 10 && name.trim().length >= 2
  // on mainnet the user retypes the ticker: a misclick must not be able to spend real SOL
  const confirmOk = !IS_MAINNET || confirm.trim().toUpperCase() === sym
  const busy = progress !== null && progress.phase !== 'done'
  const ready = isLaunchable(checks) && identityOk && confirmOk && w.launchWallet !== null && !busy

  const quoteMint = input.quoteMint ?? WSOL
  const startBps = input.startingFeeBps ?? 300
  const endBps = input.endingFeeBps ?? 100

  async function run() {
    if (!params || !w.launchWallet) return
    setFailure(null)
    setResult(null)
    try {
      // kept out of the main bundle: importing the client statically would pull
      // PartnerService and CreatorService into every first load
      const { launch } = await import('../src/launch')
      const res = await launch({
        params,
        quoteMint: new PublicKey(quoteMint),
        quoteDecimals: input.quoteDecimals ?? 9,
        token: {
          name: name.trim(),
          symbol: sym,
          uri: `${window.location.origin}/t?s=${encodeURIComponent(sym)}&n=${encodeURIComponent(name.trim())}`,
        },
        wallet: w.launchWallet,
        onProgress: setProgress,
      })
      setResult(res)
    } catch (e) {
      setFailure((e as Error).message)
      setProgress(null)
    }
  }

  const field =
    'w-full bg-transparent border px-2 py-1.5 text-[11px] outline-none focus:border-[var(--trace-dim)]'
  const btn =
    'panel px-3 py-1.5 text-[11px] label transition-colors duration-150 hover:text-[var(--trace)] hover:border-[var(--trace-dim)] disabled:opacity-40 disabled:hover:text-[var(--ink-dim)] disabled:hover:border-[var(--grid)]'

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="label text-[10px]">launch</span>
        {IS_MAINNET ? (
          <span
            className="text-[10px] px-2 py-0.5"
            style={{ background: 'var(--warn)', color: '#07090b', letterSpacing: '0.08em' }}
          >
            MAINNET · REAL SOL
          </span>
        ) : (
          <span className="label text-[10px]">devnet · test sol</span>
        )}
      </div>

      {/* what is actually being launched — the URL can lie about all of it */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[10px]">
        <div className="flex justify-between">
          <span className="label">quote mint</span>
          <span title={quoteMint}>{short(quoteMint)}</span>
        </div>
        <div className="flex justify-between">
          <span className="label">quote decimals</span>
          <span>{input.quoteDecimals ?? 9}</span>
        </div>
        <div className="flex justify-between">
          <span className="label">fee schedule</span>
          <span>
            {(startBps / 100).toFixed(2)}% → {(endBps / 100).toFixed(2)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="label">segments</span>
          <span>{input.prices.length - 1}</span>
        </div>
      </div>

      {blocks.length > 0 && (
        <div className="border px-2 py-1.5" style={{ borderColor: 'var(--warn)' }}>
          {blocks.map((c: Check, i) => (
            <div key={i} className="text-[10px]" style={{ color: 'var(--warn)' }}>
              {c.message}
            </div>
          ))}
        </div>
      )}
      {warns.length > 0 && blocks.length === 0 && (
        <div className="border px-2 py-1.5" style={{ borderColor: 'var(--grid)' }}>
          {warns.map((c, i) => (
            <div key={i} className="text-[10px] label">
              {c.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          className={field}
          style={{ borderColor: 'var(--grid)', color: 'var(--ink)' }}
          placeholder="token name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={field}
          style={{ borderColor: 'var(--grid)', color: 'var(--ink)' }}
          placeholder="TICKER"
          maxLength={10}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        />
      </div>

      {IS_MAINNET && identityOk && (
        <input
          className={field}
          style={{ borderColor: 'var(--warn)', color: 'var(--ink)' }}
          placeholder={`type ${sym} to confirm a real launch`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {!w.launchWallet ? (
          w.wallets.length ? (
            w.wallets.map((x) => (
              <button key={x.name} onClick={() => w.connect(x)} className={btn} disabled={w.connecting}>
                connect {x.name.toLowerCase()}
              </button>
            ))
          ) : (
            <span className="label text-[10px]">no compatible wallet detected on {CLUSTER}</span>
          )
        ) : (
          <>
            <button onClick={() => w.disconnect()} className={btn}>
              {short(w.publicKey!.toBase58())} · disconnect
            </button>
            <button
              onClick={run}
              disabled={!ready}
              className={btn}
              style={ready ? { color: 'var(--trace)', borderColor: 'var(--trace-dim)' } : undefined}
            >
              {busy ? 'launching…' : IS_MAINNET ? 'launch on mainnet' : 'launch on devnet'}
            </button>
          </>
        )}
      </div>

      {w.error && (
        <div className="text-[10px]" style={{ color: 'var(--warn)' }}>
          {w.error}
        </div>
      )}

      {progress && !result && (
        <div className="label text-[10px]">
          {PHASE_LABEL[progress.phase] ?? progress.phase}
          {progress.phase.startsWith('awaiting') && ' — check your wallet'}
        </div>
      )}

      {failure && (
        <div className="border px-2 py-1.5 text-[10px]" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {failure}
        </div>
      )}

      {result && (
        <div className="border px-2 py-2 flex flex-col gap-1" style={{ borderColor: 'var(--trace-dim)' }}>
          <span className="text-[10px]" style={{ color: 'var(--trace)' }}>
            live on {result.cluster}
          </span>
          {(
            [
              ['pool', 'address', result.pool],
              ['mint', 'address', result.baseMint],
              ['config tx', 'tx', result.configTx],
              ['pool tx', 'tx', result.poolTx],
            ] as const
          ).map(([label, kind, id]) => (
            <a
              key={label}
              href={EXPLORER(kind, id, result.cluster)}
              target="_blank"
              rel="noreferrer"
              className="flex justify-between text-[10px] hover:text-[var(--trace)]"
            >
              <span className="label">{label}</span>
              <span>{short(id)} ↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
