import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

describe("roulette_table (devnet) minimal flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RouletteTable as Program<any>;
  const payer = provider.wallet as anchor.Wallet;

  it("Create table + deposit liquidity + place bet (VRF request)", async () => {
    const usdcMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 6);
    const govMint  = await createMint(provider.connection, payer.payer, payer.publicKey, null, 0);

    const payerGovAta = await getOrCreateAssociatedTokenAccount(provider.connection, payer.payer, govMint, payer.publicKey);
    await mintTo(provider.connection, payer.payer, govMint, payerGovAta.address, payer.publicKey, 100);

    const payerUsdcAta = await getOrCreateAssociatedTokenAccount(provider.connection, payer.payer, usdcMint, payer.publicKey);
    await mintTo(provider.connection, payer.payer, usdcMint, payerUsdcAta.address, payer.publicKey, 1_000_000_000);

    const seed = new anchor.BN(Date.now());
    const [tablePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("table"), payer.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [vaultUsdcPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_usdc"), tablePda.toBuffer()],
      program.programId
    );
    const [vaultGovPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_gov"), tablePda.toBuffer()],
      program.programId
    );

    await program.methods
      .createTable(seed, { private: {} } as any, new anchor.BN(10_000), new anchor.BN(500_000_000))
      .accounts({
        creator: payer.publicKey,
        usdcMint,
        govMint,
        table: tablePda,
        vaultUsdc: vaultUsdcPda,
        controlVaultGov: vaultGovPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await program.methods
      .depositLiquidityUsdc(new anchor.BN(500_000_000))
      .accounts({
        operator: payer.publicKey,
        operatorUsdcAta: payerUsdcAta.address,
        table: tablePda,
        vaultUsdc: vaultUsdcPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Note: ORAO accounts (config + randomness) setup is required for full run.
    // Here we only test that create_table and deposit succeed on devnet.
  });
});
