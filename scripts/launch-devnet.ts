/**
 * Exercises src/launch.ts through the exact browser-shaped path, using a local keypair
 * that pretends to be a wallet. If this passes, the only thing left untested in the real
 * flow is the wallet popup itself.
 */
import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildParams, DEFAULTS, WSOL } from '../src/config.js'
import { simulate, validateCurve } from '../src/sim.js'
import { preflight, isLaunchable } from '../src/preflight.js'
import { launch, readPendingConfig, type LaunchWallet } from '../src/launch.js'
import { EXPLORER, CLUSTER } from '../src/network.js'

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/devnet.json'), 'utf8')))
)

// a local keypair wearing the wallet's interface
const wallet: LaunchWallet = {
  publicKey: kp.publicKey,
  async signTransaction(tx: Transaction) {
    tx.partialSign(kp)
    return tx
  },
}

async function main() {
  console.log('cluster :', CLUSTER)
  console.log('wallet  :', kp.publicKey.toBase58())

  const input = DEFAULTS
  const params = buildParams(input)
  const errors = validateCurve(params)
  const sim = simulate(params, {
    steps: 120,
    baseDecimals: input.baseDecimals,
    quoteDecimals: input.quoteDecimals,
  })

  const checks = preflight({ input, params, sim, errors })
  console.log('preflight:', isLaunchable(checks) ? 'LAUNCHABLE' : 'BLOCKED')
  checks.forEach((c) => console.log(`  ${c.level}: ${c.message}`))
  if (!isLaunchable(checks)) process.exit(1)

  const res = await launch({
    params,
    quoteMint: new PublicKey(WSOL),
    quoteDecimals: input.quoteDecimals ?? 9,
    token: { name: 'Curvature Launch Test', symbol: 'CURVE', uri: 'https://example.com/t?s=CURVE' },
    wallet,
    onProgress: (p) => console.log('  →', p.phase),
  })

  console.log()
  console.log('config   ', res.config)
  console.log('pool     ', res.pool)
  console.log('baseMint ', res.baseMint)
  console.log('config tx', EXPLORER('tx', res.configTx))
  console.log('pool tx  ', EXPLORER('tx', res.poolTx))
  console.log()
  console.log('pending config cleared:', readPendingConfig() === null ? 'yes' : 'NO')
}

main().catch((e: unknown) => {
  console.error('FAILED:', (e as Error).message)
  process.exit(1)
})
