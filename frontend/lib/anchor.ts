import * as anchor from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, Connection, Transaction } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
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

// ORAO RandomnessV2 layout (borsh via Anchor):
// discriminator(8) + variant(u8) + client(32) + seed(32) + randomness(64)  [Fulfilled]
// discriminator(8) + variant(u8) + client(32) + seed(32) + responses(vec)  [Pending]
const ORAO_RANDOMNESS_V2_LEN_FULFILLED = 8 + 1 + 32 + 32 + 64

export async function getOraoRandomnessV2Fulfilled(
  provider: anchor.AnchorProvider,
  randomPda: PublicKey,
  commitment: anchor.web3.Commitment = 'confirmed'
): Promise<{ fulfilled: boolean; randomness?: Uint8Array }>
{
  const info = await provider.connection.getAccountInfo(randomPda, commitment)
  if (!info?.data) return { fulfilled: false }

  // Ensure it's owned by ORAO program
  if (!info.owner.equals(ORAO_VRF_PROGRAM_ID)) return { fulfilled: false }

  const data = info.data
  if (data.length < 9) return { fulfilled: false }

  const variant = data[8]
  // 0 = Pending, 1 = Fulfilled (see RequestAccount enum in our vendored crate)
  if (variant !== 1) return { fulfilled: false }
  if (data.length < ORAO_RANDOMNESS_V2_LEN_FULFILLED) return { fulfilled: false }

  const randomnessOffset = 8 + 1 + 32 + 32
  const rnd = Uint8Array.from(data.slice(randomnessOffset, randomnessOffset + 64))
  return { fulfilled: true, randomness: rnd }
}

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
  // NOTE: historical name kept for backward-compat; this is actually `table.global_state` on-chain.
  vaultUsdc: PublicKey
  globalState: PublicKey
  controlVaultGov: PublicKey
  minBet: bigint
  maxBet: bigint
  lockedLiability: bigint
  activeBets: number
  betSeq: bigint
  withdrawRequestTs: bigint
  withdrawRequestAmount: bigint
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
  const globalState = readPubkey(data, o); o = globalState.next
  const controlVaultGov = readPubkey(data, o); o = controlVaultGov.next

  const minBet = readU64LE(data, o); o = minBet.next
  const maxBet = readU64LE(data, o); o = maxBet.next

  const lockedLiability = readU64LE(data, o); o = lockedLiability.next
  const activeBets = readU32LE(data, o); o = activeBets.next
  const betSeq = readU64LE(data, o); o = betSeq.next

  const withdrawRequestTs = readI64LE(data, o); o = withdrawRequestTs.next
  const withdrawRequestAmount = readU64LE(data, o); o = withdrawRequestAmount.next

  // bumps (u8,u8) exist but are not currently needed client-side

  return {
    seed: seed.value,
    creator: creator.value,
    operator: operator.value,
    mode: mode.value,
    paused: paused.value,
    usdcMint: usdcMint.value,
    govMint: govMint.value,
    vaultUsdc: globalState.value,
    globalState: globalState.value,
    controlVaultGov: controlVaultGov.value,
    minBet: minBet.value,
    maxBet: maxBet.value,
    lockedLiability: lockedLiability.value,
    activeBets: activeBets.value,
    betSeq: betSeq.value,
    withdrawRequestTs: withdrawRequestTs.value,
    withdrawRequestAmount: withdrawRequestAmount.value,
  }
}

async function fetchDecodedTable(provider: anchor.AnchorProvider, tablePk: PublicKey): Promise<DecodedTable> {
  const info = await provider.connection.getAccountInfo(tablePk, 'confirmed')
  if (!info?.data) throw new Error('Table account not found')
  return decodeTableAccount(Uint8Array.from(info.data))
}

type DecodedBet = {
  table: PublicKey
  player: PublicKey
  stake: bigint
  multiplier: number
  kindTag: number
  kindPayload: number[]
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

function isRed(n: number): boolean {
  // Standard European roulette red numbers
  const red = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])
  return red.has(n)
}

