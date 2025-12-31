import Link from 'next/link'
import { useEffect, useState } from 'react'

export type SocialLinks = {
  website?: string
  twitter?: string
  telegram?: string
  discord?: string
}

function safeUrl(u?: string) {
  if (!u) return ''
  const trimmed = u.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

function Icon(props: { name: 'website' | 'twitter' | 'telegram' | 'discord' }) {
  const common = { className: 'socialIcon', viewBox: '0 0 24 24', 'aria-hidden': true } as any
  switch (props.name) {
    case 'website':
      return (
        <svg {...common}>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9h-3.09a15.6 15.6 0 0 0-1.02-5.03A8.03 8.03 0 0 1 19.93 11ZM12 4c.9 0 2.28 1.64 3 7H9c.72-5.36 2.1-7 3-7ZM8.18 5.97A15.6 15.6 0 0 0 7.16 11H4.07a8.03 8.03 0 0 1 4.11-5.03ZM4.07 13h3.09c.2 1.82.64 3.58 1.02 5.03A8.03 8.03 0 0 1 4.07 13Zm4.93 0h6c-.72 5.36-2.1 7-3 7s-2.28-1.64-3-7Zm6.82 5.03c.38-1.45.82-3.21 1.02-5.03h3.09a8.03 8.03 0 0 1-4.11 5.03Z" />
        </svg>
      )
    case 'twitter':
      return (
        <svg {...common}>
          <path d="M18.3 2H21l-6.2 7.1L22 22h-6.8l-5.3-7-6.1 7H1l6.7-7.7L0 2h6.9l4.8 6.3L18.3 2Zm-1.2 18h1.5L5.8 3.9H4.2L17.1 20Z" />
        </svg>
      )
    case 'telegram':
      return (
        <svg {...common}>
          <path d="M9.04 15.55 8.9 19.7c.6 0 .86-.26 1.17-.57l2.8-2.68 5.8 4.25c1.06.58 1.82.28 2.1-.98L23.9 4.9c.34-1.56-.56-2.17-1.6-1.78L2.55 10.7c-1.5.58-1.48 1.4-.27 1.77l5.06 1.58L19.1 6.6c.56-.34 1.07-.15.65.22" />
        </svg>
      )
    case 'discord':
      return (
        <svg {...common}>
          <path d="M19.5 5.5A14.6 14.6 0 0 0 16 4.4l-.4.8a13.1 13.1 0 0 0-3.2 0l-.4-.8a14.6 14.6 0 0 0-3.5 1.1C6.2 8 5.4 10.4 5.6 12.8c1.4 1 2.8 1.6 4.2 2l.6-1.1c-.7-.3-1.4-.7-2.1-1.2l.5-.4c1.3.6 2.6 1 4 1s2.7-.3 4-1l.5.4c-.7.5-1.4.9-2.1 1.2l.6 1.1c1.4-.4 2.8-1 4.2-2 .2-2.4-.6-4.8-2.3-7.3ZM9.6 12.3c-.6 0-1.1-.6-1.1-1.3 0-.7.5-1.3 1.1-1.3.6 0 1.1.6 1.1 1.3 0 .7-.5 1.3-1.1 1.3Zm4.8 0c-.6 0-1.1-.6-1.1-1.3 0-.7.5-1.3 1.1-1.3.6 0 1.1.6 1.1 1.3 0 .7-.5 1.3-1.1 1.3Z" />
        </svg>
      )
  }
}

export default function SiteHeader(props: { showAdminLink: boolean }) {
  const [links, setLinks] = useState<SocialLinks>({
    website: process.env.NEXT_PUBLIC_SOCIAL_WEBSITE || '',
    twitter: process.env.NEXT_PUBLIC_SOCIAL_TWITTER || '',
    telegram: process.env.NEXT_PUBLIC_SOCIAL_TELEGRAM || '',
    discord: process.env.NEXT_PUBLIC_SOCIAL_DISCORD || '',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/social-links')
        if (!res.ok) return
        const json = await res.json()
        if (cancelled) return
        if (json?.links) setLinks(json.links)
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const items: Array<{ label: string; href: string; icon: 'website' | 'twitter' | 'telegram' | 'discord' }> = []
  if (links.website) items.push({ label: 'Website', href: safeUrl(links.website), icon: 'website' })
  if (links.twitter) items.push({ label: 'X/Twitter', href: safeUrl(links.twitter), icon: 'twitter' })
  if (links.telegram) items.push({ label: 'Telegram', href: safeUrl(links.telegram), icon: 'telegram' })
  if (links.discord) items.push({ label: 'Discord', href: safeUrl(links.discord), icon: 'discord' })

  return (
    <header className="topbar space-between">
      <div className="row">
        <Link href="/" style={{fontWeight: 900, textDecoration: 'none'}}>
          Provably-Fair Roulette
        </Link>
        <Link href="/get-tokens" className="muted" style={{fontSize: 13, textDecoration: 'none'}}>
          Get test tokens
        </Link>
        {props.showAdminLink ? (
          <Link href="/admin" className="muted" style={{fontSize: 13, textDecoration: 'none'}}>
            Admin
          </Link>
        ) : null}
      </div>

      <div className="row">
        {items.map((it) => (
          <a
            key={it.label}
            href={it.href}
            target="_blank"
            rel="noreferrer"
            className="socialLink"
            title={it.label}
            aria-label={it.label}
          >
            <Icon name={it.icon} />
          </a>
        ))}
      </div>
    </header>
  )
}
