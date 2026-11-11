// A tiny text-only PDF writer (A4, Courier) — enough for the month-end
// statements, with no library. Pure TypeScript: tested in tests/pdf.test.ts.
// shortcut: the built-in PDF fonts have no ₹ glyph, so amounts print as "Rs"; embed a font if that ever matters.
export interface PdfLine { text: string; bold?: boolean; size?: number; gap?: number }

const esc = (s: string) => s.replace(/₹/g, 'Rs ').replace(/[–—]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1')

export function makePdf(lines: PdfLine[]): Uint8Array {
  const pages: string[] = []
  let y = 800, cur = ''
  for (const l of lines) {
    const size = l.size ?? 10
    y -= (l.gap ?? 0) + size + 5
    if (y < 50) { pages.push(cur); cur = ''; y = 800 - size }
    cur += `BT /${l.bold ? 'F2' : 'F1'} ${size} Tf 50 ${y} Td (${esc(l.text)}) Tj ET\n`
  }
  pages.push(cur)
  const objs: string[] = []
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'          // monospace keeps the amount columns aligned
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>'
  pages.forEach((c, i) => {
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`
    objs[6 + i * 2] = `<< /Length ${c.length} >>\nstream\n${c}endstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n` }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(out)      // content is ASCII only, so bytes = characters
}

/** A two-or-more column row, right-aligning everything after the first cell. */
export const row = (cells: string[], widths: number[]) => cells.map((c, i) => i === 0 ? c.slice(0, widths[0]).padEnd(widths[0]) : c.slice(0, widths[i]).padStart(widths[i])).join(' ')
export const inr = (n: number) => (n < 0 ? '-' : '') + 'Rs ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.abs(n))