function betCoversNumber(kindTag: number, payload: number[], n: number): boolean {
  if (n < 0 || n > 36) return false

  switch (kindTag) {
    case 0: { // Straight { number }
      return payload[0] === n
    }
    case 1: { // Split { a, b }
      return payload[0] === n || payload[1] === n
    }
    case 2: { // Street { row }
      if (n === 0) return false
      const row = payload[0] ?? 0 // 1..12
      const start = 3 * row - 2
      return n >= start && n <= start + 2
    }
    case 3: { // Corner { row, col }
      if (n === 0) return false
      const row = payload[0] ?? 0 // 1..11
      const col = payload[1] ?? 0 // 1..2
      const tl = (row - 1) * 3 + col
      const tr = tl + 1
      const bl = tl + 3
      const br = bl + 1
      return n === tl || n === tr || n === bl || n === br
    }
    case 4: { // SixLine { row }
      if (n === 0) return false
      const row = payload[0] ?? 0 // 1..11
      const start = 3 * row - 2
      return n >= start && n <= start + 5
    }
    case 5: return n !== 0 && isRed(n) // Red
    case 6: return n !== 0 && !isRed(n) // Black
    case 7: return n !== 0 && (n % 2 === 0) // Even
    case 8: return n !== 0 && (n % 2 === 1) // Odd
    case 9: return n >= 1 && n <= 18 // Low
    case 10: return n >= 19 && n <= 36 // High
    case 11: { // Dozen { idx }
      const idx = payload[0] ?? 0 // 1..3
      if (idx === 1) return n >= 1 && n <= 12
      if (idx === 2) return n >= 13 && n <= 24
      if (idx === 3) return n >= 25 && n <= 36
      return false
    }
    case 12: { // Column { idx }
      const idx = payload[0] ?? 0 // 1..3
      if (n === 0) return false
      const col = ((n - 1) % 3) + 1
      return idx === col
    }
    default:
      return false
  }
}

