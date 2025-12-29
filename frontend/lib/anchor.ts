import * as anchor from '@coral-xyz/anchor'
import { PublicKey, Connection, Transaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha256'
import idl from '../idl/roulette_table.json'

function toSnakeCase(name: string) {
  if (!name) return name
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase()
}

function toPublicKey(value: any, label: string): PublicKey {
  if (value === undefined || value === null) {
    throw new Error(`${label} is missing`)
  }
  if (typeof value === 'object' && typeof value?.toBase58 === 'function') {
    return new PublicKey(value.toBase58())
  }
  return new PublicKey(value)
}

function withInstructionDiscriminators(rawIdl: any) {
  const instructions = (rawIdl?.instructions || []).map((ix: any) => {
    if (Array.isArray(ix?.discriminator) && ix.discriminator.length === 8) return ix
    const snakeName = toSnakeCase(ix.name)
    const preimage = Buffer.from(`global:${snakeName}`)
    const disc = Array.from(sha256(preimage).slice(0, 8))
    return { ...ix, discriminator: disc }
  })
  return { ...rawIdl, instructions }
}

export async function initProgram(wallet: any, connection: Connection) {
  if (!wallet || !connection) throw new Error('wallet and connection required')
  const provider = new anchor.AnchorProvider(connection, wallet as any, anchor.AnchorProvider.defaultOptions())
  const programId = toPublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID, 'NEXT_PUBLIC_PROGRAM_ID')
  // Anchor v0.31 Program constructor derives programId from `idl.address`.
  // Our frontend IDL is instruction-only and lacks `address`, so we inject it.
  const idlWithAddress = { ...(idl as any), address: programId.toBase58() }
  const idlWithDiscriminators = withInstructionDiscriminators(idlWithAddress)
  const program = new (anchor.Program as any)(idlWithDiscriminators, provider) as anchor.Program
  return { program, provider }
}

