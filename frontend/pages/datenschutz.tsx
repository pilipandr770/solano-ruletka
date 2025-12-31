import Head from 'next/head'
import SiteFooter from '../components/SiteFooter'
import SiteHeader from '../components/SiteHeader'

export default function Datenschutz() {
  return (
    <div>
      <Head>
        <title>Datenschutz – Provably-Fair Roulette</title>
      </Head>
      <main className="container">
        <SiteHeader showAdminLink={false} />

        <section className="card">
          <h1 style={{marginTop: 0}}>Datenschutzerklärung</h1>
          <p className="muted">
            Placeholder privacy policy. Please replace with a real text for your jurisdiction.
          </p>

          <h2>Welche Daten verarbeiten wir?</h2>
          <ul>
            <li>Wallet-Adresse (öffentlich in der Blockchain)</li>
            <li>Transaktionsdaten (on-chain, öffentlich)</li>
            <li>Technische Logs (Browser/Server) minimal</li>
          </ul>

          <h2>Cookies</h2>
          <p>Derzeit keine Tracking-Cookies (Demo). Render/Next.js können technische Cookies setzen.</p>

          <h2>Blockchain</h2>
          <p>Transaktionen auf Solana sind öffentlich und können nicht gelöscht werden.</p>

          <h2>Kontakt</h2>
          <p>Impressum: <a href="/impressum">Impressum</a></p>
        </section>

        <SiteFooter />
      </main>
    </div>
  )
}
