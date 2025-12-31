import type { NextApiRequest, NextApiResponse } from 'next'
import { Connection, PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

type SocialLinks = {
  website?: string
  twitter?: string
  telegram?: string
  discord?: string
}

const OPERATOR_THRESHOLD = 51

// In-memory store (good enough for dev/test; resets on restart/deploy)
let currentLinks: SocialLinks = {
  website: process.env.NEXT_PUBLIC_SOCIAL_WEBSITE || '',
  twitter: process.env.NEXT_PUBLIC_SOCIAL_TWITTER || '',
  telegram: process.env.NEXT_PUBLIC_SOCIAL_TELEGRAM || '',
  discord: process.env.NEXT_PUBLIC_SOCIAL_DISCORD || '',
}

function pickLinks(input: any): SocialLinks {
  const out: SocialLinks = {}
  for (const k of ['website', 'twitter', 'telegram', 'discord'] as const) {
    const v = input?.[k]
    if (typeof v === 'string') out[k] = v.trim()
  }
  return out
}

function isRecent(tsMs: number) {
  const now = Date.now()
  return Math.abs(now - tsMs) < 5 * 60_000 // 5 minutes window
}

async function hasGovBalance(connection: Connection, owner: PublicKey) {
  const mintStr = process.env.NEXT_PUBLIC_GOV_MINT
  if (!mintStr) return false
  const mint = new PublicKey(mintStr)
  const ata = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(), mint.toBuffer()],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  )[0]

  try {
    const bal = await connection.getTokenAccountBalance(ata, 'confirmed')
    const ui = Number(bal.value.uiAmount || 0)
    return ui >= OPERATOR_THRESHOLD
  } catch {
    return false
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ links: currentLinks })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { publicKey, signature, message, ts, links } = req.body || {}
    if (typeof publicKey !== 'string' || typeof signature !== 'string' || typeof message !== 'string' || typeof ts !== 'number') {
      return res.status(400).json({ error: 'Invalid body' })
    }
    if (!isRecent(ts)) return res.status(401).json({ error: 'Stale request' })

    const pk = new PublicKey(publicKey)
    const sigBytes = bs58.decode(signature)
    const msgBytes = new TextEncoder().encode(message)

    const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pk.toBytes())
    if (!ok) return res.status(401).json({ error: 'Bad signature' })

    // Basic binding: message must contain this exact timestamp and intent
    if (!message.includes('Update social links') || !message.includes(String(ts))) {
      return res.status(401).json({ error: 'Bad message' })
    }

    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
    const connection = new Connection(rpcUrl)

    const allowed = await hasGovBalance(connection, pk)
    if (!allowed) return res.status(403).json({ error: 'Not authorized (GOV threshold)' })

    currentLinks = { ...currentLinks, ...pickLinks(links) }

    return res.status(200).json({ ok: true, links: currentLinks })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) })
  }
}
