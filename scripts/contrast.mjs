// Checks WCAG contrast for every text/background pair the design tokens use.
const hex = h => h.match(/\w\w/g).map(x => parseInt(x, 16) / 255)
const lum = h => { const [r,g,b] = hex(h).map(c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4); return 0.2126*r+0.7152*g+0.0722*b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const mix = (a, b, t) => '#' + hex(a).map((c, i) => Math.round((c*t + hex(b)[i]*(1-t))*255).toString(16).padStart(2,'0')).join('')
export const pairs = {
  dark: {
    'kinari on sumi': ['#F2E8D5', '#1E1C1A'],
    'kinari on sumi-light': ['#F2E8D5', '#2A2724'],
    'kinari on sumi-raised': ['#F2E8D5', '#34302C'],
    'hai on sumi': ['#8F877F', '#1E1C1A'],
    'muted (hai 70% + kinari) on sumi-light': [mix('#8F877F', '#F2E8D5', 0.7), '#2A2724'],
    'muted on sumi-raised': [mix('#8F877F', '#F2E8D5', 0.7), '#34302C'],
    'kaki on sumi': ['#E3793A', '#1E1C1A'],
    'kaki on sumi-light': ['#E3793A', '#2A2724'],
    'yamabuki on sumi-light': ['#F2A93B', '#2A2724'],
    'sumi on kaki (primary button)': ['#1E1C1A', '#E3793A'],
    'kinari on akane (alert pill)': ['#F2E8D5', '#B7282E'],
  },
  washi: {
    'sumi on washi': ['#1E1C1A', '#F7F1E6'],
    'sumi on kinari card': ['#1E1C1A', '#F2E8D5'],
    'muted (hai 55% + sumi) on washi': [mix('#8F877F', '#1E1C1A', 0.55), '#F7F1E6'],
    'muted on kinari card': [mix('#8F877F', '#1E1C1A', 0.55), '#F2E8D5'],
    'akane on washi': ['#B7282E', '#F7F1E6'],
    'akane on kinari': ['#B7282E', '#F2E8D5'],
    'sumi on kaki (primary button)': ['#1E1C1A', '#E3793A'],
    'kinari on akane (alert pill)': ['#F2E8D5', '#B7282E'],
  },
}
let fail = 0
for (const [mode, ps] of Object.entries(pairs)) for (const [name, [fg, bg]] of Object.entries(ps)) {
  const r = ratio(fg, bg); if (r < 4.5) fail++
  console.log(`${r >= 4.5 ? 'AA ' : 'FAIL'} ${r.toFixed(2)}  ${mode.padEnd(5)} ${name} ${fg}`)
}
process.exitCode = fail ? 1 : 0
