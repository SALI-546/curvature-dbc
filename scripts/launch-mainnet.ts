/**
 * The showcase launch, on mainnet, from a local keypair.
 *
 * No browser wallet is involved: src/launch.ts only needs something that can sign, and a
 * Keypair satisfies that interface exactly as the devnet proof does. Run it with
 * NEXT_PUBLIC_CLUSTER=mainnet-beta, and nothing is spent without --confirm.
 */
import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildParams, DEFAULTS, WSOL, type CurveInput } from '../src/config.js'
import { simulate, validateCurve } from '../src/sim.js'
import { preflight, isLaunchable } from '../src/preflight.js'
import { lookupMint } from '../src/mint.js'
import { launch, type LaunchWallet } from '../src/launch.js'
import { CLUSTER, EXPLORER, connection, assertCluster } from '../src/network.js'

const ORIGIN = 'https://curvature-dbc.vercel.app'
const KEYPAIR = join(homedir(), '.config/solana/kds-w1.json')

/** Tuned to graduate at ~1.47 SOL: a threshold a real buyer could actually reach. */
const CURVE: CurveInput = {
  ...DEFAULTS,
  prices: [3.3e-11, 1.7e-10, 1e-9, 6.7e-9, 3.3e-8],
  weights: [1, 3, 6, 2],
}

const TOKENS: Record<string, { name: string; symbol: string; quoteMint: string; quoteDecimals: 6 | 7 | 8 | 9 }> = {
  sol: { name: 'Curvature Reference', symbol: 'CURVE', quoteMint: WSOL, quoteDecimals: 9 },
  // NVDAx — the most-used badged quote mint on mainnet at the time of writing
  nvda: {
    name: 'Curvature NVDA Pair',
    symbol: 'CURVNV',
    quoteMint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    quoteDecimals: 8,
  },
}

const sol = (lamports: number) => (lamports / 1e9).toFixed(9)

async function main() {
  const which = process.argv.find((a) => a in TOKENS) ?? 'sol'
  const confirmed = process.argv.includes('--confirm')
  const token = TOKENS[which]

  if (CLUSTER !== 'mainnet-beta') {
    throw new Error(`refusing to run: NEXT_PUBLIC_CLUSTER is "${CLUSTER}". Set it to mainnet-beta explicitly.`)
  }

  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, 'utf8'))))
  const wallet: LaunchWallet = {
    publicKey: kp.publicKey,
    async signTransaction(tx: Transaction) {
      tx.partialSign(kp)
      return tx
    },
  }

  const input: CurveInput = {
    ...CURVE,
    quoteMint: token.quoteMint,
    quoteSymbol: token.symbol,
    quoteDecimals: token.quoteDecimals,
  }
  const params = buildParams(input)
  const errors = validateCurve(params)
  const sim = simulate(params, {
    steps: 120,
    baseDecimals: input.baseDecimals,
    quoteDecimals: input.quoteDecimals,
  })

  await assertCluster('mainnet-beta')
  const quote = new PublicKey(token.quoteMint)
  const found = await lookupMint(quote)

  const checks = preflight({
    input,
    params,
    sim,
    errors,
    onChainQuoteDecimals: found.kind === 'ok' ? found.decimals : undefined,
    quoteMintProblem: found.kind !== 'ok' ? found.kind : undefined,
  })

  const balance = await connection().getBalance(kp.publicKey)
  const threshold = Number(params.migrationQuoteThreshold.toString()) / 10 ** token.quoteDecimals
  const uri = `${ORIGIN}/t?s=${encodeURIComponent(token.symbol)}&n=${encodeURIComponent(token.name)}`

  console.log('cluster    ', CLUSTER, '(genesis verified)')
  console.log('payer      ', kp.publicKey.toBase58())
  console.log('balance    ', sol(balance), 'SOL')
  console.log('token      ', `${token.name} (${token.symbol})`)
  console.log('quote mint ', token.quoteMint, found.kind === 'ok' ? `· ${found.decimals} decimals` : `· ${found.kind}`)
  console.log('graduation ', threshold.toFixed(4), token.quoteDecimals === 9 ? 'SOL' : 'quote units')
  console.log('segments   ', input.prices.length - 1)
  console.log('metadata   ', uri)
  console.log('est. cost  ', '0.026575720 SOL')
  console.log()
  console.log('preflight  ', isLaunchable(checks) ? 'LAUNCHABLE' : 'BLOCKED')
  checks.forEach((c) => console.log(`   ${c.level}: ${c.message}`))

  if (!isLaunchable(checks)) process.exit(1)

  if (!confirmed) {
    console.log()
    console.log('DRY RUN — nothing was spent. Re-run with --confirm to launch for real.')
    return
  }

  console.log()
  console.log('launching for real…')
  const res = await launch({
    params,
    quoteMint: quote,
    quoteDecimals: token.quoteDecimals,
    token: { name: token.name, symbol: token.symbol, uri },
    wallet,
    onProgress: (p) => console.log('  →', p.phase),
  })

  const after = await connection().getBalance(kp.publicKey)
  console.log()
  console.log('pool      ', res.pool)
  console.log('base mint ', res.baseMint)
  console.log('config    ', res.config)
  console.log('config tx ', EXPLORER('tx', res.configTx, 'mainnet-beta'))
  console.log('pool tx   ', EXPLORER('tx', res.poolTx, 'mainnet-beta'))
  console.log('pool page ', EXPLORER('address', res.pool, 'mainnet-beta'))
  console.log('spent     ', sol(balance - after), 'SOL')
  console.log('remaining ', sol(after), 'SOL')
}

main().catch((e: unknown) => {
  console.error('FAILED:', (e as Error).message)
  process.exit(1)
})
