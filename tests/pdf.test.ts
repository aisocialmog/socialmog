import { describe, expect, it } from 'vitest'
import { inr, makePdf, row } from '../supabase/functions/_shared/pdf'

describe('month-end PDF', () => {
  const text = (lines: Parameters<typeof makePdf>[0]) => new TextDecoder().decode(makePdf(lines))
  it('is a well-formed PDF whose xref offsets point at the objects', () => {
    const pdf = text([{ text: 'Net profit ₹2,14,000 (ok)', bold: true }, { text: 'Second — line' }])
    expect(pdf.startsWith('%PDF-1.4')).toBe(true); expect(pdf.endsWith('%%EOF')).toBe(true)
    expect(pdf).toContain('(Net profit Rs 2,14,000 \\(ok\\)) Tj'); expect(pdf).toContain('(Second - line) Tj')
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1])
    expect(pdf.slice(xref, xref + 4)).toBe('xref')
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n /gm)].map(m => Number(m[1]))
    offsets.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
  })
  it('adds pages when the lines run past the bottom', () => {
    expect(text(Array.from({ length: 120 }, (_, i) => ({ text: `line ${i}` })))).toContain('/Count 3')
  })
  it('formats rows and rupees', () => {
    expect(row(['Revenue', 'Rs 1'], [10, 6])).toBe('Revenue      Rs 1')
    expect(inr(-150000)).toBe('-Rs 1,50,000')
  })
})
