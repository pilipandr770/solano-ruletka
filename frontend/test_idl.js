const anchor = require('@coral-xyz/anchor');
const {Connection, Keypair, PublicKey} = require('@solana/web3.js');
const idl = require('./idl/roulette_table.json');
const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || 'EVYqRHpFASSVBkGkPj2K45N4DmUE3AvRzVoMhDoxPJou');
const idlWithAddress = { ...idl, address: programId.toBase58() };
const wallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async (tx) => tx,
  signAllTransactions: async (txs) => txs,
};
const provider = new anchor.AnchorProvider(new Connection('https://api.devnet.solana.com'), wallet, {});
const program = new anchor.Program(idlWithAddress, provider);
console.log('programId', program.programId.toBase58());
console.log('IDL types:', (idl.types||[]).map(t=>t.name));
console.log('Program camelCase IDL types:', (program.idl.types||[]).map(t=>t.name));
console.log('createTable instruction in program.idl:', JSON.stringify(program.idl.instructions.find(i=>i.name==='createTable'), null, 2));
try {
  const seed = new anchor.BN(1);
  const mode = { private: {} };
  const minBet = new anchor.BN(1);
  const maxBet = new anchor.BN(2);
  const data = program.coder.instruction.encode('createTable', { seed, mode, minBet, maxBet });
  console.log('encode ok, len', data.length);
} catch (e) {
  console.error('encode failed:', e && e.message || e);
  if (e.stack) console.error(e.stack);
  console.log('trying methods...');
  try {
    const ix = await program.methods.createTable(new anchor.BN(1), { private: {} }, new anchor.BN(1), new anchor.BN(2)).instruction();
    console.log('methods ok');
  } catch (e2) {
    console.error('methods also failed:', e2);
  }
}
