import * as anchor from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, Connection } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { sha256 } from '@noble/hashes/sha256'

/**
 * ORAO VRF (Classic VRF program id; devnet/mainnet)
 * Repo/docs: https://github.com/orao-network/solana-vrf
 */
export const ORAO_VRF_PROGRAM_ID = new PublicKey(
  'VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y'
)

// Seeds from orao-solana-vrf crate constants:
// CONFIG_ACCOUNT_SEED = b"orao-vrf-network-configuration"
// RANDOMNESS_ACCOUNT_SEED = b"orao-vrf-randomness-request"
const ORAO_CONFIG_SEED = 'orao-vrf-network-configuration'
const ORAO_RANDOMNESS_SEED = 'orao-vrf-randomness-request'

/**
 * Minimal helpers to decode our Anchor accounts without a full IDL (accounts are not in frontend/idl).
 * We only decode fields we actually need in frontend flows.
 */

function readU64LE(buf: Uint8Array, offset: number): { value: bigint; next: number } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const lo = view.getUint32(offset, true)
  const hi = view.getUint32(offset + 4, true)
  const v = (BigInt(hi) << 32n) | BigInt(lo)
  return { value: v, next: offset + 8 }
}

function readI64LE(buf: Uint8Array, offset: number): { value: bigint; next: number } {
  const { value, next } = readU64LE(buf, offset)
  const signed = value > 0x7fffffffffffffffn ? (value - 0x10000000000000000n) : value
  return { value: signed, next }
}

function readU32LE(buf: Uint8Array, offset: number): { value: number; next: number } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const v = view.getUint32(offset, true)
  return { value: v, next: offset + 4 }
}

function readU16LE(buf: Uint8Array, offset: number): { value: number; next: number } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const v = view.getUint16(offset, true)
  return { value: v, next: offset + 2 }
}

function readU8(buf: Uint8Array, offset: number): { value: number; next: number } {
  return { value: buf[offset], next: offset + 1 }
}

function readBool(buf: Uint8Array, offset: number): { value: boolean; next: number } {
  const { value, next } = readU8(buf, offset)
  return { value: value !== 0, next }
}

function readPubkey(buf: Uint8Array, offset: number): { value: PublicKey; next: number } {
  const slice = buf.slice(offset, offset + 32)
  return { value: new PublicKey(slice), next: offset + 32 }
}

function skipAnchorDiscriminator(offset = 0): number {
  return offset + 8
}

type DecodedTable = {
  seed: bigint
  creator: PublicKey
  operator: PublicKey
  mode: number
  paused: boolean
  usdcMint: PublicKey
  govMint: PublicKey
  vaultUsdc: PublicKey
  controlVaultGov: PublicKey
  minBet: bigint
  maxBet: bigint
  lockedLiability: bigint
  activeBets: number
  betSeq: bigint
}

function decodeTableAccount(data: Uint8Array): DecodedTable {
  let o = skipAnchorDiscriminator(0)

  const seed = readU64LE(data, o); o = seed.next
  const creator = readPubkey(data, o); o = creator.next
  const operator = readPubkey(data, o); o = operator.next

  const mode = readU8(data, o); o = mode.next
  const paused = readBool(data, o); o = paused.next

  const usdcMint = readPubkey(data, o); o = usdcMint.next
  const govMint = readPubkey(data, o); o = govMint.next
  const vaultUsdc = readPubkey(data, o); o = vaultUsdc.next
  const controlVaultGov = readPubkey(data, o); o = controlVaultGov.next

  const minBet = readU64LE(data, o); o = minBet.next
  const maxBet = readU64LE(data, o); o = maxBet.next

  const lockedLiability = readU64LE(data, o); o = lockedLiability.next
  const activeBets = readU32LE(data, o); o = activeBets.next
  const betSeq = readU64LE(data, o); o = betSeq.next

  return {
    seed: seed.value,
    creator: creator.value,
    operator: operator.value,
    mode: mode.value,
    paused: paused.value,
    usdcMint: usdcMint.value,
    govMint: govMint.value,
    vaultUsdc: vaultUsdc.value,
    controlVaultGov: controlVaultGov.value,
    minBet: minBet.value,
    maxBet: maxBet.value,
    lockedLiability: lockedLiability.value,
    activeBets: activeBets.value,
    betSeq: betSeq.value,
  }
}

