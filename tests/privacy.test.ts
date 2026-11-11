import { describe, expect, it } from 'vitest'
import { scrub, scrubDeep } from '../supabase/functions/_shared/privacy'

describe('privacy filter', () => {
  it('removes emails, phones, UPI IDs, PAN, GSTIN, IFSC and account numbers', () => {
    expect(scrub('Mail asha.rao+work@gmail.com today')).toBe('Mail [email] today')
    expect(scrub('Call 98765 43210 or +91-9876543210 or 09876543210')).toBe('Call [phone] or [phone] or [phone]')
    expect(scrub('US line +1 (415) 555-0199')).toBe('US line [phone]')
    expect(scrub('Pay farid.edits@okicici')).toBe('Pay [upi]')
    expect(scrub('PAN ABCDE1234F, GSTIN 27ABCDE1234F1Z5')).toBe('PAN [pan], GSTIN [gstin]')
    expect(scrub('A/c 50100234567890 IFSC HDFC0001234')).toBe('A/c [account] IFSC [ifsc]')
    expect(scrub('card 4111 1111 1111 1111')).toBe('card [account]')
  })
  it('keeps the numbers the AI needs', () => {
    const s = 'Fee ₹1,50,000 for 3 reels, 1200000 views, 4.5% engagement, due 12 Dec 2026, invoice SM/26-27/004'
    expect(scrub(s)).toBe(s)
    expect(scrub('Budget 250000 and 85000')).toBe('Budget 250000 and 85000')
    expect(scrub('@founder2 please check #BrandX')).toBe('@founder2 please check #BrandX')
  })
  it('scrubs nested input', () => {
    expect(scrubDeep({ brand: 'Chai Sutra', contact: { phone: '9876543210', notes: ['x@y.co', 12] } }))
      .toEqual({ brand: 'Chai Sutra', contact: { phone: '[phone]', notes: ['[email]', 12] } })
  })
})
