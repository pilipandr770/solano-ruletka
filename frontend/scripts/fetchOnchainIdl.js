const fs = require('fs');
const path = require('path');
const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey } = require('@solana/web3.js');

function loadDotEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

(async () => {
  loadDotEnvFile(path.join(__dirname, '..', '.env.local'));

  const rpc = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
  const programIdStr = process.env.NEXT_PUBLIC_PROGRAM_ID;
  if (!programIdStr) {
    console.error('Missing NEXT_PUBLIC_PROGRAM_ID');
    process.exit(1);
  }

  const programId = new PublicKey(programIdStr);
  const conn = new Connection(rpc, 'confirmed');

  console.log('rpc', rpc);
  console.log('programId', programId.toBase58());

  const idl = await anchor.Program.fetchIdl(programId, new anchor.AnchorProvider(conn, {} /* dummy */, { commitment: 'confirmed' }));

  if (!idl) {
    console.log('onchainIdl', null);
    console.log('NOTE: Program IDL not found on-chain (not published).');
    process.exit(0);
  }

  const instructionNames = (idl.instructions || []).map((ix) => ix.name);
  const accountNames = (idl.accounts || []).map((a) => a.name);

  console.log('onchainIdl.name', idl.name);
  console.log('onchainIdl.version', idl.version);
  console.log('instructions.contains.repair_global', instructionNames.includes('repair_global'));
  console.log('instructions.contains.init_global', instructionNames.includes('init_global'));
  console.log('instructions.contains.deposit_liquidity_usdc', instructionNames.includes('deposit_liquidity_usdc'));
  console.log('accounts.contains.GlobalState', accountNames.includes('GlobalState'));

  // Print discriminators if available (Anchor 0.30+ IDL may include them)
  const gs = (idl.accounts || []).find((a) => a.name === 'GlobalState');
  if (gs && gs.discriminator) {
    console.log('GlobalState.discriminator', gs.discriminator);
  }

  console.log('instructionNames', instructionNames);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