type DecodedBet = {
  table: PublicKey
  player: PublicKey
  stake: bigint
  kindTag: number
  createdTs: bigint
  force: Uint8Array
  randomnessAccount: PublicKey
  resultNumber: number | null
  payout: bigint
  isSettled: boolean
}

function betKindPayloadLen(tag: number): number {
  switch (tag) {
    case 0: return 1
    case 1: return 2
    case 2: return 1
    case 3: return 2
    case 4: return 1
    case 5: return 0
    case 6: return 0
    case 7: return 0
    case 8: return 0
    case 9: return 0
    case 10: return 0
    case 11: return 1
    case 12: return 1
    default: return 0
  }
}

function decodeBetAccount(data: Uint8Array): DecodedBet {
  console.log('Raw BetAccount data len:', data.length)
  console.log('Raw hex:', Buffer.from(data).toString('hex'))

  let o = skipAnchorDiscriminator(0)

  const table = readPubkey(data, o); o = table.next
  const player = readPubkey(data, o); o = player.next

  const stake = readU64LE(data, o); o = stake.next
  const multiplier = readU16LE(data, o); o = multiplier.next
  const maxTotalPayout = readU64LE(data, o); o = maxTotalPayout.next

  const kindTag = readU8(data, o); o = kindTag.next
  console.log('Decoded kindTag:', kindTag.value)
  
  const payloadLen = betKindPayloadLen(kindTag.value)
  console.log('Payload len:', payloadLen)
  o += payloadLen

  const state = readU8(data, o); o = state.next
  console.log('Decoded state:', state.value)

  const createdTs = readI64LE(data, o); o = createdTs.next

  const force = data.slice(o, o + 32); o += 32

  const randomnessAccount = readPubkey(data, o); o = randomnessAccount.next

  const resultNumberOpt = readU8(data, o); o = resultNumberOpt.next
  console.log('Decoded resultNumberOpt:', resultNumberOpt.value)
  
  let resultNumber: number | null = null
  if (resultNumberOpt.value === 1) {
      const rn = readU8(data, o); o = rn.next
      resultNumber = rn.value
      console.log('Decoded resultNumber:', resultNumber)
  }

  return {
    table: table.value,
    player: player.value,
    stake: stake.value,
    kindTag: kindTag.value,
    createdTs: createdTs.value,
    force,
    randomnessAccount: randomnessAccount.value,
    resultNumber,
    payout: 0n, // Not in struct
    isSettled: state.value !== 0 // Pending=0
  }
}

function randomForce32(): Uint8Array {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return arr
}

function toSnakeCase(name: string): string {
  if (!name) return name
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase()
}

function withInstructionDiscriminators(rawIdl: any): any {
  const instructions = (rawIdl?.instructions || []).map((ix: any) => {
    if (Array.isArray(ix?.discriminator) && ix.discriminator.length === 8) return ix
    const snakeName = toSnakeCase(ix.name)
    const preimage = Buffer.from(`global:${snakeName}`)
    const disc = Array.from(sha256(preimage).slice(0, 8))
    return { ...ix, discriminator: disc }
  })
  return { ...rawIdl, instructions }
}

export async function initProgram(idl: any, programId: PublicKey, provider: anchor.AnchorProvider) {
  anchor.setProvider(provider)
  
  // Our IDL is instruction-only and lacks 'address' field, so we inject it
  const idlWithAddress = { ...idl, address: programId.toBase58() }
  const idlWithDiscriminators = withInstructionDiscriminators(idlWithAddress)
  
  const program = new anchor.Program(idlWithDiscriminators, provider)
  return { program, provider }
}

