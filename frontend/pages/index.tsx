import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import { PublicKey, Connection } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import anchorLib from '../lib/anchor'
import dynamic from 'next/dynamic'
import idl from '../idl/roulette_table.json'
import SiteFooter from '../components/SiteFooter'
import SiteHeader from '../components/SiteHeader'
const RouletteBoard = dynamic(() => import('../components/RouletteBoardFixed'), { ssr: false })

function sanitizeFirstPda(raw: string | undefined): string {
  if (!raw) return ''
  const first = raw.split(/[\s,]+/g).map((s) => s.trim()).filter(Boolean)[0]
  if (!first) return ''
  try {
    // eslint-disable-next-line no-new
    new PublicKey(first)
    return first
  } catch {
    return ''
  }
}

declare global {
  interface Window { solana?: any }
}

export default function Home() {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
  const connection = useMemo(() => new Connection(rpcUrl), [rpcUrl])
  const balanceBackoffUntilRef = useRef<number>(0)

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
    const now = Date.now()
    if (now < balanceBackoffUntilRef.current) return
    try {
      const lamports = await connection.getBalance(publicKey)
      setBalance(lamports / 1e9)
    } catch (e: any) {
      const msg = String(e?.message || e)
      // Handle devnet public RPC rate limiting (429)
      if (msg.includes('429') || msg.includes('Too many requests')) {
        balanceBackoffUntilRef.current = Date.now() + 15_000
        return
      }
      console.warn('getBalance failed:', e)
    }
  }, [publicKey, connection])

  useEffect(() => {
    fetchBalance()
    const id = setInterval(() => fetchBalance(), 15_000)
    return () => clearInterval(id)
  }, [fetchBalance])

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

  // UI gating for liquidity controls: only show to table operator with enough GOV
  const OPERATOR_THRESHOLD = 51
  const [isOperator, setIsOperator] = useState(false)
  const [govBalanceUi, setGovBalanceUi] = useState(0)
  const [govBalanceEnvUi, setGovBalanceEnvUi] = useState(0)

  const envGovMint = process.env.NEXT_PUBLIC_GOV_MINT
  const envTablePda = sanitizeFirstPda(process.env.NEXT_PUBLIC_TABLE_PDA)
  const envTablePdasRaw = process.env.NEXT_PUBLIC_TABLE_PDAS || ''
  const hasEnvTableList = Boolean(envTablePdasRaw.trim())
  const envTablePdas = useMemo(() => {
    const candidates = [envTablePda, ...envTablePdasRaw.split(/[\s,]+/g)].filter(Boolean) as string[]
    const uniq = new Set<string>()
    const out: string[] = []
    for (const raw of candidates) {
      const v = String(raw).trim()
      if (!v) continue
      if (uniq.has(v)) continue
      try {
        // Validate base58 + length
        // eslint-disable-next-line no-new
        new PublicKey(v)
      } catch {
        continue
      }
      uniq.add(v)
      out.push(v)
    }
    return out
  }, [envTablePda, envTablePdasRaw])

  // Backward compatible behavior:
  // - If only NEXT_PUBLIC_TABLE_PDA is set => pinned (no switching)
  // - If NEXT_PUBLIC_TABLE_PDAS is set => show selector
  const tableAddressIsPinned = Boolean(envTablePda) && !hasEnvTableList
  const isFunctionalTokenOwner = govBalanceEnvUi >= OPERATOR_THRESHOLD

  // Read GOV balance directly from env mint (works even before a table exists)
  useEffect(() => {
    ;(async () => {
      try {
        if (!publicKey || !envGovMint) {
          setGovBalanceEnvUi(0)
          return
        }
        const { provider } = await ensureProgram()
        const govMintPk = new PublicKey(envGovMint)
        const govAta = anchor.utils.token.associatedAddress({ mint: govMintPk, owner: publicKey })
        const bal = await provider.connection.getTokenAccountBalance(govAta, 'confirmed')
        setGovBalanceEnvUi(Number(bal.value.uiAmount || 0))
      } catch {
        setGovBalanceEnvUi(0)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58(), envGovMint])

  const [tableAddress, setTableAddress] = useState<string>(envTablePda || '')

  // If a table list is provided, default to saved selection (or first in list)
  useEffect(() => {
    if (!hasEnvTableList) return
    try {
      const saved = window.localStorage.getItem('selectedTablePda')?.trim()
      if (saved && envTablePdas.includes(saved)) {
        setTableAddress(saved)
        return
      }
    } catch {}

    if (envTablePdas.length > 0 && !tableAddress) {
      setTableAddress(envTablePdas[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEnvTableList, envTablePdas])

  const tableSelectOptions = useMemo(() => {
    if (!hasEnvTableList) return []
    if (!tableAddress) return envTablePdas
    if (envTablePdas.includes(tableAddress)) return envTablePdas
    return [tableAddress, ...envTablePdas]
  }, [hasEnvTableList, envTablePdas, tableAddress])

  useEffect(() => {
    ;(async () => {
      try {
        if (!publicKey || !tableAddress) {
          setIsOperator(false)
          setGovBalanceUi(0)
          return
        }

        const { program, provider } = await ensureProgram()

        let tablePk: PublicKey
        try {
          tablePk = new PublicKey(tableAddress)
        } catch {
          setIsOperator(false)
          setGovBalanceUi(0)
          return
        }

        const tableAcc: any = await (program.account as any).table.fetch(tablePk)
        const operatorPk = new PublicKey(tableAcc.operator)
        setIsOperator(operatorPk.equals(publicKey))

        const govMintPk = new PublicKey(tableAcc.govMint)
        const govAta = anchor.utils.token.associatedAddress({ mint: govMintPk, owner: publicKey })
        const bal = await provider.connection.getTokenAccountBalance(govAta, 'confirmed')
        setGovBalanceUi(Number(bal.value.uiAmount || 0))
      } catch {
        // Table not created yet, ATA missing, etc.
        setIsOperator(false)
        setGovBalanceUi(0)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58(), tableAddress])

  const handleCreateTable = useCallback(async () => {
    try {
      if (!isFunctionalTokenOwner) {
        return alert('Only functional-token owners (GOV >= 51) can create tables')
      }
      const { program, provider } = await ensureProgram()
      const seed = Math.floor(Math.random() * 1e6)
      const res = await anchorLib.createTable(program, provider, { seed, usdcMint: process.env.NEXT_PUBLIC_USDC_MINT as string, govMint: process.env.NEXT_PUBLIC_GOV_MINT as string, mode: 0, minBet: 1, maxBet: 1000000 })
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
  const [tableSeed, setTableSeed] = useState<number>(Math.floor(Math.random() * 1e6))
  const [betSlip, setBetSlip] = useState<Array<any>>([])
  const [lastBetPda, setLastBetPda] = useState<string>('')
  const [lastResult, setLastResult] = useState<{number: number, win: boolean, payout: number} | null>(null)

  const [uiNotice, setUiNotice] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null)
  const [spinPhase, setSpinPhase] = useState<'idle' | 'waiting' | 'spinning' | 'revealed'>('idle')
  const [spinningNumber, setSpinningNumber] = useState<number | null>(null)
  const [wheelRotationDeg, setWheelRotationDeg] = useState(0)
  const [spinReady, setSpinReady] = useState(false)
  const [lastRandomPda, setLastRandomPda] = useState<string>('')

  const rotationRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const animModeRef = useRef<'stopped' | 'free' | 'settling'>('stopped')
  const lastPaintRef = useRef(0)

  const EURO_WHEEL_ORDER = useMemo(
    () => [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],
    []
  )

  function rouletteColor(n: number): 'green' | 'red' | 'black' {
    if (n === 0) return 'green'
    const redSet = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])
    return redSet.has(n) ? 'red' : 'black'
  }

  const wheelGradient = useMemo(() => {
    const seg = 360 / EURO_WHEEL_ORDER.length
    const stops: string[] = []
    for (let i = 0; i < EURO_WHEEL_ORDER.length; i++) {
      const n = EURO_WHEEL_ORDER[i]
      const start = i * seg
      const end = (i + 1) * seg
      const c = rouletteColor(n)
      const col = c === 'green' ? '#155724' : c === 'red' ? '#721c24' : '#111'
      stops.push(`${col} ${start}deg ${end}deg`)
    }
    return `conic-gradient(from 0deg, ${stops.join(', ')})`
  }, [EURO_WHEEL_ORDER])

  const wheelSegDeg = 360 / 37
  const wheelBaseOffsetDeg = -wheelSegDeg / 2

  function stopAnimation() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    animModeRef.current = 'stopped'
  }

  function paintRotation(next: number, nowMs: number) {
    rotationRef.current = next
    // throttle paints a bit to avoid re-rendering too hard
    if (nowMs - lastPaintRef.current > 16) {
      lastPaintRef.current = nowMs
      setWheelRotationDeg(next)
    }
  }

  function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3)
  }

  function startFreeSpin() {
    if (animModeRef.current === 'free') return
    stopAnimation()
    animModeRef.current = 'free'

    let last = performance.now()
    const speedDegPerSec = 720 // nice fast spin

    const tick = (now: number) => {
      if (animModeRef.current !== 'free') return
      const dt = Math.max(0, now - last) / 1000
      last = now
      const next = rotationRef.current + speedDegPerSec * dt
      paintRotation(next, now)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  function settleToNumber(result: number) {
    stopAnimation()
    animModeRef.current = 'settling'

    const seg = 360 / EURO_WHEEL_ORDER.length
    const idx = EURO_WHEEL_ORDER.indexOf(result)
    if (idx < 0) return

    // Center of the winning segment in wheel local coords
    const targetCenter = idx * seg + seg / 2
    // We want targetCenter to end up at pointer (0deg), so rotation mod should be -targetCenter
    const desiredMod = ((-targetCenter) % 360 + 360) % 360
    const current = rotationRef.current
    const currentMod = ((current % 360) + 360) % 360
    const deltaMod = (desiredMod - currentMod + 360) % 360
    const final = current + 360 * 6 + deltaMod

    const start = performance.now()
    const duration = 2600
    const from = current
    const to = final

    const tick = (now: number) => {
      if (animModeRef.current !== 'settling') return
      const t = Math.min(1, (now - start) / duration)
      const eased = easeOutCubic(t)
      const next = from + (to - from) * eased
      paintRotation(next, now)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else {
        animModeRef.current = 'stopped'
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    if (spinPhase === 'waiting' || spinPhase === 'spinning') {
      startFreeSpin()
      return
    }
    if (spinPhase === 'revealed' && spinningNumber !== null) {
      settleToNumber(spinningNumber)
      return
    }
    stopAnimation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinPhase, spinningNumber])

  useEffect(() => () => stopAnimation(), [])

  function clearBetEntryForNextRound() {
    setSelectedNumber(null)
    setSelectedPair(null)
    setSelectedCorner(null)
    setSelectedStreet(null)
    setStake(1)
    setBetType('straight')
    setBetSlip([])
    setSpinReady(false)
    setLastRandomPda('')
  }

  // When we have a randomness account, poll readiness and guide the user.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!lastRandomPda) return
        if (!publicKey) return
        if (!tableAddress) return
        if (spinReady) return
        if (spinPhase !== 'waiting') return

        const { provider } = await ensureProgram()
        const randomPk = new PublicKey(lastRandomPda)
        const started = Date.now()

        while (!cancelled && Date.now() - started < 30_000) {
          const st = await anchorLib.getOraoRandomnessV2Fulfilled(provider, randomPk, 'confirmed')
          if (st.fulfilled) {
            if (cancelled) return
            setSpinReady(true)
            setSpinPhase('idle')
            setUiNotice({
              kind: 'success',
              text: 'Случайность подтверждена (VRF). Нажми SPIN, чтобы открыть результат.',
            })
            return
          }
          await new Promise(r => setTimeout(r, 1200))
        }

        if (!cancelled) {
          // Stop the infinite animation loop; VRF on devnet can take longer than our initial poll window.
          setSpinPhase('idle')
          setUiNotice({
            kind: 'info',
            text: 'Ждём подтверждение VRF… На devnet это иногда занимает 30–120 секунд. Подожди и нажми SPIN ещё раз, чтобы проверить готовность.',
          })
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('VRF readiness poll failed:', e)
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRandomPda, spinPhase, publicKey?.toBase58(), tableAddress, spinReady])

  function multiplierForBetType(t: string): number {
    switch (t) {
      case 'straight': return 35
      case 'split': return 17
      case 'street': return 11
      case 'corner': return 8
      case 'red':
      case 'black':
        return 1
      case 'dozen':
      case 'column':
        return 2
      default:
        return 1
    }
  }

  async function handlePlaceBetUI() {
    setUiNotice(null)
    if (!publicKey) {
      setUiNotice({ kind: 'error', text: 'Connect wallet first' })
      return
    }
    if (betType === 'straight' && selectedNumber === null) return setUiNotice({ kind: 'error', text: 'Select a number to bet on' })
    if (betType === 'split' && (!selectedPair || selectedPair[0] === selectedPair[1])) return setUiNotice({ kind: 'error', text: 'Select two adjacent numbers for split' })
    if (betType === 'split' && selectedCorner) return setUiNotice({ kind: 'error', text: 'For corner bets switch bet type to corner' })
    if (betType === 'street' && (!selectedStreet || selectedStreet.length !== 3)) return setUiNotice({ kind: 'error', text: 'Select a street (row of 3 numbers)' })
    if (betType === 'corner' && (!selectedCorner || selectedCorner.length !== 4)) return setUiNotice({ kind: 'error', text: 'Select a valid corner (4 numbers)' })
    if ((betType === 'dozen' || betType === 'column') && selectedNumber === null) return setUiNotice({ kind: 'error', text: 'Select a dozen/column first' })
    try {
      const { program, provider } = await ensureProgram()
      const player = publicKey as PublicKey
      if (!tableAddress) return setUiNotice({ kind: 'error', text: 'Set table address in the Table section above' })
      if (process.env.NEXT_PUBLIC_PROGRAM_ID && tableAddress === process.env.NEXT_PUBLIC_PROGRAM_ID) {
        return setUiNotice({ kind: 'error', text: 'Table address is ProgramId. Create/select a real table PDA address.' })
      }
      let table: PublicKey
      try { table = new PublicKey(tableAddress) } catch { return setUiNotice({ kind: 'error', text: 'Invalid table address' }) }
      let betKind: any = null
      if (betType === 'straight') betKind = { straight: { number: selectedNumber } }
      else if (betType === 'split') betKind = { split: { a: selectedPair[0], b: selectedPair[1] } }
      else if (betType === 'street') {
        const row = Math.floor((selectedStreet[0] - 1) / 3) + 1 // program expects 1..12
        betKind = { street: { row } }
      }
      else if (betType === 'corner') {
        const tl = Math.min(...selectedCorner)
        const row = Math.floor((tl - 1) / 3) + 1 // 1..11
        const col = ((tl - 1) % 3) + 1 // 1..2
        betKind = { corner: { row, col } }
      }
      else if (betType === 'red') betKind = { red: {} }
      else if (betType === 'black') betKind = { black: {} }
      else if (betType === 'dozen') {
        const idx = selectedNumber
        if (idx !== 1 && idx !== 2 && idx !== 3) return setUiNotice({ kind: 'error', text: 'Dozen idx must be 1,2,3' })
        betKind = { dozen: { idx } }
      }
      else if (betType === 'column') {
        const idx = selectedNumber
        if (idx !== 1 && idx !== 2 && idx !== 3) return setUiNotice({ kind: 'error', text: 'Column idx must be 1,2,3' })
        betKind = { column: { idx } }
      }
      // UI is in USDC; program uses base units (6 decimals)
      const stakeBase = Math.round(Number(stake) * 1_000_000)

      // Preflight liquidity: required max payout must be available in global vault
      const tableAcc: any = await (program.account as any).table.fetch(table)
      const usdcMintPk = new PublicKey(tableAcc.usdcMint)
      const mult = multiplierForBetType(betType)
      const required = BigInt(stakeBase) * BigInt(mult + 1)
      const liq = await anchorLib.getGlobalLiquidity(provider, program.programId, usdcMintPk, 'confirmed')
      if (liq.available < required) {
        const missing = required - liq.available
        return setUiNotice({
          kind: 'error',
          text:
            `Insufficient liquidity. Available: ${Number(liq.available) / 1e6} USDC. ` +
            `Required: ${Number(required) / 1e6} USDC. ` +
            `Missing: ${Number(missing) / 1e6} USDC.`,
        })
      }

      // Preflight player USDC balance to avoid opaque Token Program errors.
      // Note: ATA may be auto-created inside anchorLib.placeBet(), but balance will still be 0.
      let playerUsdcUi = 0
      try {
        const playerUsdcAta = getAssociatedTokenAddressSync(usdcMintPk, player)
        const bal = await provider.connection.getTokenAccountBalance(playerUsdcAta, 'confirmed')
        playerUsdcUi = Number(bal.value.uiAmount || 0)
      } catch {
        playerUsdcUi = 0
      }
      const playerUsdcBase = Math.floor(playerUsdcUi * 1_000_000)
      if (playerUsdcBase < stakeBase) {
        return setUiNotice({
          kind: 'error',
          text:
            `Insufficient USDC in your wallet. Have: ${playerUsdcUi} USDC. ` +
            `Need: ${(stakeBase / 1e6).toFixed(6)} USDC. ` +
            `Go to /get-tokens or ask the operator to send you test USDC.`,
        })
      }

      setUiNotice({ kind: 'info', text: 'Bet submitted. Waiting for randomness…' })
      const res = await anchorLib.placeBet(program, provider, { table, betKind, stake: stakeBase })
      setLastBetPda(res.betPda)
      setLastRandomPda(res.randomPda)
      setSpinReady(false)
      setSpinPhase('waiting')
      setUiNotice({
        kind: 'info',
        text: 'Ставка принята. Ждём подтверждение случайности (VRF)…',
      })
    } catch (e: any) {
      console.error(e)
      setUiNotice({ kind: 'error', text: 'placeBet failed: ' + (e?.message || e) })
    }
  }

  function addToSlip() {
    setUiNotice(null)
    if (betType === 'straight' && selectedNumber === null) return setUiNotice({ kind: 'error', text: 'Select a number' })
    if (betType === 'split' && (!selectedPair || selectedPair[0] === selectedPair[1])) return setUiNotice({ kind: 'error', text: 'Select a valid split' })
    if (betType === 'corner' && (!selectedCorner || selectedCorner.length !== 4)) return setUiNotice({ kind: 'error', text: 'Select a valid corner (4 numbers)' })
    if (betType === 'street' && (!selectedStreet || selectedStreet.length !== 3)) return setUiNotice({ kind: 'error', text: 'Select a valid street (3 numbers)' })
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
    setUiNotice(null)
    if (!publicKey) return setUiNotice({ kind: 'error', text: 'Connect wallet first' })
    if (!betSlip.length) return setUiNotice({ kind: 'error', text: 'Slip is empty' })
    try {
      const { program, provider } = await ensureProgram()
      const player = publicKey as PublicKey
      if (!tableAddress) return setUiNotice({ kind: 'error', text: 'Set table address in the input above' })
      let table: PublicKey
      try { table = new PublicKey(tableAddress) } catch (err) { console.error('Invalid tableAddress', tableAddress, err); return setUiNotice({ kind: 'error', text: 'Invalid table address' }) }

      // Preflight total stake vs player USDC balance
      let totalStakeBase = 0
      for (const b of betSlip) totalStakeBase += Math.round(Number(b.stake) * 1_000_000)
      try {
        const tableAcc: any = await (program.account as any).table.fetch(table)
        const usdcMintPk = new PublicKey(tableAcc.usdcMint)
        const playerUsdcAta = getAssociatedTokenAddressSync(usdcMintPk, player)
        const bal = await provider.connection.getTokenAccountBalance(playerUsdcAta, 'confirmed')
        const playerUsdcUi = Number(bal.value.uiAmount || 0)
        const playerUsdcBase = Math.floor(playerUsdcUi * 1_000_000)
        if (playerUsdcBase < totalStakeBase) {
          return setUiNotice({
            kind: 'error',
            text:
              `Insufficient USDC for slip. Have: ${playerUsdcUi} USDC. ` +
              `Need total: ${(totalStakeBase / 1e6).toFixed(6)} USDC. ` +
              `Go to /get-tokens or ask the operator to send you test USDC.`,
          })
        }
      } catch {
        return setUiNotice({
          kind: 'error',
          text:
            `Could not read your USDC balance (ATA may be missing). ` +
            `Try placing a single bet once (it will create ATA), then retry.`,
        })
      }

      setUiNotice({ kind: 'info', text: 'Submitting slip…' })
      for (const b of betSlip) {
        let betKind: any = null
        if (b.type === 'straight') betKind = { straight: { number: b.value } }
        else if (b.type === 'split') betKind = { split: { a: b.value[0], b: b.value[1] } }
        else if (b.type === 'street') {
          const row = Math.floor((b.value[0] - 1) / 3) + 1
          betKind = { street: { row } }
        }
        else if (b.type === 'corner') {
          const tl = Math.min(...b.value)
          const row = Math.floor((tl - 1) / 3) + 1
          const col = ((tl - 1) % 3) + 1
          betKind = { corner: { row, col } }
        }
        else if (b.type === 'red') betKind = { red: {} }
        else if (b.type === 'black') betKind = { black: {} }
        else if (b.type === 'dozen') betKind = { dozen: { idx: b.value } }
        else if (b.type === 'column') betKind = { column: { idx: b.value } }
        if (!betKind) throw new Error('Invalid bet in slip: ' + JSON.stringify(b))
        try {
          const stakeBase = Math.round(Number(b.stake) * 1_000_000)
          await anchorLib.placeBet(program, provider, { table, betKind, stake: stakeBase })
        } catch (err:any) {
          console.error('placeBet failed for bet', b, err)
          throw err
        }
      }
      setUiNotice({ kind: 'success', text: 'Slip submitted (transactions sent).' })
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
      <style jsx>{`
        @keyframes popIn {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes ballOrbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <main className="container">
        <SiteHeader showAdminLink={isFunctionalTokenOwner} />

        <section className="card">
          <div className="space-between">
            <div>
              <h2 style={{margin:'0 0 6px 0'}}>Wallet & Network</h2>
              <div className="muted" style={{fontSize:13}}>
                {process.env.NEXT_PUBLIC_CLUSTER || 'devnet'} • provably-fair VRF roulette demo
              </div>
            </div>
            <div className="row">
              {publicKey ? (
                <>
                  <div className="muted" style={{fontSize:13}}>
                    {publicKey.toBase58().slice(0,6)}…{publicKey.toBase58().slice(-6)}
                  </div>
                  <button className="btn-secondary" onClick={disconnect}>Disconnect</button>
                </>
              ) : (
                <div className="row">
                  <button onClick={connect}>Connect wallet</button>
                  <a className="muted" href="https://solflare.com/" target="_blank" rel="noreferrer" style={{fontSize:13, textDecoration:'none'}}>
                    Install Solflare
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-2" style={{marginTop:14}}>
            <div className="kv"><strong>RPC:</strong> <span style={{wordBreak:'break-all'}}>{rpcUrl}</span></div>
            <div className="kv"><strong>Program:</strong> <span style={{wordBreak:'break-all'}}>{process.env.NEXT_PUBLIC_PROGRAM_ID}</span></div>
            <div className="kv"><strong>Wallet:</strong> <span style={{wordBreak:'break-all'}}>{publicKey ? publicKey.toBase58() : 'Not connected'}</span></div>
            <div className="kv"><strong>SOL:</strong> {balance!==null ? balance.toFixed(4) : '—'}</div>
          </div>
        </section>

        <section className="card">
          <h2>Table</h2>
          {hasEnvTableList && tableSelectOptions.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6 }}>Select table</label>
              <select
                value={tableSelectOptions.includes(tableAddress) ? tableAddress : tableSelectOptions[0]}
                onChange={(e) => {
                  const next = e.target.value.trim()
                  setTableAddress(next)
                  try {
                    window.localStorage.setItem('selectedTablePda', next)
                  } catch {}
                }}
                style={{ width: '100%' }}
              >
                {tableSelectOptions.map((pda) => (
                  <option key={pda} value={pda}>
                    {pda.slice(0, 4)}…{pda.slice(-4)}
                  </option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Add/remove tables via NEXT_PUBLIC_TABLE_PDAS (comma-separated) in Render.
              </div>
            </div>
          ) : null}

          {isFunctionalTokenOwner ? (
            <div className="row">
              <label className="row" style={{gap:8}}>
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
                    // base units (6 decimals)
                    minBet: 10_000, // 0.01 USDC
                    maxBet: 1_000_000_000, // 1000 USDC
                  })
                  const tablePda = res.tablePda
                  setTableAddress(tablePda)

                  // Wait for account to be created on-chain
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
          ) : (
            <div className="muted" style={{fontSize:13}}>
              Table creation is available only to functional-token owners.
            </div>
          )}

          <div style={{marginTop:12}}>
            <div style={{fontSize:13,color:'#666'}}>
              {tableAddress
                ? `Table: configured (${tableAddress.slice(0, 4)}…${tableAddress.slice(-4)})`
                : 'Table: not configured (operator must set NEXT_PUBLIC_TABLE_PDA / NEXT_PUBLIC_TABLE_PDAS, or create a table)'}
            </div>

            {/* For security + simplicity: show table address input only to owners/operators when not pinned */}
            {!tableAddressIsPinned && !hasEnvTableList && isFunctionalTokenOwner ? (
              <div style={{marginTop:10}}>
                <label style={{display:'block',marginBottom:6}}>Table address (PDA) (owner only)</label>
                <input
                  value={tableAddress}
                  onChange={(e)=>setTableAddress(e.target.value.trim())}
                  placeholder={'Paste table PDA here'}
                  style={{width:'100%'}}
                />
              </div>
            ) : null}
          </div>

          {(isOperator && govBalanceUi >= OPERATOR_THRESHOLD) ? (
            <div className="notice" style={{marginTop:16,background:'#fff3cd',borderColor:'rgba(0,0,0,0.08)'}}>
              <h3 style={{margin:'0 0 8px 0',fontSize:15}}>Deposit Liquidity (Required before bets)</h3>
              <div className="row">
                <input
                  type="number"
                  placeholder="Amount (USDC)"
                  id="liquidityAmount"
                  style={{width:150}}
                  defaultValue={10}
                />
                <button onClick={async ()=>{
                  try {
                    if (!publicKey) return alert('Connect wallet first')
                    if (!tableAddress) return alert('Set table address first')
                    const { program, provider } = await ensureProgram()
                    const amountUi = Number((document.getElementById('liquidityAmount') as HTMLInputElement)?.value || 0)
                    if (!amountUi || amountUi <= 0) return alert('Enter valid amount')
                    const amount = Math.round(amountUi * 1_000_000)
                    const table = new PublicKey(tableAddress)
                    await anchorLib.depositLiquidity(program, provider, { table, amount })
                    alert('Liquidity deposited successfully!')
                  } catch (e: any) {
                    console.error(e)
                    alert('depositLiquidity failed: ' + (e?.message || e))
                  }
                }}>Deposit Liquidity</button>
                <span className="muted" style={{fontSize:13}}>Operators must fund the vault before players can bet</span>
              </div>

              <div className="row" style={{marginTop:10}}>
                <input
                  type="number"
                  placeholder="Withdraw (USDC)"
                  id="withdrawAmount"
                  style={{width:150}}
                  defaultValue={1}
                />
                <button onClick={async ()=>{
                  try {
                    if (!publicKey) return alert('Connect wallet first')
                    if (!tableAddress) return alert('Set table address first')
                    const { program, provider } = await ensureProgram()
                    const amountUi = Number((document.getElementById('withdrawAmount') as HTMLInputElement)?.value || 0)
                    if (!amountUi || amountUi <= 0) return alert('Enter valid amount')
                    const amount = Math.round(amountUi * 1_000_000)
                    const table = new PublicKey(tableAddress)
                    await anchorLib.executeWithdraw(program, provider, { table, amount })
                    alert('Liquidity withdrawn successfully!')
                  } catch (e: any) {
                    console.error(e)
                    alert('withdraw failed: ' + (e?.message || e))
                  }
                }}>Withdraw Liquidity</button>
                <span className="muted" style={{fontSize:13}}>Withdraw rules depend on table mode (PUBLIC has delay)</span>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card">
          <h2>Resolve Bet (Spin Roulette)</h2>
          <div style={{display:'flex',gap:18,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
            <div
              style={{
                width: 140,
                height: 140,
                borderRadius: '50%',
                border: '10px solid #f7f7f7',
                position: 'relative',
                background: wheelGradient,
                boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.65)',
                transform: `rotate(${wheelRotationDeg + wheelBaseOffsetDeg}deg)`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: -12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 0,
                  height: 0,
                  borderLeft: '10px solid transparent',
                  borderRight: '10px solid transparent',
                  borderBottom: '16px solid #333',
                }}
              />

              {(spinPhase === 'waiting' || spinPhase === 'spinning') && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 8,
                    borderRadius: '50%',
                    animation: 'ballOrbit 0.55s linear infinite',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: -2,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#fff',
                      boxShadow: '0 0 0 2px rgba(0,0,0,0.15)',
                    }}
                  />
                </div>
              )}

              <div
                style={{
                  position: 'absolute',
                  inset: 18,
                  borderRadius: '50%',
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: 36,
                  animation: spinPhase === 'revealed' ? 'popIn 220ms ease-out' : undefined,
                  color:
                    spinningNumber === null
                      ? '#333'
                      : rouletteColor(spinningNumber) === 'red'
                        ? '#721c24'
                        : rouletteColor(spinningNumber) === 'green'
                          ? '#155724'
                          : '#111',
                }}
              >
                {spinningNumber === null ? '—' : spinningNumber}
              </div>
            </div>

            <div style={{minWidth: 320}}>
              <div style={{fontSize:14,color:'#555',marginBottom:6}}>
                {spinPhase === 'waiting' && 'Waiting for ORAO VRF…'}
                {spinPhase === 'spinning' && 'Spinning…'}
                {spinPhase === 'revealed' && 'Result'}
                {spinPhase === 'idle' && 'Ready'}
              </div>
              {uiNotice && (
                <div className={`notice ${uiNotice.kind === 'success' ? 'notice-success' : uiNotice.kind === 'error' ? 'notice-danger' : 'notice-info'}`}>
                  {uiNotice.text}
                </div>
              )}
              {lastResult && (
                <div style={{marginTop:10,fontSize:15,fontWeight:700}}>
                  {lastResult.win
                    ? `WIN: +${lastResult.payout} USDC`
                    : 'LOSS'}
                </div>
              )}
            </div>
          </div>
          <div className="notice notice-info">
            <p style={{margin:'0 0 12px 0',fontSize:14}}>
              Сначала делаем ставку. Затем ORAO VRF подтверждает случайность (это защищает от подкрутки). Когда будет готово — нажми SPIN.
            </p>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <button disabled={!lastBetPda || !tableAddress || spinPhase === 'waiting' || spinPhase === 'spinning'} onClick={async ()=>{
                try {
                  setUiNotice(null)
                  if (!publicKey) {
                    setUiNotice({ kind: 'error', text: 'Connect wallet first' })
                    return
                  }
                  if (!tableAddress) {
                    setUiNotice({ kind: 'error', text: 'Set table address first' })
                    return
                  }
                  const betPdaStr = lastBetPda?.trim()
                  if (!betPdaStr) return setUiNotice({ kind: 'error', text: 'Сначала сделай ставку' })
                  const { program, provider } = await ensureProgram()
                  const table = new PublicKey(tableAddress)
                  const bet = new PublicKey(betPdaStr)

                  // If we just placed a bet, we likely already polled readiness. Keep the UX consistent:
                  // show waiting only when not ready.
                  if (!spinReady) {
                    setSpinPhase('waiting')
                    setSpinningNumber(null)
                    setUiNotice({ kind: 'info', text: 'Ждём подтверждение VRF…' })
                  }
                  
                  // Check if randomness is fulfilled (optional)
                  const betInfo = await provider.connection.getAccountInfo(bet)
                  if (!betInfo) {
                    setSpinPhase('idle')
                    setUiNotice({ kind: 'error', text: 'Bet account not found' })
                    return
                  }

                  // If it's already settled, don't send another tx; just show the result.
                  try {
                    let existing = await anchorLib.getBet(provider, bet, 'confirmed')
                    if (!existing.isSettled) existing = await anchorLib.getBet(provider, bet, 'finalized')
                    if (existing.isSettled && existing.resultNumber !== null) {
                      const win = existing.payout > 0n
                      setSpinPhase('revealed')
                      setSpinningNumber(existing.resultNumber)
                      setLastResult({ number: existing.resultNumber, win, payout: Number(existing.payout) / 1e6 })
                      clearBetEntryForNextRound()
                      setUiNotice({
                        kind: win ? 'success' : 'info',
                        text: win
                          ? `Already resolved. Result ${existing.resultNumber}. Won ${Number(existing.payout) / 1e6} USDC.`
                          : `Already resolved. Result ${existing.resultNumber}. Lost.`,
                      })
                      return
                    }
                  } catch {
                    // ignore; we'll try to resolve below
                  }

                  // Poll ORAO randomness before sending resolve tx to avoid RandomnessNotFulfilled
                  try {
                    let betData = await anchorLib.getBet(provider, bet, 'confirmed')
                    const randomPda = betData.randomnessAccount
                    const started = Date.now()
                    while (Date.now() - started < 30_000) {
                      const st = await anchorLib.getOraoRandomnessV2Fulfilled(provider, randomPda, 'confirmed')
                      if (st.fulfilled) break
                      await new Promise(r => setTimeout(r, 1500))
                    }
                    const st2 = await anchorLib.getOraoRandomnessV2Fulfilled(provider, randomPda, 'confirmed')
                    if (!st2.fulfilled) {
                      setSpinPhase('waiting')
                      setUiNotice({ kind: 'info', text: 'Randomness not fulfilled yet. Wait 5–15s and try again.' })
                      return
                    }
                  } catch (pollErr) {
                    console.warn('Randomness poll warning:', pollErr)
                    // If polling fails for any reason, we still try resolve; program will enforce fulfillment.
                  }

                  setSpinPhase('spinning')
                  setUiNotice({ kind: 'info', text: 'Spinning…' })
                  
                  // Pass player explicitly to avoid decoding issues
                  const txSig = await anchorLib.resolveBet(program, provider, { table, bet, player: publicKey })

                  // Confirm + read result (avoid stale reads)
                  try {
                    await provider.connection.confirmTransaction(txSig, 'confirmed')
                  } catch (confirmErr) {
                    console.warn('confirmTransaction warning:', confirmErr)
                  }
                  await new Promise(resolve => setTimeout(resolve, 1500))
                  
                  try {
                    let betData = await anchorLib.getBet(provider, bet, 'confirmed')
                    if (!betData.isSettled) {
                      // Some RPCs can lag on account state at lower commitments
                      betData = await anchorLib.getBet(provider, bet, 'finalized')
                    }
                    if (betData.isSettled && betData.resultNumber !== null) {
                      const win = betData.payout > 0n
                      setSpinPhase('revealed')
                      setSpinningNumber(betData.resultNumber)
                      setLastResult({ number: betData.resultNumber, win, payout: Number(betData.payout)/1e6 })
                      clearBetEntryForNextRound()
                      setUiNotice({
                        kind: win ? 'success' : 'info',
                        text: win
                          ? `Result ${betData.resultNumber}. Won ${Number(betData.payout)/1e6} USDC.`
                          : `Result ${betData.resultNumber}. Lost.`,
                      })
                    } else {
                      // If still pending, check transaction status
                      try {
                        const tx = await provider.connection.getTransaction(txSig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
                        
                        if (tx && tx.meta && tx.meta.err) {
                          setSpinPhase('idle')
                          setUiNotice({ kind: 'error', text: 'Resolve transaction failed. Check console for logs.' })
                          console.error('Transaction error:', tx.meta.err)
                        } else if (tx) {
                          setSpinPhase('idle')
                          setUiNotice({ kind: 'info', text: 'Tx succeeded but account not updated yet (RPC lag). Try again in a few seconds.' })
                        } else {
                          setSpinPhase('idle')
                          setUiNotice({ kind: 'info', text: 'Transaction not found yet (congestion). Wait a bit and retry.' })
                        }
                      } catch (txErr) {
                        console.error('Error fetching transaction:', txErr)
                        setSpinPhase('idle')
                        setUiNotice({ kind: 'error', text: 'Could not fetch transaction details.' })
                      }
                    }
                  } catch (err) {
                    console.error('Error fetching bet result:', err)
                    setSpinPhase('idle')
                    setUiNotice({ kind: 'error', text: 'Resolved, but failed to fetch result (RPC lag). Try again.' })
                  }

                } catch (e: any) {
                  console.error(e)
                  setSpinPhase('idle')
                  setUiNotice({ kind: 'error', text: 'resolveBet failed: ' + (e?.message || e) })
                }
              }}>{spinReady ? 'SPIN' : (lastBetPda ? 'WAIT…' : 'SPIN')}</button>
            </div>
            <div style={{marginTop:8,fontSize:13,color:'#0c5460'}}>
              {(!lastBetPda) && 'Шаг 1: сделай ставку. После этого появится ожидание VRF.'}
              {(lastBetPda && !spinReady) && 'Шаг 2: идёт проверяемая генерация случайности (VRF). Это нужно для честной рулетки.'}
              {(lastBetPda && spinReady) && 'Шаг 3: нажми SPIN, чтобы открыть результат и выплату.'}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Place a bet</h2>
          {lastResult && (
            <div className={`notice ${lastResult.win ? 'notice-success' : 'notice-danger'}`} style={{marginBottom: 20}}>
              <h3 style={{margin:0}}>Last Spin Result: {lastResult.number}</h3>
              <p style={{margin:'5px 0 0'}}>
                {lastResult.win 
                  ? `YOU WON! Payout: ${lastResult.payout} USDC` 
                  : 'You lost.'}
              </p>
            </div>
          )}
          <div style={{display:'flex',gap:24,alignItems:'flex-start',flexWrap:'wrap'}}>
            <div style={{flex:'1 1 1024px', maxWidth:'100%', overflowX:'auto'}}>
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

            <div style={{flex:'1 1 280px', minWidth:260}}>
              <div style={{marginBottom:8}}>Selected: {selectionDisplay}</div>
              <div style={{marginBottom:8}}>Stake (USDC): <input type="number" value={stake} min={1} onChange={(e)=>setStake(Number(e.target.value||1))} style={{width:120}} /></div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={handlePlaceBetUI}>Place Bet</button>
                <button className="btn-secondary" onClick={addToSlip}>Add Chip</button>
                <button className="btn-danger" onClick={()=>{ setSelectedNumber(null); setStake(1) }}>Clear</button>
              </div>
              <div style={{marginTop:12}}>
                <h3 style={{margin:'8px 0'}}>Bet Slip ({betSlip.length})</h3>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {betSlip.map((b,i)=> (
                    <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f7f7f7',padding:8,borderRadius:6}}>
                      <div style={{fontSize:13}}>{b.type} {Array.isArray(b.value)? JSON.stringify(b.value):String(b.value)}</div>
                      <div style={{display:'flex',gap:8,alignItems:'center'}}>
                        <input type="number" value={b.stake||stake} min={1} onChange={(e)=>{ const s=Number(e.target.value||1); setBetSlip(prev=>prev.map((p,idx)=> idx===i? {...p, stake: s}:p)) }} style={{width:80}} />
                        <button className="btn-secondary" onClick={()=>setBetSlip(prev=>prev.filter((_,idx)=>idx!==i))}>Remove</button>
                      </div>
                    </div>
                  ))}
                  {betSlip.length===0 && <div className="muted">No chips placed</div>}
                </div>
              </div>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    </div>
  )
}
