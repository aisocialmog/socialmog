import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

/** Bottom sheet on phones, centred dialog on larger screens. Esc / backdrop closes. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Close"])')?.focus()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => { window.removeEventListener('keydown', k); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-sumi/70" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div ref={box} className={`relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-xl'} max-h-[92vh] overflow-y-auto bg-raised rounded-t-[14px] sm:rounded-shoji border border-line/30 p-6 rise`}
           style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-mincho text-xl text-ink">{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
