import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const cache = new Map<string, { url: string; at: number }>()

/** Photo from the private "avatars" bucket (signed URL), or initials. */
export function Avatar({ name, path, size = 32 }: { name: string; path?: string | null; size?: number }) {
  const [url, setUrl] = useState<string | null>(() => (path && cache.get(path)?.url) || null)
  useEffect(() => {
    if (path?.startsWith('preview:')) { setUrl(path.slice(8)); return }
    if (!path || !supabase) { setUrl(null); return }
    const hit = cache.get(path)
    if (hit && Date.now() - hit.at < 50 * 60_000) { setUrl(hit.url); return }
    supabase.storage.from('avatars').createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) { cache.set(path, { url: data.signedUrl, at: Date.now() }); setUrl(data.signedUrl) }
    })
  }, [path])
  const initials = name.replace(/\[|\]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
  return url
    ? <img src={url} alt="" width={size} height={size} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
    : <span aria-hidden className="grid place-items-center rounded-full bg-raised text-ink font-medium shrink-0"
        style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}>{initials}</span>
}
