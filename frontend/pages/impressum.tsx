import Head from 'next/head'
import SiteFooter from '../components/SiteFooter'
import SiteHeader from '../components/SiteHeader'

export default function Impressum() {
  return (
    <div>
      <Head>
        <title>Impressum – Provably-Fair Roulette</title>
      </Head>
      <main className="container">
        <SiteHeader showAdminLink={false} />

        <section className="card">
          <h1 style={{marginTop: 0}}>Impressum</h1>
          <p className="muted">
            Angaben gemäß § 5 TMG
          </p>

          <p>
            <strong>Betreiber:</strong> Andrii Pylypchuk<br />
            <strong>Adresse:</strong> Bergmannweg 16, 65934 Frankfurt am Main, Deutschland<br />
            <strong>Telefon:</strong> +49 160 95030120<br />
            <strong>E-Mail:</strong> <a href="mailto:andrii.it.info@gmail.com">andrii.it.info@gmail.com</a><br />
            <strong>Website:</strong> <a href="https://www.andrii-it.de/" target="_blank" rel="noreferrer">https://www.andrii-it.de/</a><br />
            <strong>USt-IdNr.:</strong> DE456902445
          </p>

          <h2>Verantwortlich für den Inhalt</h2>
          <p>Andrii Pylypchuk</p>

          <h2>Haftungsausschluss</h2>
          <p className="muted">
            Diese Seite ist eine technische Demo (Devnet/Testnet). Kein Echtgeld. Inhalte ohne Gewähr.
          </p>
        </section>

        <SiteFooter />
      </main>
    </div>
  )
}
