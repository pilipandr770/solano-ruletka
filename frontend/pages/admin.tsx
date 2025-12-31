import Head from 'next/head'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import bs58 from 'bs58'
import SiteFooter from '../components/SiteFooter'
import SiteHeader from '../components/SiteHeader'
import anchorLib from '../lib/anchor'
import idl from '../idl/roulette_table.json'

type SocialLinks = {
  website?: string
  twitter?: string
  telegram?: string
  discord?: string
}

const OPERATOR_THRESHOLD = 51

export default function Admin() {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null)
  const [govBalanceEnvUi, setGovBalanceEnvUi] = useState(0)
  const [uiNotice, setUiNotice] = useState<string>('')

  const [tableAddress, setTableAddress] = useState<string>(process.env.NEXT_PUBLIC_TABLE_PDA || '')
  const [isOperator, setIsOperator] = useState(false)

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
  const connection = useMemo(() => new Connection(rpcUrl), [rpcUrl])

  function getProvider(): any | null {
    const w = window as any
    if (w.solana && w.solana.isPhantom) return w.solana
    if (w.solflare) return w.solflare
    if (w.solana) return w.solana
    if ((w as any).phantom?.solana) return (w as any).phantom.solana
    return null
  }

  const connect = useCallback(async () => {
    try {
      const provider = getProvider()
      if (!provider) return alert('No supported Solana wallet found (Phantom / Solflare)')
      let resp: any
      try {
        resp = await provider.connect({ onlyIfTrusted: false })
      } catch {
        resp = await provider.connect()
      }
      const pub = resp?.publicKey || provider.publicKey
      if (pub) setPublicKey(new PublicKey(pub.toString()))
    } catch (e: any) {
      console.error(e)
      alert(e?.message || e)
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await (window as any).solana?.disconnect?.()
    } catch {}
    setPublicKey(null)
    setGovBalanceEnvUi(0)
    setIsOperator(false)
  }, [])

  async function ensureProgram() {
    if (!publicKey) throw new Error('Connect wallet first')
    const wallet = getProvider()
    if (!wallet) throw new Error('Wallet not connected')
    const provider = new anchor.AnchorProvider(connection, wallet as any, {
      preflightCommitment: 'confirmed',
    })
    const programIdStr = process.env.NEXT_PUBLIC_PROGRAM_ID
    if (!programIdStr) throw new Error('NEXT_PUBLIC_PROGRAM_ID is missing')
    const programId = new PublicKey(programIdStr)
    const { program } = await anchorLib.initProgram(idl as any, programId, provider)
    return { program, provider }
  }

  // GOV balance gating
  useEffect(() => {
    ;(async () => {
      try {
        if (!publicKey) {
          setGovBalanceEnvUi(0)
          return
        }
        const mintStr = process.env.NEXT_PUBLIC_GOV_MINT
        if (!mintStr) {
          setGovBalanceEnvUi(0)
          return
        }
        const { provider } = await ensureProgram()
        const govMintPk = new PublicKey(mintStr)
        const govAta = anchor.utils.token.associatedAddress({ mint: govMintPk, owner: publicKey })
        const bal = await provider.connection.getTokenAccountBalance(govAta, 'confirmed')
        setGovBalanceEnvUi(Number(bal.value.uiAmount || 0))
      } catch {
        setGovBalanceEnvUi(0)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58()])

  const isFunctionalTokenOwner = govBalanceEnvUi >= OPERATOR_THRESHOLD

  // operator check for liquidity actions
  useEffect(() => {
    ;(async () => {
      try {
        if (!publicKey || !tableAddress) {
          setIsOperator(false)
          return
        }
        const { program } = await ensureProgram()
        const tablePk = new PublicKey(tableAddress)
        const tableAcc: any = await (program.account as any).table.fetch(tablePk)
        const operatorPk = new PublicKey(tableAcc.operator)
        setIsOperator(operatorPk.equals(publicKey))
      } catch {
        setIsOperator(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58(), tableAddress])

  const [links, setLinks] = useState<SocialLinks>({})
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/social-links')
        if (!res.ok) return
        const json = await res.json()
        if (json?.links) setLinks(json.links)
      } catch {}
    })()
  }, [])

  async function saveLinks() {
    setUiNotice('')
    try {
      if (!publicKey) return alert('Connect wallet first')
      if (!isFunctionalTokenOwner) return alert('Need GOV >= 51')

      const wallet = getProvider()
      if (!wallet?.signMessage) return alert('Wallet must support signMessage')

      const ts = Date.now()
      const message = `Update social links\nTimestamp: ${ts}`
      const msgBytes = new TextEncoder().encode(message)
      const signed = await wallet.signMessage(msgBytes)
      const sigBytes: Uint8Array = (signed?.signature ?? signed) as Uint8Array
      const signature = bs58.encode(sigBytes)

      const res = await fetch('/api/social-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          signature,
          message,
          ts,
          links,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed')
      setUiNotice('Saved! Header links updated (may reset on restart).')
    } catch (e: any) {
      console.error(e)
      setUiNotice('Save failed: ' + (e?.message || e))
    }
  }

  return (
    <div>
      <Head><title>Admin – Provably-Fair Roulette</title></Head>
      <main className="container">
        <SiteHeader showAdminLink={true} />

        <section className="card">
          <h1 style={{marginTop: 0}}>Admin</h1>

          <div className="space-between">
            <div className="muted" style={{fontSize: 13}}>
              Wallet: {publicKey ? `${publicKey.toBase58().slice(0, 6)}…${publicKey.toBase58().slice(-6)}` : 'not connected'}
              <br />
              GOV balance: {govBalanceEnvUi} (need {OPERATOR_THRESHOLD})
            </div>
            <div>
              {publicKey ? <button className="btn-secondary" onClick={disconnect}>Disconnect</button> : <button onClick={connect}>Connect</button>}
            </div>
          </div>

          {!isFunctionalTokenOwner ? (
            <div className="notice notice-danger" style={{marginTop: 12}}>
              Access denied. You need GOV ≥ {OPERATOR_THRESHOLD} to use Admin.
            </div>
          ) : null}

          {uiNotice ? (
            <div className="notice notice-info" style={{marginTop: 12}}>
              {uiNotice}
            </div>
          ) : null}
        </section>

        {isFunctionalTokenOwner ? (
          <section className="card">
            <h2 style={{marginTop: 0}}>Liquidity</h2>
            <div className="muted" style={{fontSize: 13, marginBottom: 10}}>
              Liquidity actions are still enforced on-chain (operator + GOV threshold).
            </div>

            <label style={{display:'block', marginBottom: 6}}>Table PDA</label>
            <input
              value={tableAddress}
              onChange={(e) => setTableAddress(e.target.value.trim())}
              placeholder="Table PDA"
              style={{width:'100%'}}
            />

            <div className="muted" style={{marginTop: 10, fontSize: 13}}>
              Operator: {isOperator ? 'yes' : 'no'}
            </div>

            <div className="row" style={{marginTop: 12}}>
              <input id="dep" type="number" placeholder="Deposit (USDC)" defaultValue={10} style={{width: 160}} />
              <button disabled={!isOperator} onClick={async () => {
                try {
                  if (!publicKey) return alert('Connect wallet')
                  if (!tableAddress) return alert('Set table')
                  const { program, provider } = await ensureProgram()
                  const amountUi = Number((document.getElementById('dep') as HTMLInputElement)?.value || 0)
                  const amount = Math.round(amountUi * 1_000_000)
                  await anchorLib.depositLiquidity(program, provider, { table: new PublicKey(tableAddress), amount })
                  alert('Deposited')
                } catch (e:any) { console.error(e); alert(e?.message||e) }
              }}>Deposit</button>

              <input id="wd" type="number" placeholder="Withdraw (USDC)" defaultValue={1} style={{width: 160}} />
              <button disabled={!isOperator} onClick={async () => {
                try {
                  if (!publicKey) return alert('Connect wallet')
                  if (!tableAddress) return alert('Set table')
                  const { program, provider } = await ensureProgram()
                  const amountUi = Number((document.getElementById('wd') as HTMLInputElement)?.value || 0)
                  const amount = Math.round(amountUi * 1_000_000)
                  await anchorLib.executeWithdraw(program, provider, { table: new PublicKey(tableAddress), amount })
                  alert('Withdrawn')
                } catch (e:any) { console.error(e); alert(e?.message||e) }
              }}>Withdraw</button>
            </div>
          </section>
        ) : null}

        {isFunctionalTokenOwner ? (
          <section className="card">
            <h2 style={{marginTop: 0}}>Header social links</h2>
            <div className="muted" style={{fontSize: 13, marginBottom: 10}}>
              This updates the running server memory (good for tests). On restart/deploy it resets to env defaults.
            </div>

            <div style={{display:'grid', gridTemplateColumns: '1fr', gap: 10}}>
              <label>
                Website
                <input value={links.website || ''} onChange={(e)=>setLinks(prev=>({ ...prev, website: e.target.value }))} style={{width:'100%'}} />
              </label>
              <label>
                X/Twitter
                <input value={links.twitter || ''} onChange={(e)=>setLinks(prev=>({ ...prev, twitter: e.target.value }))} style={{width:'100%'}} />
              </label>
              <label>
                Telegram
                <input value={links.telegram || ''} onChange={(e)=>setLinks(prev=>({ ...prev, telegram: e.target.value }))} style={{width:'100%'}} />
              </label>
              <label>
                Discord
                <input value={links.discord || ''} onChange={(e)=>setLinks(prev=>({ ...prev, discord: e.target.value }))} style={{width:'100%'}} />
              </label>
            </div>

            <div style={{marginTop: 12}}>
              <button onClick={saveLinks}>Save</button>
            </div>
          </section>
        ) : null}

        <SiteFooter />
      </main>
    </div>
  )
}
