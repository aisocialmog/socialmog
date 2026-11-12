import { describe, expect, it } from 'vitest'
import { applyLabels, LABEL_DEFAULTS } from '../src/lib/labels'
import { STAGE_LABEL } from '../src/lib/production'

describe('editable list names', () => {
  it('renames a stage, ignores unknown keys, and goes back to the default', () => {
    applyLabels([{ kind: 'stage', key: 'editing', label: ' In the edit suite ' }, { kind: 'stage', key: 'nonsense', label: 'x' }, { kind: 'stage', key: 'idea', label: '  ' }])
    expect(STAGE_LABEL.editing).toBe('In the edit suite'); expect(STAGE_LABEL.idea).toBe(LABEL_DEFAULTS.stage.idea); expect('nonsense' in STAGE_LABEL).toBe(false)
    applyLabels([]); expect(STAGE_LABEL.editing).toBe(LABEL_DEFAULTS.stage.editing)
  })
})