export async function createTable(program: anchor.Program, payer: PublicKey, params: { seed: number; usdcMint: string; govMint: string; minBet: number; maxBet: number }) {
  try {
    console.log('[1] Starting createTable')
    console.log('[2] program:', program)
    console.log('[2.5] program._idl.instructions:', (program as any)?._idl?.instructions?.map((i: any) => i.name))
    console.log('[2.6] program.methods:', Object.keys((program as any)?.methods || {}))
    console.log('[3] program.programId:', program?.programId?.toBase58())
    console.log('[4] payer:', payer?.toBase58())
    console.log('[5] params:', JSON.stringify(params))
    
    if (!program?.programId) throw new Error('Program not initialized')
    if (!payer) throw new Error('payer is required')
    if (!params) throw new Error('params is required')
    console.log('createTable params:', params)
    if (!params?.usdcMint) throw new Error('usdcMint is required')
    if (!params?.govMint) throw new Error('govMint is required')
    if (params.seed === undefined || params.seed === null || isNaN(params.seed)) throw new Error(`seed is invalid: ${params.seed}`)
    if (params.minBet === undefined || params.minBet === null || isNaN(params.minBet)) throw new Error(`minBet is invalid: ${params.minBet}`)
    if (params.maxBet === undefined || params.maxBet === null || isNaN(params.maxBet)) throw new Error(`maxBet is invalid: ${params.maxBet}`)
    
    console.log('[6] Creating BN for seed:', params.seed)
    const seedBn = new anchor.BN(Math.floor(params.seed))
    console.log('[7] seedBn created:', seedBn.toString())
    
    // TableMode as u8: Private = 0, Public = 1
    const mode = 0
    console.log('[8] mode (u8):', mode)
    
    console.log('[9] Creating BN for minBet:', params.minBet)
    const minB = new anchor.BN(Math.floor(params.minBet))
    console.log('[10] minB created:', minB.toString())
    
    console.log('[11] Creating BN for maxBet:', params.maxBet)
    const maxB = new anchor.BN(Math.floor(params.maxBet))
    console.log('[12] maxB created:', maxB.toString())

  console.log('[12] maxB created:', maxB.toString())

  console.log('[13] Creating PublicKey for usdcMint:', params.usdcMint)
  const usdcMintPk = toPublicKey(params.usdcMint, 'usdcMint')
  console.log('[14] usdcMintPk:', usdcMintPk.toBase58())
  
  console.log('[15] Creating PublicKey for govMint:', params.govMint)
  const govMintPk = toPublicKey(params.govMint, 'govMint')
  console.log('[16] govMintPk:', govMintPk.toBase58())
  
  console.log('[17] About to compute PDAs, payer:', payer.toBase58(), 'programId:', program.programId.toBase58())
  console.log('[18] seedBn value:', seedBn.toString(), 'typeof Buffer:', typeof Buffer, 'Buffer exists:', !!Buffer)
  
  console.log('[19] Creating seed buffer using toArray...')
  const seedArray = seedBn.toArray('le', 8)
  console.log('[20] seedArray:', seedArray)
  const seedBuffer = Uint8Array.from(seedArray)
  console.log('[21] seedBuffer (Uint8Array):', seedBuffer)
  
  console.log('[23] Computing table PDA...')
  const [tablePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('table'), payer.toBuffer(), seedBuffer], 
    program.programId
  )
  console.log('[24] tablePda:', tablePda.toBase58())
  
  console.log('[25] Computing vault_usdc PDA...')
  const [vaultUsdcPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault_usdc'), tablePda.toBuffer()], program.programId)
  console.log('[26] vaultUsdcPda:', vaultUsdcPda.toBase58())
  
  console.log('[27] Computing control_vault_gov PDA...')
  const [controlVaultGovPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault_gov'), tablePda.toBuffer()], program.programId)
  console.log('[28] controlVaultGovPda:', controlVaultGovPda.toBase58())

  console.log('[28] controlVaultGovPda:', controlVaultGovPda.toBase58())

  console.log('[29] Building accounts object...')
  const accounts = {
    creator: payer,
    usdcMint: usdcMintPk,
    govMint: govMintPk,
    table: tablePda,
    vaultUsdc: vaultUsdcPda,
    controlVaultGov: controlVaultGovPda,
    systemProgram: anchor.web3.SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  }
  console.log('[30] accounts built:', Object.keys(accounts))
  
  for (const [name, value] of Object.entries(accounts)) {
    console.log(`[31] Validating account ${name}:`, value?.toString())
    if (value === undefined || value === null) {
      throw new Error(`createTable: account '${name}' is ${String(value)}`)
    }
  }
  
  console.log('[32] All accounts validated')
  console.log('[33] Preparing RPC call with args:')
  console.log('  - seedBn:', seedBn.toString(), 'type:', typeof seedBn, 'constructor:', seedBn.constructor.name)
  console.log('  - mode:', JSON.stringify(mode), 'type:', typeof mode)
  console.log('  - minB:', minB.toString(), 'type:', typeof minB, 'constructor:', minB.constructor.name)
  console.log('  - maxB:', maxB.toString(), 'type:', typeof maxB, 'constructor:', maxB.constructor.name)

  try {
    console.log('[34] Calling program.methods.createTable...')
    const tx = await program.methods
      .createTable(seedBn, mode, minB, maxB)
      .accounts(accounts)
      .rpc()
    console.log('[35] createTable success:', tx)
    return tx
  } catch (rpcError: any) {
    console.error('[36] RPC call failed:', rpcError)
    console.error('[37] RPC error message:', rpcError.message)
    console.error('[38] RPC error stack:', rpcError.stack)
    if (rpcError?.transactionMessage) console.error('[39] tx message:', rpcError.transactionMessage)
    if (rpcError?.transactionLogs) console.error('[40] tx logs:', rpcError.transactionLogs)
    if (rpcError?.logs) console.error('[41] logs:', rpcError.logs)
    if (typeof rpcError?.getLogs === 'function') {
      try {
        const l = await rpcError.getLogs()
        console.error('[42] getLogs():', l)
      } catch (e) {
        console.error('[43] getLogs() failed:', e)
      }
    }
    throw rpcError
  }
  } catch (error: any) {
    console.error('[ERROR] createTable error:', error)
    console.error('[ERROR] error.message:', error.message)
    console.error('[ERROR] error.stack:', error.stack)
    throw new Error(`createTable failed: ${error.message}`)
  }
}

export async function depositLiquidity(program: anchor.Program, operator: PublicKey, operatorUsdcAta: PublicKey, table: PublicKey, amount: number) {
  const a = new anchor.BN(amount)
  const [vaultUsdc] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault_usdc'), table.toBuffer()], program.programId)
  return program.rpc.depositLiquidityUsdc(a, {
    accounts: {
      operator,
      operatorUsdcAta,
      table,
      vaultUsdc,
      tokenProgram: TOKEN_PROGRAM_ID
    }
  })
}

export async function placeBet(program: anchor.Program, player: PublicKey, playerUsdcAta: PublicKey, table: PublicKey, betKind: any, stake: number) {
  if (!program?.provider?.connection) throw new Error('Program/provider not initialized')
  if (!player) throw new Error('player is required')
  if (!playerUsdcAta) throw new Error('playerUsdcAta is required')
  if (!table) throw new Error('table is required')
  if (!betKind) throw new Error('betKind is required')
  if (!Number.isFinite(stake) || stake <= 0) throw new Error('stake must be a positive number')

  const stakeBn = new anchor.BN(stake)
  const force = new Uint8Array(32)

  // Read Table account bytes (our current IDL in frontend is instruction-only, so we decode minimally).
  const tableInfo = await program.provider.connection.getAccountInfo(table)
  if (!tableInfo?.data) throw new Error('Table account not found: ' + table.toBase58())
  // Layout (Anchor/Borsh, little endian), offsets include 8-byte discriminator.
  // vault_usdc Pubkey is at struct offset 138; bet_seq u64 is at struct offset 230.
  const VAULT_USDC_OFFSET = 8 + 138
  const BET_SEQ_OFFSET = 8 + 230
  if (tableInfo.data.length < BET_SEQ_OFFSET + 8) throw new Error('Table account too small: ' + tableInfo.data.length)
  const vaultUsdc = new anchor.web3.PublicKey(tableInfo.data.slice(VAULT_USDC_OFFSET, VAULT_USDC_OFFSET + 32))
  const betSeqBn = new anchor.BN(tableInfo.data.slice(BET_SEQ_OFFSET, BET_SEQ_OFFSET + 8), undefined, 'le')
  const [bet] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('bet'), table.toBuffer(), player.toBuffer(), betSeqBn.toArrayLike(Buffer, 'le', 8)],
    program.programId,
  )

  // ORAO VRF program + PDAs.
  const oraoProgramId = new anchor.web3.PublicKey(process.env.NEXT_PUBLIC_ORAO_PROGRAM_ID || 'VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y')
  const [config] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('orao-vrf-network-configuration')], oraoProgramId)

  // ORAO randomness request PDA: ["orao-vrf-randomness-request", force]
  const [random] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('orao-vrf-randomness-request'), Buffer.from(force)], oraoProgramId)

  // Treasury is stored inside ORAO NetworkState config (Anchor account).
  const cfgInfo = await program.provider.connection.getAccountInfo(config)
  if (!cfgInfo?.data) throw new Error('ORAO config account not found: ' + config.toBase58())
  if (cfgInfo.data.length < 8 + 32 + 32) throw new Error('ORAO config account too small: ' + cfgInfo.data.length)
  const treasury = new anchor.web3.PublicKey(cfgInfo.data.slice(8 + 32, 8 + 32 + 32))

  const vrf = oraoProgramId
  const accounts = {
    player,
    playerUsdcAta,
    table,
    vaultUsdc,
    bet,
    random,
    treasury,
    config,
    vrf,
    systemProgram: anchor.web3.SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  }
  for (const [name, value] of Object.entries(accounts)) {
    if (value === undefined || value === null) {
      throw new Error(`placeBet: account '${name}' is ${String(value)}`)
    }
  }
  return program.rpc.placeBet(betKind, stakeBn, [...force], {
    accounts
  })
}

export async function resolveBet(program: anchor.Program, resolver: PublicKey, table: PublicKey, bet: PublicKey, playerUsdcAta: PublicKey) {
  const [vaultUsdc] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault_usdc'), table.toBuffer()], program.programId)
  const [random] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('random'), table.toBuffer(), bet.toBuffer()], program.programId)
  return program.rpc.resolveBet({
    accounts: {
      resolver,
      table,
      bet,
      playerUsdcAta,
      vaultUsdc,
      random,
      tokenProgram: TOKEN_PROGRAM_ID
    }
  })
}

export async function refundExpired(program: anchor.Program, caller: PublicKey, table: PublicKey, bet: PublicKey, playerUsdcAta: PublicKey) {
  const [vaultUsdc] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault_usdc'), table.toBuffer()], program.programId)
  return program.rpc.refundExpiredBet({
    accounts: {
      caller,
      table,
      bet,
      playerUsdcAta,
      vaultUsdc,
      tokenProgram: TOKEN_PROGRAM_ID
    }
  })
}

export default {
  initProgram,
  createTable,
  depositLiquidity,
  placeBet,
  resolveBet,
  refundExpired,
}
