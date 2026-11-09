import { useEffect, useState } from 'react'
import { brandsApi } from '../../data/brands'
import { renewalNotice } from '../../lib/brands'
import { Andon } from '../art/Ink'

const cache = new Map<string, string>()

/** Brand logo from Storage (signed URL), or a mincho initial on a shoji tile. */
export function BrandLogo({ name, path, size = 40 }: { name: string; path: string | null; size?: number }) {
  const [url, setUrl] = useState<string | null>(() => (path && cache.get(path)) || null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    if (cache.has(path)) { setUrl(cache.get(path)!); return }
    let live = true
    brandsApi.signedUrl(path).then(u => { if (u) { cache.set(path, u); if (live) setUrl(u) } })
    return () => { live = false }
  }, [path])
  const box = { width: size, height: size }
  return url
    ? <img src={url} alt="" style={box} className="rounded-shoji object-contain bg-kinari shrink-0" />
    : <span aria-hidden style={{ ...box, fontSize: size * 0.45 }} className="grid place-items-center rounded-shoji bg-raised font-mincho text-ink shrink-0">
        {name.replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase() || '?'}
      </span>
}

/** The 15-day retainer renewal warning (andon lantern + akane). */
export function RenewalWarning({ renewalDate, days, compact = false }: { renewalDate: string | null; days: number | null; compact?: boolean }) {
  const n = renewalNotice(renewalDate, days)
  if (!n) return null
  return compact
    ? <span className="pill bg-alert text-kinari" title={n.text}><Andon size={13} /> {days !== null && days < 0 ? 'Renewal overdue' : days === 0 ? 'Renews today' : `Renews in ${days}d`}</span>
    : <p role="status" className="flex items-center gap-2 rounded-shoji bg-alert text-kinari text-sm px-3 py-2.5"><Andon size={18} /> {n.text}</p>
}
