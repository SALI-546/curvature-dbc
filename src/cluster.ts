/**
 * Which chain we are on — constants only, no client.
 *
 * Kept free of @solana/web3.js so the studio page can render a network badge without
 * pulling Connection into the first load. src/network.ts adds the client on top.
 *
 * Two rules, both learned the expensive way:
 *  - mainnet is opt-in by an exact string, never a `?? 'mainnet-beta'` fallback. A missing
 *    env var must land on devnet, not on real money.
 *  - a UI label can lie; a genesis hash cannot. Anything that spends SOL verifies the
 *    cluster against the chain itself before signing.
 */
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

