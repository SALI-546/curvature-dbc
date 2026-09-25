/**
 * Live TokenBadge registry.
 *
 * A quote mint that is not permissionless-supported needs a TokenBadge, passed as the
 * remaining account at index 0 of createConfig / createPool (DBC 0.2.1). Only Meteora
 * operators can create badges, but the stock-token catalogue is already provisioned on
 * mainnet, so reading the registry is enough to offer those mints as quote tokens.
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { deriveTokenBadgeAddress } from '@meteora-ag/dynamic-bonding-curve-sdk'

export const DBC_PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN')
const TOKEN_BADGE_DISCRIMINATOR = Buffer.from([116, 219, 204, 229, 249, 116, 255, 150])
const TOKEN_BADGE_SIZE = 168

export interface BadgedMint {
  mint: string
  badge: string
  /** heuristic: xStocks mints are vanity-prefixed Xs, Ondo mints vanity-suffixed ondo */
  family: 'xstock' | 'ondo' | 'other'
}

const classify = (mint: string): BadgedMint['family'] =>
  mint.startsWith('Xs') ? 'xstock' : mint.endsWith('ondo') ? 'ondo' : 'other'

/** Every quote mint that currently holds a TokenBadge. */
export async function fetchBadgedMints(connection: Connection): Promise<BadgedMint[]> {
  const accounts = await connection.getProgramAccounts(DBC_PROGRAM, {
    dataSlice: { offset: 8, length: 32 },
    filters: [
      { dataSize: TOKEN_BADGE_SIZE },
      { memcmp: { offset: 0, bytes: TOKEN_BADGE_DISCRIMINATOR.toString('base64'), encoding: 'base64' } },
    ],
  })
  return accounts
    .map(({ pubkey, account }) => {
      const mint = new PublicKey(account.data).toBase58()
      return { mint, badge: pubkey.toBase58(), family: classify(mint) }
    })
    .sort((a, b) => a.mint.localeCompare(b.mint))
}

/** The badge account a given quote mint needs, or null when the mint is permissionless. */
export async function badgeFor(
  connection: Connection,
  quoteMint: PublicKey
): Promise<PublicKey | null> {
  const badge = deriveTokenBadgeAddress(quoteMint)
  const info = await connection.getAccountInfo(badge)
  return info ? badge : null
}