export async function createTable(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  params: {
    seed: number
    usdcMint: string
    govMint: string
    mode: number
    minBet: number
    maxBet: number
  }
) {
  const payer = provider.wallet.publicKey

  const seedBn = new anchor.BN(params.seed)
  const mode = params.mode
  const minB = new anchor.BN(params.minBet)
  const maxB = new anchor.BN(params.maxBet)

  const usdcMintPk = new PublicKey(params.usdcMint)
  const govMintPk = new PublicKey(params.govMint)

  const seedBuf = seedBn.toArrayLike(Buffer, 'le', 8)
  const [tablePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('table'), payer.toBuffer(), seedBuf],
    program.programId
  )

  const [vaultUsdcPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_usdc'), tablePda.toBuffer()],
    program.programId
  )

  const [controlVaultGovPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_gov'), tablePda.toBuffer()],
    program.programId
  )

  // Build instruction manually to force correct account metas
  const ix = await program.methods
    .createTable(seedBn, mode, minB, maxB)
    .accounts({
      creator: payer,
      operator: payer,
      table: tablePda,
      usdcMint: usdcMintPk,
      govMint: govMintPk,
      vaultUsdc: vaultUsdcPda,
      controlVaultGov: controlVaultGovPda,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .instruction()

  // Force signer/writable flags (IDL lacks account metadata)
  const signerSet = new Set<string>([payer.toBase58()])
  const writableSet = new Set<string>([
    payer.toBase58(),
    tablePda.toBase58(),
    vaultUsdcPda.toBase58(),
    controlVaultGovPda.toBase58(),
  ])
  
  ix.keys = ix.keys.map((k) => ({
    ...k,
    isSigner: signerSet.has(k.pubkey.toBase58()) || k.isSigner,
    isWritable: writableSet.has(k.pubkey.toBase58()) || k.isWritable,
  }))

  const tx = new anchor.web3.Transaction().add(ix)
  tx.feePayer = payer
  const txSig = await provider.sendAndConfirm(tx, [])

  return {
    txSig,
    tablePda: tablePda.toBase58(),
    vaultUsdcPda: vaultUsdcPda.toBase58(),
    controlVaultGovPda: controlVaultGovPda.toBase58(),
  }
}

export async function depositLiquidity(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  args: {
    table: PublicKey
    amount: number
    operatorUsdcAta?: PublicKey
  }
) {
  const operator = provider.wallet.publicKey

  const operatorUsdcAta =
    args.operatorUsdcAta ??
    getAssociatedTokenAddressSync(
      (await (async () => {
        const info = await provider.connection.getAccountInfo(args.table)
        if (!info?.data) throw new Error('Table account not found')
        const t = decodeTableAccount(info.data)
        return t.usdcMint
      })()),
      operator
    )

  const [vaultUsdc] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_usdc'), args.table.toBuffer()],
    program.programId
  )

  // Build instruction manually to force correct account metas
  const ix = await program.methods
    .depositLiquidityUsdc(new anchor.BN(args.amount))
    .accounts({
      operator,
      operatorUsdcAta,
      table: args.table,
      vaultUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction()

  // Force signer/writable flags
  const signerSet = new Set<string>([operator.toBase58()])
  const writableSet = new Set<string>([
    operator.toBase58(),
    operatorUsdcAta.toBase58(),
    args.table.toBase58(),
    vaultUsdc.toBase58(),
  ])
  
  ix.keys = ix.keys.map((k) => ({
    ...k,
    isSigner: signerSet.has(k.pubkey.toBase58()) || k.isSigner,
    isWritable: writableSet.has(k.pubkey.toBase58()) || k.isWritable,
  }))

  const tx = new anchor.web3.Transaction().add(ix)
  tx.feePayer = operator
  return provider.sendAndConfirm(tx, [])
}

export async function placeBet(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  args: {
    table: PublicKey
    stake: number
    betKind: any
    playerUsdcAta?: PublicKey
  }
) {
  const player = provider.wallet.publicKey

  const tableInfo = await provider.connection.getAccountInfo(args.table)
  if (!tableInfo?.data) throw new Error('Table account not found')
  const table = decodeTableAccount(tableInfo.data)

  const betSeq = table.betSeq
  const betSeqBn = new anchor.BN(betSeq.toString(10))

  const [betPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('bet'),
      args.table.toBuffer(),
      player.toBuffer(),
      betSeqBn.toArrayLike(Buffer, 'le', 8),
    ],
    program.programId
  )

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(ORAO_CONFIG_SEED)],
    ORAO_VRF_PROGRAM_ID
  )

  // const cfgInfo = await provider.connection.getAccountInfo(configPda)
  // if (!cfgInfo?.data) throw new Error('ORAO config account not found')

  // const treasury = new PublicKey(cfgInfo.data.slice(8 + 32, 8 + 64))
  const treasury = new PublicKey('9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR') // Hardcoded treasury for now

  const force = randomForce32()

  // Random PDA uses YOUR program ID (not ORAO's) since we commented out ORAO VRF
  const [randomPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(ORAO_RANDOMNESS_SEED), Buffer.from(force)],
    program.programId
  )

  const usdcMint = table.usdcMint
  const playerUsdcAta =
    args.playerUsdcAta ?? getAssociatedTokenAddressSync(usdcMint, player)

  // Build instruction COMPLETELY MANUALLY to bypass IDL validation
  // This is necessary because deployed program removed config/vrf but IDL still has them
  
  // Discriminator is SHA256("global:place_bet")[0..8]
  // sha256("global:place_bet") = de3e43dc3fa67e21...
  const discriminator = Buffer.from([0xde, 0x3e, 0x43, 0xdc, 0x3f, 0xa6, 0x7e, 0x21])
  
  // Serialize bet kind (Borsh enum serialization: 1-byte variant + fields)
  // Variants: Straight=0, Split=1, Street=2, Corner=3, SixLine=4, Red=5, Black=6, Even=7, Odd=8, Low=9, High=10, Dozen=11, Column=12
  // Frontend passes: { straight: { number: 5 } }, { red: {} }, { split: { a: 1, b: 2 } }, etc.
  let betData: Buffer
  if (args.betKind.hasOwnProperty('straight')) {
    // Straight variant (0) + u8 number
    betData = Buffer.alloc(2)
    betData[0] = 0
    betData[1] = (args.betKind as any).straight.number
  } else if (args.betKind.hasOwnProperty('split')) {
    // Split variant (1) + u8 a + u8 b
    betData = Buffer.alloc(3)
    betData[0] = 1
    betData[1] = (args.betKind as any).split.a
    betData[2] = (args.betKind as any).split.b
  } else if (args.betKind.hasOwnProperty('street')) {
    // Street variant (2) + u8 row
    betData = Buffer.alloc(2)
    betData[0] = 2
    betData[1] = (args.betKind as any).street.row
  } else if (args.betKind.hasOwnProperty('corner')) {
    // Corner variant (3) + u8 row + u8 col
    betData = Buffer.alloc(3)
    betData[0] = 3
    betData[1] = (args.betKind as any).corner.row
    betData[2] = (args.betKind as any).corner.col
  } else if (args.betKind.hasOwnProperty('sixLine')) {
    // SixLine variant (4) + u8 row
    betData = Buffer.alloc(2)
    betData[0] = 4
    betData[1] = (args.betKind as any).sixLine.row
  } else if (args.betKind.hasOwnProperty('red')) {
    betData = Buffer.from([5]) // Red variant
  } else if (args.betKind.hasOwnProperty('black')) {
    betData = Buffer.from([6]) // Black variant
  } else if (args.betKind.hasOwnProperty('even')) {
    betData = Buffer.from([7]) // Even variant
  } else if (args.betKind.hasOwnProperty('odd')) {
    betData = Buffer.from([8]) // Odd variant
  } else if (args.betKind.hasOwnProperty('low')) {
    betData = Buffer.from([9]) // Low variant
  } else if (args.betKind.hasOwnProperty('high')) {
    betData = Buffer.from([10]) // High variant
  } else if (args.betKind.hasOwnProperty('dozen')) {
    // Dozen variant (11) + u8 idx
    betData = Buffer.alloc(2)
    betData[0] = 11
    betData[1] = (args.betKind as any).dozen.idx
  } else if (args.betKind.hasOwnProperty('column')) {
    // Column variant (12) + u8 idx
    betData = Buffer.alloc(2)
    betData[0] = 12
    betData[1] = (args.betKind as any).column.idx
  } else {
    throw new Error('Unknown bet kind')
  }
  
  // Serialize stake (u64 LE)
  const stakeBuf = Buffer.alloc(8)
  stakeBuf.writeBigUInt64LE(BigInt(args.stake))
  
  // Serialize force ([u8; 32])
  const forceBuf = Buffer.from(force)
  
  const data = Buffer.concat([discriminator, betData, stakeBuf, forceBuf])
  
  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: playerUsdcAta, isSigner: false, isWritable: true },
      { pubkey: args.table, isSigner: false, isWritable: true },
      { pubkey: table.vaultUsdc, isSigner: false, isWritable: true },
      { pubkey: betPda, isSigner: false, isWritable: true },
      { pubkey: randomPda, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  })

  const tx = new anchor.web3.Transaction().add(ix)
  tx.feePayer = player
  const txSig = await provider.sendAndConfirm(tx, [])

  return {
    txSig,
    betPda: betPda.toBase58(),
    randomPda: randomPda.toBase58(),
    treasury: treasury.toBase58(),
  }
}

