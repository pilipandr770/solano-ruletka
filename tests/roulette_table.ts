import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import crypto from "crypto";

describe("roulette_table (devnet) end-to-end", () => {
  // Make the test runnable via plain `npm test` (no external env required)
  process.env.ANCHOR_PROVIDER_URL ??= "https://api.devnet.solana.com";
  process.env.ANCHOR_WALLET ??= "target/deploy/deployer-keypair.json";

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RouletteTable as Program<any>;
  const payer = provider.wallet as anchor.Wallet;

  const ORAO_PROGRAM_ID = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
  const CONFIG_ACCOUNT_SEED = Buffer.from("orao-vrf-network-configuration");
  const RANDOMNESS_ACCOUNT_SEED = Buffer.from("orao-vrf-randomness-request");

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function readPubkeyLE(bytes: Buffer, offset: number): PublicKey {
    return new PublicKey(bytes.subarray(offset, offset + 32));
  }

  async function getOraoTreasuryFromConfig(configPk: PublicKey): Promise<PublicKey> {
    const acc = await provider.connection.getAccountInfo(configPk, "confirmed");
    if (!acc) throw new Error(`ORAO config account not found: ${configPk.toBase58()}`);
    // Anchor discriminator (8) + authority (32) + treasury (32)
    return readPubkeyLE(Buffer.from(acc.data), 8 + 32);
  }

  function errorToString(e: any): string {
    if (!e) return "";
    if (typeof e === "string") return e;
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }

  async function waitAndResolveBet(
    accounts: {
      resolver: PublicKey;
      table: PublicKey;
      bet: PublicKey;
      playerUsdcAta: PublicKey;
      globalState: PublicKey;
      globalVaultUsdc: PublicKey;
      random: PublicKey;
    },
    timeoutMs = 300_000
  ) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await program.methods
          .resolveBet()
          .accounts({
            resolver: accounts.resolver,
            table: accounts.table,
            bet: accounts.bet,
            playerUsdcAta: accounts.playerUsdcAta,
            globalState: accounts.globalState,
            globalVaultUsdc: accounts.globalVaultUsdc,
            random: accounts.random,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .rpc();
        return;
      } catch (e: any) {
        const msg = errorToString(e);
        // Expected while VRF is still pending
        if (msg.includes("Randomness not fulfilled yet")) {
          await sleep(2_000);
          continue;
        }
        if (msg.includes("Randomness account decode failed")) {
          const acc = await provider.connection.getAccountInfo(accounts.random, "confirmed");
          console.log("ORAO randomness account info:", {
            pubkey: accounts.random.toBase58(),
            exists: !!acc,
            owner: acc?.owner?.toBase58(),
            dataLen: acc?.data?.length,
            lamports: acc?.lamports,
            first32: acc ? Buffer.from(acc.data).subarray(0, 32).toString("hex") : null,
          });
        }
        throw e;
      }
    }
    throw new Error(`resolve_bet did not succeed within ${timeoutMs}ms`);
  }

  it("init_global -> create_table -> deposit -> place_bet -> wait VRF -> resolve", async () => {
    const usdcMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 6);
    const govMint = await createMint(provider.connection, payer.payer, payer.publicKey, null, 0);

    const payerGovAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      govMint,
      payer.publicKey
    );
    await mintTo(provider.connection, payer.payer, govMint, payerGovAta.address, payer.publicKey, 100);

    const payerUsdcAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      usdcMint,
      payer.publicKey
    );
    await mintTo(provider.connection, payer.payer, usdcMint, payerUsdcAta.address, payer.publicKey, 1_000_000_000);

    const [globalStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global"), usdcMint.toBuffer()],
      program.programId
    );
    const [globalVaultUsdcPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_vault_usdc"), globalStatePda.toBuffer()],
      program.programId
    );

    // Initialize global state/vault (idempotent by catching already-initialized)
    try {
      await program.methods
        .initGlobal()
        .accounts({
          payer: payer.publicKey,
          usdcMint,
          globalState: globalStatePda,
          globalVaultUsdc: globalVaultUsdcPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    } catch (e: any) {
      // ok if already exists
    }

    const seed = new anchor.BN(Date.now());
    const [tablePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("table"), payer.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [controlVaultGovPda] = PublicKey.findProgramAddressSync(
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
        controlVaultGov: controlVaultGovPda,
        globalState: globalStatePda,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Deposit shared liquidity into global vault
    await program.methods
      .depositLiquidityUsdc(new anchor.BN(500_000_000))
      .accounts({
        operator: payer.publicKey,
        operatorUsdcAta: payerUsdcAta.address,
        globalState: globalStatePda,
        globalVaultUsdc: globalVaultUsdcPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    // ORAO config PDA and treasury
    const [oraoConfigPda] = PublicKey.findProgramAddressSync([CONFIG_ACCOUNT_SEED], ORAO_PROGRAM_ID);
    const treasury = await getOraoTreasuryFromConfig(oraoConfigPda);

    // Unique force per bet
    const force32 = crypto.randomBytes(32);

    // Randomness request PDA (must be derived with ORAO program id)
    const [randomnessPda] = PublicKey.findProgramAddressSync(
      [RANDOMNESS_ACCOUNT_SEED, force32],
      ORAO_PROGRAM_ID
    );

    console.log("ORAO PDAs:", {
      config: oraoConfigPda.toBase58(),
      treasury: treasury.toBase58(),
      randomness: randomnessPda.toBase58(),
    });

    // Bet PDA uses table.bet_seq; fetch current table to compute expected PDA
    const tableAcc: any = await (program.account as any)["table"].fetch(tablePda);
    const betSeq: anchor.BN = new anchor.BN(tableAcc.betSeq);
    const betSeqLe = betSeq.toArrayLike(Buffer, "le", 8);
    const [betPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), tablePda.toBuffer(), payer.publicKey.toBuffer(), betSeqLe],
      program.programId
    );

    await program.methods
      .placeBet({ red: {} } as any, new anchor.BN(10_000), Array.from(force32) as any)
      .accounts({
        player: payer.publicKey,
        playerUsdcAta: payerUsdcAta.address,
        table: tablePda,
        globalState: globalStatePda,
        globalVaultUsdc: globalVaultUsdcPda,
        bet: betPda,
        random: randomnessPda,
        treasury,
        config: oraoConfigPda,
        vrf: ORAO_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    await waitAndResolveBet(
      {
        resolver: payer.publicKey,
        table: tablePda,
        bet: betPda,
        playerUsdcAta: payerUsdcAta.address,
        globalState: globalStatePda,
        globalVaultUsdc: globalVaultUsdcPda,
        random: randomnessPda,
      },
      600_000
    );
  });
});
