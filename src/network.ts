/**
 * The only place in the app that knows which chain we are on.
 *
 * Two rules, both learned the expensive way:
 *  - mainnet is opt-in by an exact string, never a `?? 'mainnet-beta'` fallback. A missing
 *    env var must land on devnet, not on real money.
 *  - a UI label can lie; a genesis hash cannot. Anything that spends SOL verifies the
 *    cluster against the chain itself before signing.
 */
import { Connection } from '@solana/web3.js'

export type Cluster = 'devnet' | 'mainnet-beta'

/** Explicit opt-in. Any other value — including unset — is devnet. */
export const CLUSTER: Cluster =
  process.env.NEXT_PUBLIC_CLUSTER === 'mainnet-beta' ? 'mainnet-beta' : 'devnet'

export const IS_MAINNET = CLUSTER === 'mainnet-beta'

/**
 * api.mainnet-beta.solana.com answers 403 to any request carrying a browser Origin
 * header, so it works in curl and fails in the deployed page. publicnode serves mainnet
 * with `access-control-allow-origin: *`.
 */
export const RPC: Record<Cluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://solana-rpc.publicnode.com',
}

export const GENESIS: Record<Cluster, string> = {
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
}

export const EXPLORER = (kind: 'tx' | 'address', id: string, cluster: Cluster = CLUSTER) =>
  `https://solscan.io/${kind}/${id}${cluster === 'devnet' ? '?cluster=devnet' : ''}`

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
