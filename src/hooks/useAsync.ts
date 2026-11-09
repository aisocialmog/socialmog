import { useCallback, useEffect, useRef, useState } from 'react'

/** Load data on mount / when deps change; `reload()` refetches. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  const reload = useCallback(async () => {
    const n = ++seq.current
    setLoading(true)
    try { const v = await run(); if (n === seq.current) { setData(v); setError(null) } }
    catch (e) { if (n === seq.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (n === seq.current) setLoading(false) }
  }, [run])
  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload, setData }
}
