const crypto = require('crypto');
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

function discriminatorForAccount(name) {
  return crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}

function parseTableList(value) {
  if (!value) return [];
  return value
    .split(/[\s,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

(async () => {
  loadDotEnvFile(path.join(__dirname, '..', '.env.local'));

  const rpc = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
  const programIdStr = process.env.NEXT_PUBLIC_PROGRAM_ID;

  const tables = [
    ...parseTableList(process.env.NEXT_PUBLIC_TABLE_PDAS),
    ...(process.env.NEXT_PUBLIC_TABLE_PDA ? [process.env.NEXT_PUBLIC_TABLE_PDA] : []),
  ];

  if (!programIdStr) {
    console.error('Missing NEXT_PUBLIC_PROGRAM_ID in frontend/.env.local');
    process.exit(1);
  }
  if (tables.length === 0) {
    console.error('No tables found in NEXT_PUBLIC_TABLE_PDAS or NEXT_PUBLIC_TABLE_PDA');
    process.exit(1);
  }

  const programId = new PublicKey(programIdStr);
  const conn = new Connection(rpc, 'confirmed');

  const idlPath = path.join(__dirname, '..', 'idl', 'roulette_table.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  const coder = new anchor.BorshAccountsCoder(idl);

  const expectedGlobal = discriminatorForAccount('GlobalState');

  console.log('rpc', rpc);
  console.log('programId', programId.toBase58());
  console.log('tables', tables);
  console.log('---');

  for (const t of tables) {
    let tablePk;
    try {
      tablePk = new PublicKey(t);
    } catch {
      console.log('table', t, 'INVALID_PUBKEY');
      console.log('---');
      continue;
    }

    const info = await conn.getAccountInfo(tablePk, 'confirmed');
    if (!info?.data) {
      console.log('table', tablePk.toBase58(), 'MISSING');
      console.log('---');
      continue;
    }

    console.log('table', tablePk.toBase58());
    console.log('tableOwner', info.owner.toBase58());

    if (!info.owner.equals(programId)) {
      console.log('note', 'table is NOT owned by NEXT_PUBLIC_PROGRAM_ID');
      console.log('---');
      continue;
    }

    let decoded;
    try {
      decoded = coder.decode('Table', info.data);
    } catch (e) {
      console.log('decodeTable', 'FAILED', e?.message || String(e));
      console.log('---');
      continue;
    }

    const decodedKeys = decoded && typeof decoded === 'object' ? Object.keys(decoded) : [];
    const usdcMintAny = decoded?.usdcMint ?? decoded?.usdc_mint;
    if (!usdcMintAny) {
      console.log('decodeTable', 'OK but missing usdcMint field', { decodedKeys });
      console.log('---');
      continue;
    }

    const usdcMint = usdcMintAny instanceof PublicKey ? usdcMintAny : new PublicKey(usdcMintAny);
    console.log('usdcMint', usdcMint.toBase58());

    const [globalState] = PublicKey.findProgramAddressSync(
      [Buffer.from('global'), usdcMint.toBuffer()],
      programId,
    );

    const gInfo = await conn.getAccountInfo(globalState, 'confirmed');
    console.log('globalState', globalState.toBase58());

    if (!gInfo?.data) {
      console.log('globalStateStatus', 'MISSING');
      console.log('---');
      continue;
    }

    const first8 = Buffer.from(gInfo.data.subarray(0, 8));
    console.log('globalOwner', gInfo.owner.toBase58());
    console.log('globalFirst8', first8.toString('hex'));
    console.log('globalExpected', Buffer.from(expectedGlobal).toString('hex'));
    console.log('globalMatches', first8.equals(expectedGlobal));
    console.log('---');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
