// Keeps your appearance choices with your login (user_preferences), so they follow you to any device.
import { useEffect, useRef } from 'react'
import { useAuth } from './auth'
import { usePrefs } from './prefs'
import { supabase } from './supabase'

export function PrefsSync() {
  const { member } = useAuth()
  const p = usePrefs()
  const loaded = useRef<string | null>(null)
  useEffect(() => {
    if (!supabase || !member || loaded.current === member.id) return
    loaded.current = member.id
    supabase.from('user_preferences').select('theme, seasonal_effects, fuji_header').eq('team_member_id', member.id).maybeSingle()
      .then(({ data }) => { if (data) p.hydrate({ theme: data.theme, seasonal: data.seasonal_effects, fuji: data.fuji_header }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.id])
  useEffect(() => {
    if (!supabase || !member || loaded.current !== member.id) return
    const t = setTimeout(() => {
      supabase!.from('user_preferences').upsert({ team_member_id: member.id, theme: p.theme, seasonal_effects: p.seasonal, fuji_header: p.fuji }, { onConflict: 'team_member_id' }).then(() => null, () => null)
    }, 600)
    return () => clearTimeout(t)
  }, [member, p.theme, p.seasonal, p.fuji])
  return null
}
