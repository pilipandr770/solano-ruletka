import Head from 'next/head'
import SiteFooter from '../components/SiteFooter'
import SiteHeader from '../components/SiteHeader'

export default function AGB() {
  return (
    <div>
      <Head>
        <title>AGB – Provably-Fair Roulette</title>
      </Head>
      <main className="container">
        <SiteHeader showAdminLink={false} />

        <section className="card">
          <h1 style={{marginTop: 0}}>AGB (Allgemeine Geschäftsbedingungen)</h1>
          <p className="muted">
            Demo/Test deployment. Replace this placeholder with your real AGB text for your jurisdiction.
          </p>

          <h2>1. Geltungsbereich</h2>
          <p>Diese Seite ist eine technische Demo (Devnet/Testnet). Kein Echtgeld.</p>

          <h2>2. Nutzung</h2>
          <p>Du nutzt die Anwendung auf eigenes Risiko. Transaktionen sind öffentlich in der Solana-Blockchain.</p>

          <h2>3. Token / Testnet</h2>
          <p>Es werden ausschließlich Test-Token verwendet. Hinweise: <a href="/get-tokens">Get test tokens</a>.</p>

          <h2>4. Haftung</h2>
          <p>Platzhalter. Bitte rechtlich prüfen lassen.</p>

          <h2>Kontakt</h2>
          <p>Impressum: <a href="/impressum">Impressum</a></p>
        </section>

        <SiteFooter />
      </main>
    </div>
  )
}
