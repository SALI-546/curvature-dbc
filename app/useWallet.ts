'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PublicKey, Transaction } from '@solana/web3.js'
import { getWallets, StandardConnect, StandardDisconnect, StandardEvents } from '@wallet-standard/core'
import type { Wallet, WalletAccount } from '@wallet-standard/core'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import { CLUSTER } from '../src/cluster'
import type { LaunchWallet } from '../src/launch'

/**
 * Wallet Standard directly, no adapter library.
 *
 * getWallets() guards `window` internally, so this is SSR-safe with no dynamic import
 * and the page stays statically prerendered. The heavier wallet-adapter-react path was
 * measured at +131 kB first load against +1.49 kB here, and it drags react-native in.
 *
 * We need solana:signTransaction rather than signAndSendTransaction: both Meteora legs
 * carry a second, browser-generated keypair signer, and signAndSendTransaction gives us
 * no chance to attach it.
 */
const CHAIN = CLUSTER === 'mainnet-beta' ? 'solana:mainnet' : 'solana:devnet'

const usable = (w: Wallet) =>
  StandardConnect in w.features &&
  SolanaSignTransaction in w.features &&
  w.chains.includes(CHAIN)

export interface WalletState {
  wallets: Wallet[]
  wallet: Wallet | null
  account: WalletAccount | null
  publicKey: PublicKey | null
  connecting: boolean
  error: string | null
  connect(w: Wallet): Promise<void>
  disconnect(): Promise<void>
  /** the narrow interface src/launch.ts consumes */
  launchWallet: LaunchWallet | null
}

export function useWallet(): WalletState {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [account, setAccount] = useState<WalletAccount | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // discovery belongs in an effect, never at module scope: touching window there breaks
  // the build itself, not merely hydration
  useEffect(() => {
    const registry = getWallets()
    const refresh = () => setWallets(registry.get().filter(usable))
    refresh()
    const offRegister = registry.on('register', refresh)
    const offUnregister = registry.on('unregister', refresh)
    return () => {
      offRegister()
      offUnregister()
    }
  }, [])

  const connect = useCallback(async (w: Wallet) => {
    setConnecting(true)
    setError(null)
    try {
      const feature = w.features[StandardConnect] as {
        connect(): Promise<{ accounts: readonly WalletAccount[] }>
      }
      const { accounts } = await feature.connect()
      const usableAccount = accounts.find((a) => a.chains.includes(CHAIN)) ?? accounts[0]
      if (!usableAccount) throw new Error(`${w.name} returned no account for ${CHAIN}`)
      setWallet(w)
      setAccount(usableAccount)
    } catch (e) {
      setError((e as Error).message)
      setWallet(null)
      setAccount(null)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      const feature = wallet?.features[StandardDisconnect] as { disconnect(): Promise<void> } | undefined
      await feature?.disconnect()
    } catch {
      /* a wallet refusing to disconnect should not trap the UI */
    }
    setWallet(null)
    setAccount(null)
  }, [wallet])

  // keep up with the wallet switching accounts under us
  useEffect(() => {
    if (!wallet) return
    const events = wallet.features[StandardEvents] as
      | { on(event: 'change', cb: (p: { accounts?: readonly WalletAccount[] }) => void): () => void }
      | undefined
    if (!events) return
    return events.on('change', ({ accounts }) => {
      if (!accounts) return
      if (!accounts.length) {
        setWallet(null)
        setAccount(null)
      } else {
        setAccount(accounts.find((a) => a.chains.includes(CHAIN)) ?? accounts[0])
      }
    })
  }, [wallet])

  // WalletAccount.publicKey is raw bytes; the base58 `address` is what web3.js wants
  const publicKey = useMemo(
    () => (account ? new PublicKey(account.address) : null),
    [account]
  )

  const launchWallet = useMemo<LaunchWallet | null>(() => {
    if (!wallet || !account || !publicKey) return null
    return {
      publicKey,
      async signTransaction(tx: Transaction) {
        const feature = wallet.features[SolanaSignTransaction] as {
          signTransaction(input: {
            account: WalletAccount
            transaction: Uint8Array
            chain: string
          }): Promise<readonly { signedTransaction: Uint8Array }[]>
        }
        // the ephemeral keypair has already partial-signed, so the wallet's signature is
        // still missing — the default serializer would throw on that
        const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const [out] = await feature.signTransaction({
          account,
          transaction: new Uint8Array(serialized),
          chain: CHAIN,
        })
        if (!out?.signedTransaction) throw new Error('wallet returned no signed transaction')
        return Transaction.from(out.signedTransaction)
      },
    }
  }, [wallet, account, publicKey])

  return { wallets, wallet, account, publicKey, connecting, error, connect, disconnect, launchWallet }
}
