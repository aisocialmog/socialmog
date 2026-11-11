// Shūchū — focus mode: one task, full screen, Fuji at dusk. The session's
// time is logged to the task and the person's status reads "Focus".
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Fuji } from '../components/art/Fuji'
import { useAsync } from '../hooks/useAsync'
import { season } from '../lib/time'
import { db } from '../data/db'
import { workApi } from '../data/work'

export function FocusPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { data: task } = useAsync(() => workApi.task(id), [id])
  const [minutes, setMinutes] = useState<25 | 50>(25)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [left, setLeft] = useState(0)
  const [done, setDone] = useState(false)
  const running = useRef(false)

  const stop = useCallback(async (finished: boolean) => {
    if (!running.current) return
    running.current = false
    setEndsAt(null); setDone(finished)
    await workApi.stopTimer().catch(() => null)
    await db.rpc('set_presence', { p_status: 'working' }).catch(() => null)
  }, [])
  const start = async () => {
    running.current = true; setDone(false)
    await workApi.startTimer(id, 'focus')
    await db.rpc('set_presence', { p_status: 'focus', p_message: task?.title ?? null, p_expected_back: new Date(Date.now() + minutes * 60000).toISOString() }).catch(() => null)
    setEndsAt(Date.now() + minutes * 60000); setLeft(minutes * 60)
  }
  useEffect(() => {
    if (!endsAt) return
    const t = setInterval(() => { const s = Math.max(0, Math.round((endsAt - Date.now()) / 1000)); setLeft(s); if (s === 0) stop(true) }, 500)
    return () => clearInterval(t)
  }, [endsAt, stop])
  // leaving the page ends the session, so time is never left running
  useEffect(() => () => { stop(false) }, [stop])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running.current) nav(-1) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [nav])

  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0')
  return (
    <div className="fixed inset-0 z-[70] bg-sumi text-kinari flex flex-col" role="dialog" aria-modal="true" aria-label="Focus mode">
      <Fuji phase="sunset" season={season()} showSeason={false} className="absolute inset-0 w-full h-full opacity-70" />
      <div className="absolute inset-0 bg-gradient-to-b from-sumi/60 via-sumi/20 to-sumi/80" aria-hidden />
      <div className="relative flex-1 grid place-items-center px-6 text-center">
        <div>
          <p className="text-xs tracking-[0.3em] text-kinari/80"><span lang="ja">集中</span> · SHŪCHŪ</p>
          <h1 className="font-mincho text-2xl sm:text-4xl mt-4 max-w-2xl">{task?.title ?? '…'}</h1>
          {endsAt ? <>
            <p className="font-mincho text-7xl sm:text-9xl num mt-8" role="timer" aria-live="off">{mm}:{ss}</p>
            <button className="mt-10 btn border border-kinari/60 text-kinari hover:bg-kinari/10" onClick={() => stop(false)}>End session</button>
          </> : <>
            {done && <p className="mt-6 text-lg">Session complete. The time is on the task.</p>}
            <div className="mt-8 flex justify-center gap-3" role="radiogroup" aria-label="Session length">
              {([25, 50] as const).map(m => <button key={m} role="radio" aria-checked={minutes === m} onClick={() => setMinutes(m)}
                className={`w-24 h-24 rounded-full border font-mincho text-2xl num focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kaki ${minutes === m ? 'bg-kaki text-sumi border-kaki' : 'border-kinari/60 text-kinari hover:bg-kinari/10'}`}>{m}<span className="block text-xs font-sans">minutes</span></button>)}
            </div>
            <div className="mt-8 flex justify-center gap-3">
              <button className="btn bg-kaki text-sumi" disabled={!task} onClick={start}>{done ? 'Another session' : 'Begin'}</button>
              <button className="btn border border-kinari/60 text-kinari hover:bg-kinari/10" onClick={() => nav(`/tasks/${id}`)}>Back to the task</button>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
