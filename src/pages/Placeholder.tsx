import { EmptyState } from '../components/ui/kit'
import { formatRange, PERIOD_LABELS } from '../lib/format'
import { usePeriod } from '../lib/prefs'

export function Placeholder({ title, kanji, feature }: { title: string; kanji: string; feature: number }) {
  const { period, range } = usePeriod()
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">{kanji}</span>{title}</p>
        <h1 className="font-mincho text-3xl text-ink">{title}</h1>
        <p className="text-sm text-muted mt-1">{PERIOD_LABELS[period]} · <span className="num">{formatRange(range)}</span></p>
      </header>
      <div className="shoji"><EmptyState sketch="branch" line={`A bud, not yet open. ${title} arrives with feature ${feature}.`} /></div>
    </div>
  )
}

export function NotAllowed() {
  return (
    <div className="shoji"><h1 className="sr-only">Not available for your role</h1><EmptyState sketch="koi" line="This pond belongs to another role." action={<p className="text-sm text-muted -mt-2">Ask a founder if you need access.</p>} /></div>
  )
}
