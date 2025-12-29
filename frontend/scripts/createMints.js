const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer } = require('@solana/spl-token');
const fs = require('fs');

async function main() {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

    // Твой адрес
    const recipient = new PublicKey('EHEDoKHQ66Q4qioDUSQfaecuP9EFTWwUx4V8WA8EDEne');

    // Загрузи keypair из C:\Users\ПК\.config\solana\id.json
    const keypairPath = 'C:\\Users\\ПК\\.config\\solana\\id.json';
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const payer = Keypair.fromSecretKey(new Uint8Array(keypairData));

    console.log('Payer:', payer.publicKey.toString());

    // Проверь баланс SOL
    const balance = await connection.getBalance(payer.publicKey);
    console.log('SOL balance:', balance / LAMPORTS_PER_SOL);

    if (balance < 0.1 * LAMPORTS_PER_SOL) {
        console.log('Недостаточно SOL, airdrop...');
        await connection.confirmTransaction(await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL));
    }

    // Создай USDC mint
    console.log('Создание USDC mint...');
    const usdcMint = await createMint(connection, payer, payer.publicKey, null, 6); // 6 decimals
    console.log('USDC Mint:', usdcMint.toString());

    // Создай ATA для USDC на payer
    const usdcAtaPayer = await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey);
    console.log('USDC ATA Payer:', usdcAtaPayer.address.toString());

    // Mint 1e9 USDC на payer
    await mintTo(connection, payer, usdcMint, usdcAtaPayer.address, payer, 1000000000n * 10n**6n);
    console.log('Minted 1e9 USDC to payer');

    // Transfer 1e9 USDC to recipient
    const usdcAtaRecipient = await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, recipient);
    console.log('USDC ATA Recipient:', usdcAtaRecipient.address.toString());
    await transfer(connection, payer, usdcAtaPayer.address, usdcAtaRecipient.address, payer, 1000000000n * 10n**6n);
    console.log('Transferred 1e9 USDC to recipient');

    // Создай GOV mint
    console.log('Создание GOV mint...');
    const govMint = await createMint(connection, payer, payer.publicKey, null, 0); // 0 decimals
    console.log('GOV Mint:', govMint.toString());

    // Создай ATA для GOV на payer
    const govAtaPayer = await getOrCreateAssociatedTokenAccount(connection, payer, govMint, payer.publicKey);
    console.log('GOV ATA Payer:', govAtaPayer.address.toString());

    await mintTo(connection, payer, govMint, govAtaPayer.address, payer, 100n);
    console.log('Minted 100 GOV to payer');

    const govAtaRecipient = await getOrCreateAssociatedTokenAccount(connection, payer, govMint, recipient);
    console.log('GOV ATA Recipient:', govAtaRecipient.address.toString());
    await transfer(connection, payer, govAtaPayer.address, govAtaRecipient.address, payer, 100n);
    console.log('Transferred 100 GOV to recipient');

    // Обнови .env.local
    const envPath = './.env.local';
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/NEXT_PUBLIC_USDC_MINT=.*/, `NEXT_PUBLIC_USDC_MINT=${usdcMint.toString()}`);
    envContent = envContent.replace(/NEXT_PUBLIC_GOV_MINT=.*/, `NEXT_PUBLIC_GOV_MINT=${govMint.toString()}`);
    fs.writeFileSync(envPath, envContent);

    console.log('Обновлен .env.local');
}

main().catch(console.error);