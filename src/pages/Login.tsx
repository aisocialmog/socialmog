import { Link } from 'react-router-dom'
import { Seigaiha, Torii } from '../components/art/Ink'

/** Visual only — sign-in is wired up in feature 1 (Supabase Auth). */
export function Login() {
  return (
    <div className="relative min-h-screen grid place-items-center px-4 overflow-hidden">
      <div className="fixed inset-x-0 top-0 h-[3px] bg-sunset" aria-hidden />
      <Seigaiha opacity={0.045} />
      <Torii className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[34rem] max-w-[120vw] text-line opacity-[0.12]" />
      <div className="relative w-full max-w-sm shoji p-8 bg-card/95 backdrop-blur rise">
        <span className="grid place-items-center w-12 h-12 rounded-full bg-akane text-kinari font-mincho font-bold -rotate-6" aria-hidden>SM</span>
        <h1 className="font-mincho text-2xl text-ink mt-6">Social Mog OS</h1>
        <p className="text-sm text-muted mt-1">Sign in to continue.</p>
        <form className="mt-6 space-y-4" onSubmit={e => e.preventDefault()}>
          <label className="block text-sm text-muted">Email<input type="email" autoComplete="email" className="field mt-1.5" /></label>
          <label className="block text-sm text-muted">Password<input type="password" autoComplete="current-password" className="field mt-1.5" /></label>
          <button className="btn-primary w-full justify-center">Sign in</button>
        </form>
        <p className="text-xs text-muted mt-6">Team members only. <Link to="/" className="underline underline-offset-4 hover:text-ink">Back to preview</Link></p>
      </div>
    </div>
  )
}
