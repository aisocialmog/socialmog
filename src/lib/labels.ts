// Editable names for stages, campaign types and deliverable formats (Settings → Lists).
// The keys stay fixed (reports and automations depend on them); only the words change.
// shortcut: the label tables are edited in place at start-up, then the page is re-drawn; a new list kind needs a line here.
import { useSyncExternalStore } from 'react'
import { KIND_LABEL } from './campaigns'
import { FORMAT_LABEL, STAGE_LABEL } from './production'

export type LabelKind = 'stage' | 'campaign_kind' | 'format'
export interface LabelRow { kind: LabelKind; key: string; label: string }
const TARGET: Record<LabelKind, Record<string, string>> = { stage: STAGE_LABEL, campaign_kind: KIND_LABEL, format: FORMAT_LABEL }
export const LABEL_DEFAULTS: Record<LabelKind, Record<string, string>> = { stage: { ...STAGE_LABEL }, campaign_kind: { ...KIND_LABEL }, format: { ...FORMAT_LABEL } }
export const LABEL_TITLE: Record<LabelKind, string> = { stage: 'Production stages', campaign_kind: 'Campaign types', format: 'Deliverable types' }

let version = 0
const listeners = new Set<() => void>()
/** Puts the saved names in place (anything not listed goes back to its default). */
export function applyLabels(rows: LabelRow[]) {
  for (const k of Object.keys(TARGET) as LabelKind[]) Object.assign(TARGET[k], LABEL_DEFAULTS[k])
  for (const r of rows) if (r.label.trim() && r.key in LABEL_DEFAULTS[r.kind]) TARGET[r.kind][r.key] = r.label.trim()
  version++; listeners.forEach(l => l())
}
export const useLabelsVersion = () => useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => version)
