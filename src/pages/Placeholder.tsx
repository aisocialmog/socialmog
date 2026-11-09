import { EmptyState } from '../components/ui/kit'

export function Placeholder({ title, kanji, feature }: { title: string; kanji: string; feature: number }) {
  return (
    <div className="space-y-6">
      <h1 className="font-mincho text-3xl text-ink"><span className="text-accent-ink mr-3" aria-hidden>{kanji}</span>{title}</h1>
      <div className="shoji"><EmptyState sketch="branch" line={`A bud, not yet open. ${title} arrives with feature ${feature}.`} /></div>
    </div>
  )
}
