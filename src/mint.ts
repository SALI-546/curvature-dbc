/**
 * Reading a mint, without the Meteora SDK.
 *
 * Kept separate from src/launch.ts so the studio can check a quote token before the user
 * commits to anything: importing the SDK client here would drag PartnerService and
 * CreatorService into the first load for a lookup that needs neither.
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { connection } from './network'

/** Absent and "exists but is not a mint" are different problems and get different messages. */
export type MintLookup =
  | { kind: 'ok'; decimals: number }
  | { kind: 'absent' }
  | { kind: 'not-a-mint' }

export async function lookupMint(
  mint: PublicKey,
  conn: Connection = connection()
): Promise<MintLookup> {
  const info = await conn.getParsedAccountInfo(mint)
  if (!info.value) return { kind: 'absent' }
  const data = info.value.data
  if (!('parsed' in data)) return { kind: 'not-a-mint' }
  const decimals = data.parsed?.info?.decimals
  return typeof decimals === 'number' ? { kind: 'ok', decimals } : { kind: 'not-a-mint' }
}
