import type { ReactNode } from 'react'
import { Seigaiha, Torii } from '../../components/art/Ink'

/** Shared frame for login, forgot-password, reset and no-access screens. */
export function AuthLayout({ title, subtitle, children, footer }: {
  title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode
}) {
  return (
    <div className="relative min-h-screen grid place-items-center px-4 py-10 overflow-hidden">
      <div className="fixed inset-x-0 top-0 h-[3px] bg-sunset" aria-hidden />
      <Seigaiha opacity={0.045} />
      <Torii className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[34rem] max-w-[120vw] text-line opacity-[0.12]" />
      <main className="relative w-full max-w-sm">
        <div className="shoji p-7 sm:p-8 bg-card/95 backdrop-blur rise">
          <span className="grid place-items-center w-12 h-12 rounded-full bg-akane text-kinari font-mincho font-bold -rotate-6" aria-hidden>SM</span>
          <h1 className="font-mincho text-2xl text-ink mt-6">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1.5">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-xs text-muted">{footer}</div>}
      </main>
    </div>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-shoji bg-alert text-kinari text-sm px-3 py-2.5">{children}</p>
}
export function FormNote({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-shoji border border-line/40 text-ink text-sm px-3 py-2.5">{children}</p>
}

export function GoogleMark() {
  // the four-colour "G" is Google's sign-in mark (required on Google buttons)
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
