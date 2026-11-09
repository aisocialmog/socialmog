// Google sends people back here. supabase-js reads the session from the URL;
// if Google sign-in was refused (email not invited) we show why on the login page.
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { authMessage } from '../../lib/auth'
import { EnsoSpinner } from '../../components/art/Ink'

export function AuthCallback() {
  const nav = useNavigate()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search.slice(1) + '&' + window.location.hash.slice(1))
    const err = params.get('error_description') || params.get('error')
    if (err) { nav('/login', { replace: true, state: { error: authMessage(err) } }); return }
    if (!supabase) { nav('/login', { replace: true }); return }
    supabase.auth.getSession().then(({ data }) => nav(data.session ? '/' : '/login', { replace: true }))
  }, [nav])
  return <div className="min-h-screen grid place-items-center"><EnsoSpinner label="Signing you in" /></div>
}
