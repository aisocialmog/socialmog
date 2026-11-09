// Lead pipeline: one column per brand status (shared Kanban board).
import { useNavigate } from 'react-router-dom'
import type { BrandOverview } from '../../data/brands'
import { BRAND_STATUSES, ENGAGEMENT_SHORT, STATUS_LABEL, type BrandStatus } from '../../lib/brands'
import { formatINRShort } from '../../lib/format'
import { Avatar } from '../../components/ui/Avatar'
import { Kanban } from '../../components/ui/Kanban'
import { BrandLogo, RenewalWarning } from '../../components/brands/BrandBits'

const COLUMN_KANJI: Record<BrandStatus, string> = { lead: '芽', pitching: '話', active: '動', paused: '休', ended: '終' }

export function BrandPipeline({ brands, money, onMove }: { brands: BrandOverview[]; money: boolean; onMove: (id: string, to: BrandStatus) => Promise<void> }) {
  const nav = useNavigate()
  return (
    <Kanban
      columns={BRAND_STATUSES.map(s => ({ key: s, label: STATUS_LABEL[s], kanji: COLUMN_KANJI[s] }))}
      items={brands} getId={b => b.id} getColumn={b => b.status} getName={b => b.name}
      onMove={(b, to) => onMove(b.id, to)} onOpen={b => nav(`/brands/${b.id}`)}
      hint="Drag a card to another column to change its status — on a phone, drag by the grip. Every move is saved in the brand’s activity."
      columnMeta={(_, list) => { const fees = list.reduce((s, b) => s + (Number(b.monthly_fee) || 0), 0); return `${list.length}${money && fees > 0 ? ` · ${formatINRShort(fees)}/mo` : ''}` }}
      renderCard={(b, grip) => <>
        <div className="flex items-start gap-2.5 pr-6">
          <BrandLogo name={b.name} path={b.logo_path} size={32} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink font-medium leading-snug break-words">{b.name}</p>
            <p className="text-xs text-muted truncate">{[ENGAGEMENT_SHORT[b.engagement_type], b.industry].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        {b.renewal_warning && <div className="mt-2.5"><RenewalWarning compact renewalDate={b.renewal_date} days={b.days_to_renewal} /></div>}
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
          {b.owner_name ? <span className="flex items-center gap-1.5 min-w-0"><Avatar name={b.owner_name} path={b.owner_photo_path} size={20} /><span className="truncate">{b.owner_name}</span></span> : <span>No owner</span>}
          <span className="flex items-center gap-2">{b.active_campaigns > 0 && <span className="num">{b.active_campaigns} live</span>}{grip}</span>
        </div>
      </>} />
  )
}
