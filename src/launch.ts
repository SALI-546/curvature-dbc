/**
 * Turning a designed curve into a live pool.
 *
 * Deliberately two sequential transactions rather than createConfigAndPool: the atomic
 * path serializes past the 1232-byte limit at 9 curve points (measured: 8 pts 1202B,
 * 9 pts 1234B), which is exactly the elaborate curves this studio exists to make. It
 * would have passed every casual test and broken on the interesting work.
 *
 * The cost of splitting is a config that can outlive a failed second leg. DBC 0.2.1 has
 * no close_config, so that config's rent is sunk — but a config is reusable for unlimited
 * pools and is not consumed by createPool, so we persist its address and offer a resume
 * instead of paying for a new one.
 *
 * Nothing here is imported by src/sim.ts or src/config.ts: the simulator stays offline.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionSignature,
} from '@solana/web3.js'
import {
  DynamicBondingCurveClient,
  type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { badgeFor } from './badges'
import { assertCluster, connection, CLUSTER, type Cluster } from './network'

/** What a Wallet Standard account gives us, narrowed to what we actually need. */
export interface LaunchWallet {
  publicKey: PublicKey
  signTransaction(tx: Transaction): Promise<Transaction>
}

export type LaunchPhase =
  | 'checking'
  | 'awaiting-config-signature'
  | 'confirming-config'
  | 'awaiting-pool-signature'
  | 'confirming-pool'
  | 'done'

export interface LaunchProgress {
  phase: LaunchPhase
  config?: string
  configTx?: string
  pool?: string
  baseMint?: string
  poolTx?: string
}

export interface LaunchResult {
  cluster: Cluster
  config: string
  configTx: TransactionSignature
  pool: string
  baseMint: string
  poolTx: TransactionSignature
}

const RESUME_KEY = 'curvature:pending-config'

/** A config that survived a failed pool leg, so the user is not charged rent twice. */
export function readPendingConfig(): { cluster: Cluster; config: string } | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    return v?.config && v?.cluster ? v : null
  } catch {
    return null
  }
}

const writePendingConfig = (v: { cluster: Cluster; config: string } | null) => {
  try {
    if (v) localStorage.setItem(RESUME_KEY, JSON.stringify(v))
    else localStorage.removeItem(RESUME_KEY)
  } catch {
    /* private browsing — resume is a convenience, not a requirement */
  }
}

/**
 * ConfigParameters carries no quote-decimals field; the value only ever enters through
 * createSqrtPrices. A disagreement with the mint's real decimals mis-prices the entire
 * curve by 10^delta and the program raises nothing, so we read the truth from chain.
 */
export async function fetchQuoteDecimals(mint: PublicKey, conn = connection()): Promise<number> {
  const info = await conn.getParsedAccountInfo(mint)
  const parsed = info.value?.data
  if (!parsed || !('parsed' in parsed)) throw new Error(`quote mint ${mint.toBase58()} not found on ${CLUSTER}`)
  const decimals = parsed.parsed?.info?.decimals
  if (typeof decimals !== 'number') throw new Error(`quote mint ${mint.toBase58()} has no decimals field`)
  return decimals
}

/** Anchor hands back an unsigned legacy Transaction with neither field set. */
async function prepare(tx: Transaction, payer: PublicKey, conn: Connection, extra: Keypair) {
  tx.feePayer = payer
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
  tx.partialSign(extra)
  return tx
}

async function sendSigned(tx: Transaction, conn: Connection): Promise<TransactionSignature> {
  // the wallet's signature is present but the SDK's verifier does not know that yet
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  const sig = await conn.sendRawTransaction(raw, { preflightCommitment: 'confirmed' })
  const bh = await conn.getLatestBlockhash('confirmed')
  const res = await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed')
  if (res.value.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(res.value.err)}`)
  return sig
}

export async function launch(opts: {
  params: ConfigParameters
  quoteMint: PublicKey
  /** decimals the curve was priced for, checked against chain before anything is signed */
  quoteDecimals: number
  token: { name: string; symbol: string; uri: string }
  wallet: LaunchWallet
  /** reuse a config stranded by an earlier failed pool leg */
  existingConfig?: PublicKey
  onProgress?: (p: LaunchProgress) => void
}): Promise<LaunchResult> {
  const { params, quoteMint, quoteDecimals, token, wallet, existingConfig, onProgress } = opts
  const step = (p: LaunchProgress) => onProgress?.(p)
  const conn = connection()
  const client = new DynamicBondingCurveClient(conn, 'confirmed')
  const payer = wallet.publicKey

  step({ phase: 'checking' })

  // A UI label can lie about the network; a genesis hash cannot.
  await assertCluster()

  const onChain = await fetchQuoteDecimals(quoteMint, conn)
  if (onChain !== quoteDecimals) {
    throw new Error(
      `quote mint reports ${onChain} decimals on chain but this curve was priced for ${quoteDecimals} — refusing to launch a curve mispriced by 10^${onChain - quoteDecimals}`
    )
  }

  // Required as remaining account 0 when the quote mint is not permissionless-supported.
  // null is meaningful: WSOL has no badge and must not be given one.
  const tokenBadge = (await badgeFor(conn, quoteMint)) ?? undefined

  // ---- leg 1: the config -------------------------------------------------
  let config: PublicKey
  let configTx: TransactionSignature

  if (existingConfig) {
    config = existingConfig
    configTx = '(reused)'
  } else {
    const configKp = Keypair.generate()
    const tx = await client.partner.createConfig({
      config: configKp.publicKey,
      feeClaimer: payer,
      leftoverReceiver: payer,
      payer,
      quoteMint,
      tokenBadge,
      ...params,
    })
    await prepare(tx, payer, conn, configKp)

    step({ phase: 'awaiting-config-signature', config: configKp.publicKey.toBase58() })
    const signed = await wallet.signTransaction(tx)

    step({ phase: 'confirming-config', config: configKp.publicKey.toBase58() })
    configTx = await sendSigned(signed, conn)
    config = configKp.publicKey

    // from here a pool failure costs only a retry, not a second config
    writePendingConfig({ cluster: CLUSTER, config: config.toBase58() })
  }

  // ---- leg 2: the pool ---------------------------------------------------
  // createPool reads the config account from chain, so this leg cannot be built — let
  // alone batch-signed — before leg 1 is confirmed.
  const baseMintKp = Keypair.generate()
  const poolTxRaw = await client.creator.createPool({
    baseMint: baseMintKp.publicKey,
    config,
    name: token.name,
    symbol: token.symbol,
    uri: token.uri,
    payer,
    poolCreator: payer,
    tokenBadge,
  })
  await prepare(poolTxRaw, payer, conn, baseMintKp)

  step({
    phase: 'awaiting-pool-signature',
    config: config.toBase58(),
    configTx,
    baseMint: baseMintKp.publicKey.toBase58(),
  })
  const signedPool = await wallet.signTransaction(poolTxRaw)

  step({ phase: 'confirming-pool', config: config.toBase58(), configTx })
  const poolTx = await sendSigned(signedPool, conn)

  const { deriveDbcPoolAddress } = await import('@meteora-ag/dynamic-bonding-curve-sdk')
  const pool = deriveDbcPoolAddress(quoteMint, baseMintKp.publicKey, config)

  writePendingConfig(null)

  const result: LaunchResult = {
    cluster: CLUSTER,
    config: config.toBase58(),
    configTx,
    pool: pool.toBase58(),
    baseMint: baseMintKp.publicKey.toBase58(),
    poolTx,
  }
  step({ phase: 'done', ...result })
  return result
}
