import * as anchor from '@coral-xyz/anchor'
import { PublicKey, Connection, Transaction } from '@solana/web3.js'
import idl from '../idl/roulette_table.json'

export async function initProgram(wallet: any, connection: Connection) {
  if (!wallet || !connection) throw new Error('wallet and connection required')
  const provider = new anchor.AnchorProvider(connection, wallet as any, anchor.AnchorProvider.defaultOptions())
  const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID as string)
  const program = new anchor.Program(idl as any, programId, provider)
  return { program, provider }
}

export async function createTable(program: anchor.Program, payer: PublicKey, params: { seed: number; usdcMint: string; govMint: string; minBet: number; maxBet: number }) {
  const seedBn = new anchor.BN(params.seed)
  const mode = { private: {} }
  const minB = new anchor.BN(params.minBet)
  const maxB = new anchor.BN(params.maxBet)

  console.log('createTable: calling program.rpc.createTable (may fail if accounts mismatch)')
  const usdcMintPk = new anchor.web3.PublicKey(params.usdcMint)
  const govMintPk = new anchor.web3.PublicKey(params.govMint)
  const [tablePda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('table'), payer.toBuffer(), seedBn.toArrayLike(Buffer,'le',8)], program.programId)
  const [vaultUsdcPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault_usdc'), tablePda.toBuffer()], program.programId)
  const [controlVaultGovPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault_gov'), tablePda.toBuffer()], program.programId)

  return program.rpc.createTable(seedBn, mode as any, minB, maxB, {
    accounts: {
      creator: payer,
      usdcMint: usdcMintPk,
      govMint: govMintPk,
      table: tablePda,
      vaultUsdc: vaultUsdcPda,
      controlVaultGov: controlVaultGovPda,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }
  })
}

export async function depositLiquidity(program: anchor.Program, operator: PublicKey, operatorUsdcAta: PublicKey, table: PublicKey, amount: number) {
  const a = new anchor.BN(amount)
  return program.rpc.depositLiquidityUsdc(a, {
    accounts: {
      operator,
      operatorUsdcAta,
      table,
      vaultUsdc: (program.account.table as any).vaultUsdc || table,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }
  })
}

export async function placeBet(program: anchor.Program, player: PublicKey, playerUsdcAta: PublicKey, table: PublicKey, betKind: any, stake: number) {
  const stakeBn = new anchor.BN(stake)
  const force = new Uint8Array(32)
  return program.rpc.placeBet(betKind, stakeBn, [...force], {
    accounts: {
      player,
      playerUsdcAta,
      table,
      vaultUsdc: (program.account.table as any).vaultUsdc || table,
      bet: anchor.web3.Keypair.generate().publicKey,
      random: anchor.web3.PublicKey.default,
      treasury: anchor.web3.PublicKey.default,
      config: anchor.web3.PublicKey.default,
      vrf: program.programId,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }
  })
}

export async function resolveBet(program: anchor.Program, resolver: PublicKey, table: PublicKey, bet: PublicKey, playerUsdcAta: PublicKey) {
  return program.rpc.resolveBet({
    accounts: {
      resolver,
      table,
      bet,
      playerUsdcAta,
      vaultUsdc: (program.account.table as any).vaultUsdc || table,
      random: anchor.web3.PublicKey.default,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }
  })
}

export async function refundExpired(program: anchor.Program, caller: PublicKey, table: PublicKey, bet: PublicKey, playerUsdcAta: PublicKey) {
  return program.rpc.refundExpiredBet({
    accounts: {
      caller,
      table,
      bet,
      playerUsdcAta,
      vaultUsdc: (program.account.table as any).vaultUsdc || table,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
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
