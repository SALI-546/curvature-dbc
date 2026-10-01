/**
 * The first mainnet launch reported failure on a confirmation timeout while the config
 * transaction had in fact finalised, and the generated address was never printed. This
 * finds it again from the transaction itself, so the paid rent is not lost.
 */
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { connection, EXPLORER } from '../src/network.js'

const SIG = process.argv[2]

async function main() {
  if (!SIG) throw new Error('usage: recover-config <signature>')
  const conn = connection()
  const tx = await conn.getTransaction(SIG, { maxSupportedTransactionVersion: 0 })
  if (!tx) throw new Error('transaction not found')

  console.log('status :', tx.meta?.err ? `FAILED ${JSON.stringify(tx.meta.err)}` : 'SUCCESS')
  console.log('slot   :', tx.slot)
  console.log('fee    :', (tx.meta?.fee ?? 0) / 1e9, 'SOL')
  console.log()

  const keys = tx.transaction.message.getAccountKeys()
  const client = new DynamicBondingCurveClient(conn, 'confirmed')

  for (let i = 0; i < keys.length; i++) {
    const k = keys.get(i)
    if (!k) continue
    const delta = ((tx.meta?.postBalances?.[i] ?? 0) - (tx.meta?.preBalances?.[i] ?? 0)) / 1e9
    let tag = ''
    try {
      const cfg = await client.state.getPoolConfig(k)
      if (cfg) {
        tag = '  ← POOL CONFIG'
        console.log(`${String(i).padStart(2)} ${k.toBase58().padEnd(45)} ${delta ? delta.toFixed(9) : ''}${tag}`)
        console.log('     quote mint           :', cfg.quoteMint.toBase58())
        console.log('     migration threshold  :', cfg.migrationQuoteThreshold.toString())
        console.log('     curve points         :', cfg.curve.filter((p) => !p.liquidity.isZero()).length)
        console.log('     explorer             :', EXPLORER('address', k.toBase58(), 'mainnet-beta'))
        continue
      }
    } catch {
      /* not a config account */
    }
    console.log(`${String(i).padStart(2)} ${k.toBase58().padEnd(45)} ${delta ? delta.toFixed(9) : ''}`)
  }
}

main().catch((e: unknown) => {
  console.error('FAILED:', (e as Error).message)
  process.exit(1)
})
