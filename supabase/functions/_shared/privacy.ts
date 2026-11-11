// Privacy filter: personal and payment identifiers are removed from anything
// sent to an AI provider. Pure TypeScript (no Deno APIs) so the app's unit
// tests run it too: tests/privacy.test.ts.
const RULES: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],                                   // emails
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/gi, '[gstin]'],                    // GSTIN (contains a PAN)
  [/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[pan]'],                                          // PAN
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/gi, '[ifsc]'],                                       // IFSC
  [/\b[\w.-]{2,}@[a-z]{2,}\b/gi, '[upi]'],                                        // UPI ID (name@bank, no domain dot)
  [/(?:\+?91[\s-]?|\b0)?[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]'],                    // Indian mobile numbers
  [/\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g, '[phone]'],       // other international numbers
  [/\b\d(?:[\s-]?\d){8,17}\b/g, '[account]'],                                     // bank account / card style digit runs (9–18 digits)
]

/** Text with emails, phone numbers, UPI IDs, bank details, PAN and GSTIN replaced by placeholders. */
export function scrub(text: string): string {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text)
}

/** Scrubs every string inside a JSON-like value. */
export function scrubDeep<T>(v: T): T {
  if (typeof v === 'string') return scrub(v) as T
  if (Array.isArray(v)) return v.map(scrubDeep) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, scrubDeep(x)])) as T
  return v
}
