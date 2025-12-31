import Head from 'next/head'
import SiteFooter from '../components/SiteFooter'
import SiteHeader from '../components/SiteHeader'

export default function GetTokens() {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
  const cluster = process.env.NEXT_PUBLIC_CLUSTER || 'devnet'

  return (
    <div>
      <Head>
        <title>Get test tokens – Provably-Fair Roulette</title>
      </Head>
      <main className="container">
        <SiteHeader showAdminLink={false} />

        <section className="card">
          <h1 style={{marginTop: 0}}>Get test tokens</h1>
          <p className="muted">
            This page explains how to get SOL and demo tokens for {cluster}.
          </p>

          <h2>1) Get SOL (needed for fees)</h2>
          <p>
            Use the official Solana faucet for devnet/testnet:
          </p>
          <ul>
            <li>
              <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">https://faucet.solana.com</a>
            </li>
          </ul>

          <h2>2) Get project tokens (USDC / GOV)</h2>
          <p>
            In this project, USDC/GOV are SPL tokens on {cluster}. There is usually no universal faucet for arbitrary SPL mints.
            For testing we recommend one of the options:
          </p>
          <ul>
            <li>
              Ask the operator to send you test USDC/GOV for your wallet address.
            </li>
            <li>
              If you control the mint authority, mint tokens to your wallet (CLI: <code>spl-token mint</code>).
            </li>
          </ul>

          <h3>Configured addresses</h3>
          <div style={{fontSize: 13, color: '#555'}}>
            <div><strong>RPC:</strong> {rpc}</div>
            <div><strong>Program:</strong> {process.env.NEXT_PUBLIC_PROGRAM_ID}</div>
            <div><strong>USDC mint:</strong> {process.env.NEXT_PUBLIC_USDC_MINT}</div>
            <div><strong>GOV mint:</strong> {process.env.NEXT_PUBLIC_GOV_MINT}</div>
          </div>

          <h2>3) Next step</h2>
          <p>
            Go back to <a href="/">Roulette</a>, connect your wallet, place a bet, wait for VRF, then press SPIN.
          </p>
        </section>

        <SiteFooter />
      </main>
    </div>
  )
}
