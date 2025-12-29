import { useCallback, useEffect, useState } from 'react'
import Head from 'next/head'
import { PublicKey, Connection } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import anchorLib from '../lib/anchor'
import dynamic from 'next/dynamic'
import idl from '../idl/roulette_table.json'
const RouletteBoard = dynamic(() => import('../components/RouletteBoardFixed'), { ssr: false })

declare global {
  interface Window { solana?: any }
}

export default function Home() {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
  const connection = new Connection(rpcUrl)

  function getProvider(): any | null {
    const w = window as any
    if (w.solana && w.solana.isPhantom) return w.solana
    if (w.solflare) return w.solflare
    if (w.solana) return w.solana // other wallets may expose window.solana
    if ((w as any).phantom?.solana) return (w as any).phantom.solana
    return null
  }

  const connect = useCallback(async () => {
    try {
      const provider = getProvider()
      if (!provider) return alert('No supported Solana wallet found in browser (Phantom / Solflare)')
      // Some providers accept an options object; try both
      let resp: any
      try {
        resp = await provider.connect({ onlyIfTrusted: false })
      } catch (e) {
        resp = await provider.connect()
      }
      const pub = resp?.publicKey || provider.publicKey
      if (pub) setPublicKey(new PublicKey(pub.toString()))
      else alert('Connected but provider did not return a publicKey')
    } catch (err: any) {
      console.error('wallet connect failed', err)
      alert('Wallet connect failed: ' + (err?.message || err))
    }
  }, [])

  const disconnect = useCallback(async () => {
    try { await window.solana.disconnect() } catch {}
    setPublicKey(null); setBalance(null)
  }, [])

  const fetchBalance = useCallback(async () => {
    if (!publicKey) return setBalance(null)
    const lamports = await connection.getBalance(publicKey)
    setBalance(lamports / 1e9)
  }, [publicKey, connection])

  useEffect(() => { fetchBalance() }, [fetchBalance])

  // Attach Phantom connect/disconnect listeners for reactive updates
  useEffect(() => {
    const provider = getProvider()
    if (!provider) return
    const handleConnect = () => {
      try {
        setPublicKey(new PublicKey(provider.publicKey.toString()))
      } catch {}
    }
    const handleDisconnect = () => {
      setPublicKey(null)
      setBalance(null)
    }
    provider.on && provider.on('connect', handleConnect)
    provider.on && provider.on('disconnect', handleDisconnect)
    // If already connected, update state
    if (provider.isConnected || provider.connected) handleConnect()
    return () => {
      provider.removeListener && provider.removeListener('connect', handleConnect)
      provider.removeListener && provider.removeListener('disconnect', handleDisconnect)
    }
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

  const handleCreateTable = useCallback(async () => {
    try {
      const { program, provider } = await ensureProgram()
      const seed = Math.floor(Math.random() * 1e6)
      const res = await anchorLib.createTable(program, provider, { seed, usdcMint: process.env.NEXT_PUBLIC_USDC_MINT as string, govMint: process.env.NEXT_PUBLIC_GOV_MINT as string, mode: 0, minBet: 1, maxBet: 1000000 })
      console.log('createTable', res)
      // Calculate table PDA
      const [tablePda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('table'), (publicKey as PublicKey).toBuffer(), new anchor.BN(seed).toArrayLike(Buffer, 'le', 8)], new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID as string))
      setTableAddress(tablePda.toBase58())
      alert('createTable sent, table address set')
    } catch(e:any) { console.error(e); alert(e?.message||e) }
  }, [publicKey, connection])

  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [selectedPair, setSelectedPair] = useState<[number, number] | null>(null)
  const [selectedCorner, setSelectedCorner] = useState<number[] | null>(null)
  const [selectedStreet, setSelectedStreet] = useState<number[] | null>(null)
  const [betType, setBetType] = useState<'straight'|'split'|'street'|'corner'|'red'|'black'|'dozen'|'column'>('straight')
  const [stake, setStake] = useState<number>(1)
  const [tableAddress, setTableAddress] = useState<string>(process.env.NEXT_PUBLIC_TABLE_PDA || '')
  const [tableSeed, setTableSeed] = useState<number>(Math.floor(Math.random() * 1e6))
  const [betSlip, setBetSlip] = useState<Array<any>>([])

  async function handlePlaceBetUI() {
    if (!publicKey) return alert('Connect wallet first')
    if (betType === 'straight' && selectedNumber === null) return alert('Select a number to bet on')
    if (betType === 'split' && (!selectedPair || selectedPair[0] === selectedPair[1])) return alert('Select two adjacent numbers for split')
    if (betType === 'split' && selectedCorner) return alert('For corner bets switch bet type to corner (handled via buttons)')
    if (betType === 'street' && (!selectedStreet || selectedStreet.length !== 3)) return alert('Select a street (row of 3 numbers)')
    if (betType === 'corner' && (!selectedCorner || selectedCorner.length !== 4)) return alert('Select a valid corner (4 numbers)')
    if ((betType === 'dozen' || betType === 'column') && selectedNumber === null) return alert('Select a dozen/column first')
    try {
      const { program, provider } = await ensureProgram()
      const player = publicKey as PublicKey
      if (!tableAddress) return alert('Set table address in the Table section above')
      if (process.env.NEXT_PUBLIC_PROGRAM_ID && tableAddress === process.env.NEXT_PUBLIC_PROGRAM_ID) {
        return alert('Table address is ProgramId. Create/select a real table PDA address.')
      }
      let table: PublicKey
      try { table = new PublicKey(tableAddress) } catch { return alert('Invalid table address') }
      let betKind: any = null
      if (betType === 'straight') betKind = { straight: { number: selectedNumber } }
      else if (betType === 'split') betKind = { split: { a: selectedPair[0], b: selectedPair[1] } }
      else if (betType === 'street') betKind = { street: { row: Math.floor((selectedStreet[0] - 1) / 3) } } // assuming rows 0-11
      else if (betType === 'corner') betKind = { corner: { row: Math.floor((selectedCorner[0] - 1) / 3), col: (selectedCorner[0] - 1) % 3 } } // rough
      else if (betType === 'red') betKind = { red: {} }
      else if (betType === 'black') betKind = { black: {} }
      else if (betType === 'dozen') betKind = { dozen: { idx: selectedNumber } }
      else if (betType === 'column') betKind = { column: { idx: selectedNumber } }
      const res = await anchorLib.placeBet(program, provider, { table, betKind, stake })
      console.log('placeBet result', res)
      alert('placeBet transaction sent (see console)')
    } catch (e: any) {
      console.error(e)
      alert('placeBet failed: ' + (e?.message || e))
    }
  }

  function addToSlip() {
    if (betType === 'straight' && selectedNumber === null) return alert('Select a number')
    if (betType === 'split' && (!selectedPair || selectedPair[0] === selectedPair[1])) return alert('Select a valid split')
    if (betType === 'corner' && (!selectedCorner || selectedCorner.length !== 4)) return alert('Select a valid corner (4 numbers)')
    if (betType === 'street' && (!selectedStreet || selectedStreet.length !== 3)) return alert('Select a valid street (3 numbers)')
    let value: any = null
    if (betType === 'split') value = selectedPair
    else if (betType === 'corner') value = selectedCorner
    else if (betType === 'street') value = selectedStreet
    else value = selectedNumber
    const bet = { type: betType, value, stake }
    setBetSlip(prev => [...prev, bet])
    setSelectedNumber(null); setSelectedPair(null); setStake(1)
  }

  async function submitSlip() {
    if (!publicKey) return alert('Connect wallet first')
    if (!betSlip.length) return alert('Slip is empty')
    try {
      const { program, provider } = await ensureProgram()
      const player = publicKey as PublicKey
      if (!tableAddress) return alert('Set table address in the input above')
      let table: PublicKey
      try { table = new PublicKey(tableAddress) } catch (err) { console.error('Invalid tableAddress', tableAddress, err); return alert('Invalid table address') }
      for (const b of betSlip) {
        let betKind: any = null
        if (b.type === 'straight') betKind = { straight: { number: b.value } }
        else if (b.type === 'split') betKind = { split: { a: b.value[0], b: b.value[1] } }
        else if (b.type === 'street') betKind = { street: { row: Math.floor((b.value[0] - 1) / 3) } }
        else if (b.type === 'corner') betKind = { corner: { row: Math.floor((b.value[0] - 1) / 3), col: (b.value[0] - 1) % 3 } }
        else if (b.type === 'red') betKind = { red: {} }
        else if (b.type === 'black') betKind = { black: {} }
        else if (b.type === 'dozen') betKind = { dozen: { idx: b.value } }
        else if (b.type === 'column') betKind = { column: { idx: b.value } }
        if (!betKind) throw new Error('Invalid bet in slip: ' + JSON.stringify(b))
        try {
          await anchorLib.placeBet(program, provider, { table, betKind, stake: b.stake })
        } catch (err:any) {
          console.error('placeBet failed for bet', b, err)
          throw err
        }
      }
      alert('Submitted slip (transactions sent).')
      setBetSlip([])
    } catch (e:any) { console.error(e); alert(e?.message||e) }
  }

  const selectionDisplay = (() => {
    if (betType === 'straight') return selectedNumber === null ? '—' : String(selectedNumber)
    if (betType === 'split') return selectedPair ? `${selectedPair[0]} / ${selectedPair[1]}` : '—'
    if (betType === 'corner') return selectedCorner ? selectedCorner.join(', ') : '—'
    if (betType === 'street') return selectedStreet ? selectedStreet.join(', ') : '—'
    if (betType === 'red' || betType === 'black') return betType.toUpperCase()
    return '—'
  })()

  return (
    <div>
      <Head><title>Provably-Fair Roulette</title></Head>
      <main style={{maxWidth:900,margin:'40px auto',padding:'0 20px',fontFamily:'Inter, Arial'}}>
        <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h1 style={{margin:0}}>Provably-Fair Roulette  Table</h1>
          <div>
            {publicKey ? (<span style={{display:'flex',gap:8,alignItems:'center'}}><span>{publicKey.toBase58().slice(0,6)}...{publicKey.toBase58().slice(-6)}</span><button onClick={disconnect}>Disconnect</button></span>) : (<button onClick={connect}>Connect Phantom</button>)}
          </div>
        </header>

        <section style={{background:'#fff',borderRadius:8,padding:18,marginTop:20}}>
          <h2>Status</h2>
          <div>Cluster: {process.env.NEXT_PUBLIC_CLUSTER||'devnet'}</div>
          <div>Program: {process.env.NEXT_PUBLIC_PROGRAM_ID}</div>
          <div>RPC: {rpcUrl}</div>
          <div>Wallet: {publicKey ? publicKey.toBase58() : 'Not connected'}</div>
          <div>SOL: {balance!==null?balance.toFixed(4):''}</div>
        </section>

        <section style={{background:'#fff',borderRadius:8,padding:18,marginTop:20}}>
          <h2>Table</h2>
          <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
            <label style={{display:'flex',gap:8,alignItems:'center'}}>
              Table number (seed):
              <input
                type="number"
                value={tableSeed}
                onChange={(e)=>setTableSeed(Number(e.target.value||0))}
                style={{width:160}}
              />
            </label>
            <button onClick={async ()=>{
              try {
                if (!publicKey) return alert('Connect wallet first')
                const { program, provider } = await ensureProgram()
                const seed = Number.isFinite(tableSeed) ? Math.floor(tableSeed) : Math.floor(Math.random()*1e6)
                const res = await anchorLib.createTable(program, provider, {
                  seed,
                  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT as string,
                  govMint: process.env.NEXT_PUBLIC_GOV_MINT as string,
                  mode: 0,
                  minBet: 1,
                  maxBet: 1000000,
                })
                console.log('createTable tx', res)
                if (!process.env.NEXT_PUBLIC_PROGRAM_ID) throw new Error('NEXT_PUBLIC_PROGRAM_ID is missing')
                const tablePda = res.tablePda
                setTableAddress(tablePda)
                
                // Wait for account to be created on-chain
                console.log('Waiting for table account to be created...')
                let attempts = 0
                while (attempts < 10) {
                  await new Promise(resolve => setTimeout(resolve, 1000))
                  const info = await connection.getAccountInfo(new PublicKey(tablePda))
                  if (info) {
                    alert('Table created successfully! Address: ' + tablePda)
                    return
                  }
                  attempts++
                }
                alert('Table tx sent but account not yet visible. Address: ' + tablePda)
              } catch (e:any) {
                console.error(e)
                alert('createTable failed: ' + (e?.message || e))
              }
            }}>Create Table</button>
          </div>

          <div style={{marginTop:12}}>
            <label style={{display:'block',marginBottom:6}}>Table address (PDA)</label>
            <input
              value={tableAddress}
              onChange={(e)=>setTableAddress(e.target.value.trim())}
              placeholder="Paste table PDA here, or click Create Table"
              style={{width:'100%'}}
            />
            <div style={{marginTop:8, color:'#666', fontSize:13}}>
              Multiple tables are supported by choosing a different seed; each (creator, seed) maps to a unique PDA address.
            </div>
          </div>

          <div style={{marginTop:16,padding:12,background:'#fff3cd',borderRadius:6}}>
            <h3 style={{margin:'0 0 8px 0',fontSize:15}}>Deposit Liquidity (Required before bets)</h3>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <input
                type="number"
                placeholder="Amount (USDC)"
                id="liquidityAmount"
                style={{width:150}}
                defaultValue={1000}
              />
              <button onClick={async ()=>{
                try {
                  if (!publicKey) return alert('Connect wallet first')
                  if (!tableAddress) return alert('Set table address first')
                  const { program, provider } = await ensureProgram()
                  const amount = Number((document.getElementById('liquidityAmount') as HTMLInputElement)?.value || 0)
                  if (!amount || amount <= 0) return alert('Enter valid amount')
                  const table = new PublicKey(tableAddress)
                  await anchorLib.depositLiquidity(program, provider, { table, amount })
                  alert('Liquidity deposited successfully!')
                } catch (e: any) {
                  console.error(e)
                  alert('depositLiquidity failed: ' + (e?.message || e))
                }
              }}>Deposit Liquidity</button>
              <span style={{fontSize:13,color:'#856404'}}>Operators must fund the vault before players can bet</span>
            </div>
          </div>
        </section>

        <section style={{background:'#fff',borderRadius:8,padding:18,marginTop:20}}>
          <h2>Place a bet</h2>
          <div style={{display:'flex',gap:24,alignItems:'flex-start',flexWrap:'wrap'}}>
            <div>
              {/* Bet-type buttons removed — the board itself handles bet selection */}

              <RouletteBoard
                mode={betType}
                selected={selectedNumber}
                selectedPair={selectedPair}
                selectedCorner={selectedCorner}
                selectedStreet={selectedStreet}
                placedBets={betSlip}
                currentBetType={betType}
                currentStake={stake}
                onPlace={(b)=>{ setBetSlip(prev=>[...prev, b]) }}
                onRemove={(idx)=>{ setBetSlip(prev=>prev.filter((_,i)=>i!==idx)) }}
                onSelect={(n:number|null)=>{ setBetType('straight'); setSelectedNumber(n); setSelectedPair(null); setSelectedCorner(null); setSelectedStreet(null) }}
                onSelectPair={(a,b)=>{ setSelectedPair([a,b]); setSelectedCorner(null); setSelectedNumber(null); setSelectedStreet(null); setBetType('split') }}
                onSelectCorner={(vals)=>{ setSelectedCorner(vals); setSelectedPair(null); setSelectedNumber(null); setSelectedStreet(null); setBetType('corner') }}
                onSelectStreet={(vals)=>{ setSelectedStreet(vals); setSelectedPair(null); setSelectedCorner(null); setSelectedNumber(null); setBetType('street') }}
                onSelectDozen={(which)=>{ setBetType('dozen'); setSelectedNumber(which); setSelectedPair(null); setSelectedCorner(null); setSelectedStreet(null) }}
                onSelectColumn={(which)=>{ setBetType('column'); setSelectedNumber(which); setSelectedPair(null); setSelectedCorner(null); setSelectedStreet(null) }}
                onSelectOutside={(which)=>{ setBetType(which as any); setSelectedNumber(null); setSelectedPair(null); setSelectedCorner(null); setSelectedStreet(null) }}
              />
            </div>

            <div style={{minWidth:260}}>
              <div style={{marginBottom:8}}>Selected: {selectionDisplay}</div>
              <div style={{marginBottom:8}}>Stake (USDC): <input type="number" value={stake} min={1} onChange={(e)=>setStake(Number(e.target.value||1))} style={{width:120}} /></div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={handlePlaceBetUI}>Place Bet</button>
                <button onClick={addToSlip}>Add Chip</button>
                <button onClick={()=>{ setSelectedNumber(null); setStake(1) }}>Clear</button>
              </div>
              <div style={{marginTop:12}}>
                <h3 style={{margin:'8px 0'}}>Bet Slip ({betSlip.length})</h3>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {betSlip.map((b,i)=> (
                    <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f7f7f7',padding:8,borderRadius:6}}>
                      <div style={{fontSize:13}}>{b.type} {Array.isArray(b.value)? JSON.stringify(b.value):String(b.value)}</div>
                      <div style={{display:'flex',gap:8,alignItems:'center'}}>
                        <input type="number" value={b.stake||stake} min={1} onChange={(e)=>{ const s=Number(e.target.value||1); setBetSlip(prev=>prev.map((p,idx)=> idx===i? {...p, stake: s}:p)) }} style={{width:80}} />
                        <button onClick={()=>setBetSlip(prev=>prev.filter((_,idx)=>idx!==i))}>Remove</button>
                      </div>
                    </div>
                  ))}
                  {betSlip.length===0 && <div style={{color:'#666'}}>No chips placed</div>}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
