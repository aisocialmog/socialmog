import { describe, expect, it } from 'vitest'
import { crc32, csvCell, makeZip, toBackupCsv } from '../supabase/functions/_shared/zip'

describe('backup zip', () => {
  it('crc32 matches the standard check value', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926))
  it('writes a readable archive: headers, names, contents, central directory', () => {
    const z = makeZip([{ name: 'a.csv', data: 'id\r\n1' }, { name: 'ünï/b.json', data: '[{"x":₹1}]' }]), v = new DataView(z.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    const end = z.length - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50); expect(v.getUint16(end + 10, true)).toBe(2)
    const cd = v.getUint32(end + 16, true)
    expect(v.getUint32(cd, true)).toBe(0x02014b50)
    const txt = new TextDecoder().decode(z)
    expect(txt).toContain('a.csv'); expect(txt).toContain('id\r\n1'); expect(txt).toContain('ünï/b.json')
    // the first entry's recorded crc is the crc of its data
    expect(v.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('id\r\n1')))
  })
  it('csv is faithful and safe to quote', () => {
    expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell('say "hi"')).toBe('"say ""hi"""'); expect(csvCell(null)).toBe(''); expect(csvCell(0)).toBe('0')
    expect(csvCell({ a: [1] })).toBe('"{""a"":[1]}"'); expect(csvCell('=SUM(A1)')).toBe('=SUM(A1)')
    expect(toBackupCsv([{ id: 1, n: 'x' }, { id: 2, extra: true }])).toBe('id,n,extra\r\n1,x,\r\n2,,true')
  })
})