export async function resolveBet(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  args: {
    table: PublicKey
    bet: PublicKey
    player?: PublicKey
    playerUsdcAta?: PublicKey
  }
) {
  const resolver = provider.wallet.publicKey

  const tableInfo = await provider.connection.getAccountInfo(args.table)
  if (!tableInfo?.data) throw new Error('Table account not found')
  const table = decodeTableAccount(tableInfo.data)

  const betInfo = await provider.connection.getAccountInfo(args.bet)
  if (!betInfo?.data) throw new Error('Bet account not found')
  const bet = decodeBetAccount(betInfo.data)

  const player = args.player ?? bet.player
  const playerUsdcAta =
    args.playerUsdcAta ?? getAssociatedTokenAddressSync(table.usdcMint, player)

  const random = bet.randomnessAccount

  // Build instruction manually to force correct account metas and bypass IDL
  // Discriminator for "global:resolve_bet"
  // sha256("global:resolve_bet") = 8984216130d01e9f...
  const discriminator = Buffer.from([0x89, 0x84, 0x21, 0x61, 0x30, 0xd0, 0x1e, 0x9f])

  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: resolver, isSigner: true, isWritable: true },
      { pubkey: args.table, isSigner: false, isWritable: true },
      { pubkey: args.bet, isSigner: false, isWritable: true },
      { pubkey: playerUsdcAta, isSigner: false, isWritable: true },
      { pubkey: table.vaultUsdc, isSigner: false, isWritable: true },
      { pubkey: random, isSigner: false, isWritable: true }, // random account
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator
  })

  const tx = new anchor.web3.Transaction().add(ix)
  tx.feePayer = resolver
  return provider.sendAndConfirm(tx, [])
}

export async function refundExpired(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  args: {
    table: PublicKey
    bet: PublicKey
    player?: PublicKey
    playerUsdcAta?: PublicKey
  }
) {
  const player = args.player ?? provider.wallet.publicKey

  const tableInfo = await provider.connection.getAccountInfo(args.table)
  if (!tableInfo?.data) throw new Error('Table account not found')
  const table = decodeTableAccount(tableInfo.data)

  const playerUsdcAta =
    args.playerUsdcAta ?? getAssociatedTokenAddressSync(table.usdcMint, player)

  return program.rpc.refundExpired({
    accounts: {
      player,
      table: args.table,
      bet: args.bet,
      playerUsdcAta,
      vaultUsdc: table.vaultUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  })
}

export async function getBet(
  provider: anchor.AnchorProvider,
  betPda: PublicKey
): Promise<DecodedBet> {
  const info = await provider.connection.getAccountInfo(betPda)
  if (!info?.data) throw new Error('Bet account not found')
  return decodeBetAccount(info.data)
}

export default {
  initProgram,
  createTable,
  depositLiquidity,
  placeBet,
  resolveBet,
  refundExpired,
  getBet,
}
