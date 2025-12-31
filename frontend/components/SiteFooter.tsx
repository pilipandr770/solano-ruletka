import Link from 'next/link'

export default function SiteFooter() {
  return (
    <footer className="footer">
      <div className="space-between">
        <div style={{fontSize: 13}}>
          <div style={{fontWeight: 800, color: 'var(--text)'}}>Provably-Fair Roulette</div>
          <div style={{marginTop: 6}}>Devnet/Testnet demo. Not financial advice.</div>
        </div>
        <div className="row" style={{fontSize: 13}}>
          <Link href="/agb" className="muted" style={{textDecoration: 'none'}}>AGB</Link>
          <Link href="/datenschutz" className="muted" style={{textDecoration: 'none'}}>Datenschutz</Link>
          <Link href="/impressum" className="muted" style={{textDecoration: 'none'}}>Impressum</Link>
          <Link href="/get-tokens" className="muted" style={{textDecoration: 'none'}}>Get test tokens</Link>
        </div>
      </div>
    </footer>
  )
}