function decodeBetAccount(data: Uint8Array): DecodedBet {
  let o = skipAnchorDiscriminator(0)

  const table = readPubkey(data, o); o = table.next
  const player = readPubkey(data, o); o = player.next

  const stake = readU64LE(data, o); o = stake.next
  const multiplier = readU16LE(data, o); o = multiplier.next
  const maxTotalPayout = readU64LE(data, o); o = maxTotalPayout.next

  const kindTag = readU8(data, o); o = kindTag.next

  const payloadLen = betKindPayloadLen(kindTag.value)
  const kindPayload: number[] = []
  for (let i = 0; i < payloadLen; i++) {
    kindPayload.push(data[o + i])
  }
  o += payloadLen

  const state = readU8(data, o); o = state.next

  const createdTs = readI64LE(data, o); o = createdTs.next

  const force = data.slice(o, o + 32); o += 32

  const randomnessAccount = readPubkey(data, o); o = randomnessAccount.next

  const resultNumberOpt = readU8(data, o); o = resultNumberOpt.next
  
  let resultNumber: number | null = null
  if (resultNumberOpt.value === 1) {
      const rn = readU8(data, o); o = rn.next
      resultNumber = rn.value
  }

  // We don't persist payout on-chain; compute it from (stake, multiplier, kind, resultNumber)
  let payout = 0n
  if (state.value === 1 && resultNumber !== null) {
    const won = betCoversNumber(kindTag.value, kindPayload, resultNumber)
    payout = won ? stake.value * BigInt(multiplier.value + 1) : 0n
  }

  return {
    table: table.value,
    player: player.value,
    stake: stake.value,
    multiplier: multiplier.value,
    kindTag: kindTag.value,
    kindPayload,
    createdTs: createdTs.value,
    force,
    randomnessAccount: randomnessAccount.value,
    resultNumber,
    payout,
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

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function isGlobalStateAccount(data: Uint8Array): boolean {
  if (data.length < 8) return false
  const expected = sha256(new TextEncoder().encode('account:GlobalState')).slice(0, 8)
  return bytesEq(data.slice(0, 8), expected)
}

function withInstructionDiscriminators(rawIdl: any): any {
  const instructions = (rawIdl?.instructions || []).map((ix: any) => {
    if (Array.isArray(ix?.discriminator) && ix.discriminator.length === 8) return ix
    const snakeName = toSnakeCase(ix.name)
    const preimage = new TextEncoder().encode(`global:${snakeName}`)
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

export function deriveGlobalStatePdas(programId: PublicKey, usdcMint: PublicKey) {
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('global'), usdcMint.toBuffer()],
    programId
  )
  const [globalVaultUsdc] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_vault_usdc'), globalState.toBuffer()],
    programId
  )
  return { globalState, globalVaultUsdc }
}

export async function getGlobalLiquidity(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  usdcMint: PublicKey,
  commitment: anchor.web3.Commitment = 'confirmed'
): Promise<{
  globalState: PublicKey
  globalVaultUsdc: PublicKey
  vaultBalance: bigint
  lockedLiability: bigint
  available: bigint
}> {
  const { globalState, globalVaultUsdc } = deriveGlobalStatePdas(programId, usdcMint)

  const bal = await provider.connection.getTokenAccountBalance(globalVaultUsdc, commitment)
  const vaultBalance = BigInt(bal.value.amount)

  const info = await provider.connection.getAccountInfo(globalState, commitment)
  if (!info?.data) {
    return {
      globalState,
      globalVaultUsdc,
      vaultBalance,
      lockedLiability: 0n,
      available: vaultBalance,
    }
  }

  const data = info.data
  // Anchor discriminator (8) + usdc_mint (32) + vault (32) + locked (8)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const locked = view.getBigUint64(8 + 32 + 32, true)

  const lockedLiability = BigInt(locked.toString())
  const available = vaultBalance > lockedLiability ? (vaultBalance - lockedLiability) : 0n

  return { globalState, globalVaultUsdc, vaultBalance, lockedLiability, available }
}

async function ensureGlobalInitialized(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  usdcMint: PublicKey
) {
  const payer = provider.wallet.publicKey
  const { globalState, globalVaultUsdc } = deriveGlobalStatePdas(program.programId, usdcMint)

  const info = await provider.connection.getAccountInfo(globalState, 'confirmed')
  if (info) {
    const data = Uint8Array.from(info.data)
    // If account exists but discriminator doesn't match (old upgrade), repair in-place.
    if (!isGlobalStateAccount(data)) {
      await program.methods
        .repairGlobal()
        .accounts({
          payer,
          // Support both camelCase and snake_case IDL names
          usdcMint,
          usdc_mint: usdcMint as any,
          globalState,
          global_state: globalState as any,
          globalVaultUsdc,
          global_vault_usdc: globalVaultUsdc as any,
          systemProgram: SystemProgram.programId,
          system_program: SystemProgram.programId as any,
          tokenProgram: TOKEN_PROGRAM_ID,
          token_program: TOKEN_PROGRAM_ID as any,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc()
    }
    return { globalState, globalVaultUsdc }
  }

  await program.methods
    .initGlobal()
    .accounts({
      payer,
      usdcMint,
      usdc_mint: usdcMint as any,
      globalState,
      global_state: globalState as any,
      globalVaultUsdc,
      global_vault_usdc: globalVaultUsdc as any,
      systemProgram: SystemProgram.programId,
      system_program: SystemProgram.programId as any,
      tokenProgram: TOKEN_PROGRAM_ID,
      token_program: TOKEN_PROGRAM_ID as any,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc()

  return { globalState, globalVaultUsdc }
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

  const { globalState, globalVaultUsdc } = await ensureGlobalInitialized(program, provider, usdcMintPk)

  const seedBuf = seedBn.toArrayLike(Buffer, 'le', 8)
  const [tablePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('table'), payer.toBuffer(), seedBuf],
    program.programId
  )

  const [controlVaultGovPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_gov'), tablePda.toBuffer()],
    program.programId
  )

  // Frontend passes mode as number; program expects TableMode enum
  const modeEnum: any = mode === 1 ? { public: {} } : { private: {} }

  const txSig = await program.methods
    .createTable(seedBn, modeEnum, minB, maxB)
    .accounts({
      creator: payer,
      usdcMint: usdcMintPk,
      govMint: govMintPk,
      table: tablePda,
      controlVaultGov: controlVaultGovPda,
      globalState,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc()

  return {
    txSig,
    tablePda: tablePda.toBase58(),
    controlVaultGovPda: controlVaultGovPda.toBase58(),
    globalStatePda: globalState.toBase58(),
    globalVaultUsdcPda: globalVaultUsdc.toBase58(),
  }
}

export async function depositLiquidity(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  args: {
    table: PublicKey
    amount: number
    operatorUsdcAta?: PublicKey
    operatorGovAta?: PublicKey
  }
) {
  const operator = provider.wallet.publicKey

  const tableAcc = await fetchDecodedTable(provider, args.table)
  const usdcMintPk = tableAcc.usdcMint
  const operatorUsdcAta =
    args.operatorUsdcAta ?? getAssociatedTokenAddressSync(usdcMintPk, operator)

  const govMintPk = tableAcc.govMint
  const operatorGovAta =
    args.operatorGovAta ?? getAssociatedTokenAddressSync(govMintPk, operator)

  // The table stores the exact global_state address used by the program.
  // Ensure we are deriving/repairing the correct PDA for this table's USDC mint.
  const derived = deriveGlobalStatePdas(program.programId, usdcMintPk)
  if (!derived.globalState.equals(tableAcc.globalState)) {
    throw new Error(
      `Table.global_state mismatch. Table points to ${tableAcc.globalState.toBase58()} but derived PDA is ${derived.globalState.toBase58()}. Recreate the table with the correct USDC mint.`
    )
  }

  const { globalState, globalVaultUsdc } = await ensureGlobalInitialized(program, provider, usdcMintPk)

  // Extra safety: if the global_state account on-chain is corrupted, surface details early.
  const gsInfo = await provider.connection.getAccountInfo(globalState, 'confirmed')
  if (!gsInfo?.data) {
    throw new Error(`global_state account not found: ${globalState.toBase58()}`)
  }
  if (!gsInfo.owner.equals(program.programId)) {
    throw new Error(
      `global_state owner mismatch. global_state=${globalState.toBase58()} owner=${gsInfo.owner.toBase58()} expectedProgram=${program.programId.toBase58()}`
    )
  }
  const gsData = Uint8Array.from(gsInfo.data)
  if (!isGlobalStateAccount(gsData)) {
    const first8 = Buffer.from(gsData.slice(0, 8)).toString('hex')
    const expected = Buffer.from(sha256(new TextEncoder().encode('account:GlobalState')).slice(0, 8)).toString('hex')
    throw new Error(
      `global_state discriminator mismatch. global_state=${globalState.toBase58()} first8=${first8} expected=${expected} (try calling repair_global once for this USDC mint)`
    )
  }

  const builder = program.methods
    .depositLiquidityUsdc(new anchor.BN(args.amount))
    .accounts({
      operator,
      operatorUsdcAta,
      operator_usdc_ata: operatorUsdcAta as any,
      table: args.table,
      operatorGovAta,
      operator_gov_ata: operatorGovAta as any,
      globalState,
      global_state: globalState as any,
      globalVaultUsdc,
      global_vault_usdc: globalVaultUsdc as any,
      tokenProgram: TOKEN_PROGRAM_ID,
      token_program: TOKEN_PROGRAM_ID as any,
    })

  // Build the instruction locally so we can see the *actual* account metas order.
  // This helps diagnose cases where the wrong program-owned account is being passed as `global_state`.
  const ix = await builder.instruction()
  const idlIx = (program.idl as any)?.instructions?.find((i: any) => i?.name === 'deposit_liquidity_usdc')
  const idlNames: string[] = Array.isArray(idlIx?.accounts) ? idlIx.accounts.map((a: any) => a?.name) : []
  const debugKeys = ix.keys.map((k, idx) => ({
    idx,
    name: idlNames[idx] || '(unknown)',
    pubkey: k.pubkey.toBase58(),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  }))

  try {
    return await builder.rpc()
  } catch (e: any) {
    const msg = (e?.message || String(e) || '').toLowerCase()
    const looksLikeDiscMismatch = msg.includes('accountdiscriminatormismatch') || msg.includes('discriminator did not match')
    const mentionsGlobal = msg.includes('global_state') || msg.includes('globalstate')

    // If the global_state PDA exists but has an old discriminator/layout, try an on-chain repair then retry once.
    if (looksLikeDiscMismatch && mentionsGlobal) {
      try {
        await program.methods
          .repairGlobal()
          .accounts({
            payer: operator,
            usdcMint: usdcMintPk,
            usdc_mint: usdcMintPk as any,
            globalState,
            global_state: globalState as any,
            globalVaultUsdc,
            global_vault_usdc: globalVaultUsdc as any,
            systemProgram: SystemProgram.programId,
            system_program: SystemProgram.programId as any,
            tokenProgram: TOKEN_PROGRAM_ID,
            token_program: TOKEN_PROGRAM_ID as any,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc()

        // Retry the original deposit after repair.
        return await builder.rpc()
      } catch (repairErr: any) {
        const rmsg = (repairErr?.message || String(repairErr) || '')
        console.error('repairGlobal failed during depositLiquidity retry:', repairErr)

        // If the program doesn't even recognize the instruction, this means the deployed
        // binary is older/different than our local IDL/source.
        if (rmsg.includes('InstructionFallbackNotFound') || rmsg.includes('Fallback functions are not supported')) {
          throw new Error(
            `depositLiquidity failed because the deployed program rejects global_state as a GlobalState, and it also does NOT support repair_global. ` +
            `This indicates NEXT_PUBLIC_PROGRAM_ID (${program.programId.toBase58()}) is not the same build/version as this repo's program/IDL. ` +
            `Fix: redeploy the program from this repo (devnet) and update NEXT_PUBLIC_PROGRAM_ID, then create a fresh table and deposit liquidity again. ` +
            `Original: ${e?.message || String(e)}; repairGlobal: ${rmsg}`
          )
        }

        // fall through to detailed debug throw below
      }
    }

    // Throw a more actionable error that includes the derived/expected keys and the actual instruction metas.
    const details = {
      table: args.table.toBase58(),
      operator: operator.toBase58(),
      operatorUsdcAta: operatorUsdcAta.toBase58(),
      operatorGovAta: operatorGovAta.toBase58(),
      globalState: globalState.toBase58(),
      globalVaultUsdc: globalVaultUsdc.toBase58(),
      instructionAccounts: debugKeys,
      original: e?.message || String(e),
    }
    console.error('depositLiquidityUsdc failed (debug):', details)
    throw new Error(`depositLiquidityUsdc failed. Debug: ${JSON.stringify(details)}`)
  }
}

export async function executeWithdraw(
  program: anchor.Program,
  provider: anchor.AnchorProvider,
  args: {
    table: PublicKey
    amount: number
    operatorUsdcAta?: PublicKey
    operatorGovAta?: PublicKey
  }
) {
  const operator = provider.wallet.publicKey

  const tableAcc: any = await (program.account as any).table.fetch(args.table)
  const usdcMintPk = new PublicKey(tableAcc.usdcMint)
  const operatorUsdcAta =
    args.operatorUsdcAta ?? getAssociatedTokenAddressSync(usdcMintPk, operator)

  const govMintPk = new PublicKey(tableAcc.govMint)
  const operatorGovAta =
    args.operatorGovAta ?? getAssociatedTokenAddressSync(govMintPk, operator)

  const { globalState, globalVaultUsdc } = await ensureGlobalInitialized(program, provider, usdcMintPk)

  return program.methods
    .executeWithdraw(new anchor.BN(args.amount))
    .accounts({
      operator,
      operatorUsdcAta,
      table: args.table,
      operatorGovAta,
      globalState,
      globalVaultUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc()
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

  const tableAcc: any = await (program.account as any).table.fetch(args.table)
  const betSeqBn = new anchor.BN(tableAcc.betSeq)

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


  // ORAO randomness PDA must be derived with ORAO program id
  const [randomPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(ORAO_RANDOMNESS_SEED), Buffer.from(force)],
    ORAO_VRF_PROGRAM_ID
  )

  const usdcMintPk = new PublicKey(tableAcc.usdcMint)
  const playerUsdcAta =
    args.playerUsdcAta ?? getAssociatedTokenAddressSync(usdcMintPk, player)

  // Some wallets/accounts (especially on a fresh device) won't have the ATA created yet.
  // The program expects `player_usdc_ata` to exist, so we create it client-side if missing.
  const ataInfo = await provider.connection.getAccountInfo(playerUsdcAta, 'confirmed')
  if (!ataInfo) {
    const ix = createAssociatedTokenAccountInstruction(
      player, // payer
      playerUsdcAta, // ata address
      player, // owner
      usdcMintPk // mint
    )
    const tx = new Transaction().add(ix)
    tx.feePayer = player
    const { blockhash } = await provider.connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    await provider.sendAndConfirm(tx, [], { commitment: 'confirmed' })
  }

  const { globalState, globalVaultUsdc } = await ensureGlobalInitialized(program, provider, usdcMintPk)

  const txSig = await program.methods
    .placeBet(args.betKind, new anchor.BN(args.stake), Array.from(force) as any)
    .accounts({
      player,
      playerUsdcAta,
      table: args.table,
      globalState,
      globalVaultUsdc,
      bet: betPda,
      random: randomPda,
      treasury,
      config: configPda,
      vrf: ORAO_VRF_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc()

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

  const tableAcc: any = await (program.account as any).table.fetch(args.table)
  const betAcc: any = await (program.account as any).betAccount.fetch(args.bet)

  const player = args.player ?? new PublicKey(betAcc.player)
  const usdcMintPk = new PublicKey(tableAcc.usdcMint)
  const playerUsdcAta =
    args.playerUsdcAta ?? getAssociatedTokenAddressSync(usdcMintPk, player)

  const random = new PublicKey(betAcc.randomnessAccount)
  const { globalState, globalVaultUsdc } = await ensureGlobalInitialized(program, provider, usdcMintPk)

  return program.methods
    .resolveBet()
    .accounts({
      resolver,
      table: args.table,
      bet: args.bet,
      playerUsdcAta,
      globalState,
      globalVaultUsdc,
      random,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc()
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
  const table = decodeTableAccount(Uint8Array.from(tableInfo.data))

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
  betPda: PublicKey,
  commitment: anchor.web3.Commitment = 'finalized'
): Promise<DecodedBet> {
  const info = await provider.connection.getAccountInfo(betPda, commitment)
  if (!info?.data) throw new Error('Bet account not found')
  return decodeBetAccount(Uint8Array.from(info.data))
}

export default {
  initProgram,
  deriveGlobalStatePdas,
  getGlobalLiquidity,
  getOraoRandomnessV2Fulfilled,
  createTable,
  depositLiquidity,
  executeWithdraw,
  placeBet,
  resolveBet,
  refundExpired,
  getBet,
}
