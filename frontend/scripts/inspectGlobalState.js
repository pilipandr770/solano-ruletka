const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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

function discriminatorForAccount(name) {
  return crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}

(async () => {
  loadDotEnvFile(path.join(__dirname, '..', '.env.local'));

  const rpc = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
  const programIdStr = process.env.NEXT_PUBLIC_PROGRAM_ID;
  const usdcMintStr = process.env.NEXT_PUBLIC_USDC_MINT;

  if (!programIdStr || !usdcMintStr) {
    console.error('Missing required env vars in frontend/.env.local', {
      NEXT_PUBLIC_PROGRAM_ID: programIdStr,
      NEXT_PUBLIC_USDC_MINT: usdcMintStr,
      NEXT_PUBLIC_RPC_URL: rpc,
    });
    process.exit(1);
  }

  const programId = new PublicKey(programIdStr);
  const usdcMint = new PublicKey(usdcMintStr);

  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('global'), usdcMint.toBuffer()],
    programId,
  );

  const [globalVaultUsdc] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_vault_usdc'), globalState.toBuffer()],
    programId,
  );

  const expected = discriminatorForAccount('GlobalState');

  const conn = new Connection(rpc, 'confirmed');
  const info = await conn.getAccountInfo(globalState, 'confirmed');

  console.log('rpc', rpc);
  console.log('programId', programId.toBase58());
  console.log('usdcMint', usdcMint.toBase58());
  console.log('globalState', globalState.toBase58());
  console.log('globalVaultUsdc', globalVaultUsdc.toBase58());

  if (!info) {
    console.log('globalState: missing');
    return;
  }

  const first8 = Buffer.from(info.data.subarray(0, 8));
  console.log('owner', info.owner.toBase58());
  console.log('lamports', info.lamports);
  console.log('dataLen', info.data.length);
  console.log('first8', first8.toString('hex'));
  console.log('expected', Buffer.from(expected).toString('hex'));
  console.log('matches', first8.equals(expected));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
