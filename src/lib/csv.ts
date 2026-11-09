// CSV export used by every list page. Opens cleanly in Excel / Google Sheets
// (BOM for UTF-8 so ₹ and kanji survive; formulas neutralised).
export interface CsvColumn<T> { header: string; value: (row: T) => string | number | null | undefined }

export function toCSV<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`          // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map(c => esc(c.header)).join(',')]
  for (const r of rows) lines.push(columns.map(c => esc(c.value(r))).join(','))
  return '﻿' + lines.join('\r\n')
}

export function downloadCSV<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const blob = new Blob([toCSV(rows, columns)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
