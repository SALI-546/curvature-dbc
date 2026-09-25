/**
 * Build the quote-mint catalogue the studio offers.
 *
 * A DBC quote mint that is not permissionless-supported needs a TokenBadge, and only
 * Meteora operators can mint one — but the stock catalogue is already provisioned, so
 * reading the registry is enough. Base58 is useless in a picker, so each badged mint is
 * resolved to a ticker through Jupiter. The result is written to public/ and fetched
 * lazily, never bundled.
 */
import { Connection } from '@solana/web3.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fetchBadgedMints, type BadgedMint } from '../src/badges.js'

const RPC = process.env.MAINNET_RPC ?? 'https://api.mainnet-beta.solana.com'
const JUP = 'https://lite-api.jup.ag/tokens/v2/search?query='
const BATCH = 50

interface Resolved {
  mint: string
  symbol: string
  name: string
  decimals: number
  icon?: string
  family: BadgedMint['family']
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function resolve(badges: BadgedMint[]): Promise<Resolved[]> {
  const byMint = new Map(badges.map((b) => [b.mint, b]))
  const out: Resolved[] = []
  const mints = [...byMint.keys()]

  for (let i = 0; i < mints.length; i += BATCH) {
    const chunk = mints.slice(i, i + BATCH)
    try {
      const res = await fetch(JUP + chunk.join(','))
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>
        for (const r of rows) {
          const mint = String(r.id ?? '')
          const badge = byMint.get(mint)
          const symbol = String(r.symbol ?? '')
          if (!badge || !symbol) continue
          out.push({
            mint,
            symbol,
            name: String(r.name ?? symbol),
            decimals: Number(r.decimals ?? 0),
            icon: typeof r.icon === 'string' ? r.icon : undefined,
            family: badge.family,
          })
        }
      } else {
        process.stderr.write(`  batch ${i / BATCH}: HTTP ${res.status}\n`)
      }
    } catch (e) {
      process.stderr.write(`  batch ${i / BATCH}: ${(e as Error).message}\n`)
    }
    process.stdout.write(`\r  resolved ${out.length} / ${Math.min(i + BATCH, mints.length)} probed`)
    await sleep(120)
  }
  process.stdout.write('\n')
  return out
}

async function main() {
  const badges = await fetchBadgedMints(new Connection(RPC, 'confirmed'))
  console.log('badges on chain:', badges.length)

  const resolved = await resolve(badges)
  resolved.sort((a, b) => a.symbol.localeCompare(b.symbol))

  const counts = resolved.reduce<Record<string, number>>((acc, r) => {
    acc[r.family] = (acc[r.family] ?? 0) + 1
    return acc
  }, {})
  console.log('resolved to a ticker:', resolved.length, counts)

  mkdirSync('public', { recursive: true })
  writeFileSync(
    'public/badges.json',
    JSON.stringify({ fetchedAt: new Date().toISOString(), onChain: badges.length, quotes: resolved })
  )
  console.log('wrote public/badges.json')
  console.log('sample:', resolved.slice(0, 8).map((r) => r.symbol).join(' '))
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
