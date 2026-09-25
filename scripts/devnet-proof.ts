/**
 * Devnet proof: create a real DBC config + pool and measure the exact on-chain cost.
 * Rent is identical on devnet and mainnet, so the numbers here are the mainnet numbers.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  DynamicBondingCurveClient,
  buildCurve,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  deriveDbcPoolAddress,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const RPC = 'https://api.devnet.solana.com'
const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112')
const LAMPORTS = 1_000_000_000

const loadKeypair = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))))

const sol = (lamports: number) => (lamports / LAMPORTS).toFixed(9)

async function main() {
  const wallet = loadKeypair(join(homedir(), '.config/solana/devnet.json'))
  const connection = new Connection(RPC, 'confirmed')
  const client = new DynamicBondingCurveClient(connection, 'confirmed')

  console.log('wallet   ', wallet.publicKey.toBase58())
  const start = await connection.getBalance(wallet.publicKey)
  console.log('balance  ', sol(start), 'SOL\n')

  // ---- 1. Build the curve -------------------------------------------------
  const curveConfig = buildCurve({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 500,
          endingFeeBps: 100,
          numberOfPeriod: 10,
          totalDuration: 3600,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 100,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: 10,
  })

  console.log('curve points:', curveConfig.curve.length)
  console.log('sqrtStartPrice:', curveConfig.sqrtStartPrice.toString(), '\n')

  // ---- 2. Create the config ----------------------------------------------
  const configKp = Keypair.generate()
  const configTx = await client.partner.createConfig({
    config: configKp.publicKey,
    feeClaimer: wallet.publicKey,
    leftoverReceiver: wallet.publicKey,
    payer: wallet.publicKey,
    quoteMint: NATIVE_MINT,
    ...curveConfig,
  })
  const configSig = await sendAndConfirmTransaction(connection, configTx, [wallet, configKp], {
    commitment: 'confirmed',
  })
  const afterConfig = await connection.getBalance(wallet.publicKey)
  console.log('CONFIG created')
  console.log('  address ', configKp.publicKey.toBase58())
  console.log('  tx      ', configSig)
  console.log('  cost    ', sol(start - afterConfig), 'SOL\n')

  // ---- 3. Create the pool -------------------------------------------------
  const baseMintKp = Keypair.generate()
  const poolTx = await client.creator.createPool({
    baseMint: baseMintKp.publicKey,
    config: configKp.publicKey,
    name: 'Curve Studio Proof',
    symbol: 'PROOF',
    uri: 'https://curvestudio.xyz/proof.json',
    payer: wallet.publicKey,
    poolCreator: wallet.publicKey,
  })
  const poolSig = await sendAndConfirmTransaction(connection, poolTx, [wallet, baseMintKp], {
    commitment: 'confirmed',
  })
  const afterPool = await connection.getBalance(wallet.publicKey)

  const poolAddress = deriveDbcPoolAddress(NATIVE_MINT, baseMintKp.publicKey, configKp.publicKey)
  console.log('POOL created')
  console.log('  pool    ', poolAddress.toBase58())
  console.log('  mint    ', baseMintKp.publicKey.toBase58())
  console.log('  tx      ', poolSig)
  console.log('  cost    ', sol(afterConfig - afterPool), 'SOL\n')

  // ---- 4. Verify on-chain state ------------------------------------------
  const pool = await client.state.getPool(poolAddress)
  console.log('on-chain pool read back:', pool ? 'OK' : 'FAILED')

  console.log('\n================ COST SUMMARY ================')
  console.log('config (one-time, reusable):', sol(start - afterConfig), 'SOL')
  console.log('pool   (per launch)        :', sol(afterConfig - afterPool), 'SOL')
  console.log('total                      :', sol(start - afterPool), 'SOL')
  console.log('==============================================')
  console.log('\nexplorer:')
  console.log(`  https://solscan.io/tx/${configSig}?cluster=devnet`)
  console.log(`  https://solscan.io/tx/${poolSig}?cluster=devnet`)
}

main().catch((e: any) => {
  console.error('FAILED:', e.message)
  if (e.logs) console.error(e.logs.join('\n'))
  process.exit(1)
})
