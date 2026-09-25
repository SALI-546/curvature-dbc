/**
 * The RPC client, and the one check that cannot be faked.
 *
 * Split from src/cluster.ts on purpose: anything that only needs to KNOW the cluster
 * imports the constants, and only code that actually talks to a chain pays for web3.js.
 */
import { Connection } from '@solana/web3.js'
import { CLUSTER, GENESIS, RPC, type Cluster } from './cluster'

export * from './cluster'

let conn: Connection | null = null
export function connection(): Connection {
  if (!conn) conn = new Connection(process.env.NEXT_PUBLIC_RPC || RPC[CLUSTER], 'confirmed')
  return conn
}

/**
 * Ask the chain what it is. Called before every signature that costs money, so a
 * misconfigured RPC cannot quietly point a "devnet" build at mainnet.
 */
export async function assertCluster(expected: Cluster = CLUSTER): Promise<void> {
  const hash = await connection().getGenesisHash()
  if (hash !== GENESIS[expected]) {
    const actual = (Object.keys(GENESIS) as Cluster[]).find((c) => GENESIS[c] === hash)
    throw new Error(
      `RPC is on ${actual ?? `an unknown chain (${hash})`}, but this build expects ${expected}. Refusing to sign.`
    )
  }
}
