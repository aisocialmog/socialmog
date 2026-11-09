/** What a new password still needs (empty = fine). Supabase also enforces its own minimum. */
export function passwordProblems(p: string): string[] {
  const out: string[] = []
  if (p.length < 8) out.push('at least 8 characters')
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) out.push('letters and numbers')
  return out
}
