import { useAuth } from '../../lib/auth'
import { AuthLayout } from './AuthLayout'

export function NoAccess({ email, reason }: { email: string; reason: 'not_invited' | 'inactive' }) {
  const { signOut } = useAuth()
  return (
    <AuthLayout title={reason === 'inactive' ? 'Your access is paused' : 'Not on the team yet'}
      subtitle={reason === 'inactive'
        ? <>The account <span className="text-ink">{email}</span> has been made inactive. Ask a founder if this is a mistake.</>
        : <>You signed in as <span className="text-ink">{email}</span>, but that email hasn’t been invited. Ask a founder to invite it, or sign in with the email they invited.</>}>
      <button className="btn-primary w-full justify-center" onClick={signOut}>Sign out</button>
    </AuthLayout>
  )
}
